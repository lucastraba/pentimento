import fs from 'node:fs'
import path from 'node:path'
import { parseDocument, parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { describeChanges } from './semdiff.js'

export interface RevisionEntry {
  id: string
  created_at: string
  author: string
  summary: string
  why?: string
  source?: string
}

export interface ReplyEntry {
  author: string
  text: string
  created_at: string
}

export interface CommentEntry {
  id: string
  anchor: string
  /** W3C-annotation-style anchoring: exact selected text plus surrounding context */
  quote?: string
  prefix?: string
  suffix?: string
  text: string
  status: 'open' | 'resolved'
  created_at: string
  author: string
  resolved_in: string | null
  replies?: ReplyEntry[]
  /** set when the comment is the reader's answer to a `::: ask` question */
  answer?: string
}

export interface NewComment {
  text: string
  anchor?: string
  quote?: string
  prefix?: string
  suffix?: string
  author?: string
}

export interface Approval {
  rev: string
  created_at: string
  author: string
}

export interface Meta {
  revisions: RevisionEntry[]
  comments: CommentEntry[]
  /** the reader's sign-offs, oldest first; absent until the first approval */
  approvals?: Approval[]
}

export interface Doc {
  canonicalPath: string
  name: string
  historyDir: string
  frontmatter: Record<string, unknown>
  body: string
  raw: string
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

export const splitRaw = (raw: string): { frontmatterRaw: string | null; body: string } => {
  const m = FRONTMATTER_RE.exec(raw)
  return m ? { frontmatterRaw: m[1], body: raw.slice(m[0].length) } : { frontmatterRaw: null, body: raw }
}

export const slugify = (s: string): string =>
  s.toLowerCase().replace(/`/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

const INLINE_COMMENT_RE = /[ \t]*%%\s*@c:\s*([\s\S]*?)%%/g

/** Pull `%% @c: ... %%` inline comments out of the source, anchored to the nearest preceding heading. */
export const extractInlineComments = (raw: string): { cleaned: string; found: { text: string; anchor: string }[] } => {
  const found: { text: string; anchor: string }[] = []
  const headingFor = (index: number): string => {
    const matches = [...raw.slice(0, index).matchAll(/^#{1,3}\s+(.+)$/gm)]
    if (!matches.length) return ''
    const title = matches[matches.length - 1][1]
    const idm = /<!--[^>]*\bid:\s*([\w-]+)/.exec(title)
    if (idm) return `#${idm[1]}`
    return `#${slugify(title.replace(/<!--.*?-->/, '').trim())}`
  }
  const cleaned = raw.replace(INLINE_COMMENT_RE, (_m, text: string, offset: number) => {
    found.push({ text: text.trim(), anchor: headingFor(offset) })
    return ''
  })
  return { cleaned, found }
}

export const nowStamp = (): string => {
  const d = new Date()
  const offsetMin = -d.getTimezoneOffset()
  const sign = offsetMin >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMin)
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  )
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

export const revId = (n: number): string => `r${String(n).padStart(3, '0')}`

export const parseRevId = (value: unknown): number => {
  const m = /^r(\d{3,})$/.exec(String(value ?? '').trim())
  if (!m) throw new Error(`Invalid Current Revision value: ${JSON.stringify(value)} — expected rNNN`)
  return Number(m[1])
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

/** Rewrite one scalar frontmatter key, preserving all other formatting (audit H3). */
export const stampFrontmatter = (raw: string, updates: Record<string, string | boolean | null>): string => {
  const m = FRONTMATTER_RE.exec(raw)
  if (m) {
    const doc = parseDocument(m[1])
    for (const [k, v] of Object.entries(updates)) v === null ? doc.delete(k) : doc.set(k, v)
    return `---\n${String(doc).replace(/\n$/, '')}\n---\n${raw.slice(m[0].length)}`
  }
  const kept = Object.fromEntries(Object.entries(updates).filter(([, v]) => v !== null))
  const fmDoc = stringifyYaml(kept).replace(/\n$/, '')
  return `---\n${fmDoc}\n---\n\n${raw}`
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const metadataError = (metaPath: string, detail: string): never => {
  throw new Error(`Invalid meta.yml at ${metaPath}: ${detail}`)
}

const validateMeta = (value: unknown, metaPath: string): Meta => {
  if (!isRecord(value)) metadataError(metaPath, 'expected an object')
  const record = value as Record<string, unknown>
  if (!Array.isArray(record.revisions)) metadataError(metaPath, '`revisions` must be an array')
  if (!Array.isArray(record.comments)) metadataError(metaPath, '`comments` must be an array')
  const revisions = record.revisions as unknown[]
  const comments = record.comments as unknown[]

  const revisionIds = new Set<string>()
  revisions.forEach((entry, index) => {
    if (!isRecord(entry)) metadataError(metaPath, `revisions[${index}] must be an object`)
    const revision = entry as Record<string, unknown>
    if (typeof revision.id !== 'string' || !/^r\d{3,}$/.test(revision.id)) {
      metadataError(metaPath, `revisions[${index}].id must be rNNN`)
    }
    if (revisionIds.has(revision.id as string)) metadataError(metaPath, `duplicate revision id ${revision.id}`)
    revisionIds.add(revision.id as string)
    for (const field of ['created_at', 'author', 'summary'] as const) {
      if (typeof revision[field] !== 'string' || !revision[field]) {
        metadataError(metaPath, `revisions[${index}].${field} must be a non-empty string`)
      }
    }
    if (Number.isNaN(Date.parse(revision.created_at as string))) {
      metadataError(metaPath, `revisions[${index}].created_at must be an ISO timestamp`)
    }
    for (const field of ['why', 'source'] as const) {
      if (revision[field] !== undefined && typeof revision[field] !== 'string') {
        metadataError(metaPath, `revisions[${index}].${field} must be a string`)
      }
    }
  })

  const commentIds = new Set<string>()
  comments.forEach((entry, index) => {
    if (!isRecord(entry)) metadataError(metaPath, `comments[${index}] must be an object`)
    const comment = entry as Record<string, unknown>
    for (const field of ['id', 'anchor', 'text', 'created_at', 'author'] as const) {
      if (typeof comment[field] !== 'string' || (field !== 'anchor' && !comment[field])) {
        metadataError(metaPath, `comments[${index}].${field} must be ${field === 'anchor' ? 'a string' : 'a non-empty string'}`)
      }
    }
    if (commentIds.has(comment.id as string)) metadataError(metaPath, `duplicate comment id ${comment.id}`)
    commentIds.add(comment.id as string)
    if (Number.isNaN(Date.parse(comment.created_at as string))) {
      metadataError(metaPath, `comments[${index}].created_at must be an ISO timestamp`)
    }
    if (comment.status !== 'open' && comment.status !== 'resolved') {
      metadataError(metaPath, `comments[${index}].status must be open or resolved`)
    }
    if (comment.resolved_in !== null && comment.resolved_in !== undefined) {
      if (typeof comment.resolved_in !== 'string' || !revisionIds.has(comment.resolved_in)) {
        metadataError(metaPath, `comments[${index}].resolved_in must name an existing revision`)
      }
    }
    for (const field of ['quote', 'prefix', 'suffix', 'answer'] as const) {
      if (comment[field] !== undefined && typeof comment[field] !== 'string') {
        metadataError(metaPath, `comments[${index}].${field} must be a string`)
      }
    }
    if (comment.replies !== undefined) {
      if (!Array.isArray(comment.replies)) metadataError(metaPath, `comments[${index}].replies must be an array`)
      const replies = comment.replies as unknown[]
      replies.forEach((reply, replyIndex) => {
        if (!isRecord(reply)) metadataError(metaPath, `comments[${index}].replies[${replyIndex}] must be an object`)
        const replyRecord = reply as Record<string, unknown>
        for (const field of ['author', 'text', 'created_at'] as const) {
          if (typeof replyRecord[field] !== 'string' || !replyRecord[field]) {
            metadataError(metaPath, `comments[${index}].replies[${replyIndex}].${field} must be a non-empty string`)
          }
        }
        if (Number.isNaN(Date.parse(replyRecord.created_at as string))) {
          metadataError(metaPath, `comments[${index}].replies[${replyIndex}].created_at must be an ISO timestamp`)
        }
      })
    }
  })
  if (record.approvals !== undefined) {
    if (!Array.isArray(record.approvals)) metadataError(metaPath, '`approvals` must be an array')
    ;(record.approvals as unknown[]).forEach((entry, index) => {
      if (!isRecord(entry)) metadataError(metaPath, `approvals[${index}] must be an object`)
      const approval = entry as Record<string, unknown>
      if (typeof approval.rev !== 'string' || !revisionIds.has(approval.rev)) {
        metadataError(metaPath, `approvals[${index}].rev must name an existing revision`)
      }
      for (const field of ['created_at', 'author'] as const) {
        if (typeof approval[field] !== 'string' || !approval[field]) {
          metadataError(metaPath, `approvals[${index}].${field} must be a non-empty string`)
        }
      }
    })
  }
  return record as unknown as Meta
}

export const readMeta = (historyDir: string): Meta => {
  const metaPath = path.join(historyDir, 'meta.yml')
  if (!fs.existsSync(metaPath)) return { revisions: [], comments: [] }
  let parsed: unknown
  try {
    parsed = parseYaml(fs.readFileSync(metaPath, 'utf8'))
  } catch (error) {
    throw new Error(`Unreadable meta.yml at ${metaPath} — refusing to touch it: ${error instanceof Error ? error.message : String(error)}`)
  }
  return validateMeta(parsed, metaPath)
}

export const writeMeta = (historyDir: string, meta: Meta): void => {
  const metaPath = path.join(historyDir, 'meta.yml')
  validateMeta(meta, metaPath)
  atomicWrite(metaPath, stringifyYaml({
    revisions: meta.revisions,
    comments: meta.comments,
    ...(meta.approvals?.length ? { approvals: meta.approvals } : {}),
  }))
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

export interface SnapshotOptions {
  /** what changed; computed from the diff (headings name the parts) when omitted */
  summary?: string
  why?: string
  source?: string
  author?: string
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
    // 'Vellum: true' is the pre-rename marker — keep reading it so old docs snapshot cleanly
    const isPentimento = doc.frontmatter['Pentimento'] === true || doc.frontmatter['Vellum'] === true
    const current = isPentimento && doc.frontmatter['Current Revision'] !== undefined
      ? parseRevId(doc.frontmatter['Current Revision'])
      : 0
    const next = revId(current + 1)
    const historyFile = path.join(doc.historyDir, `${next}.md`)
    if (fs.existsSync(historyFile)) {
      throw new Error(`${historyFile} already exists — history and frontmatter disagree; refusing to overwrite`)
    }
    const historyRel = path
      .relative(path.dirname(doc.canonicalPath), doc.historyDir)
      .split(path.sep)
      .join('/')
    const sourceRaw = replacementBody === undefined
      ? doc.raw
      : doc.raw.slice(0, doc.raw.length - doc.body.length) + replacementBody
    const { cleaned, found } = extractInlineComments(sourceRaw)
    const stamped = stampFrontmatter(cleaned, {
      Pentimento: true,
      Vellum: null, // migrate pre-rename docs: drop the legacy marker on first snapshot
      'Current Revision': next,
      'History Folder': historyRel,
    })
    const meta = readMeta(doc.historyDir)
    let summary = opts.summary?.trim()
    if (!summary) {
      const latest = meta.revisions[meta.revisions.length - 1]
      const previousBody = latest && fs.existsSync(path.join(doc.historyDir, `${latest.id}.md`))
        ? splitRaw(fs.readFileSync(path.join(doc.historyDir, `${latest.id}.md`), 'utf8')).body
        : null
      summary = describeChanges(previousBody, splitRaw(stamped).body)
    }
    meta.revisions.push({
      id: next,
      created_at: nowStamp(),
      author: opts.author ?? 'unknown',
      summary,
      ...(opts.why ? { why: opts.why } : {}),
      ...(opts.source ? { source: opts.source } : {}),
    })
    for (const f of found) {
      meta.comments.push(makeComment(meta, { text: f.text, anchor: f.anchor, author: opts.author }))
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

const makeComment = (meta: Meta, input: NewComment): CommentEntry => {
  const stamp = nowStamp()
  const date = stamp.slice(0, 10)
  const seq = Math.max(0, ...meta.comments.map((comment) => {
    const match = new RegExp(`^c-${date}-(\\d+)$`).exec(comment.id)
    return match ? Number(match[1]) : 0
  })) + 1
  return {
    id: `c-${date}-${String(seq).padStart(3, '0')}`,
    anchor: input.anchor ?? '',
    ...(input.quote ? { quote: input.quote } : {}),
    ...(input.prefix ? { prefix: input.prefix } : {}),
    ...(input.suffix ? { suffix: input.suffix } : {}),
    text: input.text,
    status: 'open',
    created_at: stamp,
    author: input.author ?? 'reader',
    resolved_in: null,
  }
}

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

/** The most recent approval, if any. */
export const latestApproval = (meta: Meta): Approval | null =>
  meta.approvals?.length ? meta.approvals[meta.approvals.length - 1] : null

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
