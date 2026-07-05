import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { snapshot } from '../src/core.js'
import { render } from '../src/render.js'

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vellum-render-'))
})

afterEach(() => {
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
    expect(html).toContain('Rendered by <code>vellum render</code>')
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

  it('defaults the palette to iris, overridable via Palette frontmatter', () => {
    const p = doc('# T\n\n## S\n\nx\n')
    const html = render(p)
    expect(html).toContain("p=p||'iris'")
    expect(html).toContain('data-p="iris" aria-pressed="true"')
    const p2 = path.join(dir, 'Other.md')
    fs.writeFileSync(p2, '---\nPalette: mist\n---\n# T2\n\n## S\n\nx\n')
    snapshot(p2, { summary: 's' })
    const html2 = render(p2)
    expect(html2).toContain("p=p||'mist'")
    expect(html2).toContain('data-p="mist" aria-pressed="true"')
    expect(html2).toContain('data-p="iris" aria-pressed="false"')
  })

  it('passes figures through with aria labels', () => {
    const p = doc('# T\n\n## S\n\n::: figure aria="a diagram"\n<svg viewBox="0 0 10 10"><rect class="nodebox" width="10" height="10"/></svg>\n:::\n')
    const html = render(p)
    expect(html).toContain('<div class="diagram" role="img" aria-label="a diagram">')
    expect(html).toContain('<rect class="nodebox"')
  })
})
