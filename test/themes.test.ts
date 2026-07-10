import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PALETTE, PALETTES, PALETTE_KEYS, themeCss, themeInitSnippet, themePicker,
} from '../src/themes.js'

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

describe('theme registry', () => {
  it('has six unique, fully generated palettes with Verdigris as the product default', () => {
    expect(DEFAULT_PALETTE).toBe('verdigris')
    expect(PALETTES).toHaveLength(6)
    expect(new Set(PALETTE_KEYS).size).toBe(PALETTES.length)

    const css = themeCss()
    for (const palette of PALETTES) {
      expect(css).toContain(`:root[data-palette="${palette.key}"]`)
      expect(css).toContain(`.preview-${palette.key}`)
    }
  })

  it('renders a scalable theme dropdown beside the independent scheme control', () => {
    const picker = themePicker('parchment')
    for (const key of PALETTE_KEYS) expect(picker).toContain(`data-p="${key}"`)
    expect(picker).toContain('data-p="parchment" aria-pressed="true"')
    expect(picker).toContain('Use document default')
    expect(picker).toContain('class="theme-controls"')
    expect(picker).toContain('class="theme-chevron"')
    expect(picker).toContain('class="tbtn"')
    expect(picker).not.toContain('class="scheme-group"')
  })

  it('renders every palette preview in the active light or dark scheme', () => {
    const css = themeCss()
    for (const palette of PALETTES) {
      const light = `--preview-page:${palette.light.bg};--preview-accent:${palette.light.accent};--preview-ink:${palette.light.ink}`
      const dark = `--preview-page:${palette.dark.bg};--preview-accent:${palette.dark.accent};--preview-ink:${palette.dark.ink}`
      expect(css).toContain(`.preview-${palette.key}{${light}}`)
      expect(css).toContain(`@media (prefers-color-scheme:dark){.preview-${palette.key}{${dark}}}`)
      expect(css).toContain(`:root[data-theme="light"] .preview-${palette.key}{${light}}`)
      expect(css).toContain(`:root[data-theme="dark"] .preview-${palette.key}{${dark}}`)
    }
  })

  it('validates stored palette and scheme values before first paint', () => {
    const init = themeInitSnippet('fjord')
    expect(init).toContain('k.includes(p)')
    expect(init).toContain("t!=='dark'&&t!=='light'")
    expect(init).toContain("removeItem('pentimento-palette')")
    expect(init).toContain("r.dataset.documentPalette='fjord'")
    expect(init).toContain("r.dataset.palette=p||'fjord'")
  })

  it('keeps pre-registry picker markup styled and interactive during a rolling restart', () => {
    const css = fs.readFileSync(path.resolve('assets/theme.css'), 'utf8')
    const js = fs.readFileSync(path.resolve('assets/chrome.js'), 'utf8')
    expect(css).toContain('.theme-grid .pbtn')
    expect(css).not.toMatch(/\n\.pbtn\s*\{/)
    expect(css).toContain('.palettes .pbtn, .tbtn')
    expect(css).toContain(':root[data-palette="iris"]')
    expect(css).toContain(':root[data-palette="mist"]')
    expect(css).toContain(':root[data-palette="parchment"]')
    expect(css).toContain(':root[data-palette="fjord"]')
    expect(css).toContain(':root[data-palette="contrast"]')
    expect(js).toContain("t.closest('.tbtn')")
    expect(js).toContain('upgradeLegacyPicker()')
    expect(js).toContain("['parchment', 'Parchment']")
  })

  it('keeps text, filled controls, category badges, and control boundaries accessible', () => {
    for (const palette of PALETTES) {
      for (const scheme of ['light', 'dark'] as const) {
        const colors = palette[scheme]
        const label = `${palette.key} ${scheme}`
        expect(contrast(colors.ink, colors.bg), `${label} body text`).toBeGreaterThanOrEqual(7)
        expect(contrast(colors.soft, colors.bg), `${label} muted text`).toBeGreaterThanOrEqual(4.5)
        expect(contrast(colors.onAccent, colors.accent), `${label} accent control`).toBeGreaterThanOrEqual(4.5)
        expect(contrast(colors.controlLine, colors.bg), `${label} control boundary`).toBeGreaterThanOrEqual(3)
        for (const category of ['impl', 'brain', 'audit', 'design'] as const) {
          expect(contrast(colors.onCategory, colors[category]), `${label} ${category} badge`).toBeGreaterThanOrEqual(4.5)
        }
      }
    }
  })
})
