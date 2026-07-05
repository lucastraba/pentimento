import { diffArrays, diffWords } from 'diff'

export interface BlockPart {
  type: 'same' | 'add' | 'del' | 'change'
  old?: string
  new?: string
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Split a markdown body into diffable blocks; fences and ::: containers stay atomic. */
export const splitBlocks = (body: string): string[] => {
  const lines = body.split('\n')
  const blocks: string[] = []
  let cur: string[] = []
  let inFence = false
  let inContainer = false
  const flush = () => {
    const t = cur.join('\n').trim()
    if (t) blocks.push(t)
    cur = []
  }
  for (const line of lines) {
    const t = line.trim()
    if (/^```/.test(t)) {
      inFence = !inFence
      cur.push(line)
      if (!inFence && !inContainer) flush()
      continue
    }
    if (!inFence) {
      if (!inContainer && /^:::\s*\w/.test(t)) {
        flush()
        inContainer = true
        cur.push(line)
        continue
      }
      if (inContainer && /^:::$/.test(t)) {
        cur.push(line)
        inContainer = false
        flush()
        continue
      }
      if (!inContainer && t === '') {
        flush()
        continue
      }
    }
    cur.push(line)
  }
  flush()
  return blocks
}

export const diffBlocks = (oldBody: string, newBody: string): BlockPart[] => {
  const parts = diffArrays(splitBlocks(oldBody), splitBlocks(newBody))
  const out: BlockPart[] = []
  let i = 0
  while (i < parts.length) {
    const p = parts[i]
    const next = parts[i + 1]
    if (p.removed && next?.added) {
      // a replace hunk: pair blocks positionally for word-level diffing
      const paired = Math.min(p.value.length, next.value.length)
      for (let k = 0; k < paired; k++) out.push({ type: 'change', old: p.value[k], new: next.value[k] })
      for (let k = paired; k < p.value.length; k++) out.push({ type: 'del', old: p.value[k] })
      for (let k = paired; k < next.value.length; k++) out.push({ type: 'add', new: next.value[k] })
      i += 2
    } else if (p.removed) {
      p.value.forEach((v) => out.push({ type: 'del', old: v }))
      i++
    } else if (p.added) {
      p.value.forEach((v) => out.push({ type: 'add', new: v }))
      i++
    } else {
      p.value.forEach((v) => out.push({ type: 'same', old: v, new: v }))
      i++
    }
  }
  return out
}

const isCodey = (s: string): boolean => /^(```|:::|\||<)/.test(s.trimStart())

const wordDiffHtml = (oldS: string, newS: string): string =>
  diffWords(oldS, newS)
    .map((p) => (p.added ? `<ins>${escapeHtml(p.value)}</ins>` : p.removed ? `<del>${escapeHtml(p.value)}</del>` : escapeHtml(p.value)))
    .join('')

/**
 * Reader-facing revision diff: changed blocks with word-level ins/del marks,
 * unchanged runs collapsed, the nearest heading shown as context before each change.
 */
export const renderDiffHtml = (oldBody: string, newBody: string): string => {
  const parts = diffBlocks(oldBody, newBody)
  const out: string[] = []
  let skip = 0
  let pendingCtx: string | null = null
  const flushSkip = () => {
    if (skip) {
      out.push(`<div class="rdiff-skip">⋯ ${skip} unchanged block${skip > 1 ? 's' : ''}</div>`)
      skip = 0
    }
  }
  for (const p of parts) {
    if (p.type === 'same') {
      skip++
      if (/^#{1,3}\s/.test(p.new!)) pendingCtx = p.new!.split('\n')[0].replace(/<!--.*?-->/g, '').trim()
      continue
    }
    flushSkip()
    if (pendingCtx) {
      out.push(`<div class="rdiff-ctx">${escapeHtml(pendingCtx)}</div>`)
      pendingCtx = null
    }
    const cls = `rdiff-block${isCodey(p.new ?? p.old ?? '') ? ' codey' : ''}`
    if (p.type === 'change') out.push(`<div class="${cls}">${wordDiffHtml(p.old!, p.new!)}</div>`)
    else if (p.type === 'add') out.push(`<div class="${cls}"><ins>${escapeHtml(p.new!)}</ins></div>`)
    else out.push(`<div class="${cls}"><del>${escapeHtml(p.old!)}</del></div>`)
  }
  flushSkip()
  if (!out.some((h) => h.includes('rdiff-block'))) {
    return '<div class="rdiff-skip">No content changes in the body (frontmatter or metadata only).</div>'
  }
  return out.join('\n')
}
