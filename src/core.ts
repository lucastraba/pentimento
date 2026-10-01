import fs from 'node:fs'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import {
  FRONTMATTER_RE, makeComment, nowStamp, parseMeta, planSnapshot, serializeMeta, splitRaw,
  type Approval, type CommentEntry, type Meta, type NewComment, type SnapshotOptions,
} from './model.js'
import { describeChanges } from './semdiff.js'

export * from './model.js'

export interface Doc {
  canonicalPath: string
  name: string
  historyDir: string
  frontmatter: Record<string, unknown>
  body: string
  raw: string
}


export const atomicWrite = (filePath: string, content: string): void => {
  const tmp = `${filePath}.tmp-${process.pid}`
  try {
    fs.writeFileSync(tmp, content, 'utf8')
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
    : path.join('.history', name)
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
}

const snapshotWithBody = (docPath: string, opts: SnapshotOptions, replacementBody?: string): SnapshotResult => {
  const initial = loadDoc(docPath)
  return withLock(initial.historyDir, () => {
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
    const plan = planSnapshot({
      raw: sourceRaw,
      meta: current,
      historyRel,
      previousBody: latestFile && fs.existsSync(latestFile) ? splitRaw(fs.readFileSync(latestFile, 'utf8')).body : null,
      opts,
      describe: describeChanges,
    })
    const next = plan.rev
    const stamped = plan.stamped
    const meta = plan.meta
    const historyFile = path.join(doc.historyDir, `${next}.md`)
    if (fs.existsSync(historyFile)) {
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
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`Snapshot failed without changing the canonical document: ${detail}${rollbackErrors.length ? `; ${rollbackErrors.join('; ')}` : ''}`)
    }
    return { rev: next, historyFile }
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
  const dirty = savedBody.trim() !== doc.body.trim()
  return { latest, dirty, label: dirty ? `Draft after ${latest}` : latest }
}

/** Restore an earlier revision's body as a new revision (history stays append-only). */
export const revert = (docPath: string, rev: string, author?: string): SnapshotResult => {
  const target = readRevision(docPath, rev)
  const targetBody = FRONTMATTER_RE.exec(target)
    ? target.slice(FRONTMATTER_RE.exec(target)![0].length)
    : target
  return snapshotWithBody(docPath, {
    summary: `Restored content of ${rev}`,
    why: `pentimento revert ${rev}`,
    author,
  }, targetBody)
}
