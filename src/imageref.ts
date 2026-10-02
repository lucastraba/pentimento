/**
 * Image references in markdown, with no file access. A draft body is "keyed" before it is
 * diffed or rendered: each reference gets a private-use marker naming the stored image it
 * pointed to (`<hash>.<ext>`), so a new screenshot at an old path diffs as a change, and a
 * page that shows two drafts at once shows each draft's own picture.
 */

export interface ImageRef {
  /** offsets of the whole reference in the source */
  start: number
  end: number
  /** what a revision's `images` map is keyed by: the path as written, `[[name]]` for Obsidian embeds */
  ref: string
  /** the file the reference names, with escapes and percent-encoding undone */
  target: string
  embed: boolean
  alt: string
  title: string
}

const EXTENSIONS: Record<string, string> = { png: 'png', jpg: 'jpg', jpeg: 'jpg', gif: 'gif', webp: 'webp', svg: 'svg' }

/** The stored extension for an image path (jpeg is stored as jpg), or null when it isn't one. */
export const imageExtension = (target: string): string | null => {
  const m = /\.([a-z0-9]+)$/i.exec(target.replace(/[?#].*$/, ''))
  return m ? EXTENSIONS[m[1].toLowerCase()] ?? null : null
}

/** `https:`, `data:`, `//host/…`: anything that isn't a path on this machine. */
export const isRemote = (target: string): boolean => /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target)

/** A stored image: 16 hex characters of the file's SHA-256 and its extension. */
export const ASSET_RE = /^[0-9a-f]{16}\.(?:png|jpg|gif|webp|svg)$/

export const IMAGE_MARK = { open: '', close: '' } as const
export const IMAGE_MARK_RE = /([0-9a-f]{16}\.[a-z]+)/g
const MARK_AT_RE = /^([0-9a-f]{16}\.[a-z]+)/

export const stripImageMarks = (s: string): string => s.replace(IMAGE_MARK_RE, '')

/** The stored images a keyed body shows, in order. */
export const assetsIn = (s: string): string[] => [...s.matchAll(IMAGE_MARK_RE)].map((m) => m[1])

const unescape = (s: string): string => s.replace(/\\([!-/:-@[-`{-~])/g, '$1')

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
const decodeEntities = (s: string): string =>
  s.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|(\w+));/g, (m, dec: string, hex: string, name: string) => {
    if (dec || hex) {
      const code = dec ? Number(dec) : parseInt(hex, 16)
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m
    }
    return ENTITIES[name] ?? m
  })

/**
 * The file a destination names, as markdown-it reads it (escapes, entities, percent-encoding),
 * without a query or fragment: `shot.png?v=2` is `shot.png`, and `a.png?/../.env` can't reach
 * past it. Remote URLs are left whole.
 */
const decodeTarget = (s: string): string => {
  const plain = decodeEntities(unescape(s))
  let decoded: string
  try { decoded = decodeURIComponent(plain) } catch { decoded = plain }
  return isRemote(decoded) ? decoded : decoded.replace(/[?#].*$/s, '')
}

/** `./mocks/a.png` and `mocks/a.png` are the same reference. */
const normalizeRef = (p: string): string => {
  const out: string[] = []
  for (const seg of p.split('/')) {
    if (seg === '.' || (seg === '' && out.length)) continue
    if (seg === '..' && out.length && out[out.length - 1] !== '..') out.pop()
    else out.push(seg)
  }
  return out.join('/')
}

/** Spaces and tabs, and at most one line ending, as CommonMark allows around a destination. */
const skipSpace = (s: string, j: number): number => {
  let newline = false
  while (j < s.length) {
    if (s[j] === ' ' || s[j] === '\t') j++
    else if (s[j] === '\n' && !newline) { newline = true; j++ }
    else break
  }
  return j
}

/** The end of `[…]` starting at `i`, with nested brackets and escapes, or -1. */
const closeBracket = (s: string, i: number): number => {
  let j = i + 1
  let depth = 1
  while (j < s.length && depth) {
    const c = s[j]
    if (c === '\\') { j += 2; continue }
    if (c === '\n' && s[j + 1] === '\n') return -1
    if (c === '[') depth++
    else if (c === ']') depth--
    j++
  }
  return depth ? -1 : j
}

/** A destination and optional title at `j`; `close` is the character that must follow, if any. */
const parseDestination = (s: string, j: number, close: string | null): { end: number; target: string; title: string } | null => {
  j = skipSpace(s, j)
  let target: string
  if (s[j] === '<') {
    const end = s.indexOf('>', j)
    if (end < 0 || s.slice(j, end).includes('\n')) return null
    target = s.slice(j + 1, end)
    j = end + 1
  } else {
    const start = j
    let parens = 0
    while (j < s.length && !/\s/.test(s[j])) {
      if (s[j] === '\\') { j += 2; continue }
      if (s[j] === '(') parens++
      else if (s[j] === ')') { if (!parens) break; parens-- }
      j++
    }
    target = s.slice(start, j)
  }
  const afterTarget = j
  j = skipSpace(s, j)
  let title = ''
  const quote = s[j]
  if ((quote === '"' || quote === "'" || quote === '(') && j > afterTarget) {
    const want = quote === '(' ? ')' : quote
    let k = j + 1
    while (k < s.length && s[k] !== want) k += s[k] === '\\' ? 2 : 1
    if (k >= s.length) return null
    title = s.slice(j + 1, k)
    j = skipSpace(s, k + 1)
  } else if (close === null) {
    j = afterTarget
  }
  if (close !== null) {
    if (s[j] !== close) return null
    j++
  }
  return { end: j, target, title }
}

/** `![alt](target "title")` starting at `i`, or null when the text there isn't one. */
const parseInline = (s: string, i: number): { end: number; alt: string; target: string; title: string } | null => {
  const altEnd = closeBracket(s, i + 1)
  if (altEnd < 0 || s[altEnd] !== '(') return null
  const dest = parseDestination(s, altEnd + 1, ')')
  return dest && { end: dest.end, alt: s.slice(i + 2, altEnd - 1), target: dest.target, title: dest.title }
}

const normalizeLabel = (label: string): string => label.trim().replace(/\s+/g, ' ').toLowerCase()

/** Link reference definitions (`[label]: target "title"`), which reference-style images use. */
const definitions = (masked: string, body: string): Map<string, { target: string; title: string }> => {
  const out = new Map<string, { target: string; title: string }>()
  const re = /^ {0,3}\[([^\]\n]+)\]:/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(masked))) {
    const dest = parseDestination(body, m.index + m[0].length, null)
    const key = normalizeLabel(m[1])
    if (dest && dest.target && !out.has(key)) out.set(key, { target: dest.target, title: dest.title })
  }
  return out
}

const EMBED_RE = /^!\[\[([^\]\n]+)\]\]/

/** A fence opener's character and length, after any blockquote markers and list markers. */
const fenceAt = (line: string): { char: string; length: number; rest: string } | null => {
  const m = /^(?:\s{0,3}>\s?)*(?:\s{0,3}(?:[-*+]|\d{1,9}[.)])\s+)*\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line)
  return m ? { char: m[1][0], length: m[1].length, rest: m[2] } : null
}

/** Blank out fenced code and code spans, keeping offsets, so references inside them are skipped. */
const maskCode = (body: string): string => {
  let fence: { char: string; length: number } | null = null
  return body.split('\n').map((line) => {
    const f = fenceAt(line)
    if (fence) {
      // a fence closes only with the same character, at least as many, and nothing after
      if (f && f.char === fence.char && f.length >= fence.length && !f.rest.trim()) fence = null
      return ' '.repeat(line.length)
    }
    if (f && !(f.char === '`' && f.rest.includes('`'))) {
      fence = { char: f.char, length: f.length }
      return ' '.repeat(line.length)
    }
    return line.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (m) => ' '.repeat(m.length))
  }).join('\n')
}

/** True when the `!` at `i` is escaped by an odd number of backslashes. */
const escapedAt = (s: string, i: number): boolean => {
  let n = 0
  while (i - 1 - n >= 0 && s[i - 1 - n] === '\\') n++
  return n % 2 === 1
}

/** Every image reference in a markdown body, in order. Code and code spans are skipped. */
export const findImageRefs = (body: string): ImageRef[] => {
  const masked = maskCode(body)
  const defs = definitions(masked, body)
  const out: ImageRef[] = []
  const push = (start: number, end: number, rawTarget: string, rawAlt: string, rawTitle: string): void => {
    const target = decodeTarget(rawTarget)
    out.push({
      start, end, ref: isRemote(target) ? target : normalizeRef(target), target, embed: false,
      alt: unescape(rawAlt), title: decodeEntities(unescape(rawTitle)),
    })
  }
  let i = masked.indexOf('![')
  while (i >= 0) {
    if (escapedAt(masked, i)) { i = masked.indexOf('![', i + 2); continue }
    const embed = EMBED_RE.exec(masked.slice(i))
    if (embed) {
      // in a table, Obsidian escapes the pipe: `![[shot.png\|300]]`
      const [inner, alias] = embed[1].split(/\\?\|/)
      const target = inner.replace(/#.*$/, '').trim()
      const name = target.slice(target.lastIndexOf('/') + 1)
      out.push({
        start: i, end: i + embed[0].length, ref: `[[${target}]]`, target, embed: true,
        alt: alias && !/^\d+(?:x\d+)?$/.test(alias.trim()) ? alias.trim() : name.replace(/\.[^.]+$/, ''), title: '',
      })
      i = masked.indexOf('![', i + embed[0].length)
      continue
    }
    const inline = parseInline(masked, i)
    if (inline) {
      // read the parts back from the source, not the mask
      const parsed = parseInline(body.slice(i, inline.end), 0) ?? inline
      push(i, inline.end, parsed.target, parsed.alt, parsed.title)
      i = masked.indexOf('![', inline.end)
      continue
    }
    // reference style: `![alt][label]`, `![alt][]`, or `![label]`
    const altEnd = closeBracket(masked, i + 1)
    if (altEnd > 0) {
      const alt = body.slice(i + 2, altEnd - 1)
      let label = alt
      let end = altEnd
      if (masked[altEnd] === '[') {
        const labelEnd = closeBracket(masked, altEnd)
        if (labelEnd > 0) {
          label = body.slice(altEnd + 1, labelEnd - 1) || alt
          end = labelEnd
        }
      }
      const def = defs.get(normalizeLabel(label))
      if (def) {
        push(i, end, def.target, alt, def.title)
        i = masked.indexOf('![', end)
        continue
      }
    }
    i = masked.indexOf('![', i + 2)
  }
  return out
}

/** Mark each reference with the stored image it points to; `assetFor` returns null to leave one alone. */
export const keyImages = (body: string, assetFor: (ref: ImageRef) => string | null): string => {
  let out = ''
  let at = 0
  for (const ref of findImageRefs(body)) {
    const asset = assetFor(ref)
    if (!asset) continue
    out += body.slice(at, ref.end) + IMAGE_MARK.open + asset + IMAGE_MARK.close
    at = ref.end
  }
  return out + body.slice(at)
}

/** The references in a keyed body that carry a stored image, with it. */
export const keyedImages = (s: string): { ref: ImageRef; asset: string }[] =>
  findImageRefs(s).flatMap((ref) => {
    const mark = MARK_AT_RE.exec(s.slice(ref.end))
    return mark ? [{ ref, asset: mark[1] }] : []
  })

/** A block that is one image and nothing else: it renders as a figure and diffs as a picture. */
export const imageBlock = (block: string): { ref: ImageRef; asset: string | null } | null => {
  const text = block.trim()
  const refs = findImageRefs(text)
  if (refs.length !== 1 || refs[0].start !== 0) return null
  const rest = text.slice(refs[0].end)
  const mark = MARK_AT_RE.exec(rest)
  if ((mark ? rest.slice(mark[0].length) : rest).trim()) return null
  return { ref: refs[0], asset: mark ? mark[1] : null }
}
