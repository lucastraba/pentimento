import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { findImageRefs, imageExtension, isRemote, keyImages, type ImageRef } from './imageref.js'

/**
 * The image files a document shows: finding them on disk the way Obsidian does, hashing
 * them, and keeping each draft's copies in `.history/<name>/assets/<hash>.<ext>`.
 */

export const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
}

const isFile = (p: string): boolean => {
  try { return fs.statSync(p).isFile() } catch { return false }
}

const isInside = (root: string, target: string): boolean => {
  const rel = path.relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/** The Obsidian vault a folder is in: the nearest ancestor with a `.obsidian` folder. */
export const vaultRoot = (dir: string): string | null => {
  let cur = path.resolve(dir)
  for (;;) {
    try { if (fs.statSync(path.join(cur, '.obsidian')).isDirectory()) return cur } catch { /* keep looking */ }
    const parent = path.dirname(cur)
    if (parent === cur) return null
    cur = parent
  }
}

/** Images stay inside the vault when the document is in one, otherwise inside the document's folder. */
export const imageRoot = (docPath: string): string => vaultRoot(path.dirname(docPath)) ?? path.dirname(path.resolve(docPath))

const attachmentFolder = (vault: string): string | null => {
  try {
    const value = (JSON.parse(fs.readFileSync(path.join(vault, '.obsidian', 'app.json'), 'utf8')) as Record<string, unknown>).attachmentFolderPath
    return typeof value === 'string' ? value : null
  } catch {
    return null
  }
}

// Obsidian finds `![[name.png]]` anywhere in the vault. The index is rebuilt at most every few
// seconds, so a live viewer rendering on every change doesn't walk the vault each time.
const INDEX_TTL_MS = 5000
const INDEX_LIMIT = 50000
const indexes = new Map<string, { at: number; byName: Map<string, string[]> }>()

const filesNamed = (vault: string, name: string): string[] => {
  let index = indexes.get(vault)
  if (!index || Date.now() - index.at > INDEX_TTL_MS) {
    const byName = new Map<string, string[]>()
    let seen = 0
    const walk = (dir: string): void => {
      let entries: fs.Dirent[]
      try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
      for (const entry of entries) {
        if (seen >= INDEX_LIMIT || entry.name.startsWith('.') || entry.name === 'node_modules') continue
        const p = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(p)
        else if (entry.isFile() && imageExtension(entry.name)) {
          seen++
          const key = entry.name.toLowerCase()
          byName.set(key, [...(byName.get(key) ?? []), p])
        }
      }
    }
    walk(vault)
    index = { at: Date.now(), byName }
    indexes.set(vault, index)
  }
  // shortest path first, as Obsidian prefers
  return [...(index.byName.get(name.toLowerCase()) ?? [])].sort((a, b) => a.length - b.length)
}

const candidates = (docPath: string, ref: ImageRef): string[] => {
  const dir = path.dirname(path.resolve(docPath))
  if (!ref.embed) return [path.resolve(dir, ref.target)]
  const vault = vaultRoot(dir)
  const out: string[] = []
  if (vault && ref.target.includes('/')) out.push(path.resolve(vault, ref.target))
  out.push(path.resolve(dir, ref.target))
  if (vault) {
    const folder = attachmentFolder(vault)
    if (folder !== null) {
      out.push(folder === '.' || folder.startsWith('./')
        ? path.resolve(dir, folder, ref.target)
        : path.resolve(vault, folder.replace(/^\/+/, ''), ref.target))
    }
    out.push(...filesNamed(vault, path.basename(ref.target)).filter((p) => p.endsWith(ref.target) || !ref.target.includes('/')))
  }
  return out
}

export type ImageProblem = 'remote' | 'type' | 'missing' | 'outside'

export interface ResolvedImage {
  ref: ImageRef
  file: string | null
  problem: ImageProblem | null
}

/** The file an image reference shows, or why there isn't one. A `data:` image has neither. */
export const resolveImage = (docPath: string, ref: ImageRef): ResolvedImage => {
  if (/^data:/i.test(ref.target)) return { ref, file: null, problem: null }
  if (isRemote(ref.target)) return { ref, file: null, problem: 'remote' }
  if (!imageExtension(ref.target)) return { ref, file: null, problem: 'type' }
  let root: string
  try { root = fs.realpathSync(imageRoot(docPath)) } catch { return { ref, file: null, problem: 'missing' } }
  let outside = false
  for (const candidate of candidates(docPath, ref)) {
    if (!isFile(candidate)) continue
    const real = fs.realpathSync(candidate)
    if (isInside(root, real)) return { ref, file: real, problem: null }
    outside = true
  }
  return { ref, file: null, problem: outside ? 'outside' : 'missing' }
}

const hashes = new Map<string, { mtimeMs: number; size: number; hash: string }>()

/** The first 16 hex characters of the file's SHA-256, cached until the file changes. */
export const hashFile = (file: string): string => {
  const st = fs.statSync(file)
  const hit = hashes.get(file)
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.hash
  const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16)
  hashes.set(file, { mtimeMs: st.mtimeMs, size: st.size, hash })
  return hash
}

export const assetsDir = (historyDir: string): string => path.join(historyDir, 'assets')

const assetFor = (hash: string, ref: ImageRef): string | null => {
  const ext = imageExtension(ref.target)
  return ext && /^[0-9a-f]{16}$/.test(hash) ? `${hash}.${ext}` : null
}

const copyInto = (source: string, dest: string): void => {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  const tmp = `${dest}.tmp-${process.pid}`
  try {
    fs.copyFileSync(source, tmp)
    fs.renameSync(tmp, dest)
  } catch (error) {
    fs.rmSync(tmp, { force: true })
    throw error
  }
}

/** Copy a file into the history's assets unless an identical one is there; returns the path when it wrote one. */
const storeFile = (file: string, ref: ImageRef, historyDir: string): { hash: string; written: string | null } => {
  const hash = hashFile(file)
  const dest = path.join(assetsDir(historyDir), assetFor(hash, ref)!)
  if (isFile(dest)) return { hash, written: null }
  copyInto(file, dest)
  return { hash, written: dest }
}

export interface StoredImages {
  /** reference → hash, for the revision's `images` entry */
  images: Record<string, string>
  /** asset files this call created, so a failed snapshot can take them back */
  written: string[]
  /** local images that aren't there to store */
  missing: ResolvedImage[]
}

/** Store every local image a body shows, for the draft being saved. */
export const storeImages = (docPath: string, historyDir: string, body: string): StoredImages => {
  const out: StoredImages = { images: {}, written: [], missing: [] }
  for (const ref of findImageRefs(body)) {
    if (ref.ref in out.images) continue
    const resolved = resolveImage(docPath, ref)
    if (!resolved.file) {
      if (resolved.problem === 'missing' || resolved.problem === 'outside') out.missing.push(resolved)
      continue
    }
    const { hash, written } = storeFile(resolved.file, ref, historyDir)
    out.images[ref.ref] = hash
    if (written) out.written.push(written)
  }
  return out
}

/** True when a body's images on disk are no longer the ones a draft saved. */
export const imagesDiffer = (docPath: string, body: string, saved: Record<string, string>): boolean =>
  findImageRefs(body).some((ref) => {
    const resolved = resolveImage(docPath, ref)
    return (resolved.file ? hashFile(resolved.file) : undefined) !== saved[ref.ref]
  })

/** Where a missing image would be written back: its own path, or next to the document for an embed. */
const restoreTarget = (docPath: string, ref: ImageRef): string | null => {
  const dir = path.dirname(path.resolve(docPath))
  const dest = ref.embed ? path.join(dir, path.basename(ref.target)) : path.resolve(dir, ref.target)
  let ancestor = path.dirname(dest)
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor)
  return isInside(fs.realpathSync(imageRoot(docPath)), path.join(fs.realpathSync(ancestor), path.relative(ancestor, dest))) ? dest : null
}

/**
 * Put a draft's images back at their paths, for `revert`. A file that would be overwritten is
 * stored in the assets first, so it can always be found again. Returns the files written.
 */
export const restoreImages = (docPath: string, historyDir: string, body: string, images: Record<string, string>): string[] => {
  const restored: string[] = []
  const done = new Set<string>()
  for (const ref of findImageRefs(body)) {
    const asset = images[ref.ref] ? assetFor(images[ref.ref], ref) : null
    if (!asset || done.has(ref.ref)) continue
    done.add(ref.ref)
    const source = path.join(assetsDir(historyDir), asset)
    if (!isFile(source)) continue
    const resolved = resolveImage(docPath, ref)
    let dest = resolved.file
    if (dest) {
      if (hashFile(dest) === images[ref.ref]) continue
      storeFile(dest, ref, historyDir)
    } else {
      if (resolved.problem !== 'missing') continue
      dest = restoreTarget(docPath, ref)
      if (!dest) continue
    }
    copyInto(source, dest)
    restored.push(dest)
  }
  return restored
}

export interface ImageKeys {
  /** key a body with a revision's `images` map, or from the files on disk when it has none */
  key: (body: string, images?: Record<string, string>) => string
  /** the file that holds a stored image */
  file: (asset: string) => string | null
}

/** Keys the drafts of one document and remembers which file holds each image it saw. */
export const imageKeys = (docPath: string, historyDir: string): ImageKeys => {
  const files = new Map<string, string>()
  const stored = (asset: string): string | null => {
    const p = path.join(assetsDir(historyDir), asset)
    return isFile(p) ? p : null
  }
  const fromDisk = (ref: ImageRef): string | null => {
    const resolved = resolveImage(docPath, ref)
    if (!resolved.file) return null
    const asset = assetFor(hashFile(resolved.file), ref)
    if (asset && !files.has(asset)) files.set(asset, resolved.file)
    return asset
  }
  const fromMap = (images: Record<string, string>) => (ref: ImageRef): string | null => {
    const asset = images[ref.ref] ? assetFor(images[ref.ref], ref) : null
    if (!asset) return null
    if (!files.has(asset)) {
      const p = stored(asset)
      if (!p) return null
      files.set(asset, p)
    }
    return asset
  }
  return {
    key: (body, images) => keyImages(body, images ? fromMap(images) : fromDisk),
    file: (asset) => files.get(asset) ?? stored(asset),
  }
}

/** A stored image as a `data:` URI, for pages that carry their images inside them. */
export const dataUri = (file: string, asset: string): string =>
  `data:${MIME[asset.slice(asset.lastIndexOf('.') + 1)]};base64,${fs.readFileSync(file).toString('base64')}`
