import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { ASSET_RE } from './imageref.js'

/**
 * The draft format with no file access: frontmatter stamping, meta.yml parsing and
 * validation, revision numbering, inline-comment extraction, and snapshot planning.
 * The CLI (src/core.ts) and the Obsidian plugin both build on it, so a draft saved
 * by either is byte-for-byte the same.
 */

export interface RevisionEntry {
  id: string
  created_at: string
  author: string
  summary: string
  why?: string
  source?: string
  /** the image each reference pointed to when this draft was saved: path as written → hash */
  images?: Record<string, string>
}

export interface ReplyEntry {
  author: string
  text: string
  created_at: string
}

/** What a comment on an image points at. */
export interface ImageMark {
  /** the image as the document writes it: a path, or `[[name]]` for an Obsidian embed */
  ref: string
  /** the stored image the comment was made on, `<hash>.<ext>` */
  asset: string
  /** the part the reader marked, as fractions of the image's width and height; absent for the whole image */
  box?: { x: number; y: number; w: number; h: number }
  /** the image's size in pixels, as the reader's browser loaded it */
  width?: number
  height?: number
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
  /** set when the comment is on an image rather than on selected text */
  image?: ImageMark
}

export interface NewComment {
  text: string
  anchor?: string
  quote?: string
  prefix?: string
  suffix?: string
  author?: string
  image?: ImageMark
}

const isFraction = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1

/** Why an image mark is malformed, or null when it's fine. */
export const imageMarkProblem = (value: unknown): string | null => {
  if (!isRecord(value)) return 'must be an object'
  if (typeof value.ref !== 'string' || !value.ref) return 'needs the image reference'
  if (typeof value.asset !== 'string' || !ASSET_RE.test(value.asset)) return 'needs a stored image name (<hash>.<ext>)'
  if (value.box !== undefined) {
    const box = value.box as Record<string, unknown>
    if (!isRecord(box) || ![box.x, box.y, box.w, box.h].every(isFraction)) return 'box needs x, y, w, and h between 0 and 1'
    if ((box.w as number) <= 0 || (box.h as number) <= 0 || (box.x as number) + (box.w as number) > 1.0001 || (box.y as number) + (box.h as number) > 1.0001) {
      return 'box must have a size and stay inside the image'
    }
  }
  for (const side of ['width', 'height'] as const) {
    if (value[side] !== undefined && !(Number.isInteger(value[side]) && (value[side] as number) > 0)) return `${side} must be a whole number of pixels`
  }
  return null
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


export const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

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

export const revId = (n: number): string => `r${String(n).padStart(3, '0')}`

export const parseRevId = (value: unknown): number => {
  const m = /^r(\d{3,})$/.exec(String(value ?? '').trim())
  if (!m) throw new Error(`Invalid Current Revision value: ${JSON.stringify(value)} — expected rNNN`)
  return Number(m[1])
}

/**
 * Set or remove top-level frontmatter keys by editing only their own lines, so the rest of
 * the frontmatter (the user's properties, their order, quoting, and spacing) stays as written.
 */
const editKeys = (lines: string[], updates: Record<string, string | boolean | null>): string[] => {
  const out = [...lines]
  for (const [key, value] of Object.entries(updates)) {
    const at = out.findIndex((l) => l.startsWith(`${key}:`) || l.startsWith(`'${key}':`) || l.startsWith(`"${key}":`))
    // a key's value may continue on indented lines below it
    let span = 0
    if (at >= 0) {
      span = 1
      while (at + span < out.length && /^[ \t]+\S/.test(out[at + span])) span++
    }
    if (value === null) {
      if (at >= 0) out.splice(at, span)
      continue
    }
    const line = stringifyYaml({ [key]: value }).replace(/\n$/, '')
    if (at >= 0) out.splice(at, span, line)
    else out.push(line)
  }
  return out
}

export const stampFrontmatter = (raw: string, updates: Record<string, string | boolean | null>): string => {
  const m = FRONTMATTER_RE.exec(raw)
  if (m) return `---\n${editKeys(m[1].split(/\r?\n/), updates).join('\n')}\n---\n${raw.slice(m[0].length)}`
  const kept = Object.fromEntries(Object.entries(updates).filter(([, v]) => v !== null))
  const fmDoc = stringifyYaml(kept).replace(/\n$/, '')
  return `---\n${fmDoc}\n---\n\n${raw}`
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const metadataError = (metaPath: string, detail: string): never => {
  throw new Error(`Invalid meta.yml at ${metaPath}: ${detail}`)
}

export const validateMeta = (value: unknown, metaPath: string): Meta => {
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
    // `images` is read leniently (see revisionImages): a malformed or newer entry must never
    // make a history unreadable for an older version
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
    // `image` is read leniently too (see commentImage)
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

export const makeComment = (meta: Meta, input: NewComment): CommentEntry => {
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
    ...(input.image ? { image: input.image } : {}),
    text: input.text,
    status: 'open',
    created_at: stamp,
    author: input.author ?? 'reader',
    resolved_in: null,
  }
}

/**
 * A revision's images, keeping only well-formed entries; undefined for drafts saved before
 * drafts kept images. Unknown or malformed entries stay in meta.yml untouched.
 */
export const revisionImages = (revision: RevisionEntry | undefined): Record<string, string> | undefined => {
  const images: unknown = revision?.images
  if (!isRecord(images)) return undefined
  return Object.fromEntries(Object.entries(images).filter(([, hash]) => typeof hash === 'string' && /^[0-9a-f]{16}$/.test(hash))) as Record<string, string>
}

/** A comment's image mark if it is well formed. */
export const commentImage = (comment: CommentEntry): ImageMark | undefined =>
  comment.image !== undefined && imageMarkProblem(comment.image) === null ? comment.image : undefined

/** The most recent approval, if any. */
export const latestApproval = (meta: Meta): Approval | null =>
  meta.approvals?.length ? meta.approvals[meta.approvals.length - 1] : null


/** Parse meta.yml text (null when the file doesn't exist yet). */
export const parseMeta = (text: string | null, metaPath: string): Meta => {
  if (text === null) return { revisions: [], comments: [] }
  let parsed: unknown
  try {
    parsed = parseYaml(text)
  } catch (error) {
    throw new Error(`Unreadable meta.yml at ${metaPath} — refusing to touch it: ${error instanceof Error ? error.message : String(error)}`)
  }
  return validateMeta(parsed, metaPath)
}

export const serializeMeta = (meta: Meta, metaPath = 'meta.yml'): string => {
  validateMeta(meta, metaPath)
  return stringifyYaml({
    revisions: meta.revisions,
    comments: meta.comments,
    ...(meta.approvals?.length ? { approvals: meta.approvals } : {}),
  })
}

export interface SnapshotOptions {
  /** what changed; computed from the diff (headings name the parts) when omitted */
  summary?: string
  why?: string
  source?: string
  author?: string
}

/** The frontmatter keys a snapshot owns. */
const stampKeys = (rev: string, historyRel: string): Record<string, string | boolean | null> => ({
  Pentimento: true,
  Vellum: null, // migrate pre-rename docs: drop the legacy marker on first snapshot
  'Current Revision': rev,
  'History Folder': historyRel,
})

/** The canonical as a snapshot leaves it: inline comments removed, frontmatter stamped. */
export const stampCanonical = (raw: string, rev: string, historyRel: string): { stamped: string; found: { text: string; anchor: string }[] } => {
  const { cleaned, found } = extractInlineComments(raw)
  return { stamped: stampFrontmatter(cleaned, stampKeys(rev, historyRel)), found }
}

/**
 * The canonical with Pentimento's frontmatter keys removed. The frontmatter block goes too
 * when nothing else was in it, so a note returns to how it was before its first draft.
 */
export const unstampCanonical = (raw: string): string => {
  const m = FRONTMATTER_RE.exec(raw)
  if (!m) return raw
  const remaining = editKeys(m[1].split(/\r?\n/), { Pentimento: null, Vellum: null, 'Current Revision': null, 'History Folder': null })
  const rest = raw.slice(m[0].length)
  if (remaining.every((l) => !l.trim())) return rest.replace(/^\r?\n/, '')
  return `---\n${remaining.join('\n')}\n---\n${rest}`
}

/** The revision a snapshot of this source would create (r001 for a document with none). */
export const nextRevision = (raw: string): string => {
  const m = FRONTMATTER_RE.exec(raw)
  const fm = m ? ((parseYaml(m[1]) ?? {}) as Record<string, unknown>) : {}
  // 'Vellum: true' is the pre-rename marker; keep reading it so old docs snapshot cleanly
  const isPentimento = fm['Pentimento'] === true || fm['Vellum'] === true
  const current = isPentimento && fm['Current Revision'] !== undefined ? parseRevId(fm['Current Revision']) : 0
  return revId(current + 1)
}

export interface SnapshotPlan {
  rev: string
  /** the new canonical text, which is also the revision file's content */
  stamped: string
  /** meta with the new revision and any extracted inline comments appended */
  meta: Meta
}

/**
 * Everything a snapshot writes, computed without touching storage. The caller writes
 * `stamped` to the revision file and the canonical, and `meta` to meta.yml.
 */
export const planSnapshot = (input: {
  raw: string
  meta: Meta
  historyRel: string
  /** the latest saved revision's body, for computed summaries; null for a first draft */
  previousBody: string | null
  opts: SnapshotOptions
  describe: (previousBody: string | null, body: string) => string
}): SnapshotPlan => {
  const rev = nextRevision(input.raw)
  const { stamped, found } = stampCanonical(input.raw, rev, input.historyRel)
  const meta: Meta = {
    ...input.meta,
    revisions: [...input.meta.revisions],
    comments: [...input.meta.comments],
  }
  const summary = input.opts.summary?.trim() || input.describe(input.previousBody, splitRaw(stamped).body)
  meta.revisions.push({
    id: rev,
    created_at: nowStamp(),
    author: input.opts.author ?? 'unknown',
    summary,
    ...(input.opts.why ? { why: input.opts.why } : {}),
    ...(input.opts.source ? { source: input.opts.source } : {}),
  })
  for (const f of found) meta.comments.push(makeComment(meta, { text: f.text, anchor: f.anchor, author: input.opts.author }))
  return { rev, stamped, meta }
}
