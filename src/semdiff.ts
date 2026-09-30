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
      // a heading always starts its own block, so a heading glued to its first
      // paragraph still diffs (and labels) as a heading
      if (!inContainer && /^#{1,6}\s/.test(t)) {
        flush()
        cur.push(line)
        flush()
        continue
      }
    }
    cur.push(line)
  }
  flush()
  return blocks
}

const words = (s: string): string[] => s.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []

/** Share of words two blocks have in common, 0..1, by a word-level diff. */
export const similarity = (a: string, b: string): number => {
  const wa = words(a)
  const wb = words(b)
  if (!wa.length && !wb.length) return 1
  const common = diffArrays(wa, wb).filter((p) => !p.added && !p.removed).reduce((n, p) => n + p.value.length, 0)
  return common / Math.max(wa.length, wb.length)
}

// heading comments carry anchors, not content; changing one is not a change to the text
const comparable = (block: string): string => (isHeading(block) ? block.replace(/\s*<!--.*?-->\s*$/, '') : block)

export const diffBlocks = (oldBody: string, newBody: string): BlockPart[] => {
  const parts = diffArrays(splitBlocks(oldBody), splitBlocks(newBody), {
    comparator: (a: string, b: string) => comparable(a) === comparable(b),
  })
  const out: BlockPart[] = []
  let i = 0
  while (i < parts.length) {
    const p = parts[i]
    const next = parts[i + 1]
    if (p.removed && next?.added) {
      // a replace hunk: pair blocks positionally for word-level diffing, but a heading
      // only pairs with a heading
      const olds = [...p.value]
      const news = [...next.value]
      while (olds.length || news.length) {
        const o = olds[0]
        const n = news[0]
        if (o !== undefined && n !== undefined && isHeading(o) === isHeading(n)) {
          out.push({ type: 'change', old: olds.shift(), new: news.shift() })
        } else if (o !== undefined && (n === undefined || isHeading(n))) {
          out.push({ type: 'del', old: olds.shift() })
        } else {
          out.push({ type: 'add', new: news.shift() })
        }
      }
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

export const isHeading = (block: string): boolean => /^#{1,6}\s/.test(block)
const isCodey = (s: string): boolean => /^(```|:::|\||<)/.test(s.trimStart())
export const headingText = (block: string): string =>
  block.split('\n')[0].replace(/^#{1,6}\s+/, '').replace(/<!--.*?-->/g, '').replace(/[`*_]/g, '').trim()

/** Short lines stacked on each other (a stanza, a list) diff better line by line. */
export const isLineShaped = (block: string): boolean => {
  const lines = block.split('\n')
  return lines.length >= 2 && !isCodey(block) && lines.every((l) => l.length <= 100)
}

const wordDiffHtml = (oldS: string, newS: string): string =>
  diffWords(oldS, newS)
    .map((p) => (p.added ? `<ins>${escapeHtml(p.value)}</ins>` : p.removed ? `<del>${escapeHtml(p.value)}</del>` : escapeHtml(p.value)))
    .join('')

/** Line-level diff: unchanged lines plain, rewritten lines word-diffed, new and cut lines whole. */
const lineDiffHtml = (oldS: string, newS: string): string => {
  const out: string[] = []
  const parts = diffArrays(oldS.split('\n'), newS.split('\n'))
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    const next = parts[i + 1]
    if (p.removed && next?.added) {
      const n = Math.max(p.value.length, next.value.length)
      for (let k = 0; k < n; k++) {
        const o = p.value[k]
        const nw = next.value[k]
        if (o !== undefined && nw !== undefined && similarity(o, nw) >= 0.4) out.push(wordDiffHtml(o, nw))
        else {
          if (o !== undefined) out.push(`<del>${escapeHtml(o)}</del>`)
          if (nw !== undefined) out.push(`<ins>${escapeHtml(nw)}</ins>`)
        }
      }
      i++
    } else if (p.removed) p.value.forEach((l) => out.push(`<del>${escapeHtml(l)}</del>`))
    else if (p.added) p.value.forEach((l) => out.push(`<ins>${escapeHtml(l)}</ins>`))
    else p.value.forEach((l) => out.push(escapeHtml(l)))
  }
  return out.join('\n')
}

const blockDiffHtml = (oldS: string, newS: string): string =>
  isLineShaped(oldS) || isLineShaped(newS) ? lineDiffHtml(oldS, newS) : wordDiffHtml(oldS, newS)

/**
 * Reader-facing revision diff: changed blocks with word-level ins/del marks (line-level for
 * stanzas and lists), unchanged runs collapsed, the nearest heading shown before each change.
 */
export const renderDiffHtml = (oldBody: string, newBody: string): string => {
  const parts = diffBlocks(oldBody, newBody)
  const out: string[] = []
  let skip = 0
  let pendingCtx: string | null = null
  const flushSkip = () => {
    if (skip) {
      out.push(`<div class="rdiff-skip">${skip} unchanged block${skip > 1 ? 's' : ''}</div>`)
      skip = 0
    }
  }
  for (const p of parts) {
    if (p.type === 'same') {
      skip++
      if (isHeading(p.new!)) pendingCtx = headingText(p.new!)
      continue
    }
    flushSkip()
    if (pendingCtx) {
      out.push(`<div class="rdiff-ctx">${escapeHtml(pendingCtx)}</div>`)
      pendingCtx = null
    }
    const cls = `rdiff-block${isCodey(p.new ?? p.old ?? '') ? ' codey' : ''}`
    if (p.type === 'change') out.push(`<div class="${cls}">${blockDiffHtml(p.old!, p.new!)}</div>`)
    else if (p.type === 'add') out.push(`<div class="${cls}"><ins>${escapeHtml(p.new!)}</ins></div>`)
    else out.push(`<div class="${cls}"><del>${escapeHtml(p.old!)}</del></div>`)
  }
  flushSkip()
  if (!out.some((h) => h.includes('rdiff-block'))) {
    return '<div class="rdiff-skip">No content changes in the body (frontmatter or metadata only).</div>'
  }
  return out.join('\n')
}

// ---------------------------------------------------------------------------
// traces: the current draft with the previous one showing through
// ---------------------------------------------------------------------------

/** Private-use sentinels the renderer swaps for <del>/<ins> after markdown rendering. */
export const TRACE = { delOpen: '', delClose: '', insOpen: '', insClose: '' } as const

export type TracePart =
  | { kind: 'same'; text: string }
  /** markdown with trace sentinels around changed words; renders in place of the block */
  | { kind: 'inline'; text: string }
  | { kind: 'add'; text: string }
  | { kind: 'del'; text: string; heading?: string }
  /** a directive or code block that changed: the new version, with the old one behind a fold */
  | { kind: 'swap'; old: string; text: string }

// a changed run can be marked inline only if wrapping it can't split a markdown construct
const inlineSafe = (chunk: string): boolean =>
  !/[\n[\]<>|\\]/.test(chunk) && (chunk.match(/`/g) ?? []).length % 2 === 0 &&
  (chunk.match(/\*/g) ?? []).length % 2 === 0 && !/^\s*(?:[-*+]|\d+\.)\s/.test(chunk) && !/^\s*#/.test(chunk)

const inlineTrace = (oldS: string, newS: string): string | null => {
  if ([oldS, newS].some((s) => /\]\(|<|^\s*(?:```|:::|\|)/.test(s))) return null
  const lineShaped = isLineShaped(oldS) || isLineShaped(newS)
  if (lineShaped) {
    // stanzas and lists: whole lines in and out, rewritten lines marked word by word
    const out: string[] = []
    const parts = diffArrays(oldS.split('\n'), newS.split('\n'))
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i]
      const next = parts[i + 1]
      const cutLine = (l: string): string | null => {
        const m = /^(\s*(?:[-*+]|\d+\.)\s+(?:\[[ xX]\]\s+)?)?(.*)$/.exec(l)!
        return inlineSafe(m[2]) ? `${m[1] ?? ''}${TRACE.delOpen}${m[2]}${TRACE.delClose}` : null
      }
      const newLine = (l: string): string | null => {
        const m = /^(\s*(?:[-*+]|\d+\.)\s+(?:\[[ xX]\]\s+)?)?(.*)$/.exec(l)!
        return inlineSafe(m[2]) ? `${m[1] ?? ''}${TRACE.insOpen}${m[2]}${TRACE.insClose}` : null
      }
      if (p.removed && next?.added) {
        const n = Math.max(p.value.length, next.value.length)
        for (let k = 0; k < n; k++) {
          const o = p.value[k]
          const nw = next.value[k]
          if (o !== undefined && nw !== undefined && similarity(o, nw) >= 0.4) {
            const marked = inlineWords(o, nw)
            if (marked === null) return null
            out.push(marked)
          } else {
            // a cut list item has no line of its own in the new list; keep it as a ghost line
            if (o !== undefined) { const l = cutLine(o); if (l === null) return null; out.push(l) }
            if (nw !== undefined) { const l = newLine(nw); if (l === null) return null; out.push(l) }
          }
        }
        i++
      } else if (p.removed) {
        for (const l of p.value) { const m = cutLine(l); if (m === null) return null; out.push(m) }
      } else if (p.added) {
        for (const l of p.value) { const m = newLine(l); if (m === null) return null; out.push(m) }
      } else out.push(...p.value)
    }
    return out.join('\n')
  }
  return inlineWords(oldS, newS)
}

const inlineWords = (oldS: string, newS: string): string | null => {
  let out = ''
  for (const p of diffWords(oldS, newS)) {
    if (!p.added && !p.removed) { out += p.value; continue }
    if (!p.value.trim()) { if (p.added) out += p.value; continue }
    if (!inlineSafe(p.value)) return null
    // keep the surrounding whitespace outside the marks
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(p.value)!
    out += p.added
      ? (m[1] + TRACE.insOpen + m[2] + TRACE.insClose + m[3])
      : (m[1] + TRACE.delOpen + m[2] + TRACE.delClose + m[3])
  }
  return out
}

/** Plan the traces view block by block. Inline marks where safe, whole ghost blocks elsewhere. */
export const tracePlan = (oldBody: string, newBody: string): TracePart[] => {
  const out: TracePart[] = []
  for (const p of diffBlocks(oldBody, newBody)) {
    if (p.type === 'same') { out.push({ kind: 'same', text: p.new! }); continue }
    if (p.type === 'add') {
      out.push(isHeading(p.new!) ? { kind: 'same', text: p.new! } : { kind: 'add', text: p.new! })
      continue
    }
    if (p.type === 'del') {
      out.push(isHeading(p.old!) ? { kind: 'del', text: p.old!, heading: headingText(p.old!) } : { kind: 'del', text: p.old! })
      continue
    }
    // changed block
    if (isHeading(p.new!)) { out.push({ kind: 'same', text: p.new! }); continue }
    if (isCodey(p.old!) && isCodey(p.new!)) { out.push({ kind: 'swap', old: p.old!, text: p.new! }); continue }
    const marked = similarity(p.old!, p.new!) >= 0.25 ? inlineTrace(p.old!, p.new!) : null
    if (marked !== null) out.push({ kind: 'inline', text: marked })
    else {
      out.push({ kind: 'del', text: p.old! })
      out.push({ kind: 'add', text: p.new! })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// summaries and cuttings
// ---------------------------------------------------------------------------

const listPhrase = (items: string[]): string =>
  items.length <= 1 ? items.join('')
    : items.length === 2 ? `${items[0]} and ${items[1]}`
    : items.length === 3 ? `${items[0]}, ${items[1]}, and ${items[2]}`
    : `${items.slice(0, 2).join(', ')}, and ${items.length - 2} more`

/**
 * A one-line account of what moved, for snapshots saved without --summary:
 * "Removed Bridge; rewrote Chorus; edited Verse 2". Headings name the parts.
 */
export const describeChanges = (oldBody: string | null, newBody: string): string => {
  if (oldBody === null) return 'First draft'
  const parts = diffBlocks(oldBody, newBody)
  const removed: string[] = []
  const added: string[] = []
  const rewrote: string[] = []
  const edited: string[] = []
  const push = (list: string[], v: string) => { if (v && !list.includes(v)) list.push(v) }
  let ctxOld = ''
  let ctxNew = ''
  let untitled = 0
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    if (p.type === 'same') {
      if (isHeading(p.new!)) { ctxOld = headingText(p.new!); ctxNew = ctxOld }
      continue
    }
    if (p.type === 'del' && isHeading(p.old!)) {
      ctxOld = headingText(p.old!)
      push(removed, ctxOld)
      continue
    }
    if (p.type === 'add' && isHeading(p.new!)) {
      ctxNew = headingText(p.new!)
      push(added, ctxNew)
      continue
    }
    if (p.type === 'change' && isHeading(p.new!)) {
      ctxOld = headingText(p.old!)
      ctxNew = headingText(p.new!)
      push(edited, `${ctxOld} → ${ctxNew}`)
      continue
    }
    const where = p.type === 'del' ? ctxOld : ctxNew
    if (removed.includes(where) || added.includes(where)) continue
    if (!where) { untitled++; continue }
    if (p.type === 'change' && similarity(p.old!, p.new!) >= 0.5) push(edited, where)
    else push(rewrote, where)
  }
  for (const w of rewrote) { const k = edited.indexOf(w); if (k >= 0) edited.splice(k, 1) }
  const clauses: string[] = []
  if (removed.length) clauses.push(`removed ${listPhrase(removed)}`)
  if (added.length) clauses.push(`added ${listPhrase(added)}`)
  if (rewrote.length) clauses.push(`rewrote ${listPhrase(rewrote)}`)
  if (edited.length) clauses.push(`edited ${listPhrase(edited)}`)
  if (untitled && !clauses.length) clauses.push(`edited ${untitled} passage${untitled > 1 ? 's' : ''}`)
  if (!clauses.length) return 'No content changes'
  const s = clauses.join('; ')
  return s[0].toUpperCase() + s.slice(1)
}

export interface Cutting {
  text: string
  /** the revision in which the passage disappeared ('canonical' for unsaved edits) */
  cutIn: string
  /** the revision it was last seen in */
  from: string
  /** nearest heading above it in the draft it was cut from */
  section: string
}

const normalizeText = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase()

/**
 * Passages that were cut or rewritten beyond recognition somewhere along the history and
 * aren't in the current draft. Newest cut first. Headings, code, and directives are skipped.
 */
export const collectCuttings = (drafts: { id: string; body: string }[]): Cutting[] => {
  if (drafts.length < 2) return []
  const current = normalizeText(drafts[drafts.length - 1].body)
  const seen = new Set<string>()
  const out: Cutting[] = []
  for (let k = 1; k < drafts.length; k++) {
    let ctx = ''
    for (const p of diffBlocks(drafts[k - 1].body, drafts[k].body)) {
      const oldBlock = p.old
      if (oldBlock !== undefined && isHeading(oldBlock)) { ctx = headingText(oldBlock); continue }
      let cut: string | null = null
      if (p.type === 'del') cut = oldBlock!
      else if (p.type === 'change' && similarity(oldBlock!, p.new!) < 0.5) cut = oldBlock!
      if (!cut || isCodey(cut) || words(cut).length < 4) continue
      const norm = normalizeText(cut)
      if (seen.has(norm) || current.includes(norm)) continue
      seen.add(norm)
      out.push({ text: cut, cutIn: drafts[k].id, from: drafts[k - 1].id, section: ctx })
    }
  }
  return out.reverse()
}

export const wordCount = (body: string): number =>
  body.replace(/<!--[\s\S]*?-->/g, '').match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0
