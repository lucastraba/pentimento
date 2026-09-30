import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { schemeToggle, themeInitSnippet } from '../src/themes.js'

const css = fs.readFileSync(path.resolve(__dirname, '../assets/theme.css'), 'utf8')

const channel = (hex: string, offset: number): number => {
  const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}
const luminance = (hex: string): number =>
  0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5)
const contrast = (a: string, b: string): number => {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (lighter + 0.05) / (darker + 0.05)
}

/** The custom properties declared in the first rule matching `selector`. */
const tokens = (selector: string): Record<string, string> => {
  const start = css.indexOf(`${selector} {`)
  expect(start).toBeGreaterThanOrEqual(0)
  const body = css.slice(start, css.indexOf('}', start))
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9A-Fa-f]{6})/g)].map((m) => [m[1], m[2]]))
}

describe('the palette', () => {
  const schemes = { light: tokens(':root'), dark: tokens(':root[data-theme="dark"]') }

  it.each(Object.entries(schemes))('keeps %s text readable', (_name, t) => {
    expect(contrast(t.ink, t.bg)).toBeGreaterThanOrEqual(12)
    expect(contrast(t.soft, t.bg)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(t.accent, t.bg)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(t.trace, t.bg)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(t.crit, t.bg)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(t.high, t.bg)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(t['on-accent'], t.accent)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(t['add-ink'], t['add-bg'])).toBeGreaterThanOrEqual(4.5)
    expect(contrast(t['del-ink'], t['del-bg'])).toBeGreaterThanOrEqual(4.5)
  })

  it('applies the dark values for the system setting unless the reader chose light', () => {
    expect(css).toContain('@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"]) {')
    const auto = css.slice(css.indexOf(':root:not([data-theme="light"]) {'))
    expect(auto.slice(0, auto.indexOf('}'))).toContain(`--bg: ${schemes.dark.bg}`)
  })

  it('keeps faint grey off text that carries meaning', () => {
    for (const selector of ['footer.doc {', '.history .words {', '.rdiff-skip {', '.ph {']) {
      const rule = css.slice(css.indexOf(selector), css.indexOf('}', css.indexOf(selector)))
      expect(rule, selector).not.toContain('var(--faint)')
    }
  })
})

describe('scheme restore', () => {
  it('applies only valid stored schemes before first paint', () => {
    const snippet = themeInitSnippet()
    expect(snippet).toContain("t==='dark'||t==='light'")
    expect(snippet).toContain("localStorage.removeItem('pentimento-theme')")
    expect(snippet).not.toContain('palette')
  })

  it('renders a single toggle', () => {
    expect(schemeToggle()).toContain('data-scheme-toggle')
  })
})
