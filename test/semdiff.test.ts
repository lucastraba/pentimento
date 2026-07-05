import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parse, stringify } from 'yaml'
import { snapshot } from '../src/core.js'
import { render, renderDiffPage } from '../src/render.js'
import { renderDiffHtml, splitBlocks } from '../src/semdiff.js'
import { verifyDoc } from '../src/verify.js'

describe('splitBlocks', () => {
  it('keeps containers and fences atomic', () => {
    const blocks = splitBlocks('Para one.\n\n::: callout info\ntext\n\nmore\n:::\n\n```js\na\n\nb\n```\n\nPara two.')
    expect(blocks).toHaveLength(4)
    expect(blocks[1]).toContain('::: callout info')
    expect(blocks[1]).toContain('more')
    expect(blocks[2]).toContain('```js')
  })
})

describe('renderDiffHtml', () => {
  it('marks word-level changes inside a rewritten paragraph', () => {
    const html = renderDiffHtml('The quick brown fox jumps.', 'The quick red fox leaps.')
    expect(html).toContain('<del>brown</del>')
    expect(html).toContain('<ins>red</ins>')
    expect(html).toContain('quick')
    expect(html).not.toContain('<del>quick</del>')
  })

  it('collapses unchanged runs and shows heading context', () => {
    const oldB = '## Alpha\n\none\n\ntwo\n\n## Beta\n\nold text here\n'
    const newB = '## Alpha\n\none\n\ntwo\n\n## Beta\n\nnew text here\n'
    const html = renderDiffHtml(oldB, newB)
    expect(html).toContain('unchanged block')
    expect(html).toContain('<div class="rdiff-ctx">## Beta</div>')
    expect(html).toContain('<del>old</del>')
    expect(html).toContain('<ins>new</ins>')
  })

  it('shows whole added/removed blocks', () => {
    const html = renderDiffHtml('stays\n', 'stays\n\nBrand new paragraph.\n')
    expect(html).toContain('<ins>Brand new paragraph.</ins>')
  })

  it('reports metadata-only changes honestly', () => {
    expect(renderDiffHtml('same\n', 'same\n')).toContain('No content changes')
  })
})

describe('what-changed integration', () => {
  let dir: string
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vellum-wc-')) })
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

  it('embeds a collapsible diff of the latest revision in the render', () => {
    const p = path.join(dir, 'Plan.md')
    fs.writeFileSync(p, '# T\n\n## S\n\noriginal wording here\n')
    snapshot(p, { summary: 'one' })
    expect(render(p)).not.toContain('What changed')
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('original wording', 'revised wording'))
    snapshot(p, { summary: 'two' })
    const html = render(p)
    expect(html).toContain('What changed in r002 (vs r001)')
    expect(html).toContain('<del>original</del>')
    expect(html).toContain('<ins>revised</ins>')
  })

  it('renders a standalone diff page between named revisions', () => {
    const p = path.join(dir, 'Plan.md')
    fs.writeFileSync(p, '# T\n\n## S\n\nfirst version\n')
    snapshot(p, { summary: 'one' })
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('first version', 'second version'))
    snapshot(p, { summary: 'two' })
    const page = renderDiffPage(p, 'r001', 'r002')
    expect(page).toMatch(/^<!doctype html>/)
    expect(page).toContain('r001 → r002')
    expect(page).toContain('<del>first</del>')
    expect(page).toContain('<ins>second</ins>')
  })
})

describe('verify', () => {
  let dir: string
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vellum-verify-')) })
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

  it('passes a healthy document', () => {
    const p = path.join(dir, 'Plan.md')
    fs.writeFileSync(p, '# T\n\n## S\n\nbody text long enough to not be a stub\n')
    snapshot(p, { summary: 'one' })
    expect(verifyDoc(p)).toEqual([])
  })

  it('catches a phantom revision and frontmatter drift (the Pandora failure modes)', () => {
    const p = path.join(dir, 'Plan.md')
    fs.writeFileSync(p, '# T\n\n## S\n\nbody text long enough to not be a stub\n')
    snapshot(p, { summary: 'one' })
    // phantom: meta claims r002 with no file; canonical claims r002 too
    const metaPath = path.join(dir, '.history/Plan/meta.yml')
    const meta = parse(fs.readFileSync(metaPath, 'utf8'))
    meta.revisions.push({ id: 'r002', created_at: '2026-07-05', author: 'x', summary: 'phantom' })
    fs.writeFileSync(metaPath, stringify(meta))
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('Current Revision: r001', 'Current Revision: r002'))
    const issues = verifyDoc(p)
    expect(issues.some((i) => i.level === 'error' && i.message.includes('r002.md does not exist'))).toBe(true)
    expect(issues.some((i) => i.level === 'error' && i.message.includes('no snapshot file'))).toBe(true)
  })

  it('flags stub snapshots', () => {
    const p = path.join(dir, 'Plan.md')
    fs.writeFileSync(p, '# T\n\n## S\n\nbody text long enough to not be a stub\n')
    snapshot(p, { summary: 'one' })
    fs.writeFileSync(path.join(dir, '.history/Plan/r001.md'), '# stub\n')
    const issues = verifyDoc(p)
    expect(issues.some((i) => i.level === 'warn' && i.message.includes('stub'))).toBe(true)
  })
})
