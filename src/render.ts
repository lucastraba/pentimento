import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import MarkdownIt from 'markdown-it'
import sanitizeHtml from 'sanitize-html'
import { parse as parseYaml } from 'yaml'
import {
  canonicalRevisionState, latestApproval, loadDoc, readMeta, readRevision, revisionImages, slugify, splitRaw,
  type CommentEntry, type Doc, type Meta,
} from './core.js'
import { renderFlowSvg } from './flow.js'
import { assetsIn, IMAGE_MARK_RE, imageBlock, imageExtension, isRemote, stripImageMarks } from './imageref.js'
import { dataUri, imageKeys, type ImageKeys } from './images.js'
import {
  collectCuttings, renderDiffHtml, TRACE, tracePlan, wordCount, type Cutting,
} from './semdiff.js'
import { schemeToggle, themeInitSnippet } from './themes.js'

const ASSETS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets')

/**
 * How the page being rendered shows stored images. The live viewer serves them by URL. A
 * static page carries each one once: inline in the current draft, and in a store template
 * for images only earlier drafts show; every other copy names its image in `data-asset`
 * and chrome.js fills it in.
 */
interface ImageContext {
  keys: ImageKeys | null
  url?: (asset: string) => string
  /** true while rendering the current draft of a static page */
  carry: boolean
  carried: Set<string>
  wanted: Set<string>
  data: Map<string, string | null>
}
const freshImages = (keys: ImageKeys | null, url?: (asset: string) => string): ImageContext =>
  ({ keys, url, carry: false, carried: new Set(), wanted: new Set(), data: new Map() })
let images: ImageContext = freshImages(null)

const imageData = (asset: string): string | null => {
  if (!images.data.has(asset)) {
    const file = images.keys?.file(asset) ?? null
    images.data.set(asset, file ? dataUri(file, asset) : null)
  }
  return images.data.get(asset) ?? null
}

/** `src` and `data-asset` for a stored image, as this page shows it. */
const imageAttrs = (asset: string): string => {
  if (images.url) return ` src="${escapeHtml(images.url(asset))}" data-asset="${asset}"`
  // the first copy in the current draft carries the data; any other copy points at it
  const uri = images.carry && !images.carried.has(asset) ? imageData(asset) : null
  if (uri) {
    images.carried.add(asset)
    return ` src="${uri}" data-asset="${asset}"`
  }
  images.wanted.add(asset)
  return ` data-asset="${asset}"`
}

/** Render with the current draft's images carried inline (static pages). */
const carrying = <T>(fn: () => T): T => {
  const previous = images.carry
  images.carry = true
  try { return fn() } finally { images.carry = previous }
}

/** Images other copies on a static page point at but the current draft doesn't carry. */
const imageStore = (): string => {
  if (images.url) return ''
  const items = [...images.wanted].filter((a) => !images.carried.has(a))
    .map((a) => { const uri = imageData(a); return uri ? `<img data-asset="${a}" src="${uri}" alt="">` : '' })
    .filter(Boolean)
  return items.length ? `<template id="pentimento-images">${items.join('')}</template>` : ''
}

/** A line of page HTML that is left out entirely when empty, so pages without images are unchanged. */
const optionalLine = (html: string): string => (html ? `\n${html}` : '')

/** No URL: the page fills `src` in from its store. */
const noUrl = (): null => null

const assetAfter = (tokens: { type: string; content: string }[], idx: number): string | null =>
  tokens[idx + 1]?.type === 'pentimento_asset' ? tokens[idx + 1].content : null

const safeDecode = (s: string): string => {
  try { return decodeURI(s) } catch { return s }
}

/** True when an inline token sits inside a link, where another link can't go (`[![badge](…)](…)`). */
const insideLink = (tokens: { type: string }[], idx: number): boolean => {
  let depth = 0
  for (let i = 0; i < idx; i++) {
    if (tokens[i].type === 'link_open') depth++
    else if (tokens[i].type === 'link_close') depth--
  }
  return depth > 0
}

const imageHtml = (img: { asset: string | null; src: string; alt: string; title: string; figure: boolean; inLink: boolean }): string => {
  const alt = escapeHtml(img.alt)
  const title = img.title ? ` title="${escapeHtml(img.title)}"` : ''
  let tag: string
  if (img.asset) tag = `<img${imageAttrs(img.asset)} alt="${alt}"${title} loading="lazy">`
  else if (/^data:image\/(?:png|jpeg|gif|webp);/i.test(img.src)) tag = `<img src="${escapeHtml(img.src)}" alt="${alt}"${title}>`
  // the page makes no outside requests, so a remote image is a link to it, or just its text inside a link
  else if (/^https?:\/\//i.test(img.src)) {
    return img.inLink
      ? `<span class="image-link">${alt || escapeHtml(img.src)}</span>`
      : `<a class="image-link" href="${escapeHtml(img.src)}">${alt || escapeHtml(img.src)}</a>`
  }
  else return `<span class="image-missing" title="Image not found: ${escapeHtml(safeDecode(img.src))}">${alt || escapeHtml(safeDecode(img.src))}</span>`
  if (!img.figure) return tag
  return `<figure class="shot">${tag}${img.title ? `<figcaption>${escapeHtml(img.title)}</figcaption>` : ''}</figure>`
}

/** Footnote numbering for the document being rendered, set by prepare(). */
const footnotes: { numbers: Map<string, number>; referenced: Set<string> } = { numbers: new Map(), referenced: new Set() }

// Plans follow CommonMark (a single newline is a space). Personal documents follow Obsidian,
// where a single newline is a line break, so lyrics and poems keep their lines.
const makeMd = (breaks: boolean): MarkdownIt => {
  const m = new MarkdownIt({ html: false, linkify: false, typographer: false, breaks })
  m.inline.ruler.before('text', 'pentimento_dot', (state, silent) => {
    const match = /^\{dot:([\w-]+)\}/.exec(state.src.slice(state.pos))
    if (!match) return false
    if (!silent) state.push('pentimento_dot', '', 0).content = match[1]
    state.pos += match[0].length
    return true
  })
  m.renderer.rules.pentimento_dot = (tokens, idx) => `<span class="dot dot-${tokens[idx].content}"></span>`
  // Obsidian syntax, so notes written there render as they look there
  m.inline.ruler.before('link', 'obsidian_wikilink', (state, silent) => {
    const match = /^(!?)\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]/.exec(state.src.slice(state.pos))
    if (!match) return false
    if (!silent) {
      const token = state.push('obsidian_wikilink', '', 0)
      token.content = (match[3] ?? match[2].replace(/#\^?/, ' › ')).trim()
      const target = match[2].replace(/#.*$/, '').trim()
      const alias = match[3]?.trim()
      token.meta = {
        embed: match[1] === '!',
        target,
        // Obsidian reads `![[shot.png|300]]` as a width, not a caption
        alt: alias && !/^\d+(?:x\d+)?$/.test(alias) ? alias : target.slice(target.lastIndexOf('/') + 1).replace(/\.[^.]+$/, ''),
      }
    }
    state.pos += match[0].length
    return true
  })
  m.renderer.rules.obsidian_wikilink = (tokens, idx) => {
    const t = tokens[idx]
    if (t.meta.embed && imageExtension(t.meta.target)) {
      const asset = assetAfter(tokens, idx)
      // a missing embed names the file Obsidian would look for
      if (!asset) return `<span class="image-missing" title="Image not found: ${escapeHtml(t.meta.target)}">${escapeHtml(t.content)}</span>`
      return imageHtml({ asset, src: t.meta.target, alt: t.meta.alt, title: '', figure: Boolean(t.meta.figure), inLink: false })
    }
    return t.meta.embed
      ? `<span class="embed">${escapeHtml(t.content)}</span>`
      : `<span class="wikilink">${escapeHtml(t.content)}</span>`
  }
  // the marker a keyed body puts after each image names the stored copy to show
  m.inline.ruler.before('text', 'pentimento_asset', (state, silent) => {
    const match = /^\uE020([0-9a-f]{16}\.[a-z]+)\uE021/.exec(state.src.slice(state.pos))
    if (!match) return false
    if (!silent) state.push('pentimento_asset', '', 0).content = match[1]
    state.pos += match[0].length
    return true
  })
  m.renderer.rules.pentimento_asset = () => ''
  m.renderer.rules.image = (tokens, idx, options, env, self) => {
    const t = tokens[idx]
    return imageHtml({
      asset: assetAfter(tokens, idx),
      src: t.attrGet('src') ?? '',
      alt: self.renderInlineAsText(t.children ?? [], options, env),
      title: t.attrGet('title') ?? '',
      figure: Boolean(t.meta?.figure),
      inLink: insideLink(tokens, idx),
    })
  }
  // an image alone in its paragraph is a figure, at the width diffs use
  m.core.ruler.push('pentimento_figure', (state) => {
    const tokens = state.tokens
    for (let i = 0; i + 2 < tokens.length; i++) {
      const [open, inline, close] = [tokens[i], tokens[i + 1], tokens[i + 2]]
      if (open.type !== 'paragraph_open' || open.hidden || inline.type !== 'inline' || close.type !== 'paragraph_close') continue
      const kids = (inline.children ?? []).filter((t) => t.type !== 'softbreak' && !(t.type === 'text' && !t.content.trim()))
      const [first, second] = kids
      const isImage = first?.type === 'image' || (first?.type === 'obsidian_wikilink' && first.meta?.embed && imageExtension(first.meta.target))
      if (kids.length !== 2 || !isImage || second.type !== 'pentimento_asset') continue
      first.meta = { ...(first.meta ?? {}), figure: true }
      open.hidden = true
      close.hidden = true
    }
  })
  m.inline.ruler.before('emphasis', 'obsidian_mark', (state, silent) => {
    if (state.src.charCodeAt(state.pos) !== 0x3D || state.src.charCodeAt(state.pos + 1) !== 0x3D) return false
    const end = state.src.indexOf('==', state.pos + 2)
    if (end < 0 || end === state.pos + 2 || /\s/.test(state.src[state.pos + 2]) || /\s/.test(state.src[end - 1])) return false
    if (!silent) {
      state.push('mark_open', 'mark', 1)
      const max = state.posMax
      state.pos += 2
      state.posMax = end
      state.md.inline.tokenize(state)
      state.posMax = max
      state.push('mark_close', 'mark', -1)
    }
    state.pos = end + 2
    return true
  })
  m.inline.ruler.before('link', 'footnote_ref', (state, silent) => {
    const match = /^\[\^([^\]\s]+)\]/.exec(state.src.slice(state.pos))
    if (!match || !footnotes.numbers.has(match[1])) return false
    if (!silent) state.push('footnote_ref', '', 0).content = match[1]
    state.pos += match[0].length
    return true
  })
  m.renderer.rules.footnote_ref = (tokens, idx) => {
    const id = tokens[idx].content
    const n = footnotes.numbers.get(id)!
    const first = !footnotes.referenced.has(id)
    footnotes.referenced.add(id)
    return `<sup class="fnref"><a href="#fn-${escapeHtml(slugify(id) || String(n))}"${first ? ` id="fnref-${escapeHtml(slugify(id) || String(n))}"` : ''}>${n}</a></sup>`
  }
  // every table scrolls inside its own container; the page never scrolls sideways
  m.renderer.rules.table_open = () => '<div class="tablewrap"><table>\n'
  m.renderer.rules.table_close = () => '</table></div>\n'
  const defaultFence = m.renderer.rules.fence!
  m.renderer.rules.fence = (tokens, idx, options, env, self) =>
    defaultFence(tokens, idx, options, env, self).replace(/^<pre>/, '<pre class="block">')
  return m
}
const mdPlan = makeMd(false)
const mdVerse = makeMd(true)
let md: MarkdownIt = mdPlan
// Reader comments arrive over HTTP. Both renderers reject raw HTML and javascript: links.
const mdUntrusted: MarkdownIt = new MarkdownIt({ html: false, linkify: false, typographer: false }).disable('image')

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

const scriptHash = (source: string): string => `'sha256-${crypto.createHash('sha256').update(source).digest('base64')}'`

/**
 * Add a deterministic CSP whose hashes cover only the scripts already present in the page.
 * Static pages carry their images as data: URIs; the live viewer also serves them itself.
 */
export const contentSecurityPolicy = (html: string, includeFrameAncestors = false, selfImages = false): string => {
  const hashes = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map((match) => scriptHash(match[1]))
  const scripts = hashes.length ? [...new Set(hashes)].join(' ') : "'none'"
  return `default-src 'none'; style-src 'unsafe-inline'; script-src ${scripts}; img-src ${selfImages ? "'self' " : ''}data:; connect-src 'self'; base-uri 'none'; object-src 'none'; form-action 'none'${includeFrameAncestors ? "; frame-ancestors 'none'" : ''}`
}

export const secureHtml = (html: string, opts: { selfImages?: boolean } = {}): string => {
  const clean = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\n?/i, '')
  const policy = contentSecurityPolicy(clean, false, opts.selfImages)
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}">`
  return clean.replace(/(<meta name="viewport"[^>]*>)/i, `$1\n${meta}`)
}


/** Re-apply the reader's stored light/dark choice before first paint. */
export const RESTORE_SNIPPET = themeInitSnippet()

/** The fixed design system, shared by every rendered surface. */
export const renderStylesheet = (): string => fs.readFileSync(path.join(ASSETS, 'theme.css'), 'utf8')

const SVG_TAGS = ['svg', 'g', 'defs', 'marker', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'title', 'desc']
const SVG_ATTRIBUTES = [
  'xmlns', 'viewBox', 'width', 'height', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry',
  'd', 'points', 'transform', 'text-anchor', 'dominant-baseline', 'class', 'id', 'role', 'aria-label',
  'aria-hidden', 'focusable', 'marker-end', 'marker-start', 'markerWidth', 'markerHeight', 'markerUnits',
  'orient', 'refX', 'refY', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
  'preserveAspectRatio',
]

const sanitizeFigureSvg = (source: string): string => {
  const cleaned = sanitizeHtml(source, {
    allowedTags: SVG_TAGS,
    allowedAttributes: { '*': SVG_ATTRIBUTES },
    allowedClasses: { '*': ['nodebox', 'accentbox', 'flow', 'lbl'] },
    allowedSchemes: [],
    allowProtocolRelative: false,
    disallowedTagsMode: 'completelyDiscard',
    parser: { lowerCaseTags: false, lowerCaseAttributeNames: false },
    transformTags: {
      '*': (tagName, attribs) => {
        const safe = { ...attribs }
        if (safe.id && !/^[A-Za-z][\w-]*$/.test(safe.id)) delete safe.id
        for (const name of ['marker-end', 'marker-start']) {
          if (safe[name] && !/^url\(#[A-Za-z][\w-]*\)$/.test(safe[name])) delete safe[name]
        }
        for (const name of ['fill', 'stroke']) {
          if (safe[name] && !/^(?:none|currentColor|var\(--[a-z0-9-]+\))$/.test(safe[name])) delete safe[name]
        }
        if (safe.xmlns && safe.xmlns !== 'http://www.w3.org/2000/svg') delete safe.xmlns
        return { tagName, attribs: safe }
      },
    },
  }).trim()
  if (!/^<svg\b[\s\S]*<\/svg>$/.test(cleaned) || (cleaned.match(/<svg\b/g) ?? []).length !== 1) {
    throw new Error('figure must contain one allowlisted <svg> root')
  }
  return cleaned
}

const renderMarkdown = (source: string): string => md.render(source)
const renderInline = (source: string): string => md.renderInline(source)

const plainText = (s: string): string => s.replace(/[`*_]/g, '')

const parseAttrs = (s: string): Record<string, string> => {
  const attrs: Record<string, string> = {}
  const re = /([\w-]+)=(?:"([^"]*)"|(\S+))/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) attrs[m[1]] = m[2] ?? m[3]
  return attrs
}

// Private-use characters mark renderer-internal lines. Source text never gets to use them.
const INTERNAL_CHARS_RE = /[\uE000\uE001\uE010-\uE013\uE020\uE021]/g
const scrubInternal = (s: string): string => s.replace(INTERNAL_CHARS_RE, '�')

/** Per-render facts directive handlers need: the reader's answers to `::: ask` questions. */
interface RenderContext {
  answers: Map<string, CommentEntry>
  revisions: string[]
}
let context: RenderContext = { answers: new Map(), revisions: [] }

const contextFor = (meta: Meta): RenderContext => {
  const answers = new Map<string, CommentEntry>()
  for (const c of meta.comments) if (c.answer !== undefined && c.anchor) answers.set(c.anchor, c)
  return { answers, revisions: meta.revisions.map((r) => r.id) }
}

// ---------------------------------------------------------------------------
// directive handlers — the agent's entire expressive surface
// ---------------------------------------------------------------------------

type Handler = (content: string, attrs: Record<string, string>, kind: string) => string

const CALLOUT_LABELS: Record<string, string> = {
  decision: 'Decision', info: 'Note', warn: 'Warning', risk: 'Risk',
}

const renderCallout: Handler = (content, attrs, kind) => {
  const supersededBy = attrs['superseded-by']
  const label = supersededBy ? 'Superseded' : CALLOUT_LABELS[kind] ?? 'Note'
  const id = attrs.id ? ` id="${escapeHtml(attrs.id)}"` : ''
  // a reversed decision stays visible under the surface, pointing at its replacement
  const note = supersededBy
    ? `<p class="supersede-note">Replaced by <a href="#${escapeHtml(supersededBy)}">${escapeHtml(supersededBy)}</a>.</p>`
    : ''
  return `<div class="callout ${escapeHtml(kind)}${supersededBy ? ' superseded' : ''}"${id}><span class="label">${label}</span>${renderMarkdown(content)}${note}</div>`
}

// optional stable anchor on a list item: `... {#f-disk}` — a comment/link target
const ITEM_ID_RE = /\s*\{#([a-z][\w-]*)\}\s*/
const takeItemId = (s: string): { text: string; id?: string } => {
  const m = ITEM_ID_RE.exec(s)
  return m ? { text: s.replace(ITEM_ID_RE, ' ').trim(), id: m[1] } : { text: s }
}

const renderVerdict: Handler = (content) => {
  const rows = content
    .split('\n')
    .map((l) => /^-\s+(.+?)\s+::\s+(.+)$/.exec(l.trim()))
    .filter((m): m is RegExpExecArray => m !== null)
    .map(([, q, a]) => `<dt>${renderInline(q)}</dt><dd>${renderInline(a)}</dd>`)
  return `<dl class="verdict">${rows.join('')}</dl>`
}

const SEV_CLASS: Record<string, string> = { CRIT: 'c', HIGH: 'h', MED: 'm', LOW: 'l' }
const SEV_LABEL: Record<string, string> = { CRIT: 'Critical', HIGH: 'High', MED: 'Medium', LOW: 'Low' }

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
    const { text, id } = takeItemId(m[2])
    const html = `<div class="finding"${id ? ` id="${escapeHtml(id)}"` : ''}><span class="sev ${SEV_CLASS[m[1]]}">${SEV_LABEL[m[1]]}</span>` +
      `<div>${renderInline(text)}${id ? anchor(id) : ''}</div></div>`
    ;(collapseLabel ? collapsed : open).push(html)
  }
  // computed severity line: the reader sees the shape before reading a single finding
  const total = counts.CRIT + counts.HIGH + counts.MED + counts.LOW
  const tally = (['CRIT', 'HIGH', 'MED', 'LOW'] as const)
    .filter((k) => counts[k])
    .map((k) => `<span class="${SEV_CLASS[k]}"><b>${counts[k]}</b> ${SEV_LABEL[k].toLowerCase()}</span>`)
    .join('')
  const summary = total ? `<div class="tally">${tally}</div>` : ''
  // auto-label the collapsed group with its count when the agent didn't
  const label = collapseLabel
    ? (/\(\d+\)/.test(collapseLabel) ? collapseLabel : `${collapseLabel} (${collapsed.length})`)
    : null
  const details = label
    ? `<details class="findings-more"><summary>${escapeHtml(label)}</summary><div class="findings-list">${collapsed.join('\n')}</div></details>`
    : ''
  return `${summary}<div class="findings-list">${open.join('\n')}</div>${details}`
}

const progressLine = (reached: number, total: number, label: string, text: string): string =>
  `<div class="progress"><span class="bar" role="meter" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${reached}" aria-label="${label}">` +
  `<i style="width:${total ? Math.round((reached / total) * 100) : 0}%"></i></span><span>${text}</span></div>`

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
    const m = /^\*\*(.+?)\*\*(?:\s+\[(next|later|done)\])?(?:\s+\{#([a-z][\w-]*)\})?(?:\s+—\s+([\s\S]+))?$/.exec(item)
    const status = m?.[2]
    const id = m?.[3]
    if (status && status in counts) counts[status as keyof typeof counts]++
    const title = m ? renderInline(m[1]) : renderInline(item)
    const pill = status ? `<span class="status ${status}">${status}</span>` : ''
    const desc = m?.[4] ? `<p>${renderInline(m[4])}</p>` : ''
    return `<li${id ? ` id="${escapeHtml(id)}"` : ''}${status === 'done' ? ' class="is-done"' : ''}><span class="ph">${i + 1}</span>` +
      `<div><h3>${title}${pill}${id ? anchor(id) : ''}</h3>${desc}</div></li>`
  })
  const total = items.length
  const parts = (['done', 'next', 'later'] as const).filter((k) => counts[k]).map((k) => `${counts[k]} ${k}`)
  // shown only when the sequence has actually started; an all-later plan needs no meter
  const progress = total && (counts.done || counts.next)
    ? progressLine(counts.done, total, 'Sequence progress', `${counts.done} of ${total} done${counts.next ? ` · ${counts.next} next` : ''}`)
    : ''
  void parts
  return `${progress}<ol class="timeline">${lis.join('\n')}</ol>`
}

const renderChecklist: Handler = (content) => {
  const items = content.split('\n')
    .map((l) => /^-\s+\[([ xX])\]\s+(.+)$/.exec(l.trim()))
    .filter((m): m is RegExpExecArray => m !== null)
  const done = items.filter((m) => m[1] !== ' ').length
  const lis = items.map((m) => {
    const checked = m[1] !== ' '
    const { text, id } = takeItemId(m[2])
    return `<li class="${checked ? 'done' : 'open'}"${id ? ` id="${escapeHtml(id)}"` : ''}>` +
      `<span class="cbox" aria-hidden="true">${checked ? '✓' : ''}</span>` +
      `<div>${renderInline(text)}${id ? anchor(id) : ''}</div></li>`
  })
  const progress = items.length ? progressLine(done, items.length, 'Checklist progress', `${done} of ${items.length} done`) : ''
  return `${progress}<ul class="checklist">${lis.join('\n')}</ul>`
}

/** The brainstorm scorecard: one row per option, criteria as columns, one row marked [pick]. */
const renderOptions: Handler = (content, attrs) => {
  const criteria = (attrs.criteria ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (!criteria.length) throw new Error('options needs criteria="A, B, C"')
  const rows = content.split('\n')
    .map((l) => /^-\s+(.+)$/.exec(l.trim()))
    .filter((m): m is RegExpExecArray => m !== null)
  const trs = rows.map((m) => {
    const cells = m[1].split(' :: ').map((s) => s.trim())
    let name = cells.shift() ?? ''
    const pick = /\s*\[pick\]\s*/.test(name)
    if (pick) name = name.replace(/\s*\[pick\]\s*/, ' ').trim()
    const tds = criteria.map((_, i) => `<td>${renderInline(cells[i] ?? '')}</td>`).join('')
    return `<tr${pick ? ' class="pick"' : ''}><td>${renderInline(name)}` +
      `${pick ? ' <span class="pick-chip">Pick</span>' : ''}</td>${tds}</tr>`
  })
  const head = `<thead><tr><th>Option</th>${criteria.map((c) => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead>`
  return `<div class="tablewrap"><table class="options">${head}<tbody>${trs.join('\n')}</tbody></table></div>`
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
  return `<figure class="diagram"${aria}>${sanitizeFigureSvg(content)}${caption}</figure>`
}

/** Edge chains in, laid-out diagram out; the generated SVG passes the same figure allowlist. */
const renderFlow: Handler = (content, attrs) => renderFigure(renderFlowSvg(content), attrs, 'figure')

/**
 * A question the reader answers in the page. The live viewer turns the options into buttons
 * that record the choice as a comment; a static render shows the options and any answer.
 */
const renderAsk: Handler = (content, attrs) => {
  const question: string[] = []
  const options: { label: string; recommended: boolean }[] = []
  for (const raw of content.split('\n')) {
    const line = raw.trim()
    const opt = /^-\s+(.+)$/.exec(line)
    if (opt) {
      const recommended = /\s*\[recommended\]\s*/i.test(opt[1])
      options.push({ label: opt[1].replace(/\s*\[recommended\]\s*/i, ' ').trim(), recommended })
    } else if (line) question.push(line)
  }
  if (!question.length) throw new Error('ask needs a question line before its options')
  if (options.length < 2) throw new Error('ask needs at least two "- option" lines')
  const q = question.join(' ')
  const id = attrs.id && /^[a-z][\w-]*$/.test(attrs.id) ? attrs.id : `q-${slugify(q).slice(0, 40)}`
  const answer = context.answers.get(`#${id}`)
  const chosen = answer?.answer
  const buttons = options.map((o) => {
    const text = plainText(o.label)
    const pressed = chosen !== undefined && chosen === text
    return `<button class="ask-opt" type="button" data-choice="${escapeHtml(text)}" aria-pressed="${pressed}" disabled>` +
      `${renderInline(o.label)}${o.recommended ? '<span class="rec">recommended</span>' : ''}</button>`
  }).join('')
  const other = chosen !== undefined && !options.some((o) => plainText(o.label) === chosen)
  const state = answer
    ? `You answered “${escapeHtml(other ? chosen! : chosen ?? '')}”${answer.status === 'resolved' && answer.resolved_in ? ` · taken into ${escapeHtml(answer.resolved_in)}` : ' · waiting for the next draft'}`
    : ''
  return `<div class="ask" id="${escapeHtml(id)}" data-ask="${escapeHtml(id)}">` +
    `<div class="ask-q"><p>${renderInline(q)}${anchor(id)}</p></div>` +
    `<div class="ask-options" role="group" aria-label="Answer">${buttons}` +
    `<button class="ask-opt ask-other" type="button" data-other aria-pressed="${other}" disabled>Something else…</button></div>` +
    `<p class="ask-state">${state}</p></div>`
}

const HANDLERS: Record<string, Handler> = {
  callout: renderCallout,
  verdict: renderVerdict,
  findings: renderFindings,
  timeline: renderTimeline,
  checklist: renderChecklist,
  options: renderOptions,
  diff: renderDiff,
  figure: renderFigure,
  flow: renderFlow,
  ask: renderAsk,
}

/** The directive vocabulary, exported so lint can flag names outside it. */
export const DIRECTIVE_NAMES: readonly string[] = Object.keys(HANDLERS)

// ---------------------------------------------------------------------------
// document assembly
// ---------------------------------------------------------------------------

interface HeadingInfo {
  level: 2 | 3
  title: string
  id: string
}

interface Prepared {
  title: string
  standfirst: string
  sections: { heading: HeadingInfo; bodyLines: string[] }[]
  preamble: string[]
  blocks: string[]
  headings: HeadingInfo[]
  /** renderer-built HTML spliced in by the traces view */
  raws: string[]
  /** footnote definitions by id, in source order */
  footnotes: Map<string, string>
}

/** Obsidian `%% … %%` comments are private notes; they never reach the page. Fences keep theirs. */
/**
 * Number footnotes by first reference, then any defined but never referenced. Runs before
 * parsing because directive blocks render during it. Fragments without definitions keep
 * the enclosing document's numbering.
 */
const numberFootnotes = (body: string): void => {
  const defined = [...body.matchAll(/^\[\^([^\]\s]+)\]:/gm)].map((m) => m[1])
  if (!defined.length) return
  footnotes.numbers = new Map()
  footnotes.referenced = new Set()
  for (const m of body.matchAll(/\[\^([^\]\s]+)\](?!:)/g)) {
    if (defined.includes(m[1]) && !footnotes.numbers.has(m[1])) footnotes.numbers.set(m[1], footnotes.numbers.size + 1)
  }
  for (const id of defined) if (!footnotes.numbers.has(id)) footnotes.numbers.set(id, footnotes.numbers.size + 1)
}

const stripObsidianComments = (body: string): string => {
  const out: string[] = []
  let chunk: string[] = []
  let inFence = false
  const flush = () => { out.push(chunk.join('\n').replace(/%%[\s\S]*?%%/g, '')); chunk = [] }
  for (const line of body.split('\n')) {
    if (/^\s*```/.test(line)) {
      if (!inFence) { chunk.push(line); flush(); inFence = true; continue }
      inFence = false
      out.push(line)
      continue
    }
    if (inFence) out.push(line)
    else chunk.push(line)
  }
  flush()
  return out.join('\n').replace(/\n{3,}/g, '\n\n')
}

const CALLOUT_KINDS: Record<string, string> = {
  warning: 'warn', caution: 'warn', attention: 'warn',
  danger: 'risk', error: 'risk', bug: 'risk', failure: 'risk', fail: 'risk', missing: 'risk',
}

/** An Obsidian callout (`> [!type] Title`) rendered with the callout styles. */
const renderObsidianCallout = (type: string, fold: string, title: string, inner: string): string => {
  const kind = CALLOUT_KINDS[type.toLowerCase()] ?? 'info'
  const label = title ? renderInline(title) : escapeHtml(type[0].toUpperCase() + type.slice(1).toLowerCase())
  const body = inner.trim() ? renderMarkdown(inner) : ''
  return fold
    ? `<details class="callout ${kind}"${fold === '+' ? ' open' : ''}><summary class="label">${label}</summary>${body}</details>`
    : `<div class="callout ${kind}"><span class="label">${label}</span>${body}</div>`
}

const HEADING_META_RE = /\s*<!--\s*([^>]*?)\s*-->\s*$/
const BLOCK_MARKER_RE = /^PENTIMENTO-BLOCK-(\d+)$/
const HEADING_MARKER_RE = /^PENTIMENTO-HEADING-(\d+)$/
const RAW_MARKER_RE = /^PENTIMENTO-RAW-(\d+)$/
const rawMarker = (n: number): string => `PENTIMENTO-RAW-${n}`

/** Heading comments carry an id; `eyebrow:` from earlier releases is accepted and ignored. */
const parseHeadingMeta = (comment: string): { id?: string } => {
  const out: { id?: string } = {}
  for (const part of comment.split(';')) {
    const m = /^\s*id\s*:\s*(.+?)\s*$/.exec(part)
    if (m) out.id = m[1]
  }
  return out
}

const prepare = (source: string, raws: string[] = []): Prepared => {
  const stripped = stripObsidianComments(source)
  const lines = stripped.split('\n')
  const footnoteDefs = new Map<string, string>()
  numberFootnotes(stripped)
  const blocks: string[] = []
  const headings: HeadingInfo[] = []
  let title = ''
  const standfirstLines: string[] = []
  const out: string[] = []
  const usedIds = new Set<string>()
  let inFence = false
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (/^```/.test(line.trim())) inFence = !inFence
    if (!inFence) {
      if (!title && /^#\s+/.test(line)) {
        title = line.replace(/^#\s+/, '').trim()
        i++
        while (i < lines.length && (lines[i].trim() === '' || (lines[i].startsWith('>') && !/^>\s*\[!/.test(lines[i])))) {
          if (lines[i].startsWith('>')) standfirstLines.push(lines[i].replace(/^>\s?/, ''))
          i++
        }
        continue
      }
      const fn = /^\[\^([^\]\s]+)\]:\s?(.*)$/.exec(line)
      if (fn) {
        const text = [fn[2]]
        i++
        while (i < lines.length && /^(?: {2,}|\t)\S/.test(lines[i])) text.push(lines[i++].trim())
        footnoteDefs.set(fn[1], text.join(' '))
        continue
      }
      const callout = /^>\s*\[!([\w-]+)\]([+-]?)\s*(.*)$/.exec(line)
      if (callout) {
        const inner: string[] = []
        i++
        while (i < lines.length && lines[i].startsWith('>')) inner.push(lines[i++].replace(/^>\s?/, ''))
        blocks.push(renderObsidianCallout(callout[1], callout[2], callout[3], inner.join('\n')))
        out.push('', `\uE000PENTIMENTO-BLOCK-${blocks.length - 1}\uE001`, '')
        continue
      }
      const open = /^:::\s*([\w-]+)\s*(.*)$/.exec(line)
      if (open && HANDLERS[open[1]]) {
        const contentLines: string[] = []
        i++
        let innerFence = false
        let closed = false
        while (i < lines.length) {
          if (/^```/.test(lines[i].trim())) innerFence = !innerFence
          if (!innerFence && /^:::\s*$/.test(lines[i])) { closed = true; break }
          contentLines.push(lines[i])
          i++
        }
        if (!closed) throw new Error(`unclosed ::: ${open[1]} directive`)
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
        out.push('', `PENTIMENTO-BLOCK-${blocks.length - 1}`, '')
        continue
      }
      const h = /^(#{2,3})\s+(.+)$/.exec(line)
      if (h) {
        let text = h[2]
        let meta: { id?: string } = {}
        const c = HEADING_META_RE.exec(text)
        if (c) { meta = parseHeadingMeta(c[1]); text = text.replace(HEADING_META_RE, '') }
        const requestedId = slugify(meta.id ?? text) || `section-${headings.length + 1}`
        let id = requestedId
        let suffix = 2
        while (usedIds.has(id)) id = `${requestedId}-${suffix++}`
        usedIds.add(id)
        headings.push({ level: h[1].length as 2 | 3, title: text.trim(), id })
        out.push(`PENTIMENTO-HEADING-${headings.length - 1}`)
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
    const hm = HEADING_MARKER_RE.exec(line)
    const heading = hm ? headings[Number(hm[1])] : undefined
    if (heading?.level === 2) {
      sections.push({ heading, bodyLines: [] })
      bucket = sections[sections.length - 1].bodyLines
      continue
    }
    bucket.push(line)
  }
  return { title, standfirst: standfirstLines.join(' ').trim(), sections, preamble, blocks, headings, raws, footnotes: footnoteDefs }
}

const anchor = (id: string): string =>
  `<a class="anch" href="#${escapeHtml(id)}" aria-label="Link to this section">#</a>`

const renderSectionBody = (prepared: Prepared, bodyLines: string[]): string => {
  const out: string[] = []
  let markdown: string[] = []
  const flush = () => {
    if (markdown.length) out.push(renderMarkdown(markdown.join('\n')))
    markdown = []
  }
  for (const line of bodyLines) {
    const heading = HEADING_MARKER_RE.exec(line)
    const block = BLOCK_MARKER_RE.exec(line)
    const raw = RAW_MARKER_RE.exec(line)
    const h = heading ? prepared.headings[Number(heading[1])] : undefined
    const renderedBlock = block ? prepared.blocks[Number(block[1])] : undefined
    const rawHtml = raw ? prepared.raws[Number(raw[1])] : undefined
    if (h) {
      flush()
      out.push(`<h3 id="${escapeHtml(h.id)}">${renderInline(h.title)}${anchor(h.id)}</h3>`)
    } else if (renderedBlock !== undefined) {
      flush()
      out.push(renderedBlock)
    } else if (rawHtml !== undefined) {
      flush()
      out.push(rawHtml)
    } else {
      markdown.push(line)
    }
  }
  flush()
  return out.join('\n')
}


const footnotesHtml = (prepared: Prepared): string => {
  if (!prepared.footnotes.size) return ''
  const items = [...footnotes.numbers.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => {
    const anchorId = escapeHtml(slugify(id) || String(footnotes.numbers.get(id)))
    const back = footnotes.referenced.has(id) ? ` <a class="fnback" href="#fnref-${anchorId}" aria-label="Back to the text">↩</a>` : ''
    return `<li id="fn-${anchorId}">${renderInline(prepared.footnotes.get(id) ?? '')}${back}</li>`
  })
  return `\n<section class="footnotes" aria-label="Footnotes"><ol>${items.join('')}</ol></section>`
}

const renderSections = (prepared: Prepared): string => {
  const preamble = prepared.preamble.join('\n').trim()
    ? `<div class="preamble">${renderSectionBody(prepared, prepared.preamble)}</div>\n`
    : ''
  return preamble + prepared.sections.map((s) =>
    `<section>\n<h2 id="${escapeHtml(s.heading.id)}">${renderInline(s.heading.title)}${anchor(s.heading.id)}</h2>\n` +
    renderSectionBody(prepared, s.bodyLines) + '\n</section>').join('\n\n') + footnotesHtml(prepared)
}

/** Render a loose markdown fragment (no sections) to HTML. */
const renderFragment = (source: string): string => {
  const p = prepare(source)
  return renderSectionBody(p, [...p.preamble, ...p.sections.flatMap((s) => s.bodyLines)])
}

// ---------------------------------------------------------------------------
// revision-aware glance layer — where the document moved, computed, never written
// ---------------------------------------------------------------------------

interface GlanceCounts {
  done: number; next: number; later: number
  CRIT: number; HIGH: number; MED: number; LOW: number
  checked: number
}

const glanceCounts = (body: string): GlanceCounts => {
  const counts: GlanceCounts = { done: 0, next: 0, later: 0, CRIT: 0, HIGH: 0, MED: 0, LOW: 0, checked: 0 }
  let inFence = false
  let block: string | null = null
  for (const raw of body.split('\n')) {
    const line = raw.trim()
    if (/^```/.test(line)) { inFence = !inFence; continue }
    if (inFence) continue
    const open = /^:::\s*([\w-]+)/.exec(line)
    if (block === null && open) { block = open[1]; continue }
    if (block !== null && /^:::\s*$/.test(line)) { block = null; continue }
    if (block === 'timeline') {
      const m = /\[(next|later|done)\]/.exec(line)
      if (m) counts[m[1] as 'next' | 'later' | 'done']++
    } else if (block === 'findings') {
      const m = /^-\s+(CRIT|HIGH|MED|LOW)\s+::/.exec(line)
      if (m) counts[m[1] as 'CRIT' | 'HIGH' | 'MED' | 'LOW']++
    } else if (block === 'checklist') {
      if (/^-\s+\[[xX]\]/.test(line)) counts.checked++
    }
  }
  return counts
}

const glanceDelta = (prev: GlanceCounts, cur: GlanceCounts): string => {
  const parts: string[] = []
  for (const key of ['done', 'next', 'later', 'CRIT', 'HIGH', 'MED', 'LOW', 'checked'] as const) {
    const d = cur[key] - prev[key]
    if (d) parts.push(`${d > 0 ? '+' : '−'}${Math.abs(d)} ${key in SEV_LABEL ? SEV_LABEL[key].toLowerCase() : key}`)
  }
  return parts.join(' · ')
}

/** Section content keyed by the same ids prepare() assigns, for cross-revision change marks. */
const sectionSignatures = (body: string): Map<string, string> => {
  const sig = new Map<string, string>()
  const usedIds = new Set<string>()
  let inFence = false
  let key = ''
  let buf: string[] = []
  const flush = (): void => { if (key) sig.set(key, buf.join('\n').trim()); buf = [] }
  for (const line of body.split('\n')) {
    if (/^```/.test(line.trim())) inFence = !inFence
    const h = inFence ? null : /^##\s+(.+)$/.exec(line)
    if (h) {
      flush()
      let text = h[1]
      let meta: { id?: string } = {}
      const c = HEADING_META_RE.exec(text)
      if (c) { meta = parseHeadingMeta(c[1]); text = text.replace(HEADING_META_RE, '') }
      const requested = slugify(meta.id ?? text) || `section-${sig.size + 1}`
      let id = requested
      let suffix = 2
      while (usedIds.has(id)) id = `${requested}-${suffix++}`
      usedIds.add(id)
      key = id
      continue
    }
    buf.push(line)
  }
  flush()
  return sig
}

const changedSectionIds = (baseline: string, current: string): Set<string> => {
  const prev = sectionSignatures(baseline)
  const changed = new Set<string>()
  for (const [id, content] of sectionSignatures(current)) {
    if (prev.get(id) !== content) changed.add(id)
  }
  return changed
}

/** The traces view: the current body with the baseline showing through, as rendered HTML. */
const renderTraces = (baseline: string, current: string, baselineLabel: string): string => {
  // the traces copy numbers its own footnotes; the page's numbering resumes afterwards
  const saved = { numbers: footnotes.numbers, referenced: footnotes.referenced }
  try { return renderTracesInner(baseline, current, baselineLabel) } finally {
    footnotes.numbers = saved.numbers
    footnotes.referenced = saved.referenced
  }
}

const renderTracesInner = (baseline: string, current: string, baselineLabel: string): string => {
  const raws: string[] = []
  const stripIds = (html: string): string => html.replace(/\sid="[^"]*"/g, '')
  const pieces = tracePlan(baseline, current).map((part) => {
    if (part.kind === 'same' || part.kind === 'inline') return part.text
    if (part.kind === 'add') {
      raws.push(`<div class="tr-new">${stripIds(renderFragment(part.text))}</div>`)
      return rawMarker(raws.length - 1)
    }
    if (part.kind === 'swap') {
      let old: string
      try { old = renderFragment(part.old) } catch { old = `<pre>${escapeHtml(part.old)}</pre>` }
      raws.push(`<div class="tr-new" data-label="Changed since ${escapeHtml(baselineLabel)}">${stripIds(renderFragment(part.text))}</div>` +
        `<details class="tr-prev"><summary>As it was in ${escapeHtml(baselineLabel)}</summary><div class="tr-old">${stripIds(old)}</div></details>`)
      return rawMarker(raws.length - 1)
    }
    if (part.heading !== undefined) {
      raws.push(`<p class="tr-heading">${escapeHtml(part.heading)}</p>`)
      return rawMarker(raws.length - 1)
    }
    let html: string
    try { html = renderFragment(part.text) } catch { html = `<p>${escapeHtml(part.text)}</p>` }
    raws.push(`<div class="tr-old" data-label="Cut from ${escapeHtml(baselineLabel)}">${stripIds(html)}</div>`)
    return rawMarker(raws.length - 1)
  })
  const html = renderSections(prepare(pieces.join('\n\n'), raws))
  return `<p class="traces-banner">Traces of ${escapeHtml(baselineLabel)} under the current text. Press T to hide.</p>\n` +
    html
      .replaceAll(TRACE.delOpen, '<del class="tr">').replaceAll(TRACE.delClose, '</del>')
      .replaceAll(TRACE.insOpen, '<ins class="tr">').replaceAll(TRACE.insClose, '</ins>')
}

const KINDS: Record<string, string> = {
  implementation: 'Implementation plan',
  brainstorm: 'Brainstorm',
  audit: 'Audit',
  'design-doc': 'Design doc',
  plan: 'Plan',
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const humanDate = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : iso
}

export interface RenderOptions {
  /** Emit a claude.ai-Artifact-compatible fragment (no doctype/html/head/body — the platform wraps it). */
  artifact?: boolean
  /** Skip the header comments panel (the live viewer shows comments in its drawer instead). */
  omitCommentsPanel?: boolean
  /** Compare against this revision instead of the previous one ("what changed since I last read"). */
  since?: string
  /**
   * Earlier drafts to embed for the in-page scrubber: a count of the most recent ones, or
   * 'all'. Default 10. The live viewer passes 0; its bar fetches drafts from the server.
   */
  drafts?: number | 'all'
  /** where the live viewer serves a stored image; without it, the page carries its images */
  imageUrl?: (asset: string) => string
}

const DEFAULT_EMBEDDED_DRAFTS = 10

/** Pre-rendered earlier drafts plus a slider, so a static page can step through its history. */
const draftScrubber = (drafts: Draft[], currentLabel: string, limit: number | 'all'): string => {
  const earlier = drafts.slice(0, -1)
  const kept = limit === 'all' ? earlier : earlier.slice(Math.max(0, earlier.length - limit))
  if (!kept.length) return ''
  const saved = { numbers: footnotes.numbers, referenced: footnotes.referenced }
  let templates = ''
  try {
    templates = kept.map((d) => {
      let html: string
      try { html = renderSections(prepare(d.body)) } catch { html = `<pre>${escapeHtml(d.body)}</pre>` }
      return `<template class="draft-tpl" data-rev="${escapeHtml(d.id)}">${html}</template>`
    }).join('\n')
  } finally {
    footnotes.numbers = saved.numbers
    footnotes.referenced = saved.referenced
  }
  const max = kept.length
  return `<div class="drafts-scrub"><label><span class="drafts-scrub-name">Drafts</span>` +
    `<input type="range" data-draft-scrub min="0" max="${max}" step="1" value="${max}" aria-label="Draft"></label>` +
    `<span class="drafts-scrub-label" data-draft-label data-current="${escapeHtml(currentLabel)}">${escapeHtml(currentLabel)}</span></div>\n${templates}`
}

/** Plans (any Archetype) use CommonMark line joining; personal documents keep their line breaks. */
const usesLineBreaks = (doc: Doc): boolean => {
  const explicit = doc.frontmatter['Line Breaks']
  if (typeof explicit === 'boolean') return explicit
  return !doc.frontmatter['Archetype']
}

interface Draft { id: string; body: string }

/** A saved draft's body, keyed with the images it was saved with. */
const draftBody = (doc: Doc, meta: Meta, rev: string): string =>
  images.keys!.key(scrubInternal(splitRaw(readRevision(doc.canonicalPath, rev)).body), revisionImages(meta.revisions.find((r) => r.id === rev)))

const readDrafts = (doc: Doc, meta: Meta): Draft[] => {
  const drafts: Draft[] = []
  for (const r of meta.revisions) {
    try { drafts.push({ id: r.id, body: draftBody(doc, meta, r.id) }) } catch { /* verify reports it */ }
  }
  return drafts
}

const receiptsHtml = (resolved: CommentEntry[]): string => {
  if (!resolved.length) return ''
  const items = resolved.map((c) => {
    const quote = c.quote ? `<q>${escapeHtml(c.quote.length > 180 ? `${c.quote.slice(0, 180)}…` : c.quote)}</q>` : ''
    const reply = c.replies?.length ? `<span class="reply">↳ ${mdUntrusted.renderInline(c.replies[c.replies.length - 1].text)}</span>` : ''
    return `<div class="receipt">${quote}<span class="ask-text">${mdUntrusted.renderInline(c.text)}</span>${reply}</div>`
  }).join('')
  return `<div class="receipts"><h4>Your notes this draft answered</h4>${items}</div>`
}

const cuttingsHtml = (cuttings: Cutting[], open: boolean): string => {
  if (!cuttings.length) return ''
  const one = (c: Cutting): string => {
    const shot = imageBlock(c.text)
    const thumb = shot?.asset ? `<img class="cutting-shot"${imageAttrs(shot.asset)} alt="${escapeHtml(shot.ref.alt)}" loading="lazy">` : ''
    return `<div class="cutting">${thumb}<pre class="cutting-text">${escapeHtml(stripImageMarks(c.text))}</pre>` +
      `<div class="cuttings-meta"><span>${c.section ? `${escapeHtml(c.section)} · ` : ''}cut in ${escapeHtml(c.cutIn === 'canonical' ? 'the unsaved draft' : c.cutIn)}</span>` +
      `<button class="cut-copy" type="button" data-copy>Copy</button></div></div>`
  }
  const shown = cuttings.slice(0, 12).map(one).join('')
  const rest = cuttings.length > 12
    ? `<details class="cuttings-more"><summary>${cuttings.length - 12} older cuttings</summary>${cuttings.slice(12).map(one).join('')}</details>`
    : ''
  const n = cuttings.length
  return `<section class="cuttings" id="cuttings"><details${open ? ' open' : ''}><summary><h2>Cuttings · ${n} passage${n > 1 ? 's' : ''} from earlier drafts</h2></summary>` +
    `${shown}${rest}</details></section>`
}

const historyHtml = (meta: Meta, drafts: Draft[]): string => {
  if (!meta.revisions.length) return ''
  const words = new Map(drafts.map((d) => [d.id, wordCount(d.body)]))
  const approved = new Set((meta.approvals ?? []).map((a) => a.rev))
  const latest = meta.revisions[meta.revisions.length - 1].id
  let spark = ''
  if (drafts.length >= 3) {
    const max = Math.max(1, ...drafts.map((d) => words.get(d.id) ?? 0))
    const bars = drafts.map((d, i) => {
      const h = Math.max(1.5, ((words.get(d.id) ?? 0) / max) * 22)
      return `<rect${d.id === latest ? ' class="cur"' : ''} x="${i * 7}" y="${(24 - h).toFixed(1)}" width="5" height="${h.toFixed(1)}" rx="1"><title>${d.id}: ${words.get(d.id)} words</title></rect>`
    }).join('')
    spark = `<svg class="spark" viewBox="0 0 ${drafts.length * 7 - 2} 24" width="${drafts.length * 7 - 2}" height="24" role="img" aria-label="Words per draft">${bars}</svg>`
  }
  const items = [...meta.revisions].reverse().map((r) =>
    `<li><span class="rev">${escapeHtml(r.id)}</span><span class="what"><strong>${renderInline(r.summary)}</strong>` +
    `${r.why ? `. ${renderInline(r.why)}` : ''}` +
    `${approved.has(r.id) ? ' <span class="approved">· approved</span>' : ''}</span>` +
    `<span class="when"><time datetime="${escapeHtml(r.created_at)}">${escapeHtml(humanDate(r.created_at))}</time>` +
    `${words.has(r.id) ? ` <span class="words">· ${words.get(r.id)} words</span>` : ''}</span></li>`).join('\n')
  return `<section class="history" id="history"><h2>History · ${meta.revisions.length} draft${meta.revisions.length > 1 ? 's' : ''}</h2>${spark}<ol>${items}</ol></section>`
}

/** The page around a document. `body` is the draft being shown, scrubbed and keyed. */
const chrome = (doc: Doc, meta: Meta, body: string, opts: RenderOptions): string => {
  const css = renderStylesheet()
  const js = fs.readFileSync(path.join(ASSETS, 'chrome.js'), 'utf8')
  const archetype = doc.frontmatter['Archetype'] ? String(doc.frontmatter['Archetype']) : ''
  const kind = archetype ? KINDS[archetype] ?? archetype : ''
  const isPlan = Boolean(archetype)
  const latest = meta.revisions[meta.revisions.length - 1]
  const revisionState = canonicalRevisionState(doc, meta)
  const date = latest ? latest.created_at.slice(0, 10) : ''
  const pathLabel = doc.canonicalPath.split(path.sep).slice(-3).join('/')
  const inline = (s: string): string => renderInline(s)
  // the current draft first, so a static page carries each of its images here and only here
  const prepared = carrying(() => prepare(body))
  const mainHtml = carrying(() => renderSections(prepared))

  // --- baseline: what this view is compared against --------------------------------
  const revIds = meta.revisions.map((r) => r.id)
  const currentId = revisionState.dirty ? 'canonical' : latest?.id
  let baselineId: string | null = null
  if (opts.since && revIds.includes(opts.since) && opts.since !== currentId) baselineId = opts.since
  else if (revisionState.dirty && revisionState.latest) baselineId = revisionState.latest
  else if (meta.revisions.length >= 2) baselineId = meta.revisions[meta.revisions.length - 2].id
  let baselineBody: string | null = null
  if (baselineId) {
    try { baselineBody = draftBody(doc, meta, baselineId) } catch { baselineId = null }
  }

  let changes = ''
  let traces = ''
  let changedSections = new Set<string>()
  if (baselineBody !== null && baselineId) {
    changedSections = changedSectionIds(baselineBody, body)
    const delta = glanceDelta(glanceCounts(baselineBody), glanceCounts(body))
    // receipts: notes resolved in a revision after the baseline, up to this one
    const from = revIds.indexOf(baselineId)
    const to = currentId === 'canonical' ? revIds.length - 1 : revIds.indexOf(currentId ?? '')
    const window = new Set(revIds.slice(from + 1, to + 1))
    const resolved = meta.comments.filter((c) => c.status === 'resolved' && c.resolved_in && window.has(c.resolved_in))
    const extras = [delta, resolved.length ? `${resolved.length} note${resolved.length > 1 ? 's' : ''} answered` : '']
      .filter(Boolean).join(' · ')
    const label = revisionState.dirty && baselineId === revisionState.latest
      ? `Unsaved changes since ${escapeHtml(baselineId)}`
      : `What changed since ${escapeHtml(baselineId)}`
    changes = `<details class="changes"><summary>${label}${extras ? `<span class="delta"> · ${extras}</span>` : ''}</summary>` +
      `${receiptsHtml(resolved)}<div class="rdiff">${renderDiffHtml(baselineBody, body, {
        imageUrl: images.url ?? noUrl,
        labels: [baselineId, currentId === 'canonical' || !currentId ? 'now' : currentId],
      })}</div></details>`
    if (!images.url) for (const a of [...assetsIn(baselineBody), ...assetsIn(body)]) images.wanted.add(a)
    try {
      traces = `<template id="traces-tpl">${renderTraces(baselineBody, body, baselineId)}</template>`
    } catch { /* a traces failure never blocks the page */ }
  }

  const openComments = opts.omitCommentsPanel ? [] : meta.comments.filter((c) => c.status === 'open')
  const commentsPanel = openComments.length
    ? `\n  <details class="changes comments"><summary>${openComments.length} open comment${openComments.length > 1 ? 's' : ''}</summary><div class="receipts">${openComments.map((c) =>
        `<div class="receipt vcomment" data-cid="${escapeHtml(c.id)}">` +
        `${c.quote ? `<blockquote>${escapeHtml(c.quote)}</blockquote>` : ''}` +
        `<span class="ask-text">${mdUntrusted.renderInline(c.text)}</span>` +
        `<span class="reply">${escapeHtml(c.author)} · ${escapeHtml(humanDate(String(c.created_at)))}</span></div>`).join('')}</div></details>`
    : ''

  // --- history, cuttings -----------------------------------------------------------
  const drafts = readDrafts(doc, meta)
  const sequence = revisionState.dirty ? [...drafts, { id: 'canonical', body }] : drafts
  const cuttings = collectCuttings(sequence)
  const appendix = [cuttingsHtml(cuttings, !isPlan), historyHtml(meta, drafts)].filter(Boolean).join('\n')
  const draftLimit = opts.drafts ?? DEFAULT_EMBEDDED_DRAFTS
  const scrubber = draftLimit === 0 || opts.artifact ? '' : draftScrubber(sequence, currentId === 'canonical' ? 'now' : currentId ?? 'now', draftLimit)

  // --- contents ------------------------------------------------------------------------
  const tocItems = prepared.sections.map((s) =>
    `<li><a href="#${escapeHtml(s.heading.id)}">${escapeHtml(plainText(s.heading.title))}` +
    `${changedSections.has(s.heading.id) ? '<span class="chg" title="Changed since ' + escapeHtml(baselineId ?? '') + '"></span>' : ''}</a></li>`)
  const appendixItems = [
    cuttings.length ? '<li><a href="#cuttings">Cuttings</a></li>' : '',
    meta.revisions.length ? '<li><a href="#history">History</a></li>' : '',
  ].filter(Boolean)
  const showToc = prepared.sections.length >= 3
  const rail = showToc
    ? `<nav class="rail" aria-label="Contents"><ol>${tocItems.join('')}</ol>${appendixItems.length ? `<ol class="rail-appendix">${appendixItems.join('')}</ol>` : ''}</nav>`
    : ''
  const tocInline = showToc
    ? `<details class="toc-inline"><summary>Contents</summary><nav aria-label="Contents"><ol>${tocItems.join('')}${appendixItems.join('')}</ol></nav></details>`
    : ''

  // --- header -----------------------------------------------------------------------------
  const approval = latestApproval(meta)
  const approvedLabel = approval
    ? approval.rev === latest?.id && !revisionState.dirty ? 'Approved' : `Approved ${approval.rev}`
    : ''
  const metaItems = [
    kind ? `<span class="kind">${escapeHtml(kind)}</span>` : '',
    `<span class="rev-label">${escapeHtml(revisionState.label === 'Draft' ? 'Unsaved draft' : revisionState.label)}</span>`,
    date ? `<time datetime="${escapeHtml(date)}">${escapeHtml(humanDate(date))}</time>` : '',
    approvedLabel ? `<span class="approved" data-approved="${escapeHtml(approval!.rev)}">${escapeHtml(approvedLabel)}</span>` : '',
  ].filter(Boolean).join('')
  const tools = `<span class="meta-tools">${traces ? '<button class="tool" type="button" data-traces-toggle aria-pressed="false" title="Show the previous draft under this one (T)">Traces</button>' : ''}${schemeToggle()}</span>`
  const latestLine = latest
    ? `<p class="latest"><span class="rev">${escapeHtml(latest.id)}</span>${inline(latest.summary)}</p>`
    : ''

  const title = escapeHtml(plainText(prepared.title || doc.name))
  const page = `${themeInitSnippet()}

<div class="wrap">
${rail}
<header class="doc">
  <div class="meta">${metaItems}${tools}</div>
  <h1>${inline(prepared.title || doc.name)}</h1>
  ${prepared.standfirst ? `<p class="standfirst">${inline(prepared.standfirst)}</p>` : ''}
  ${latestLine}${changes}${commentsPanel}
  ${scrubber}
  ${tocInline}
</header>

<main>
${mainHtml}
</main>
${traces}${optionalLine(imageStore())}
${appendix ? `<div class="appendix">\n${appendix}\n</div>` : ''}
<footer class="doc">
  <code>${escapeHtml(pathLabel)}</code>
</footer>
</div>
<script>
${js}</script>
`

  if (opts.artifact) return `<title>${title}</title>\n<style>\n${css}</style>\n\n${page.replace(IMAGE_MARK_RE, '')}`

  return secureHtml(`<!doctype html>
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
${page.replace(IMAGE_MARK_RE, '')}</body>
</html>
`, { selfImages: Boolean(opts.imageUrl) })
}

const withDocument = <T>(doc: Doc, meta: Meta, opts: RenderOptions, fn: () => T): T => {
  const previous = { md, context, images, numbers: footnotes.numbers, referenced: footnotes.referenced }
  md = usesLineBreaks(doc) ? mdVerse : mdPlan
  context = contextFor(meta)
  images = freshImages(imageKeys(doc.canonicalPath, doc.historyDir), opts.imageUrl)
  footnotes.numbers = new Map()
  footnotes.referenced = new Set()
  try { return fn() } finally {
    md = previous.md
    context = previous.context
    images = previous.images
    footnotes.numbers = previous.numbers
    footnotes.referenced = previous.referenced
  }
}

export const render = (docPath: string, opts: RenderOptions = {}): string => {
  const doc = loadDoc(docPath)
  const meta = readMeta(doc.historyDir)
  return withDocument(doc, meta, opts, () => chrome(doc, meta, images.keys!.key(scrubInternal(doc.body)), opts))
}

export const renderToFile = (docPath: string, outPath?: string, opts: RenderOptions = {}): string => {
  const doc = loadDoc(docPath)
  const out = outPath
    ? path.resolve(outPath)
    : path.join(path.dirname(doc.canonicalPath), `${doc.name.toLowerCase()}.html`)
  fs.writeFileSync(out, render(docPath, opts), 'utf8')
  return out
}

/** Render the document as it stood at a given revision (history trimmed to that point). */
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
    approvals: (meta.approvals ?? []).filter((a) => meta.revisions.findIndex((r) => r.id === a.rev) <= idx),
  }
  const revDoc: Doc = { ...doc, raw, body, frontmatter, revision: rev }
  return withDocument(revDoc, trimmed, opts, () => chrome(revDoc, trimmed, draftBody(revDoc, meta, rev), opts))
}

/** Standalone page showing the changes between two revisions ('canonical' = current file). */
export const renderDiffPage = (docPath: string, a: string, b: string, opts: Pick<RenderOptions, 'imageUrl'> = {}): string => {
  const doc = loadDoc(docPath)
  const meta = readMeta(doc.historyDir)
  const css = renderStylesheet()
  const js = fs.readFileSync(path.join(ASSETS, 'chrome.js'), 'utf8')
  const label = (rev: string): string => (rev === 'canonical' ? 'now' : rev)
  const previous = images
  images = freshImages(imageKeys(doc.canonicalPath, doc.historyDir), opts.imageUrl)
  let rdiff: string
  let store: string
  try {
    const bodyOf = (rev: string): string =>
      rev === 'canonical' ? images.keys!.key(scrubInternal(doc.body)) : draftBody(doc, meta, rev)
    const [before, after] = [bodyOf(a), bodyOf(b)]
    rdiff = renderDiffHtml(before, after, { imageUrl: images.url ?? noUrl, labels: [label(a), label(b)] })
    if (!images.url) for (const asset of [...assetsIn(before), ...assetsIn(after)]) images.wanted.add(asset)
    store = imageStore()
  } finally {
    images = previous
  }
  const title = `${doc.name}: ${label(a)} → ${label(b)}`
  return secureHtml(`<!doctype html>
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
  <div class="meta"><span class="kind">Changes</span><span>${escapeHtml(label(a))} → ${escapeHtml(label(b))}</span><span class="meta-tools">${schemeToggle()}</span></div>
  <h1>${escapeHtml(doc.name)}</h1>
  <p class="standfirst">What changed between ${escapeHtml(label(a))} and ${escapeHtml(label(b))}.</p>
</header>
<main>
<div class="rdiff">${rdiff}</div>
</main>${optionalLine(store)}
</div>
<script>${js}</script>
</body>
</html>
`, { selfImages: Boolean(opts.imageUrl) })
}
