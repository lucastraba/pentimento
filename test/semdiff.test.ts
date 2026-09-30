import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parse, stringify } from 'yaml'
import { snapshot } from '../src/core.js'
import { render, renderDiffPage } from '../src/render.js'
import {
  collectCuttings, describeChanges, renderDiffHtml, splitBlocks, TRACE, tracePlan,
} from '../src/semdiff.js'
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
    expect(html).toContain('<div class="rdiff-ctx">Beta</div>')
    expect(html).toContain('<del>old</del>')
    expect(html).toContain('<ins>new</ins>')
  })

  it('shows whole added/removed blocks', () => {
    const html = renderDiffHtml('stays\n', 'stays\n\nBrand new paragraph.\n')
    expect(html).toContain('<ins>Brand new paragraph.</ins>')
  })

  it('ignores heading comments', () => {
    expect(renderDiffHtml('## A <!-- id: a; eyebrow: X -->\n\ntext\n', '## A <!-- id: a -->\n\ntext\n')).toContain('No content changes')
  })

  it('reports metadata-only changes honestly', () => {
    expect(renderDiffHtml('same\n', 'same\n')).toContain('No content changes')
  })
})

describe('line-shaped blocks', () => {
  it('diffs stanzas line by line', () => {
    const html = renderDiffHtml('first line\nsecond line\nthird line', 'first line\na new second\nthird line')
    expect(html).toContain('first line\n')
    expect(html).toContain('<del>second line</del>\n<ins>a new second</ins>')
  })
})

describe('tracePlan', () => {
  it('marks changed words inline where wrapping is safe', () => {
    const parts = tracePlan('The gulls were arguing over bread.\n', 'The gulls fought over bread.\n')
    expect(parts).toHaveLength(1)
    expect(parts[0].kind).toBe('inline')
    expect(parts[0].text).toContain(`${TRACE.delOpen}were arguing${TRACE.delClose}`)
    expect(parts[0].text).toContain(`${TRACE.insOpen}fought${TRACE.insClose}`)
  })

  it('falls back to whole blocks when a change would split markdown', () => {
    const parts = tracePlan('A [link](https://a.example) here.\n', 'A [link](https://b.example) here.\n')
    expect(parts.map((p) => p.kind)).toEqual(['del', 'add'])
  })

  it('keeps a changed directive whole, with the old one behind a fold', () => {
    const parts = tracePlan('::: timeline\n1. **A** [next] — x\n:::\n', '::: timeline\n1. **A** [done] — x\n:::\n')
    expect(parts).toEqual([{ kind: 'swap', old: '::: timeline\n1. **A** [next] — x\n:::', text: '::: timeline\n1. **A** [done] — x\n:::' }])
  })

  it('shows a removed section heading as a ghost, not a heading', () => {
    const parts = tracePlan('## Keep\n\nx\n\n## Bridge\n\ngone words here\n', '## Keep\n\nx\n')
    expect(parts).toContainEqual({ kind: 'del', text: '## Bridge', heading: 'Bridge' })
  })
})

describe('describeChanges', () => {
  const song = '## Verse\n\nthe ferry left at nine\nwe laughed about it\n\n## Chorus\n\nharbor lights harbor lights\nkeep the water gold\n\n## Bridge\n\nmaybe it is the tide\n'
  it('names the parts that moved', () => {
    expect(describeChanges(null, song)).toBe('First draft')
    expect(describeChanges(song, song.replace('we laughed about it', 'we laughed about it all'))).toBe('Edited Verse')
    expect(describeChanges(song, song.replace('harbor lights harbor lights\nkeep the water gold', 'so let the harbor burn\nlet the last boat slip'))).toBe('Rewrote Chorus')
    expect(describeChanges(song, song.replace('\n## Bridge\n\nmaybe it is the tide\n', ''))).toBe('Removed Bridge')
    expect(describeChanges(song, song)).toBe('No content changes')
  })
})

describe('collectCuttings', () => {
  it('keeps passages cut or replaced along the way, newest first, unless restored', () => {
    const r1 = '## Chorus\n\nharbor lights harbor lights keep the water gold\n\n## Bridge\n\nmaybe it is the tide or the wine\n'
    const r2 = '## Chorus\n\nso let the harbor burn its lamps tonight\n\n## Bridge\n\nmaybe it is the tide or the wine\n'
    const r3 = '## Chorus\n\nso let the harbor burn its lamps tonight\n'
    const cuts = collectCuttings([{ id: 'r001', body: r1 }, { id: 'r002', body: r2 }, { id: 'r003', body: r3 }])
    expect(cuts.map((c) => [c.cutIn, c.section])).toEqual([['r003', 'Bridge'], ['r002', 'Chorus']])
    const restored = collectCuttings([{ id: 'r001', body: r1 }, { id: 'r002', body: r2 }, { id: 'r003', body: r1 }])
    // the first chorus came back, so only the replaced one counts as cut
    expect(restored.map((c) => c.text)).toEqual(['so let the harbor burn its lamps tonight'])
  })
})

describe('what-changed integration', () => {
  let dir: string
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pentimento-wc-')) })
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

  it('embeds a collapsible diff of the latest revision in the render', () => {
    const p = path.join(dir, 'Plan.md')
    fs.writeFileSync(p, '# T\n\n## S\n\noriginal wording here\n')
    snapshot(p, { summary: 'one' })
    expect(render(p)).not.toContain('What changed')
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('original wording', 'revised wording'))
    snapshot(p, { summary: 'two' })
    const html = render(p)
    expect(html).toContain('What changed since r001')
    expect(html).toContain('<del>original</del>')
    expect(html).toContain('<ins>revised</ins>')
    // the traces view ships as a template the reader can toggle
    expect(html).toContain('<template id="traces-tpl">')
    expect(html).toContain('<del class="tr">original</del>')
  })

  it('lists the notes a draft answered next to what changed', async () => {
    const { addComment, resolveComment } = await import('../src/core.js')
    const p = path.join(dir, 'Plan.md')
    fs.writeFileSync(p, '# T\n\n## S\n\ncompaction runs whenever\n')
    snapshot(p, { summary: 'one' })
    const c = addComment(p, { text: 'When does compaction run?', quote: 'compaction runs' })
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('whenever', 'at idle'))
    snapshot(p, { summary: 'two' })
    resolveComment(p, c.id, 'r002')
    const html = render(p)
    expect(html).toContain('1 note answered')
    expect(html).toContain('Your notes this draft answered')
    expect(html).toContain('When does compaction run?')
  })

  it('computes a summary when snapshot gets none', () => {
    const p = path.join(dir, 'Song.md')
    fs.writeFileSync(p, '# Song\n\n## Chorus\n\nold chorus line one\nold chorus line two\n')
    snapshot(p, {})
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('old chorus line one\nold chorus line two', 'brand new words\nsomething else entirely'))
    snapshot(p, {})
    const meta = parse(fs.readFileSync(path.join(dir, '.history/Song/meta.yml'), 'utf8'))
    expect(meta.revisions.map((r: { summary: string }) => r.summary)).toEqual(['First draft', 'Rewrote Chorus'])
    const html = render(p)
    expect(html).toContain('<section class="cuttings" id="cuttings">')
    expect(html).toContain('old chorus line one\nold chorus line two')
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
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pentimento-verify-')) })
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
