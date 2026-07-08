import fs from 'node:fs'
import path from 'node:path'
import { loadDoc, parseRevId, readMeta, revId, splitRaw } from './core.js'

export interface Issue {
  level: 'error' | 'warn' | 'info'
  message: string
}

const SKIP_DIRS = new Set(['.git', 'node_modules', '.history', 'dist', '.obsidian'])

export const findPentimentoDocs = (root: string): string[] => {
  const out: string[] = []
  const walk = (dir: string): void => {
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return // unreadable directory — skip
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) walk(path.join(dir, entry.name))
        continue
      }
      if (!entry.name.endsWith('.md')) continue
      const p = path.join(dir, entry.name)
      try {
        const head = fs.readFileSync(p, 'utf8').slice(0, 2000)
        if (/^(?:Pentimento|Vellum):\s*true$/m.test(head)) out.push(p)
      } catch {
        // broken symlink or unreadable file — not a Pentimento doc
      }
    }
  }
  walk(root)
  return out.sort()
}

/** Consistency check: canonical frontmatter, history files, and meta.yml must agree. */
export const verifyDoc = (docPath: string): Issue[] => {
  const issues: Issue[] = []
  const err = (message: string) => issues.push({ level: 'error', message })
  const warn = (message: string) => issues.push({ level: 'warn', message })
  const info = (message: string) => issues.push({ level: 'info', message })

  let doc
  try {
    doc = loadDoc(docPath)
  } catch (e) {
    err(e instanceof Error ? e.message : String(e))
    return issues
  }
  if (doc.frontmatter['Pentimento'] !== true && doc.frontmatter['Vellum'] !== true) {
    info('not a Pentimento document (no `Pentimento: true` frontmatter) — nothing to verify')
    return issues
  }
  if (doc.historyDir.includes('{{')) {
    info('template file (placeholder in History Folder) — skipped')
    return issues
  }

  let current = 0
  try {
    current = parseRevId(doc.frontmatter['Current Revision'])
  } catch (e) {
    err(e instanceof Error ? e.message : String(e))
  }

  if (!fs.existsSync(doc.historyDir)) {
    err(`history folder missing: ${doc.historyDir}`)
    return issues
  }

  let meta
  try {
    meta = readMeta(doc.historyDir)
  } catch (e) {
    err(e instanceof Error ? e.message : String(e))
    return issues
  }

  const files = fs
    .readdirSync(doc.historyDir)
    .filter((f) => /^r\d{3,}\.md$/.test(f))
    .map((f) => f.replace(/\.md$/, ''))
    .sort()
  const metaIds = meta.revisions.map((r) => r.id)

  if (new Set(metaIds).size !== metaIds.length) err('duplicate revision ids in meta.yml')
  for (const id of metaIds) {
    if (!files.includes(id)) err(`meta.yml lists ${id} but ${id}.md does not exist`)
  }
  for (const f of files) {
    if (!metaIds.includes(f)) warn(`${f}.md exists but meta.yml has no entry for it`)
  }
  for (let i = 0; i < metaIds.length; i++) {
    if (metaIds[i] !== revId(i + 1)) {
      warn(`revision ids are not sequential from r001 (found ${metaIds[i]} at position ${i + 1})`)
      break
    }
  }

  const last = metaIds[metaIds.length - 1]
  if (current > 0 && last && revId(current) !== last) {
    err(`canonical says Current Revision ${revId(current)} but the latest meta revision is ${last}`)
  }
  if (current > 0 && !files.includes(revId(current))) {
    err(`Current Revision ${revId(current)} has no snapshot file`)
  }

  for (const f of files) {
    const content = fs.readFileSync(path.join(doc.historyDir, `${f}.md`), 'utf8')
    if (splitRaw(content).body.trim().length < 40) {
      warn(`${f}.md looks like a stub (${content.length} bytes), not a real snapshot`)
    }
  }

  if (last && files.includes(last)) {
    const lastBody = splitRaw(fs.readFileSync(path.join(doc.historyDir, `${last}.md`), 'utf8')).body
    if (lastBody.trim() !== doc.body.trim()) {
      info(`canonical has changes not yet snapshotted (differs from ${last})`)
    }
  }

  return issues
}
