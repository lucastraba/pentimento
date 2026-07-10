import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import MarkdownIt from 'markdown-it'
import { parse as parseYaml } from 'yaml'
import { readUserConfig } from './config.js'
import { loadDoc, readMeta, readRevision, slugify, splitRaw, type Doc, type Meta } from './core.js'
import { renderDiffHtml } from './semdiff.js'
import {
  DEFAULT_PALETTE, isPalette, themeCss, themeInitSnippet, themePicker,
} from './themes.js'

const ASSETS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets')

const md: MarkdownIt = new MarkdownIt({ html: true, linkify: false, typographer: false })
// reader comments are untrusted (they arrive over HTTP via the viewer) — html:false makes
// markdown-it escape raw HTML and reject javascript: links, unlike the regex sanitize()
const mdUntrusted: MarkdownIt = new MarkdownIt({ html: false, linkify: false, typographer: false })

// every table scrolls inside its own container; the page never scrolls sideways
md.renderer.rules.table_open = () => '<div class="tablewrap"><table>\n'
md.renderer.rules.table_close = () => '</table></div>\n'
const defaultFence = md.renderer.rules.fence!
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const rendered = defaultFence(tokens, idx, options, env, self)
  return rendered.replace(/^<pre>/, '<pre class="block">')
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// A bright stroke over the faded stroke beneath it — the pentimento. Inline data URI
// so static renders stay self-contained.
export const FAVICON = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
  '<rect width="64" height="64" rx="14" fill="#241E33"/>' +
  '<path d="M14 46 C24 32 34 28 50 27" stroke="#4A3F66" stroke-width="7" fill="none" stroke-linecap="round"/>' +
  '<path d="M14 41 C26 41 38 33 50 17" stroke="#A78BE0" stroke-width="7" fill="none" stroke-linecap="round"/>' +
  '</svg>')}`

export const FAVICON_TAG = `<link rel="icon" type="image/svg+xml" href="${FAVICON}">`

/** Re-apply the reader's stored palette/scheme before first paint on pages without doc frontmatter (index, diff). */
export const RESTORE_SNIPPET = themeInitSnippet()

/** The fixed design system plus generated palette definitions, shared by every rendered surface. */
export const renderStylesheet = (): string =>
  `${fs.readFileSync(path.join(ASSETS, 'theme.css'), 'utf8')}\n${themeCss()}`

/** Strip active content from agent-supplied HTML/SVG (defense in depth; not a full sanitizer). */
const sanitize = (html: string): string =>
  html
    .replace(/<\s*(script|iframe|object|embed|foreignObject)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|iframe|object|embed|foreignObject)\b[^>]*\/?>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src|xlink:href)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1=$2#$2')

const plainText = (s: string): string => s.replace(/[`*_]/g, '')

const parseAttrs = (s: string): Record<string, string> => {
  const attrs: Record<string, string> = {}
  const re = /([\w-]+)=(?:"([^"]*)"|(\S+))/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) attrs[m[1]] = m[2] ?? m[3]
  return attrs
}

// ---------------------------------------------------------------------------
// directive handlers — the agent's entire expressive surface
// ---------------------------------------------------------------------------

type Handler = (content: string, attrs: Record<string, string>, kind: string) => string

const CALLOUT_LABELS: Record<string, string> = {
  decision: 'Decision', info: 'Info', warn: 'Warning', risk: 'Risk',
}

const renderCallout: Handler = (content, attrs, kind) => {
  const label = CALLOUT_LABELS[kind] ?? 'Note'
  const id = attrs.id ? ` id="${escapeHtml(attrs.id)}"` : ''
  return `<div class="callout ${kind}"${id}><span class="label">${label}</span>${md.render(content)}</div>`
}

const renderVerdict: Handler = (content) => {
  const cells = content
    .split('\n')
    .map((l) => /^-\s+(.+?)\s+::\s+(.+)$/.exec(l.trim()))
    .filter((m): m is RegExpExecArray => m !== null)
    .map(([, q, a]) => `<div><span class="q">${md.renderInline(q)}</span><span class="a">${md.renderInline(a)}</span></div>`)
  return `<div class="verdict">${cells.join('')}</div>`
}

const SEV_CLASS: Record<string, string> = { CRIT: 'c', HIGH: 'h', MED: 'm', LOW: 'm' }

const renderFindings: Handler = (content) => {
  const open: string[] = []
  const collapsed: string[] = []
  let collapseLabel: string | null = null
  const counts: Record<string, number> = { CRIT: 0, HIGH: 0, MED: 0, LOW: 0 }
  for (const line of content.split('\n')) {
    const t = line.trim()
    if (!t) continue
    const c = /^@collapse\s+(.+)$/.exec(t)
    if (c) { collapseLabel = c[1]; continue }
    const m = /^-\s+(CRIT|HIGH|MED|LOW)\s+::\s+(.+)$/.exec(t)
    if (!m) continue
    counts[m[1]]++
    const html = `<div class="finding"><span class="sev ${SEV_CLASS[m[1]]}">${m[1]}</span><div>${md.renderInline(m[2])}</div></div>`
    ;(collapseLabel ? collapsed : open).push(html)
  }
  // computed severity strip — the reader sees the shape before reading a single finding
  const total = counts.CRIT + counts.HIGH + counts.MED + counts.LOW
  const tally = (['CRIT', 'HIGH', 'MED', 'LOW'] as const)
    .filter((k) => counts[k])
    .map((k) => `<span class="tally ${SEV_CLASS[k]}"><b>${counts[k]}</b> ${k}</span>`)
    .join('')
  const summary = total ? `<div class="finding-summary">${tally}</div>` : ''
  // auto-label the collapsed group with its count when the agent didn't
  const label = collapseLabel
    ? (/\(\d+\)/.test(collapseLabel) ? collapseLabel : `${collapseLabel} (${collapsed.length})`)
    : null
  const details = label
    ? `<details><summary>${escapeHtml(label)}</summary>${collapsed.join('\n')}</details>`
    : ''
  return `${summary}<div>${open.join('\n')}</div>${details}`
}

const renderTimeline: Handler = (content) => {
  const items: string[] = []
  let current: string[] = []
  for (const line of content.split('\n')) {
    if (/^\d+\.\s+/.test(line.trim()) && current.length) { items.push(current.join(' ')); current = [] }
    if (line.trim()) current.push(line.trim().replace(/^\d+\.\s+/, ''))
  }
  if (current.length) items.push(current.join(' '))
  const counts = { done: 0, next: 0, later: 0 }
  const lis = items.map((item, i) => {
    const m = /^\*\*(.+?)\*\*(?:\s+\[(next|later|done)\])?(?:\s+—\s+([\s\S]+))?$/.exec(item)
    const status = m?.[2]
    if (status && status in counts) counts[status as keyof typeof counts]++
    const title = m ? md.renderInline(m[1]) : md.renderInline(item)
    const pill = status ? ` <span class="pill${status === 'next' ? '' : ` ${status}`}">${status}</span>` : ''
    const desc = m?.[3] ? `<p>${md.renderInline(m[3])}</p>` : ''
    const phCls = status === 'done' ? 'ph ph-done' : 'ph'
    return `<li><span class="${phCls}">${i + 1}</span><div><h3>${title}${pill}</h3>${desc}</div></li>`
  })
  // Progress includes the active `next` phase, so a sequence that has started is
  // visibly different from one where every phase is still `later`.
  const total = items.length
  const reached = counts.done + counts.next
  const parts = (['done', 'next', 'later'] as const).filter((k) => counts[k]).map((k) => `${counts[k]} ${k}`)
  const progress = total && (counts.done || counts.next || counts.later)
    ? `<div class="timeline-progress"><meter value="${reached}" min="0" max="${total}" aria-label="Sequence progress"></meter>` +
      `<span>${parts.join(' · ')} · ${total} total</span></div>`
    : ''
  return `${progress}<ol class="timeline">${lis.join('\n')}</ol>`
}

/** Content is a unified diff (optionally fenced); rendered as responsive side-by-side panes. */
const renderDiff: Handler = (content, attrs) => {
  let lines = content.split('\n')
  if (lines[0]?.startsWith('```')) lines = lines.slice(1, lines.lastIndexOf('```'))
  const before: string[] = []
  const after: string[] = []
  for (const line of lines) {
    if (line.startsWith('-')) before.push(`<span class="del">${escapeHtml(line.slice(1))}</span>`)
    else if (line.startsWith('+')) after.push(`<span class="add">${escapeHtml(line.slice(1))}</span>`)
    else {
      const ctx = `<span>${escapeHtml(line.replace(/^ /, ''))}</span>`
      before.push(ctx)
      after.push(ctx)
    }
  }
  const head = attrs.head ? `<div class="diff-head">${escapeHtml(attrs.head)}</div>` : ''
  return `<div class="diff">${head}<div class="diff-cols">` +
    `<div class="diff-pane"><div class="pane-label">Before</div><pre>${before.join('')}</pre></div>` +
    `<div class="diff-pane"><div class="pane-label">After</div><pre>${after.join('')}</pre></div>` +
    `</div></div>`
}

const renderFigure: Handler = (content, attrs) => {
  const aria = attrs.aria ? ` role="img" aria-label="${escapeHtml(attrs.aria)}"` : ''
  const caption = attrs.aria ? `<figcaption>${escapeHtml(attrs.aria)}</figcaption>` : ''
  return `<figure class="diagram"${aria}>${sanitize(content)}${caption}</figure>`
}

const HANDLERS: Record<string, Handler> = {
  callout: renderCallout,
  verdict: renderVerdict,
  findings: renderFindings,
  timeline: renderTimeline,
  diff: renderDiff,
  figure: renderFigure,
  compare: (content) => md.render(content),
  files: (content) => md.render(content),
}

// ---------------------------------------------------------------------------
// document assembly
// ---------------------------------------------------------------------------

interface HeadingInfo {
  level: 2 | 3
  title: string
  id: string
  eyebrow?: string
}

interface Prepared {
  title: string
  standfirst: string
  sections: { heading: HeadingInfo; bodyLines: string[] }[]
  preamble: string[]
  blocks: string[]
  headings: HeadingInfo[]
}

const HEADING_META_RE = /\s*<!--\s*([^>]*?)\s*-->\s*$/

const parseHeadingMeta = (comment: string): { id?: string; eyebrow?: string } => {
  const out: { id?: string; eyebrow?: string } = {}
  for (const part of comment.split(';')) {
    const m = /^\s*(id|eyebrow)\s*:\s*(.+?)\s*$/.exec(part)
    if (m) out[m[1] as 'id' | 'eyebrow'] = m[2]
  }
  return out
}

const prepare = (body: string): Prepared => {
  const swapped = body.replace(/\{dot:([\w-]+)\}/g, '<span class="dot dot-$1"></span>')
  const lines = swapped.split('\n')
  const blocks: string[] = []
  const headings: HeadingInfo[] = []
  let title = ''
  const standfirstLines: string[] = []
  const out: string[] = []
  let inFence = false
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (/^```/.test(line.trim())) inFence = !inFence
    if (!inFence) {
      if (!title && /^#\s+/.test(line)) {
        title = line.replace(/^#\s+/, '').trim()
        i++
        while (i < lines.length && (lines[i].trim() === '' || lines[i].startsWith('>'))) {
          if (lines[i].startsWith('>')) standfirstLines.push(lines[i].replace(/^>\s?/, ''))
          i++
        }
        continue
      }
      const open = /^:::\s*([\w-]+)\s*(.*)$/.exec(line)
      if (open && HANDLERS[open[1]]) {
        const contentLines: string[] = []
        i++
        let innerFence = false
        while (i < lines.length) {
          if (/^```/.test(lines[i].trim())) innerFence = !innerFence
          if (!innerFence && /^:::\s*$/.test(lines[i])) break
          contentLines.push(lines[i])
          i++
        }
        i++ // consume closing :::
        // a leading bare word is the variant (e.g. `::: callout decision`), the rest is k=v attrs
        let rest = open[2]
        let variant = open[1]
        const vm = /^([\w-]+)\b\s*/.exec(rest)
        if (vm && !rest.startsWith(`${vm[1]}=`)) {
          variant = vm[1]
          rest = rest.slice(vm[0].length)
        }
        blocks.push(HANDLERS[open[1]](contentLines.join('\n').trim(), parseAttrs(rest), variant))
        out.push('', `<!--PENTIMENTO-BLOCK-${blocks.length - 1}-->`, '')
        continue
      }
      const h = /^(#{2,3})\s+(.+)$/.exec(line)
      if (h) {
        let text = h[2]
        let meta: { id?: string; eyebrow?: string } = {}
        const c = HEADING_META_RE.exec(text)
        if (c) { meta = parseHeadingMeta(c[1]); text = text.replace(HEADING_META_RE, '') }
        const info: HeadingInfo = {
          level: h[1].length as 2 | 3,
          title: text.trim(),
          id: meta.id ?? slugify(text),
          eyebrow: meta.eyebrow,
        }
        headings.push(info)
        out.push(`<!--PENTIMENTO-H-${headings.length - 1}-->`)
        i++
        continue
      }
    }
    out.push(line)
    i++
  }

  // split into sections at h2 markers
  const sections: Prepared['sections'] = []
  const preamble: string[] = []
  let bucket = preamble
  for (const line of out) {
    const hm = /^<!--PENTIMENTO-H-(\d+)-->$/.exec(line)
    if (hm && headings[Number(hm[1])].level === 2) {
      sections.push({ heading: headings[Number(hm[1])], bodyLines: [] })
      bucket = sections[sections.length - 1].bodyLines
      continue
    }
    bucket.push(line)
  }
  return { title, standfirst: standfirstLines.join(' ').trim(), sections, preamble, blocks, headings }
}

const anchor = (id: string): string =>
  `<a class="anch" href="#${id}" aria-label="Link to this section">#</a>`

const renderSectionBody = (prepared: Prepared, bodyLines: string[]): string => {
  let html = md.render(bodyLines.join('\n'))
  html = html.replace(/<!--PENTIMENTO-H-(\d+)-->/g, (_, n) => {
    const h = prepared.headings[Number(n)]
    return `<h3 id="${h.id}">${md.renderInline(h.title)}${anchor(h.id)}</h3>`
  })
  html = html.replace(/<!--PENTIMENTO-BLOCK-(\d+)-->/g, (_, n) => prepared.blocks[Number(n)])
  return sanitize(html)
}

const ARCHETYPES: Record<string, string> = {
  implementation: 'Implementation plan',
  brainstorm: 'Brainstorm / exploration',
  audit: 'Audit / review',
  'design-doc': 'Design doc · PRD',
}

export interface RenderOptions {
  /** Emit a claude.ai-Artifact-compatible fragment (no doctype/html/head/body — the platform wraps it). */
  artifact?: boolean
  /** Skip the header comments panel (the live viewer shows comments in its drawer instead). */
  omitCommentsPanel?: boolean
}

const chrome = (doc: Doc, meta: Meta, prepared: Prepared, opts: RenderOptions): string => {
  const css = renderStylesheet()
  const js = fs.readFileSync(path.join(ASSETS, 'chrome.js'), 'utf8')
  const archetype = String(doc.frontmatter['Archetype'] ?? 'design-doc')
  const badge = ARCHETYPES[archetype] ?? archetype
  const rev = String(doc.frontmatter['Current Revision'] ?? '—')
  const latest = meta.revisions[meta.revisions.length - 1]
  const date = latest ? latest.created_at.slice(0, 10) : ''
  const pathLabel = doc.canonicalPath.split(path.sep).slice(-3).join('/')
  const historyRel = String(doc.frontmatter['History Folder'] ?? `.history/${doc.name}`)

  // Default palette precedence: document frontmatter > env > personal CLI config > built-in.
  // Explicit browser choices still win until the reader resets to the document default.
  const fmPalette = String(doc.frontmatter['Palette'] ?? '')
  const envPalette = String(process.env.PENTIMENTO_PALETTE ?? '')
  const userPalette = String(readUserConfig().palette ?? '')
  const defaultPalette = isPalette(fmPalette) ? fmPalette
    : isPalette(envPalette) ? envPalette
    : isPalette(userPalette) ? userPalette
    : DEFAULT_PALETTE

  const inline = (s: string): string => sanitize(md.renderInline(s))

  const evolution = [...meta.revisions].reverse().slice(0, 4).map((r) =>
    `<div class="evolution"><span class="rev">${escapeHtml(r.id)}</span>` +
    `<span class="what"><strong>${inline(r.summary)}</strong>` +
    `${r.why ? ` — ${inline(r.why)}` : ''}</span></div>`).join('\n  ')

  const openComments = opts.omitCommentsPanel ? [] : meta.comments.filter((c) => c.status === 'open')
  const commentsPanel = openComments.length
    ? `\n  <details class="comments" open><summary>${openComments.length} open comment${openComments.length > 1 ? 's' : ''}</summary>${openComments.map((c) =>
        `<div class="vcomment" data-cid="${escapeHtml(c.id)}">` +
        `${c.anchor ? `<a class="vc-anchor" href="${escapeHtml(c.anchor)}">${escapeHtml(c.anchor)}</a> ` : ''}` +
        `${c.quote ? `<blockquote>${escapeHtml(c.quote)}</blockquote>` : ''}` +
        `<p>${mdUntrusted.renderInline(c.text)}</p>` +
        `<span class="vc-meta">${escapeHtml(c.author)} · ${escapeHtml(String(c.created_at).slice(0, 10))}</span></div>`).join('')}</details>`
    : ''

  // what changed since the previous revision — so a reader never has to ask the agent
  let changes = ''
  if (meta.revisions.length >= 2) {
    const prev = meta.revisions[meta.revisions.length - 2]
    const latest = meta.revisions[meta.revisions.length - 1]
    const prevFile = path.join(doc.historyDir, `${prev.id}.md`)
    if (fs.existsSync(prevFile)) {
      const prevBody = splitRaw(fs.readFileSync(prevFile, 'utf8')).body
      changes = `\n  <details class="changes"><summary>What changed in ${escapeHtml(latest.id)} (vs ${escapeHtml(prev.id)})</summary><div class="rdiff">${renderDiffHtml(prevBody, doc.body)}</div></details>`
    }
  }

  const toc = prepared.sections.map((s, i) =>
    `<li><a href="#${s.heading.id}"><span class="n">${String(i + 1).padStart(2, '0')}</span>` +
    `${escapeHtml(plainText(s.heading.title))}</a></li>`).join('\n      ')

  const sections = prepared.sections.map((s) => {
    const eyebrow = s.heading.eyebrow ? `<span class="eyebrow">${escapeHtml(s.heading.eyebrow)}</span>\n  ` : ''
    return `<section>\n  ${eyebrow}<h2 id="${s.heading.id}">${md.renderInline(s.heading.title)}${anchor(s.heading.id)}</h2>\n` +
      renderSectionBody(prepared, s.bodyLines) + '\n</section>'
  }).join('\n\n')

  const preambleHtml = prepared.preamble.join('\n').trim()
    ? renderSectionBody(prepared, prepared.preamble)
    : ''

  const title = escapeHtml(plainText(prepared.title))
  // Set palette and scheme before first paint; a valid reader override wins over document defaults.
  const paletteInit = themeInitSnippet(defaultPalette)

  const body = `${paletteInit}

<div class="wrap">
<header class="doc">
  <div class="meta-row">
    <span class="badge badge-${escapeHtml(archetype)}">${escapeHtml(badge)}</span>
    <span class="chip">${escapeHtml(rev)}</span>
    ${date ? `<time class="chip" datetime="${escapeHtml(date)}">${escapeHtml(date)}</time>\n    ` : ''}${themePicker(defaultPalette)}
    <span class="path-chip" title="${escapeHtml(doc.canonicalPath)}">${escapeHtml(pathLabel)}</span>
  </div>
  <h1>${inline(prepared.title)}</h1>
  ${prepared.standfirst ? `<p class="standfirst">${inline(prepared.standfirst)}</p>` : ''}
  ${evolution}${changes}${commentsPanel}
</header>

<details class="toc" open>
  <summary>Contents</summary>
  <nav aria-label="Contents">
    <ol>
      ${toc}
    </ol>
  </nav>
</details>

<main>
${preambleHtml}
${sections}
</main>

<footer class="doc">
  Source: <code>${escapeHtml(pathLabel)}</code> · history: <code>${escapeHtml(historyRel)}/</code> (${escapeHtml(rev)}) · Rendered by <code>pentimento render</code>.
</footer>
</div>
<script>
${js}</script>
`

  if (opts.artifact) return `<title>${title}</title>\n<style>\n${css}</style>\n\n${body}`

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
${FAVICON_TAG}
<style>
${css}</style>
</head>
<body>
${body}</body>
</html>
`
}

export const render = (docPath: string, opts: RenderOptions = {}): string => {
  const doc = loadDoc(docPath)
  const meta = readMeta(doc.historyDir)
  return chrome(doc, meta, prepare(doc.body), opts)
}

export const renderToFile = (docPath: string, outPath?: string, opts: RenderOptions = {}): string => {
  const doc = loadDoc(docPath)
  const out = outPath
    ? path.resolve(outPath)
    : path.join(path.dirname(doc.canonicalPath), `${doc.name.toLowerCase()}.html`)
  fs.writeFileSync(out, render(docPath, opts), 'utf8')
  return out
}

/** Render the document as it stood at a given revision (evolution strip trimmed to that point). */
export const renderRevisionHtml = (docPath: string, rev: string, opts: RenderOptions = {}): string => {
  const doc = loadDoc(docPath)
  const raw = readRevision(docPath, rev)
  const { frontmatterRaw, body } = splitRaw(raw)
  let frontmatter: Record<string, unknown> = { ...doc.frontmatter, 'Current Revision': rev }
  if (frontmatterRaw) {
    try {
      frontmatter = { ...((parseYaml(frontmatterRaw) ?? {}) as Record<string, unknown>), 'Current Revision': rev }
    } catch { /* fall back to the canonical's frontmatter */ }
  }
  const meta = readMeta(doc.historyDir)
  const idx = meta.revisions.findIndex((r) => r.id === rev)
  const trimmed: Meta = {
    revisions: idx >= 0 ? meta.revisions.slice(0, idx + 1) : meta.revisions,
    comments: meta.comments,
  }
  const revDoc: Doc = { ...doc, raw, body, frontmatter }
  return chrome(revDoc, trimmed, prepare(body), opts)
}

/** Standalone page showing the changes between two revisions ('canonical' = current file). */
export const renderDiffPage = (docPath: string, a: string, b: string): string => {
  const doc = loadDoc(docPath)
  const css = renderStylesheet()
  const js = fs.readFileSync(path.join(ASSETS, 'chrome.js'), 'utf8')
  const bodyOf = (rev: string): string =>
    rev === 'canonical' ? doc.body : splitRaw(readRevision(docPath, rev)).body
  const rdiff = renderDiffHtml(bodyOf(a), bodyOf(b))
  const title = `${doc.name}: ${a} → ${b}`
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
${FAVICON_TAG}
<style>
${css}</style>
</head>
<body>
${RESTORE_SNIPPET}
<div class="wrap">
<header class="doc">
  <div class="meta-row">
    <span class="badge">Changes</span>
    <span class="chip">${escapeHtml(a)} → ${escapeHtml(b)}</span>
    <span class="chip">${escapeHtml(doc.name)}</span>
    ${themePicker()}
  </div>
  <h1>${escapeHtml(doc.name)}</h1>
  <p class="standfirst">What changed between ${escapeHtml(a)} and ${escapeHtml(b)}.</p>
</header>
<main>
<div class="rdiff" style="margin-top:2rem">${rdiff}</div>
</main>
<footer class="doc">Rendered by <code>pentimento diff --html</code>.</footer>
</div>
<script>${js}</script>
</body>
</html>
`
}
