import { parse as parseYaml } from 'yaml'
import {
  FRONTMATTER_RE, parseMeta, planSnapshot, serializeMeta, splitRaw, stampCanonical, unstampCanonical,
  type Meta, type SnapshotOptions,
} from './model.js'
import { describeChanges } from './semdiff.js'

/**
 * Saving and reading drafts through an async storage interface, for hosts without Node's
 * file system (the Obsidian plugin). Paths are POSIX strings relative to the store's root.
 * The format logic is the same `model.ts` the CLI uses.
 */
export interface DraftStore {
  /** file contents, or null when the file doesn't exist */
  read(path: string): Promise<string | null>
  write(path: string, content: string): Promise<void>
  exists(path: string): Promise<boolean>
  /** create a folder and its parents; no error if it exists */
  mkdir(path: string): Promise<void>
  remove(path: string): Promise<void>
  rmdir(path: string): Promise<void>
  /** modification time in ms, or null when the path doesn't exist */
  mtime(path: string): Promise<number | null>
  /** true when the folder exists and has nothing in it */
  isEmptyFolder(path: string): Promise<boolean>
}

const dirname = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
const basename = (p: string): string => p.slice(p.lastIndexOf('/') + 1)

/** Join and normalize POSIX segments, refusing to climb above the store root. */
export const joinPath = (...parts: string[]): string => {
  const out: string[] = []
  for (const seg of parts.join('/').split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') {
      if (!out.length) throw new Error('path escapes the vault')
      out.pop()
    } else out.push(seg)
  }
  return out.join('/')
}

export interface DocLocation {
  docPath: string
  name: string
  /** History Folder relative to the document, as written in frontmatter */
  historyRel: string
  historyDir: string
  metaPath: string
}

/** Where a document keeps its history: `History Folder` frontmatter, else `.history/<name>`. */
export const locate = (docPath: string, raw: string): DocLocation => {
  const m = FRONTMATTER_RE.exec(raw)
  let fm: Record<string, unknown> = {}
  try { fm = m ? ((parseYaml(m[1]) ?? {}) as Record<string, unknown>) : {} } catch { /* treated as no frontmatter */ }
  const name = basename(docPath).replace(/\.md$/i, '')
  const historyRel = typeof fm['History Folder'] === 'string' ? (fm['History Folder'] as string) : `.history/${name}`
  if (historyRel.startsWith('/')) throw new Error('History Folder must be relative')
  // same contract as the CLI: the history lives inside the document's folder
  const base = joinPath(dirname(docPath))
  const historyDir = joinPath(base, historyRel)
  if (base && historyDir !== base && !historyDir.startsWith(`${base}/`)) {
    throw new Error('History Folder must stay inside the document\'s folder')
  }
  return { docPath, name, historyRel, historyDir, metaPath: joinPath(historyDir, 'meta.yml') }
}

const LOCK_STALE_MS = 10 * 60 * 1000

/** The same `.lock` folder the CLI uses, so the two never write a history at once. */
const withLock = async <T>(store: DraftStore, historyDir: string, fn: () => Promise<T>): Promise<T> => {
  const lock = joinPath(historyDir, '.lock')
  await store.mkdir(historyDir)
  const since = await store.mtime(lock)
  if (since !== null) {
    if (Date.now() - since < LOCK_STALE_MS) throw new Error('Another Pentimento operation is saving this document. Try again in a moment.')
    await store.rmdir(lock)
  }
  await store.mkdir(lock)
  try {
    return await fn()
  } finally {
    await store.rmdir(lock).catch(() => undefined)
  }
}

export interface SaveDraftResult {
  rev: string
  summary: string
  revisionPath: string
}

export interface SaveDraftOptions extends SnapshotOptions {
  /**
   * Rewrites the canonical in place. Hosts with an open editor pass one that stamps the
   * text as it is now, so a keystroke made while saving is never overwritten. Receives
   * the function that turns current text into stamped text.
   */
  updateCanonical?: (stamp: (current: string) => string) => Promise<void>
  /** save this body instead of the document's current one (restoring an earlier draft) */
  replacementBody?: string
}

/** Swap a document's body, keeping its frontmatter. */
const withBody = (raw: string, body: string): string => raw.slice(0, raw.length - splitRaw(raw).body.length) + body

/** Save the document as its next draft. Mirrors `snapshot` in core.ts, step for step. */
export const saveDraft = async (store: DraftStore, docPath: string, opts: SaveDraftOptions = {}): Promise<SaveDraftResult> => {
  const initial = await store.read(docPath)
  if (initial === null) throw new Error(`No such document: ${docPath}`)
  const where = locate(docPath, initial)
  return withLock(store, where.historyDir, async () => {
    const current = await store.read(docPath)
    if (current === null) throw new Error(`No such document: ${docPath}`)
    const raw = opts.replacementBody === undefined ? current : withBody(current, opts.replacementBody)
    if (locate(docPath, raw).historyDir !== where.historyDir) throw new Error('History Folder changed while saving')
    const meta = parseMeta(await store.read(where.metaPath), where.metaPath)
    const latest = meta.revisions[meta.revisions.length - 1]
    const latestRaw = latest ? await store.read(joinPath(where.historyDir, `${latest.id}.md`)) : null
    const plan = planSnapshot({
      raw,
      meta,
      historyRel: where.historyRel,
      previousBody: latestRaw === null ? null : splitRaw(latestRaw).body,
      opts,
      describe: describeChanges,
    })
    const revisionPath = joinPath(where.historyDir, `${plan.rev}.md`)
    if (await store.exists(revisionPath)) {
      throw new Error(`${revisionPath} already exists; history and frontmatter disagree, so nothing was saved`)
    }
    const previousMeta = await store.read(where.metaPath)
    let revisionWritten = false
    let metaWritten = false
    try {
      await store.write(revisionPath, plan.stamped)
      revisionWritten = true
      await store.write(where.metaPath, serializeMeta(plan.meta, where.metaPath))
      metaWritten = true
      if (opts.updateCanonical) {
        await opts.updateCanonical((now) => stampCanonical(
          opts.replacementBody === undefined ? now : withBody(now, opts.replacementBody), plan.rev, where.historyRel).stamped)
      } else {
        await store.write(docPath, plan.stamped)
      }
    } catch (error) {
      if (metaWritten) {
        await (previousMeta === null ? store.remove(where.metaPath) : store.write(where.metaPath, previousMeta)).catch(() => undefined)
      }
      if (revisionWritten) await store.remove(revisionPath).catch(() => undefined)
      throw new Error(`Saving the draft failed and nothing was changed: ${error instanceof Error ? error.message : String(error)}`)
    }
    return { rev: plan.rev, summary: plan.meta.revisions[plan.meta.revisions.length - 1].summary, revisionPath }
  })
}

/** Bring back an earlier draft as a new one; history only ever grows. */
export const restoreDraft = async (
  store: DraftStore, docPath: string, rev: string, opts: Omit<SaveDraftOptions, 'replacementBody' | 'summary'> = {},
): Promise<SaveDraftResult> => {
  const raw = await store.read(docPath)
  if (raw === null) throw new Error(`No such document: ${docPath}`)
  const where = locate(docPath, raw)
  const target = await store.read(joinPath(where.historyDir, `${rev}.md`))
  if (target === null) throw new Error(`No draft ${rev} for ${where.name}`)
  return saveDraft(store, docPath, { ...opts, summary: `Restored ${rev}`, replacementBody: splitRaw(target).body })
}

export interface RemoveHistoryOptions {
  /** like SaveDraftOptions.updateCanonical: rewrite the note as it is now */
  updateCanonical?: (unstamp: (current: string) => string) => Promise<void>
}

/**
 * Take a note out of Pentimento: its properties come off the note, then its history folder
 * (every draft, comment, and approval) is deleted. The note's text is left as it is.
 */
export const removeHistory = async (store: DraftStore, docPath: string, opts: RemoveHistoryOptions = {}): Promise<{ historyDir: string; drafts: number }> => {
  const raw = await store.read(docPath)
  if (raw === null) throw new Error(`No such document: ${docPath}`)
  const where = locate(docPath, raw)
  if (where.historyDir === joinPath(dirname(docPath))) {
    throw new Error('History Folder points at the note\'s own folder, so it can\'t be deleted safely; remove it by hand')
  }
  const since = await store.mtime(joinPath(where.historyDir, '.lock'))
  if (since !== null && Date.now() - since < LOCK_STALE_MS) throw new Error('A draft of this note is being saved. Try again in a moment.')
  let drafts = 0
  try { drafts = parseMeta(await store.read(where.metaPath), where.metaPath).revisions.length } catch { /* unreadable history is still removable */ }
  if (opts.updateCanonical) await opts.updateCanonical(unstampCanonical)
  else await store.write(docPath, unstampCanonical(raw))
  await store.rmdir(where.historyDir)
  // the shared `.history` folder goes too once its last note leaves
  const parent = dirname(where.historyDir)
  if (basename(parent) === '.history' && await store.isEmptyFolder(parent)) await store.rmdir(parent)
  return { historyDir: where.historyDir, drafts }
}

export interface DraftStatus {
  latest: { id: string; created_at: string; summary: string } | null
  /** true when the document differs from its latest saved draft (or has none) */
  dirty: boolean
}

/** The latest draft and whether the note moved since, reading only what that needs. */
export const draftStatus = async (store: DraftStore, docPath: string): Promise<DraftStatus | null> => {
  const raw = await store.read(docPath)
  if (raw === null) return null
  const location = locate(docPath, raw)
  const meta = parseMeta(await store.read(location.metaPath), location.metaPath)
  const latest = meta.revisions[meta.revisions.length - 1] ?? null
  if (!latest) return { latest: null, dirty: true }
  const saved = await store.read(joinPath(location.historyDir, `${latest.id}.md`))
  return { latest, dirty: saved === null || splitRaw(saved).body.trim() !== splitRaw(raw).body.trim() }
}

export interface DocHistory {
  location: DocLocation
  meta: Meta
  /** saved drafts, oldest first */
  drafts: { id: string; body: string }[]
  /** the document's body now */
  body: string
  /** true when the document differs from its latest saved draft (or has none) */
  dirty: boolean
}

/** Everything a history view needs, read in one pass. */
export const readHistory = async (store: DraftStore, docPath: string): Promise<DocHistory | null> => {
  const raw = await store.read(docPath)
  if (raw === null) return null
  const location = locate(docPath, raw)
  const meta = parseMeta(await store.read(location.metaPath), location.metaPath)
  const drafts: { id: string; body: string }[] = []
  for (const r of meta.revisions) {
    const text = await store.read(joinPath(location.historyDir, `${r.id}.md`))
    if (text !== null) drafts.push({ id: r.id, body: splitRaw(text).body })
  }
  const body = splitRaw(raw).body
  const latest = drafts[drafts.length - 1]
  return { location, meta, drafts, body, dirty: !latest || latest.body.trim() !== body.trim() }
}
