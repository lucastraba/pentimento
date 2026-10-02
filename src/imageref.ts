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

const decodeTarget = (s: string): string => {
  const plain = unescape(s)
  try { return decodeURIComponent(plain) } catch { return plain }
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

/** `![alt](target "title")` starting at `i`, or null when the text there isn't one. */
const parseInline = (s: string, i: number): { end: number; alt: string; target: string; title: string } | null => {
  let j = i + 2
  let depth = 1
  while (j < s.length && depth) {
    const c = s[j]
    if (c === '\\') { j += 2; continue }
    if (c === '\n' && s[j + 1] === '\n') return null
    if (c === '[') depth++
    else if (c === ']') depth--
    j++
  }
  if (depth || s[j] !== '(') return null
  const alt = s.slice(i + 2, j - 1)
  j++
  while (s[j] === ' ' || s[j] === '\t') j++
  let target: string
  if (s[j] === '<') {
    const close = s.indexOf('>', j)
    if (close < 0 || s.slice(j, close).includes('\n')) return null
    target = s.slice(j + 1, close)
    j = close + 1
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
  while (s[j] === ' ' || s[j] === '\t') j++
  let title = ''
  const quote = s[j]
  if (quote === '"' || quote === "'" || quote === '(') {
    const close = s.indexOf(quote === '(' ? ')' : quote, j + 1)
    if (close < 0) return null
    title = s.slice(j + 1, close)
    j = close + 1
    while (s[j] === ' ' || s[j] === '\t') j++
  }
  if (s[j] !== ')') return null
  return { end: j + 1, alt, target, title }
}

const EMBED_RE = /^!\[\[([^\]\n]+)\]\]/

/** Blank out fenced code and code spans, keeping offsets, so references inside them are skipped. */
const maskCode = (body: string): string => {
  let inFence = false
  return body.split('\n').map((line) => {
    if (/^\s{0,3}(?:```|~~~)/.test(line)) { inFence = !inFence; return ' '.repeat(line.length) }
    if (inFence) return ' '.repeat(line.length)
    return line.replace(/(`+)(.+?)\1/g, (m) => ' '.repeat(m.length))
  }).join('\n')
}

/** Every image reference in a markdown body, in order. Code and code spans are skipped. */
export const findImageRefs = (body: string): ImageRef[] => {
  const masked = maskCode(body)
  const out: ImageRef[] = []
  let i = masked.indexOf('![')
  while (i >= 0) {
    if (i > 0 && masked[i - 1] === '\\') { i = masked.indexOf('![', i + 2); continue }
    const embed = EMBED_RE.exec(masked.slice(i))
    if (embed) {
      const [inner, alias] = embed[1].split('|')
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
      const source = body.slice(i, inline.end)
      const parsed = parseInline(source, 0) ?? inline
      const target = decodeTarget(parsed.target)
      out.push({
        start: i, end: inline.end, ref: isRemote(target) ? target : normalizeRef(target), target, embed: false,
        alt: unescape(parsed.alt), title: unescape(parsed.title),
      })
      i = masked.indexOf('![', inline.end)
      continue
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
