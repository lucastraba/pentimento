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
  it('builds the chrome: meta line, title, latest summary, contents, history, footer', () => {
    const p = doc('---\nArchetype: implementation\n---\n# My Plan\n\n> A standfirst.\n\n## First <!-- id: first; eyebrow: Intro -->\n\nBody text.\n\n## Second\n\nMore.\n\n## Third\n\nLast.\n')
    const html = render(p)
    expect(html).toContain('<title>My Plan</title>')
    expect(html).toContain('<span class="kind">Implementation plan</span>')
    expect(html).toContain('<span class="rev-label">r001</span>')
    expect(html).toContain('class="standfirst"')
    expect(html).toContain('<p class="latest"><span class="rev">r001</span>test revision</p>')
    expect(html).toContain('<strong>test revision</strong>. testing')
    expect(html).toContain('<nav class="rail" aria-label="Contents">')
    expect(html).toContain('href="#first"')
    // eyebrows from earlier releases are accepted and not rendered
    expect(html).not.toContain('Intro')
    expect(html).toContain('<h2 id="first">First<a class="anch" href="#first"')
    expect(html).toContain('<h2 id="second">')
    expect(html).toContain('<section class="history" id="history">')
    expect(html).toContain('<footer class="doc">')
  })

  it('leaves the contents out of short documents and the label off personal ones', () => {
    const html = render(doc('# Song\n\n## Verse\n\nline one\nline two\n'))
    expect(html).not.toContain('class="rail"')
    expect(html).not.toContain('class="kind"')
    // no Archetype: single newlines are line breaks, as in Obsidian
    expect(html).toContain('line one<br>')
  })

  it('labels unsnapshotted canonical changes as a draft after the saved revision', () => {
    const p = doc('# Plan\n\n## Section\n\nSaved body.\n')
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('Saved body.', 'Unsaved draft body.'))
    const html = render(p)
    expect(html).toContain('<span class="rev-label">Draft after r001</span>')
    expect(html).toContain('Unsaved changes since r001')
    expect(html).not.toContain('What changed since')
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
    expect(html).toContain('<dl class="verdict"><dt>Works?</dt><dd>Yes</dd>')
    expect(html).toContain('<span class="sev c">Critical</span>')
    expect(html).toContain('<summary>More (1)</summary>')
    expect(html).toContain('<span class="sev l">Low</span>')
    expect(html).toContain('<ol class="timeline">')
    expect(html).toContain('<span class="status next">next</span>')
    expect(html).toContain('<span class="status later">later</span>')
  })

  it('computes a severity strip and auto-counts the collapsed group', () => {
    const p = doc('# T\n\n## S\n\n::: findings\n- CRIT :: a\n- HIGH :: b\n- HIGH :: c\n@collapse Lower severity\n- MED :: d\n- LOW :: e\n:::\n')
    const html = render(p)
    expect(html).toContain('<div class="tally">')
    expect(html).toContain('<span class="c"><b>1</b> critical</span>')
    expect(html).toContain('<span class="h"><b>2</b> high</span>')
    // agent omitted the count; renderer appends it
    expect(html).toContain('<summary>Lower severity (2)</summary>')
  })

  it('computes a timeline progress line', () => {
    const p = doc('# T\n\n## S\n\n::: timeline\n1. **One** [done] — a\n2. **Two** [done] — b\n3. **Three** [next] — c\n4. **Four** [later] — d\n:::\n')
    const html = render(p)
    expect(html).toContain('<div class="progress">')
    expect(html).toContain('aria-valuemax="4" aria-valuenow="2" aria-label="Sequence progress"')
    expect(html).toContain('2 of 4 done · 1 next')
    expect(html).toContain('<li class="is-done"><span class="ph">1</span>')
  })

  it('shows progress once a phase is next, and none for an unstarted plan', () => {
    const p = doc('# T\n\n## S\n\n::: timeline\n1. **One** [next] — a\n2. **Two** [later] — b\n:::\n')
    expect(render(p)).toContain('0 of 2 done · 1 next')
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('[next]', '[later]'))
    // the traces template still shows the earlier timeline, so look only at the page body
    expect(render(p).split('<main>')[1].split('</main>')[0]).not.toContain('class="progress"')
  })

  it('renders figure aria as a figcaption and uses a time element for the date', () => {
    const p = doc('# T\n\n## S\n\n::: figure aria="the flow"\n<svg viewBox="0 0 10 10"><rect class="nodebox" width="10" height="10"/></svg>\n:::\n')
    const html = render(p)
    expect(html).toContain('<figcaption>the flow</figcaption>')
    expect(html).toMatch(/<time datetime="\d{4}-\d{2}-\d{2}">\d{1,2} [A-Z][a-z]{2} \d{4}<\/time>/)
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

  it('has one palette with a scheme toggle, and ignores legacy Palette frontmatter', () => {
    const p = path.join(dir, 'Other.md')
    fs.writeFileSync(p, '---\nPalette: mist\n---\n# T2\n\n## S\n\nx\n')
    snapshot(p, { summary: 's' })
    const html = render(p)
    expect(html).toContain('data-scheme-toggle')
    expect(html).not.toContain('data-palette')
    expect(html).not.toContain('data-p=')
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

  it('renders a checklist with a computed coverage strip', () => {
    const html = render(doc('# T\n\n## S\n\n::: checklist\n- [x] tests green\n- [ ] npm publish {#c-npm}\n- [X] docs updated\n:::\n'))
    expect(html).toContain('aria-valuemax="3" aria-valuenow="2" aria-label="Checklist progress"')
    expect(html).toContain('2 of 3 done')
    expect(html).toContain('<ul class="checklist">')
    expect(html).toContain('<li class="done">')
    expect(html).toContain('<li class="open" id="c-npm">')
    expect(html).toContain('href="#c-npm"')
    expect(html).not.toContain('{#c-npm}')
  })

  it('renders an options scorecard and highlights the pick', () => {
    const html = render(doc('# T\n\n## S\n\n::: options criteria="Latency, Memory"\n- **SQLite** [pick] :: 120ms :: 3× RSS\n- **Postgres** :: 800ms :: 1× RSS\n:::\n'))
    expect(html).toContain('<table class="options">')
    expect(html).toContain('<th>Option</th><th>Latency</th><th>Memory</th>')
    expect(html).toContain('<tr class="pick"><td><strong>SQLite</strong> <span class="pick-chip">Pick</span></td><td>120ms</td>')
    expect(html).toContain('<tr><td><strong>Postgres</strong></td>')
    expect(html).not.toContain('[pick]')
  })

  it('requires criteria on options', () => {
    expect(() => render(doc('# T\n\n## S\n\n::: options\n- **A** :: x\n:::\n')))
      .toThrow('options needs criteria=')
  })

  it('marks a superseded decision and links its replacement', () => {
    const html = render(doc('# T\n\n## S\n\n::: callout decision id=d-old superseded-by=d-new\n**Old call.** Rationale.\n:::\n\n::: callout decision id=d-new\n**New call.** Better.\n:::\n'))
    expect(html).toContain('<div class="callout decision superseded" id="d-old"><span class="label">Superseded</span>')
    expect(html).toContain('Replaced by <a href="#d-new">d-new</a>.')
    expect(html).toContain('<div class="callout decision" id="d-new"><span class="label">Decision</span>')
  })

  it('gives findings and timeline phases stable item anchors', () => {
    const html = render(doc('# T\n\n## S\n\n::: findings\n- HIGH :: disk full loses draft {#f-disk}\n:::\n\n::: timeline\n1. **Viewer** [next] {#p-viewer} — build it\n:::\n'))
    expect(html).toContain('<div class="finding" id="f-disk">')
    expect(html).toContain('href="#f-disk"')
    expect(html).toContain('<li id="p-viewer">')
    expect(html).toContain('href="#p-viewer"')
    expect(html).toContain('<span class="status next">next</span>')
    expect(html).toContain('<p>build it</p>')
    expect(html).not.toContain('{#')
  })

  it('lays out a flow directive as a sanitized figure', () => {
    const html = render(doc('# T\n\n## S\n\n::: flow aria="plan to render"\nPLAN.md -> CLI -> plan.html\naccent: CLI\n:::\n'))
    expect(html).toContain('<figure class="diagram" role="img" aria-label="plan to render">')
    expect(html).toContain('<figcaption>plan to render</figcaption>')
    expect(html).toContain('class="accentbox"')
    expect(html).toContain('marker-end="url(#arr)"')
  })

  it('renders removed stub directives as literal text', () => {
    const html = render(doc('# T\n\n## S\n\n::: compare\n| a |\n:::\n'))
    expect(html).toContain('::: compare')
  })

  it('dots changed TOC sections and appends glance deltas to the changes summary', () => {
    const p = doc('# T\n\n## Alpha\n\nstable prose\n\n## Beta\n\n::: timeline\n1. **One** [next] — a\n:::\n\n## Gamma\n\nend\n')
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('[next]', '[done]'))
    snapshot(p, { summary: 'phase one done', author: 'test' })
    const html = render(p)
    // one dot in the rail, one in the narrow-screen contents
    expect(html.match(/class="chg"/g)).toHaveLength(2)
    const betaEntry = html.split('href="#beta"')[1].split('</li>')[0]
    expect(betaEntry).toContain('class="chg"')
    expect(html).toContain('What changed since r001<span class="delta"> · +1 done · −1 next</span>')
  })

  it('tracks draft changes against the latest snapshot in the glance layer', () => {
    const p = doc('# T\n\n## Alpha\n\nstable\n\n## Beta\n\n::: findings\n- HIGH :: risky {#f-1}\n:::\n\n## Gamma\n\nend\n')
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('- HIGH :: risky {#f-1}\n', ''))
    const html = render(p)
    expect(html).toContain('Unsaved changes since r001<span class="delta"> · −1 high</span>')
    const betaEntry = html.split('href="#beta"')[1].split('</li>')[0]
    expect(betaEntry).toContain('class="chg"')
  })

  it('shows no change marks on a first revision', () => {
    const html = render(doc('# T\n\n## Alpha\n\ntext\n'))
    expect(html).not.toContain('class="chg"')
    expect(html).not.toContain('class="delta"')
  })
})
