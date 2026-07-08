import fs from 'node:fs'
import path from 'node:path'
import { parseDocument, parse as parseYaml, stringify as stringifyYaml } from 'yaml'

export interface RevisionEntry {
  id: string
  created_at: string
  author: string
  summary: string
  why?: string
  source?: string
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
}

export interface NewComment {
  text: string
  anchor?: string
  quote?: string
  prefix?: string
  suffix?: string
  author?: string
}

export interface Meta {
  revisions: RevisionEntry[]
  comments: CommentEntry[]
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
  fs.writeFileSync(tmp, content, 'utf8')
  fs.renameSync(tmp, filePath)
}

export const revId = (n: number): string => `r${String(n).padStart(3, '0')}`

export const parseRevId = (value: unknown): number => {
  const m = /^r(\d{3,})$/.exec(String(value ?? '').trim())
  if (!m) throw new Error(`Invalid Current Revision value: ${JSON.stringify(value)} — expected rNNN`)
  return Number(m[1])
}

export const loadDoc = (docPath: string): Doc => {
  const canonicalPath = path.resolve(docPath)
  if (!fs.existsSync(canonicalPath)) throw new Error(`No such document: ${canonicalPath}`)
  const raw = fs.readFileSync(canonicalPath, 'utf8')
  const m = FRONTMATTER_RE.exec(raw)
  const frontmatter = m ? ((parseYaml(m[1]) ?? {}) as Record<string, unknown>) : {}
  const body = m ? raw.slice(m[0].length) : raw
  const name = path.basename(canonicalPath).replace(/\.md$/i, '')
  // History Folder is canonical-relative — the single path contract (audit C3)
  const historyRel = typeof frontmatter['History Folder'] === 'string'
    ? (frontmatter['History Folder'] as string)
    : path.join('.history', name)
  const historyDir = path.resolve(path.dirname(canonicalPath), historyRel)
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

export const readMeta = (historyDir: string): Meta => {
  const metaPath = path.join(historyDir, 'meta.yml')
  if (!fs.existsSync(metaPath)) return { revisions: [], comments: [] }
  const parsed = parseYaml(fs.readFileSync(metaPath, 'utf8')) as Partial<Meta> | null
  if (parsed === null || typeof parsed !== 'object') {
    throw new Error(`Unreadable meta.yml at ${metaPath} — refusing to touch it`)
  }
  return { revisions: parsed.revisions ?? [], comments: parsed.comments ?? [] }
}

export const writeMeta = (historyDir: string, meta: Meta): void => {
  const metaPath = path.join(historyDir, 'meta.yml')
  atomicWrite(metaPath, stringifyYaml({ revisions: meta.revisions, comments: meta.comments }))
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
  summary: string
  why?: string
  source?: string
  author?: string
}

export interface SnapshotResult {
  rev: string
  historyFile: string
}

/**
 * Capture the canonical as the next revision.
 * Order: history file first (refusing to overwrite), then meta, then canonical stamp —
 * a crash mid-way surfaces loudly on the next run instead of silently overwriting (audit C1).
 */
export const snapshot = (docPath: string, opts: SnapshotOptions): SnapshotResult => {
  const doc = loadDoc(docPath)
  return withLock(doc.historyDir, () => {
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
    const { cleaned, found } = extractInlineComments(doc.raw)
    const stamped = stampFrontmatter(cleaned, {
      Pentimento: true,
      Vellum: null, // migrate pre-rename docs: drop the legacy marker on first snapshot
      'Current Revision': next,
      'History Folder': historyRel,
    })
    fs.writeFileSync(historyFile, stamped, { flag: 'wx' })
    const meta = readMeta(doc.historyDir)
    meta.revisions.push({
      id: next,
      created_at: nowStamp(),
      author: opts.author ?? 'unknown',
      summary: opts.summary,
      ...(opts.why ? { why: opts.why } : {}),
      ...(opts.source ? { source: opts.source } : {}),
    })
    for (const f of found) {
      meta.comments.push(makeComment(meta, { text: f.text, anchor: f.anchor, author: opts.author }))
    }
    writeMeta(doc.historyDir, meta)
    atomicWrite(doc.canonicalPath, stamped)
    return { rev: next, historyFile }
  })
}

const makeComment = (meta: Meta, input: NewComment): CommentEntry => {
  const stamp = nowStamp()
  const date = stamp.slice(0, 10)
  const seq = meta.comments.filter((c) => c.id.startsWith(`c-${date}`)).length + 1
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

export const resolveComment = (docPath: string, id: string, rev?: string): CommentEntry => {
  const doc = loadDoc(docPath)
  return withLock(doc.historyDir, () => {
    const meta = readMeta(doc.historyDir)
    const c = meta.comments.find((x) => x.id === id)
    if (!c) throw new Error(`no comment ${id} on ${doc.name}`)
    c.status = 'resolved'
    c.resolved_in = rev ?? null
    writeMeta(doc.historyDir, meta)
    return c
  })
}

export const readRevision = (docPath: string, rev: string): string => {
  const doc = loadDoc(docPath)
  const file = path.join(doc.historyDir, `${rev}.md`)
  if (!fs.existsSync(file)) throw new Error(`No revision ${rev} for ${doc.name} (looked at ${file})`)
  return fs.readFileSync(file, 'utf8')
}

/** Restore an earlier revision's body as a new revision (history stays append-only). */
export const revert = (docPath: string, rev: string, author?: string): SnapshotResult => {
  const target = readRevision(docPath, rev)
  const doc = loadDoc(docPath)
  const targetBody = FRONTMATTER_RE.exec(target)
    ? target.slice(FRONTMATTER_RE.exec(target)![0].length)
    : target
  const restored = doc.raw.slice(0, doc.raw.length - doc.body.length) + targetBody
  atomicWrite(doc.canonicalPath, restored)
  return snapshot(docPath, {
    summary: `Restored content of ${rev}`,
    why: `pentimento revert ${rev}`,
    author,
  })
}
