import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { snapshot } from '../src/core.js'
import { render } from '../src/render.js'

let dir: string
let previousConfig: string | undefined
let previousPalette: string | undefined

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pentimento-render-'))
  previousConfig = process.env.PENTIMENTO_CONFIG
  previousPalette = process.env.PENTIMENTO_PALETTE
  process.env.PENTIMENTO_CONFIG = path.join(dir, 'user-config.json')
  delete process.env.PENTIMENTO_PALETTE
})

afterEach(() => {
  if (previousConfig === undefined) delete process.env.PENTIMENTO_CONFIG
  else process.env.PENTIMENTO_CONFIG = previousConfig
  if (previousPalette === undefined) delete process.env.PENTIMENTO_PALETTE
  else process.env.PENTIMENTO_PALETTE = previousPalette
  fs.rmSync(dir, { recursive: true, force: true })
})

const doc = (body: string): string => {
  const p = path.join(dir, 'Plan.md')
  fs.writeFileSync(p, body)
  snapshot(p, { summary: 'test revision', why: 'testing', author: 'test' })
  return p
}

describe('render', () => {
  it('builds the chrome: title, badge, revision chip, TOC, evolution, footer', () => {
    const p = doc('# My Plan\n\n> A standfirst.\n\n## First <!-- id: first; eyebrow: Intro -->\n\nBody text.\n\n## Second\n\nMore.\n')
    const html = render(p)
    expect(html).toContain('<title>My Plan</title>')
    expect(html).toContain('class="badge badge-design-doc"')
    expect(html).toContain('<span class="chip">r001</span>')
    expect(html).toContain('class="standfirst"')
    expect(html).toContain('<strong>test revision</strong> — testing')
    expect(html).toContain('href="#first"')
    expect(html).toContain('<span class="eyebrow">Intro</span>')
    expect(html).toContain('<h2 id="first">First<a class="anch" href="#first"')
    expect(html).toContain('<h2 id="second">')
    expect(html).toContain('Rendered by <code>pentimento render</code>')
  })

  it('renders callouts, verdicts, findings, timeline', () => {
    const p = doc(`# T

## S

::: callout decision id=d-1
**Bold call.** Rest.
:::

::: verdict
- Works? :: Yes
- Fast? :: Enough
:::

::: findings
- CRIT :: broken thing
- HIGH :: risky thing
@collapse More (1)
- LOW :: small thing
:::

::: timeline
1. **Phase one** [next] — do it
2. **Phase two** [later] — then this
:::
`)
    const html = render(p)
    expect(html).toContain('<div class="callout decision" id="d-1"><span class="label">Decision</span>')
    expect(html).toContain('<div class="verdict">')
    expect(html).toContain('<span class="sev c">CRIT</span>')
    expect(html).toContain('<summary>More (1)</summary>')
    expect(html).toContain('<span class="sev m">LOW</span>')
    expect(html).toContain('<ol class="timeline">')
    expect(html).toContain('<span class="pill">next</span>')
    expect(html).toContain('<span class="pill later">later</span>')
  })

  it('computes a severity strip and auto-counts the collapsed group', () => {
    const p = doc('# T\n\n## S\n\n::: findings\n- CRIT :: a\n- HIGH :: b\n- HIGH :: c\n@collapse Lower severity\n- MED :: d\n- LOW :: e\n:::\n')
    const html = render(p)
    expect(html).toContain('<div class="finding-summary">')
    expect(html).toContain('<span class="tally c"><b>1</b> CRIT</span>')
    expect(html).toContain('<span class="tally h"><b>2</b> HIGH</span>')
    // agent omitted the count; renderer appends it
    expect(html).toContain('<summary>Lower severity (2)</summary>')
  })

  it('computes a timeline progress strip with a meter', () => {
    const p = doc('# T\n\n## S\n\n::: timeline\n1. **One** [done] — a\n2. **Two** [done] — b\n3. **Three** [next] — c\n4. **Four** [later] — d\n:::\n')
    const html = render(p)
    expect(html).toContain('<div class="timeline-progress">')
    expect(html).toContain('<meter value="3" min="0" max="4"')
    expect(html).toContain('aria-label="Sequence progress"')
    expect(html).toContain('2 done · 1 next · 1 later · 4 total')
    expect(html).toContain('<span class="ph ph-done">1</span>')
  })

  it('shows the active next phase as progress even before anything is done', () => {
    const p = doc('# T\n\n## S\n\n::: timeline\n1. **One** [next] — a\n2. **Two** [later] — b\n3. **Three** [later] — c\n:::\n')
    const html = render(p)
    expect(html).toContain('<meter value="1" min="0" max="3"')
    expect(html).toContain('1 next · 2 later · 3 total')
  })

  it('renders figure aria as a figcaption and uses a time element for the date', () => {
    const p = doc('# T\n\n## S\n\n::: figure aria="the flow"\n<svg viewBox="0 0 10 10"><rect class="nodebox" width="10" height="10"/></svg>\n:::\n')
    const html = render(p)
    expect(html).toContain('<figcaption>the flow</figcaption>')
    expect(html).toMatch(/<time class="chip" datetime="\d{4}-\d{2}-\d{2}">/)
  })

  it('renders a unified diff as side-by-side panes', () => {
    const p = doc('# T\n\n## S\n\n::: diff head="file.py · fix"\n```txt\n def f():\n-    old()\n+    new()\n+    more()\n```\n:::\n')
    const html = render(p)
    expect(html).toContain('<div class="diff-head">file.py · fix</div>')
    expect(html).toContain('<span class="del">    old()</span>')
    expect(html).toContain('<span class="add">    new()</span>')
    const before = html.split('pane-label">Before')[1].split('diff-pane')[0]
    expect(before).not.toContain('new()')
  })

  it('wraps tables, expands swatches, escapes diff content', () => {
    const p = doc('# T\n\n## S\n\n| a | b |\n|---|---|\n| {dot:impl}x | y |\n\n::: diff\n```txt\n-<script>alert(1)</script>\n+safe\n```\n:::\n')
    const html = render(p)
    expect(html).toContain('<div class="tablewrap"><table>')
    expect(html).toContain('<span class="dot dot-impl"></span>x')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).not.toContain('<script>alert(1)')
  })

  it('emits a standalone document by default, a fragment with artifact: true', () => {
    const p = doc('# T\n\n## S\n\nx\n')
    const standalone = render(p)
    expect(standalone).toMatch(/^<!doctype html>/)
    expect(standalone).toContain('name="viewport"')
    const fragment = render(p, { artifact: true })
    expect(fragment).toMatch(/^<title>/)
    expect(fragment).not.toContain('<!doctype')
  })

  it('defaults the palette to verdigris, overridable via Palette frontmatter', () => {
    const p = doc('# T\n\n## S\n\nx\n')
    const html = render(p)
    expect(html).toContain("r.dataset.documentPalette='verdigris'")
    expect(html).toContain("r.dataset.palette=p||'verdigris'")
    expect(html).toContain('data-p="verdigris" aria-pressed="true"')
    const p2 = path.join(dir, 'Other.md')
    fs.writeFileSync(p2, '---\nPalette: mist\n---\n# T2\n\n## S\n\nx\n')
    snapshot(p2, { summary: 's' })
    const html2 = render(p2)
    expect(html2).toContain("r.dataset.documentPalette='mist'")
    expect(html2).toContain("r.dataset.palette=p||'mist'")
    expect(html2).toContain('data-p="mist" aria-pressed="true"')
    expect(html2).toContain('data-p="iris" aria-pressed="false"')
  })

  it('respects the configured house palette without changing the product default', () => {
    const previous = process.env.PENTIMENTO_PALETTE
    process.env.PENTIMENTO_PALETTE = 'iris'
    try {
      const html = render(doc('# Configured\n\n## Section\n\ntext\n'))
      expect(html).toContain("r.dataset.documentPalette='iris'")
      expect(html).toContain('data-p="iris" aria-pressed="true"')
    } finally {
      if (previous === undefined) delete process.env.PENTIMENTO_PALETTE
      else process.env.PENTIMENTO_PALETTE = previous
    }
  })

  it('passes figures through with aria labels', () => {
    const p = doc('# T\n\n## S\n\n::: figure aria="a diagram"\n<svg viewBox="0 0 10 10"><rect class="nodebox" width="10" height="10"/></svg>\n:::\n')
    const html = render(p)
    expect(html).toContain('<figure class="diagram" role="img" aria-label="a diagram">')
    expect(html).toContain('<rect class="nodebox"')
  })

  it('treats raw markdown HTML and heading metadata as text', () => {
    const p = doc(`# <img src=x onerror="titleAttack()">

## <img src=x onerror="headingAttack()"> <!-- id: safe\" onmouseover=\"idAttack(); eyebrow: <svg onload=\"eyebrowAttack()\"> -->

<a href=javascript:bodyAttack()>bad link</a>
`)
    const html = render(p)
    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('<svg onload')
    expect(html).not.toContain('<a href=javascript:')
    expect(html).not.toContain('onmouseover="idAttack()"')
    expect(html).toContain('&lt;img src=x onerror=&quot;headingAttack()&quot;&gt;')
    expect(html.match(/<h2 id="[^"]+">/)?.[0]).toMatch(/^<h2 id="[a-z0-9-]+">$/)
  })

  it('deduplicates generated heading IDs', () => {
    const html = render(doc('# T\n\n## Repeat\n\none\n\n## Repeat\n\ntwo\n'))
    expect(html).toContain('<h2 id="repeat">')
    expect(html).toContain('<h2 id="repeat-2">')
  })

  it('renders dot tokens as prose but leaves code examples literal', () => {
    const html = render(doc('# T\n\n## S\n\n{dot:impl} prose and `{dot:impl}` code.\n\n```txt\n{dot:impl}\n```\n'))
    expect(html).toContain('<span class="dot dot-impl"></span> prose')
    expect(html).toContain('<code>{dot:impl}</code>')
    expect(html).toContain('class="language-txt">{dot:impl}\n</code>')
  })

  it('does not treat source text as an internal renderer marker', () => {
    const html = render(doc('# T\n\n## S\n\n\uE000PENTIMENTO-BLOCK-0\uE001\n\n\uE000PENTIMENTO-HEADING-99\uE001\n'))
    expect(html).toContain('PENTIMENTO-BLOCK-0')
    expect(html).toContain('PENTIMENTO-HEADING-99')
  })

  it('renders unknown directives literally and rejects unclosed supported directives', () => {
    const p = doc('# T\n\n## S\n\n::: mystery\ntext\n:::\n')
    expect(render(p)).toContain('::: mystery')
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('::: mystery\ntext\n:::', '::: callout decision\ntext'))
    expect(() => render(p)).toThrow('unclosed ::: callout directive')
  })

  it('allowlists figure SVG instead of passing active content through', () => {
    const p = doc(`# T

## S

::: figure aria="safe diagram"
<svg viewBox="0 0 10 10" onload="attack()">
  <script>alert(1)</script>
  <foreignObject><img src=x onerror="attack()"></foreignObject>
  <rect class="nodebox alien" width="10" height="10" style="fill:red" onclick="attack()"/>
  <a href="https://example.com"><text>outside</text></a>
</svg>
:::
`)
    const html = render(p)
    const figure = html.match(/<figure class="diagram"[\s\S]*?<\/figure>/)?.[0] ?? ''
    expect(figure).toContain('<svg viewBox="0 0 10 10">')
    expect(figure).toContain('<rect class="nodebox" width="10" height="10">')
    expect(figure).not.toContain('<script')
    expect(figure).not.toContain('<foreignObject')
    expect(figure).not.toContain('<img')
    expect(figure).not.toContain('<a ')
    expect(figure).not.toContain('onload=')
    expect(figure).not.toContain('onclick=')
    expect(figure).not.toContain('style=')
  })

  it('requires exactly one SVG root in each figure', () => {
    expect(() => render(doc('# T\n\n## S\n\n::: figure\n<svg viewBox="0 0 1 1"></svg><svg viewBox="0 0 1 1"></svg>\n:::\n')))
      .toThrow('figure must contain one allowlisted <svg> root')
  })

  it('ships a restrictive content security policy', () => {
    const html = render(doc('# T\n\n## S\n\ntext\n'))
    expect(html).toContain('http-equiv="Content-Security-Policy"')
    expect(html).toContain("default-src 'none'")
    expect(html).toContain("connect-src 'self'")
    expect(html).toContain("img-src data:")
    expect(html).toContain("base-uri 'none'")
    expect(html).toMatch(/script-src 'sha256-[A-Za-z0-9+/=]+'/)
    expect(html).not.toMatch(/script-src[^;]*'unsafe-inline'/)
  })
})
