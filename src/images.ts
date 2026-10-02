import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { findImageRefs, imageExtension, isRemote, keyImages, type ImageRef } from './imageref.js'

/**
 * The image files a document shows: finding them on disk the way Obsidian does, hashing
 * them, and keeping each draft's copies in `.history/<name>/assets/<hash>.<ext>`.
 *
 * Everything here may run on a reference an untrusted document wrote, and the viewer serves
 * what it finds to anyone with the read-only link. So a file is an image only when the file
 * itself is one (its real path, its first bytes), inside the document's folder or vault, and
 * small enough to carry; history copies are read and written only as plain files.
 */

export const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
}

/** The largest image a page carries or a draft keeps; lint warns from 1 MB. */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024

const isInside = (root: string, target: string): boolean => {
  const rel = path.relative(root, target)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel))
}

/** A plain file, not a link to one. */
const isPlainFile = (p: string): boolean => {
  try { return fs.lstatSync(p).isFile() } catch { return false }
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

// Obsidian finds `![[name.png]]` anywhere in the vault. The index is built only when an embed
// isn't in the usual places, at most every few seconds, and stops after a fixed number of
// entries so a huge vault costs a bounded walk.
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
        if (++seen > INDEX_LIMIT) return
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
        const p = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(p)
        else if (entry.isFile() && imageExtension(entry.name)) {
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

/** Where a reference could point, nearest first; the vault-wide search runs only if the rest miss. */
function* candidates(docPath: string, ref: ImageRef): Generator<string> {
  const dir = path.dirname(path.resolve(docPath))
  if (!ref.embed) { yield path.resolve(dir, ref.target); return }
  const vault = vaultRoot(dir)
  if (vault && ref.target.includes('/')) yield path.resolve(vault, ref.target)
  yield path.resolve(dir, ref.target)
  if (!vault) return
  const folder = attachmentFolder(vault)
  if (folder !== null) {
    yield folder === '.' || folder.startsWith('./')
      ? path.resolve(dir, folder, ref.target)
      : path.resolve(vault, folder.replace(/^\/+/, ''), ref.target)
  }
  const tail = path.sep + ref.target.split('/').join(path.sep)
  for (const p of filesNamed(vault, path.basename(ref.target))) {
    if (!ref.target.includes('/') || p.endsWith(tail)) yield p
  }
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** What a file's first bytes say it is, among the images a page can show. */
const sniff = (head: Buffer): string | null => {
  if (head.subarray(0, 8).equals(PNG)) return 'png'
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpg'
  const ascii = head.subarray(0, 12).toString('latin1')
  if (ascii.startsWith('GIF87a') || ascii.startsWith('GIF89a')) return 'gif'
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return 'webp'
  // an SVG is text whose first element is <svg>, after an optional prolog, comments, and doctype
  const text = head.toString('utf8').replace(/^﻿/, '')
  if (/^\s*(?:<\?xml[^>]*>\s*)?(?:(?:<!--[\s\S]*?-->|<!DOCTYPE[^>]*>)\s*)*<svg[\s>/]/i.test(text)) return 'svg'
  return null
}

interface FileFacts { stamp: string; type: string | null; hash?: string; size?: { width: number; height: number } | null }
const facts = new Map<string, FileFacts>()

// A file changed within this window may still be being written; its facts aren't cached.
const SETTLE_MS = 2000
const stampOf = (st: fs.Stats): string => `${st.ino}:${st.size}:${st.mtimeMs}:${st.ctimeMs}`

/** The type a file sniffs as, cached until it changes. Throws when it can't be read. */
const typeOf = (file: string, st: fs.Stats): string | null => {
  const stamp = stampOf(st)
  const hit = facts.get(file)
  if (hit && hit.stamp === stamp) return hit.type
  const head = Buffer.alloc(4096)
  const fd = fs.openSync(file, 'r')
  let n: number
  try { n = fs.readSync(fd, head, 0, head.length, 0) } finally { fs.closeSync(fd) }
  const type = sniff(head.subarray(0, n))
  if (Date.now() - st.mtimeMs > SETTLE_MS) facts.set(file, { stamp, type })
  return type
}

const sha = (bytes: Buffer): string => crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 16)

/** A file's bytes and their hash, read once so the hash always names the bytes kept. */
const readImage = (file: string): { bytes: Buffer; hash: string } => {
  const bytes = fs.readFileSync(file)
  return { bytes, hash: sha(bytes) }
}

/** The first 16 hex characters of the file's SHA-256, cached until the file changes. Throws when unreadable. */
const hashFile = (file: string): string => {
  const st = fs.statSync(file)
  const stamp = stampOf(st)
  const hit = facts.get(file)
  if (hit && hit.stamp === stamp && hit.hash) return hit.hash
  const { hash } = readImage(file)
  if (hit && hit.stamp === stamp) hit.hash = hash
  return hash
}

/** Width and height from an image's header, so a page can hold its place before it loads. */
const dimensions = (head: Buffer, type: string | null): { width: number; height: number } | null => {
  const ok = (width: number, height: number) => (width > 0 && height > 0 && width < 100000 && height < 100000 ? { width, height } : null)
  if (type === 'png' && head.length >= 24) return ok(head.readUInt32BE(16), head.readUInt32BE(20))
  if (type === 'gif' && head.length >= 10) return ok(head.readUInt16LE(6), head.readUInt16LE(8))
  if (type === 'webp' && head.length >= 30) {
    const chunk = head.subarray(12, 16).toString('latin1')
    if (chunk === 'VP8 ') return ok(head.readUInt16LE(26) & 0x3fff, head.readUInt16LE(28) & 0x3fff)
    if (chunk === 'VP8L') {
      const bits = head.readUInt32LE(21)
      return ok((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1)
    }
    if (chunk === 'VP8X') return ok(head.readUIntLE(24, 3) + 1, head.readUIntLE(27, 3) + 1)
  }
  if (type === 'jpg') {
    let i = 2
    while (i + 9 < head.length && head[i] === 0xff) {
      const marker = head[i + 1]
      const length = head.readUInt16BE(i + 2)
      // a start-of-frame marker carries the size; C4, C8, and CC are other tables
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return ok(head.readUInt16BE(i + 7), head.readUInt16BE(i + 5))
      i += 2 + length
    }
  }
  if (type === 'svg') {
    const root = /<svg\b[^>]*>/i.exec(head.toString('utf8'))?.[0] ?? ''
    const px = (name: string) => Number(new RegExp(`\\s${name}\\s*=\\s*["']\\s*([\\d.]+)\\s*(?:px)?\\s*["']`, 'i').exec(root)?.[1])
    return ok(Math.round(px('width')), Math.round(px('height')))
  }
  return null
}

/** An image's width and height in pixels, when its header says. */
export const imageSize = (file: string): { width: number; height: number } | null => {
  try {
    const st = fs.statSync(file)
    const stamp = stampOf(st)
    const hit = facts.get(file)
    if (hit && hit.stamp === stamp && hit.size !== undefined) return hit.size
    // a JPEG's size can sit after a large metadata block
    const head = Buffer.alloc(Math.min(st.size, 65536))
    const fd = fs.openSync(file, 'r')
    let n: number
    try { n = fs.readSync(fd, head, 0, head.length, 0) } finally { fs.closeSync(fd) }
    const size = dimensions(head.subarray(0, n), sniff(head.subarray(0, n)))
    if (hit && hit.stamp === stamp) hit.size = size
    return size
  } catch {
    return null
  }
}

export type ImageProblem = 'remote' | 'type' | 'missing' | 'outside' | 'unreadable' | 'large'

export interface ResolvedImage {
  ref: ImageRef
  file: string | null
  problem: ImageProblem | null
}

/** The file an image reference shows, or why there isn't one. A `data:` image has neither. */
export const resolveImage = (docPath: string, ref: ImageRef): ResolvedImage => {
  if (/^data:/i.test(ref.target)) return { ref, file: null, problem: null }
  if (isRemote(ref.target)) return { ref, file: null, problem: 'remote' }
  const ext = imageExtension(ref.target)
  if (!ext) return { ref, file: null, problem: 'type' }
  let root: string
  try { root = fs.realpathSync(imageRoot(docPath)) } catch { return { ref, file: null, problem: 'missing' } }
  let outside = false
  for (const candidate of candidates(docPath, ref)) {
    let real: string
    let st: fs.Stats
    try {
      real = fs.realpathSync(candidate)
      st = fs.statSync(real)
    } catch { continue }
    if (!st.isFile()) continue
    if (!isInside(root, real)) { outside = true; continue }
    // the file itself has to be an image: a link named shot.png that points at .env is not one
    if (!imageExtension(real)) return { ref, file: null, problem: 'type' }
    if (st.size > MAX_IMAGE_BYTES) return { ref, file: null, problem: 'large' }
    let type: string | null
    try { type = typeOf(real, st) } catch { return { ref, file: null, problem: 'unreadable' } }
    if (!type || (type === 'svg') !== (ext === 'svg')) return { ref, file: null, problem: 'type' }
    return { ref, file: real, problem: null }
  }
  return { ref, file: null, problem: outside ? 'outside' : 'missing' }
}

/** A local image the document means to show: something a draft should keep. */
const isLocalImage = (problem: ImageProblem | null): boolean => problem !== 'remote' && problem !== 'type'

export const assetsDir = (historyDir: string): string => path.join(historyDir, 'assets')

const assetFor = (hash: string, ref: ImageRef): string | null => {
  const ext = imageExtension(ref.target)
  return ext && /^[0-9a-f]{16}$/.test(hash) ? `${hash}.${ext}` : null
}

/** The history's copy of a stored image, only if it's a plain file in a plain assets folder. */
export const storedImage = (historyDir: string, asset: string): string | null => {
  const dir = assetsDir(historyDir)
  try { if (!fs.lstatSync(dir).isDirectory()) return null } catch { return null }
  const p = path.join(dir, asset)
  return isPlainFile(p) ? p : null
}

/** Write bytes through a temporary file, readable by everyone and executable by no one. */
const writeFile = (dest: string, bytes: Buffer): void => {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  // created exclusively, under a name nobody can guess, so a link planted there can't redirect it
  const tmp = `${dest}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`
  try {
    fs.writeFileSync(tmp, bytes, { mode: 0o644, flag: 'wx' })
    fs.renameSync(tmp, dest)
  } catch (error) {
    fs.rmSync(tmp, { force: true })
    throw error
  }
}

/** Keep a file's bytes in the history's assets; returns its hash and the path when it wrote one. */
const storeFile = (file: string, ref: ImageRef, historyDir: string): { hash: string; written: string | null } => {
  const dir = assetsDir(historyDir)
  if (fs.existsSync(dir) && !fs.lstatSync(dir).isDirectory()) {
    throw new Error(`${dir} is not a plain folder; refusing to write images through it`)
  }
  const { bytes, hash } = readImage(file)
  const asset = assetFor(hash, ref)!
  if (storedImage(historyDir, asset)) return { hash, written: null }
  const dest = path.join(dir, asset)
  writeFile(dest, bytes)
  return { hash, written: dest }
}

export interface StoredImages {
  /** reference → hash, for the revision's `images` entry; null when the body shows no local images */
  images: Record<string, string> | null
  /** asset files this call created, so a failed snapshot can take them back */
  written: string[]
  /** local images that aren't there to store */
  missing: ResolvedImage[]
}

/** Store every local image a body shows, for the draft being saved. */
export const storeImages = (docPath: string, historyDir: string, body: string): StoredImages => {
  const out: StoredImages = { images: null, written: [], missing: [] }
  try {
    for (const ref of findImageRefs(body)) {
      if (out.images && ref.ref in out.images) continue
      const resolved = resolveImage(docPath, ref)
      if (!isLocalImage(resolved.problem) && resolved.file === null) continue
      if (/^data:/i.test(ref.target)) continue
      // recorded even when nothing can be kept, so the draft says "no picture here" rather
      // than looking like a draft from before drafts kept images
      out.images ??= {}
      if (!resolved.file) { out.missing.push(resolved); continue }
      try {
        const { hash, written } = storeFile(resolved.file, ref, historyDir)
        out.images[ref.ref] = hash
        if (written) out.written.push(written)
      } catch (error) {
        if ((error as Error).message.includes('refusing')) throw error
        out.missing.push({ ...resolved, file: null, problem: 'unreadable' })
      }
    }
  } catch (error) {
    for (const f of out.written) fs.rmSync(f, { force: true })
    throw error
  }
  return out
}

/** True when a body's images on disk are no longer the ones a draft saved. */
export const imagesDiffer = (docPath: string, body: string, saved: Record<string, string>): boolean =>
  findImageRefs(body).some((ref) => {
    const resolved = resolveImage(docPath, ref)
    if (resolved.problem !== null && !isLocalImage(resolved.problem)) return false
    let now: string | undefined
    try { now = resolved.file ? hashFile(resolved.file) : undefined } catch { now = undefined }
    return now !== saved[ref.ref]
  })

export interface RestoredImages {
  /** files written, with what was there before (null: nothing), so a failed revert can undo them */
  restored: { file: string; previous: Buffer | null }[]
  /** references not put back, and why */
  skipped: { ref: string; reason: string }[]
}

/**
 * Put a draft's images back at their paths, for `revert`. Only markdown images with a path
 * are restored, and only as plain files inside the document's folder or vault: an Obsidian
 * embed may resolve to a different file than the one the draft saved, and a link may point
 * anywhere. A file that gets overwritten is stored in the assets first and returned, so the
 * caller can put it back.
 */
export const restoreImages = (docPath: string, historyDir: string, body: string, images: Record<string, string>): RestoredImages => {
  const out: RestoredImages = { restored: [], skipped: [] }
  const done = new Set<string>()
  const dir = path.dirname(path.resolve(docPath))
  let root: string
  try { root = fs.realpathSync(imageRoot(docPath)) } catch { return out }
  for (const ref of findImageRefs(body)) {
    if (done.has(ref.ref) || !images[ref.ref]) continue
    done.add(ref.ref)
    const asset = assetFor(images[ref.ref], ref)
    const source = asset ? storedImage(historyDir, asset) : null
    if (!source) { out.skipped.push({ ref: ref.ref, reason: 'its saved copy is missing' }); continue }
    if (ref.embed) { out.skipped.push({ ref: ref.ref, reason: `Obsidian embeds aren't put back; the saved copy is ${source}` }); continue }
    const dest = path.resolve(dir, ref.target)
    let existing: fs.Stats | null = null
    try { existing = fs.lstatSync(dest) } catch { /* not there */ }
    if (existing && !existing.isFile()) { out.skipped.push({ ref: ref.ref, reason: 'it is a link or a folder now' }); continue }
    let ancestor = path.dirname(dest)
    while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor)
    if (!isInside(root, path.join(fs.realpathSync(ancestor), path.relative(ancestor, dest)))) {
      out.skipped.push({ ref: ref.ref, reason: 'it is outside the document\'s folder' })
      continue
    }
    try {
      const { bytes, hash } = readImage(source)
      let previous: Buffer | null = null
      if (existing) {
        previous = fs.readFileSync(dest)
        if (sha(previous) === hash) continue
        storeFile(dest, ref, historyDir)
      }
      writeFile(dest, bytes)
      out.restored.push({ file: dest, previous })
    } catch (error) {
      out.skipped.push({ ref: ref.ref, reason: error instanceof Error ? error.message : String(error) })
    }
  }
  return out
}

/** Undo `restoreImages`, newest first. */
export const undoRestore = (restored: RestoredImages['restored']): void => {
  for (const { file, previous } of [...restored].reverse()) {
    try {
      if (previous === null) fs.rmSync(file, { force: true })
      else writeFile(file, previous)
    } catch { /* best effort: the overwritten file is also in the assets */ }
  }
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
  const fromDisk = (ref: ImageRef): string | null => {
    const resolved = resolveImage(docPath, ref)
    if (!resolved.file) return null
    let asset: string | null
    try { asset = assetFor(hashFile(resolved.file), ref) } catch { return null }
    if (asset && !files.has(asset)) files.set(asset, resolved.file)
    return asset
  }
  const fromMap = (images: Record<string, string>) => (ref: ImageRef): string | null => {
    const hash = images[ref.ref]
    const asset = typeof hash === 'string' ? assetFor(hash, ref) : null
    if (!asset) return null
    if (!files.has(asset)) {
      const p = storedImage(historyDir, asset)
      if (!p) return null
      files.set(asset, p)
    }
    return asset
  }
  return {
    key: (body, images) => keyImages(body, images ? fromMap(images) : fromDisk),
    file: (asset) => files.get(asset) ?? storedImage(historyDir, asset),
  }
}

/** A stored image as a `data:` URI, for pages that carry their images inside them. */
export const dataUri = (file: string, asset: string): string | null => {
  try {
    const st = fs.statSync(file)
    if (!st.isFile() || st.size > MAX_IMAGE_BYTES) return null
    return `data:${MIME[asset.slice(asset.lastIndexOf('.') + 1)]};base64,${fs.readFileSync(file).toString('base64')}`
  } catch {
    return null
  }
}

/** True when a stored copy's bytes still match the hash in its name. */
export const storedImageIntact = (file: string, asset: string): boolean => {
  try { return sha(fs.readFileSync(file)) === asset.slice(0, 16) } catch { return false }
}
