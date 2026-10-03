import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import {
  commentImage, FRONTMATTER_RE, isHistoryFolder, makeComment, nowStamp, parseMeta, planSnapshot, revisionImages, serializeMeta, splitRaw, unstampCanonical,
  type HistoryFolder,
  type Approval, type CommentEntry, type Meta, type NewComment, type SnapshotOptions,
} from './model.js'
import { keyedImages } from './imageref.js'
import { imageKeys, imagesDiffer, restoreImages, storeImages, undoRestore, vaultRoot, type RestoredImages } from './images.js'
import { holdsHistories } from './drafts.js'
import { describeChanges } from './semdiff.js'

export * from './model.js'

export interface Doc {
  canonicalPath: string
  name: string
  historyDir: string
  frontmatter: Record<string, unknown>
  body: string
  raw: string
  /** set when the body is an earlier draft rather than the file on disk */
  revision?: string
}


export const atomicWrite = (filePath: string, content: string): void => {
  // created exclusively, under a name nobody can guess, so a link planted there can't redirect it
  const tmp = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`
  try {
    fs.writeFileSync(tmp, content, { encoding: 'utf8', flag: 'wx' })
    fs.renameSync(tmp, filePath)
  } catch (error) {
    fs.rmSync(tmp, { force: true })
    throw error
  }
}

export const isPathInside = (root: string, target: string): boolean => {
  const relative = path.relative(root, target)
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
}

/** Resolve a relative path while rejecting lexical traversal and symlink escapes. */
export const resolveContainedPath = (root: string, relativePath: string, label = 'Path'): string => {
  if (path.isAbsolute(relativePath)) throw new Error(`${label} must be relative`)
  const absRoot = path.resolve(root)
  const target = path.resolve(absRoot, relativePath)
  if (!isPathInside(absRoot, target)) throw new Error(`${label} must stay inside ${absRoot}`)

  const realRoot = fs.realpathSync(absRoot)
  let ancestor = target
  while (!fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor)
    if (parent === ancestor) break
    ancestor = parent
  }
  const realAncestor = fs.realpathSync(ancestor)
  if (!isPathInside(realRoot, realAncestor)) throw new Error(`${label} escapes through a symlink`)
  return target
}

/**
 * Where a new document's history goes: in an Obsidian vault, the folder the Pentimento plugin
 * is set to use there, so drafts saved from the command line and from Obsidian end up in the
 * same place; elsewhere, `.history`.
 */
export const defaultHistoryFolder = (dir: string): HistoryFolder => {
  const vault = vaultRoot(dir)
  if (!vault) return '.history'
  try {
    const data = JSON.parse(fs.readFileSync(path.join(vault, '.obsidian', 'plugins', 'pentimento', 'data.json'), 'utf8')) as Record<string, unknown>
    return isHistoryFolder(data.historyFolder) ? data.historyFolder : '.history'
  } catch {
    return '.history'
  }
}

export const loadDoc = (docPath: string): Doc => {
  const requestedPath = path.resolve(docPath)
  if (!fs.existsSync(requestedPath)) throw new Error(`No such document: ${requestedPath}`)
  const canonicalPath = fs.realpathSync(requestedPath)
  const raw = fs.readFileSync(canonicalPath, 'utf8')
  const m = FRONTMATTER_RE.exec(raw)
  const frontmatter = m ? ((parseYaml(m[1]) ?? {}) as Record<string, unknown>) : {}
  const body = m ? raw.slice(m[0].length) : raw
  const name = path.basename(canonicalPath).replace(/\.md$/i, '')
  // History Folder is canonical-relative — the single path contract (audit C3)
  const historyRel = typeof frontmatter['History Folder'] === 'string'
    ? (frontmatter['History Folder'] as string)
    : path.join(defaultHistoryFolder(path.dirname(canonicalPath)), name)
  const historyDir = resolveContainedPath(path.dirname(canonicalPath), historyRel, 'History Folder')
  return { canonicalPath, name, historyDir, frontmatter, body, raw }
}

export const readMeta = (historyDir: string): Meta => {
  const metaPath = path.join(historyDir, 'meta.yml')
  return parseMeta(fs.existsSync(metaPath) ? fs.readFileSync(metaPath, 'utf8') : null, metaPath)
}

export const writeMeta = (historyDir: string, meta: Meta): void => {
  const metaPath = path.join(historyDir, 'meta.yml')
  atomicWrite(metaPath, serializeMeta(meta, metaPath))
}

const withLock = <T>(historyDir: string, fn: () => T): T => {
  const lockDir = path.join(historyDir, '.lock')
  fs.mkdirSync(historyDir, { recursive: true })
  try {
    fs.mkdirSync(lockDir)
  } catch {
    const age = Date.now() - fs.statSync(lockDir).mtimeMs
    if (age < 10 * 60 * 1000) throw new Error(`Another pentimento operation holds the lock: ${lockDir}`)
    fs.rmdirSync(lockDir)
    fs.mkdirSync(lockDir)
  }
  try {
    return fn()
  } finally {
    fs.rmdirSync(lockDir)
  }
}

export interface SnapshotResult {
  rev: string
  historyFile: string
  /** images the draft shows that weren't there to save, as written in the document */
  missingImages: string[]
}

export interface RevertResult extends SnapshotResult {
  /** image files put back as the earlier draft had them */
  restoredImages: string[]
  /** images not put back, and why */
  skippedImages: RestoredImages['skipped']
}

const snapshotWithBody = (
  docPath: string,
  opts: SnapshotOptions,
  replacementBody?: string,
  /** runs under the lock before anything is read, e.g. to put a draft's images back */
  before?: (doc: Doc) => void,
): SnapshotResult => {
  const initial = loadDoc(docPath)
  return withLock(initial.historyDir, () => {
    if (before) before(initial)
    const doc = loadDoc(docPath)
    if (doc.historyDir !== initial.historyDir) throw new Error('History Folder changed while waiting for the lock')
    const historyRel = path
      .relative(path.dirname(doc.canonicalPath), doc.historyDir)
      .split(path.sep)
      .join('/')
    const sourceRaw = replacementBody === undefined
      ? doc.raw
      : doc.raw.slice(0, doc.raw.length - doc.body.length) + replacementBody
    const current = readMeta(doc.historyDir)
    const latest = current.revisions[current.revisions.length - 1]
    const latestFile = latest ? path.join(doc.historyDir, `${latest.id}.md`) : null
    const stored = storeImages(doc.canonicalPath, doc.historyDir, splitRaw(sourceRaw).body)
    // summaries see image changes too: a new screenshot at the same path is an edit
    const keys = imageKeys(doc.canonicalPath, doc.historyDir)
    let plan: ReturnType<typeof planSnapshot>
    try {
      plan = planSnapshot({
        raw: sourceRaw,
        meta: current,
        historyRel,
        previousBody: latestFile && fs.existsSync(latestFile) ? splitRaw(fs.readFileSync(latestFile, 'utf8')).body : null,
        opts,
        describe: (previous, body) => describeChanges(
          previous === null ? null : keys.key(previous, revisionImages(latest)),
          keys.key(body, stored.images ?? undefined),
        ),
      })
    } catch (error) {
      // nothing was saved, so neither are the copies made for it
      for (const f of stored.written) fs.rmSync(f, { force: true })
      throw error
    }
    const next = plan.rev
    const stamped = plan.stamped
    const meta = plan.meta
    if (stored.images) meta.revisions[meta.revisions.length - 1].images = stored.images
    const historyFile = path.join(doc.historyDir, `${next}.md`)
    const dropAssets = (): void => { for (const f of stored.written) fs.rmSync(f, { force: true }) }
    if (fs.existsSync(historyFile)) {
      dropAssets()
      throw new Error(`${historyFile} already exists — history and frontmatter disagree; refusing to overwrite`)
    }
    const metaPath = path.join(doc.historyDir, 'meta.yml')
    const previousMeta = fs.existsSync(metaPath) ? fs.readFileSync(metaPath, 'utf8') : null
    let revisionWritten = false
    let metaWritten = false
    try {
      fs.writeFileSync(historyFile, stamped, { flag: 'wx' })
      revisionWritten = true
      writeMeta(doc.historyDir, meta)
      metaWritten = true
      atomicWrite(doc.canonicalPath, stamped)
    } catch (error) {
      const rollbackErrors: string[] = []
      if (metaWritten) {
        try {
          if (previousMeta === null) fs.rmSync(metaPath, { force: true })
          else atomicWrite(metaPath, previousMeta)
        } catch (rollbackError) {
          rollbackErrors.push(`metadata rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`)
        }
      }
      if (revisionWritten) {
        try { fs.rmSync(historyFile, { force: true }) } catch (rollbackError) {
          rollbackErrors.push(`revision rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`)
        }
      }
      try { dropAssets() } catch { /* an orphaned asset is harmless */ }
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`Snapshot failed without changing the canonical document: ${detail}${rollbackErrors.length ? `; ${rollbackErrors.join('; ')}` : ''}`)
    }
    return { rev: next, historyFile, missingImages: stored.missing.map((m) => m.ref.ref) }
  })
}

/** Capture the canonical as the next revision under a document-scoped lock. */
export const snapshot = (docPath: string, opts: SnapshotOptions): SnapshotResult =>
  snapshotWithBody(docPath, opts)

export const addComment = (docPath: string, input: NewComment): CommentEntry => {
  const doc = loadDoc(docPath)
  return withLock(doc.historyDir, () => {
    const meta = readMeta(doc.historyDir)
    const entry = makeComment(meta, input)
    meta.comments.push(entry)
    writeMeta(doc.historyDir, meta)
    return entry
  })
}

export const resolveComment = (
  docPath: string,
  id: string,
  rev?: string,
  note?: { text: string; author?: string },
): CommentEntry => {
  const doc = loadDoc(docPath)
  return withLock(doc.historyDir, () => {
    const meta = readMeta(doc.historyDir)
    const c = meta.comments.find((x) => x.id === id)
    if (!c) throw new Error(`no comment ${id} on ${doc.name}`)
    if (rev && !meta.revisions.some((entry) => entry.id === rev)) {
      throw new Error(`cannot resolve ${id} in missing revision ${rev}`)
    }
    if (note) {
      c.replies = [...(c.replies ?? []), { author: note.author ?? 'reader', text: note.text, created_at: nowStamp() }]
    }
    c.status = 'resolved'
    c.resolved_in = rev ?? null
    writeMeta(doc.historyDir, meta)
    return c
  })
}


export const reopenComment = (docPath: string, id: string): CommentEntry => {
  const doc = loadDoc(docPath)
  return withLock(doc.historyDir, () => {
    const meta = readMeta(doc.historyDir)
    const c = meta.comments.find((x) => x.id === id)
    if (!c) throw new Error(`no comment ${id} on ${doc.name}`)
    c.status = 'open'
    c.resolved_in = null
    writeMeta(doc.historyDir, meta)
    return c
  })
}

export const deleteComment = (docPath: string, id: string): CommentEntry => {
  const doc = loadDoc(docPath)
  return withLock(doc.historyDir, () => {
    const meta = readMeta(doc.historyDir)
    const idx = meta.comments.findIndex((x) => x.id === id)
    if (idx < 0) throw new Error(`no comment ${id} on ${doc.name}`)
    const [removed] = meta.comments.splice(idx, 1)
    writeMeta(doc.historyDir, meta)
    return removed
  })
}

export const addReply = (docPath: string, id: string, input: { text: string; author?: string }): CommentEntry => {
  const doc = loadDoc(docPath)
  return withLock(doc.historyDir, () => {
    const meta = readMeta(doc.historyDir)
    const c = meta.comments.find((x) => x.id === id)
    if (!c) throw new Error(`no comment ${id} on ${doc.name}`)
    c.replies = [...(c.replies ?? []), { author: input.author ?? 'reader', text: input.text, created_at: nowStamp() }]
    writeMeta(doc.historyDir, meta)
    return c
  })
}

export interface AnswerInput {
  /** the `::: ask` block's anchor, e.g. `#q-db` */
  anchor: string
  question: string
  choice: string
  author?: string
}

/** Record the reader's answer to a question; a new answer replaces their earlier open one. */
export const answerQuestion = (docPath: string, input: AnswerInput): CommentEntry => {
  const doc = loadDoc(docPath)
  return withLock(doc.historyDir, () => {
    const meta = readMeta(doc.historyDir)
    meta.comments = meta.comments.filter((c) => !(c.answer !== undefined && c.anchor === input.anchor && c.status === 'open'))
    const entry: CommentEntry = {
      ...makeComment(meta, {
        text: `Answer: ${input.choice}`,
        anchor: input.anchor,
        quote: input.question,
        author: input.author,
      }),
      answer: input.choice,
    }
    meta.comments.push(entry)
    writeMeta(doc.historyDir, meta)
    return entry
  })
}

/** Sign off on a saved revision (the latest by default). */
export const approve = (docPath: string, rev?: string, author?: string): Approval => {
  const doc = loadDoc(docPath)
  return withLock(doc.historyDir, () => {
    const meta = readMeta(doc.historyDir)
    const target = rev ?? meta.revisions[meta.revisions.length - 1]?.id
    if (!target) throw new Error(`${doc.name} has no saved revision to approve`)
    if (!meta.revisions.some((r) => r.id === target)) throw new Error(`No revision ${target} for ${doc.name}`)
    const entry: Approval = { rev: target, created_at: nowStamp(), author: author ?? 'reader' }
    meta.approvals = [...(meta.approvals ?? []), entry]
    writeMeta(doc.historyDir, meta)
    return entry
  })
}

export const readRevision = (docPath: string, rev: string): string => {
  const doc = loadDoc(docPath)
  if (!/^r\d{3,}$/.test(rev)) throw new Error(`Invalid revision ${JSON.stringify(rev)} — expected rNNN`)
  const meta = readMeta(doc.historyDir)
  if (!meta.revisions.some((entry) => entry.id === rev)) throw new Error(`No revision ${rev} for ${doc.name}`)
  const file = resolveContainedPath(doc.historyDir, `${rev}.md`, 'Revision path')
  if (!fs.existsSync(file)) throw new Error(`No revision ${rev} for ${doc.name} (looked at ${file})`)
  const realFile = fs.realpathSync(file)
  const realHistory = fs.realpathSync(doc.historyDir)
  if (!isPathInside(realHistory, realFile)) throw new Error(`Revision ${rev} escapes its history directory`)
  return fs.readFileSync(realFile, 'utf8')
}

export interface CanonicalRevisionState {
  latest: string | null
  dirty: boolean
  label: string
}

/** Describe whether the canonical body still matches its latest saved revision. */
export const canonicalRevisionState = (doc: Doc, meta: Meta): CanonicalRevisionState => {
  const latest = meta.revisions[meta.revisions.length - 1]?.id ?? null
  if (!latest) return { latest: null, dirty: true, label: 'Draft' }
  const savedBody = splitRaw(readRevision(doc.canonicalPath, latest)).body
  const saved = revisionImages(meta.revisions[meta.revisions.length - 1])
  // a new screenshot at the same path is an unsaved change too; drafts from before 0.13 record no images
  const dirty = savedBody.trim() !== doc.body.trim() ||
    (!doc.revision && saved !== undefined && imagesDiffer(doc.canonicalPath, doc.body, saved))
  return { latest, dirty, label: dirty ? `Draft after ${latest}` : latest }
}

/** Restore an earlier revision's body as a new revision (history stays append-only). */
export const revert = (docPath: string, rev: string, author?: string): RevertResult => {
  const target = readRevision(docPath, rev)
  const targetBody = FRONTMATTER_RE.exec(target)
    ? target.slice(FRONTMATTER_RE.exec(target)![0].length)
    : target
  let images: RestoredImages = { restored: [], skipped: [] }
  try {
    const saved = snapshotWithBody(docPath, {
      summary: `Restored content of ${rev}`,
      why: `pentimento revert ${rev}`,
      author,
    }, targetBody, (doc) => {
      // the draft's images go back to their paths too, so the folder matches what was restored
      const map = revisionImages(readMeta(doc.historyDir).revisions.find((r) => r.id === rev))
      if (map) images = restoreImages(doc.canonicalPath, doc.historyDir, targetBody, map)
    })
    return { ...saved, restoredImages: images.restored.map((r) => r.file), skippedImages: images.skipped }
  } catch (error) {
    // nothing was saved, so the image files go back to how they were
    undoRestore(images.restored)
    throw error
  }
}

/** The file behind a stored image: the history's copy, or a file on disk with that hash. */
export const imageFile = (docPath: string, asset: string): string | null => {
  const doc = loadDoc(docPath)
  const keys = imageKeys(doc.canonicalPath, doc.historyDir)
  const stored = keys.file(asset)
  if (stored) return stored
  // the document as it is now, and drafts saved before drafts kept their images, show what's on disk
  keys.key(doc.body)
  for (const r of readMeta(doc.historyDir).revisions) {
    if (revisionImages(r)) continue
    try { keys.key(splitRaw(readRevision(docPath, r.id)).body) } catch { /* verify reports it */ }
  }
  return keys.file(asset)
}

/** How the document as it is now writes the image a stored copy shows, if it still shows it. */
export const imageRefFor = (docPath: string, asset: string): string | null => {
  const doc = loadDoc(docPath)
  const keyed = imageKeys(doc.canonicalPath, doc.historyDir).key(doc.body)
  return keyedImages(keyed).find((k) => k.asset === asset)?.ref.ref ?? null
}

const span = (from: number, size: number, scale: number): string =>
  `${Math.round(from * scale)}–${Math.round((from + size) * scale)}`

/**
 * What an agent needs to act on a comment about an image: the file to open and, for a
 * marked part, where it is in pixels ("box 120–480 × 60–200 of 1280 × 800").
 */
export const describeImageComment = (docPath: string, c: CommentEntry): string[] => {
  const mark = commentImage(c)
  if (!mark) return []
  const { ref, asset, box, width, height } = mark
  const file = imageFile(docPath, asset)
  const lines = [`  image: ${ref}${c.quote ? ` ("${c.quote}")` : ''}`]
  lines.push(file
    ? `  file: ${path.relative(process.cwd(), file) || file}`
    : `  file: not on disk any more (${asset})`)
  if (!box) lines.push('  on: the whole image')
  else if (width && height) lines.push(`  on: box ${span(box.x, box.w, width)} × ${span(box.y, box.h, height)} of ${width} × ${height}`)
  else lines.push(`  on: box ${span(box.x, box.w, 100)}% × ${span(box.y, box.h, 100)}% of the width and height`)
  return lines
}

/** Take a document out of Pentimento: drop its frontmatter keys, then delete its history folder. */
export const untrack = (docPath: string): { historyDir: string; drafts: number } => {
  const doc = loadDoc(docPath)
  if (path.resolve(doc.historyDir) === path.dirname(doc.canonicalPath)) {
    throw new Error('History Folder points at the document\'s own folder, so it can\'t be deleted safely; remove it by hand')
  }
  const lock = path.join(doc.historyDir, '.lock')
  if (fs.existsSync(lock) && Date.now() - fs.statSync(lock).mtimeMs < 10 * 60 * 1000) {
    throw new Error(`Another pentimento operation holds the lock: ${lock}`)
  }
  let drafts = 0
  try { drafts = readMeta(doc.historyDir).revisions.length } catch { /* unreadable history is still removable */ }
  atomicWrite(doc.canonicalPath, unstampCanonical(doc.raw))
  fs.rmSync(doc.historyDir, { recursive: true, force: true })
  // the shared folder (`.history` in `.history/<name>`, whatever it's called) goes too once its last document leaves
  const parent = path.dirname(doc.historyDir)
  const historyRel = path.relative(path.dirname(doc.canonicalPath), doc.historyDir).split(path.sep).join('/')
  if (holdsHistories(historyRel, doc.name) && fs.existsSync(parent) && !fs.readdirSync(parent).length) fs.rmdirSync(parent)
  return { historyDir: doc.historyDir, drafts }
}
