import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  addComment, canonicalRevisionState, describeImageComment, loadDoc, readMeta, revert, snapshot, untrack,
} from '../src/core.js'
import { findImageRefs, imageBlock, keyImages, stripImageMarks } from '../src/imageref.js'
import { lintDoc } from '../src/lint.js'
import { commentImage, parseMeta, revisionImages, serializeMeta } from '../src/model.js'
import { render, renderDiffPage, renderRevisionHtml } from '../src/render.js'
import { renderDiffHtml } from '../src/semdiff.js'
import { verifyDoc } from '../src/verify.js'
import { createApp } from '../src/viewer.js'

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pentimento-images-'))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

const write = (name: string, content: string | Buffer): string => {
  const p = path.join(dir, name)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, content)
  return p
}

const PLAN = '---\nArchetype: plan\n---\n# Settings\n\n> A mock.\n\n## Layout\n\n![Settings page](mocks/settings.png "The settings page")\n\nSome prose about it.\n'

const assets = (): string[] => {
  const d = path.join(dir, '.history', 'Plan', 'assets')
  return fs.existsSync(d) ? fs.readdirSync(d).sort() : []
}

/** Bytes that sniff as a PNG, distinct per label. */
const img = (label: string): Buffer => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(label)])
const base64 = (label: string): string => img(label).toString('base64')

describe('image references', () => {
  it('finds markdown images and Obsidian embeds, and skips code', () => {
    const refs = findImageRefs([
      '![A mock](./mocks/a.png "Title")',
      '![Spaced](<mocks/my file.png>) and ![Encoded](mocks/my%20file.png)',
      '![[shot.png|300]] ![[sub/other.jpeg|The other one]] ![[Some note]]',
      '`![not](code.png)` \\![escaped](no.png)',
      '```',
      '![fenced](no.png)',
      '```',
    ].join('\n'))
    expect(refs.map((r) => r.ref)).toEqual([
      'mocks/a.png', 'mocks/my file.png', 'mocks/my file.png', '[[shot.png]]', '[[sub/other.jpeg]]', '[[Some note]]',
    ])
    expect(refs[0]).toMatchObject({ alt: 'A mock', title: 'Title', embed: false })
    // a number after the pipe is a width in Obsidian, not alt text
    expect(refs[3].alt).toBe('shot')
    expect(refs[4].alt).toBe('The other one')
  })

  it('keys a body with a marker after each image, and strips it back off', () => {
    const body = 'Before ![a](a.png) after.\n\n![b](b.png)\n'
    const keyed = keyImages(body, (ref) => (ref.ref === 'b.png' ? '0123456789abcdef.png' : null))
    expect(keyed).not.toBe(body)
    expect(stripImageMarks(keyed)).toBe(body)
    expect(imageBlock(keyed.split('\n\n')[1])).toMatchObject({ asset: '0123456789abcdef.png' })
    expect(imageBlock('Before ![a](a.png) after.')).toBeNull()
  })
})

describe('rendering images', () => {
  it('shows a local image as a figure that carries its data, once', () => {
    write('mocks/settings.png', img('first image'))
    const p = write('Plan.md', `${PLAN}\nAnd again inline: ![again](mocks/settings.png).\n`)
    const html = render(p)
    expect(html).toContain('<figure class="shot"><img src="data:image/png;base64,')
    expect(html).toContain('<figcaption>The settings page</figcaption>')
    // the second copy points at the first instead of carrying the bytes again
    expect(html.split(base64('first image')).length - 1).toBe(1)
    expect(html).toMatch(/<img data-asset="[0-9a-f]{16}\.png" alt="again"/)
    expect(html).toContain("img-src data:;")
  })

  it('shows a missing image, a remote one, and one outside the folder without loading them', () => {
    fs.mkdirSync(path.join(dir, 'doc'))
    write('outside.png', img('not inside'))
    const p = write('doc/Plan.md', '# T\n\n## A\n\n![gone](nope.png)\n\n![far](https://example.com/x.png)\n\n![up](../outside.png)\n')
    const html = render(p)
    expect(html).toContain('<span class="image-missing" title="Image not found: nope.png">gone</span>')
    expect(html).toContain('<a class="image-link" href="https://example.com/x.png">far</a>')
    expect(html).toContain('<span class="image-missing" title="Image not found: ../outside.png">up</span>')
    expect(html).not.toContain(base64('not inside'))
  })

  it('finds Obsidian embeds in the attachment folder and anywhere in the vault', () => {
    write('.obsidian/app.json', JSON.stringify({ attachmentFolderPath: 'Attachments' }))
    write('Attachments/one.png', img('from attachments'))
    write('deep/folder/two.png', img('found by name'))
    const p = write('notes/Song.md', 'A verse\n\n![[one.png]]\n\n![[two.png|200]]\n\n![[Some note]]\n')
    const html = render(p)
    expect(html).toContain(base64('from attachments'))
    expect(html).toContain(base64('found by name'))
    expect(html).toContain('alt="two"')
    expect(html).toContain('<span class="embed">Some note</span>')
  })

  it('keeps a badge inside a link one link, and names a missing embed by its file', () => {
    const p = write('Plan.md', '# T\n\n## A\n\n[![CI](https://img.shields.io/ci.svg)](https://example.com/ci)\n\nA cover: ![[cover.png]]\n')
    const html = render(p)
    expect(html).toContain('<a href="https://example.com/ci"><span class="image-link">CI</span></a>')
    expect(html).toContain('<span class="image-missing" title="Image not found: cover.png">cover.png</span>')
  })

  it('diffs documents without images exactly as before', () => {
    // the plugin calls renderDiffHtml on plain bodies; no blank lines may appear between blocks
    const html = renderDiffHtml('# T\n\nOne line.\n\nTwo line.\n', '# T\n\nOne changed line.\n\nTwo line.\n')
    // what 0.12.1 returns for the same two bodies
    expect(html).toBe('<div class="rdiff-skip">1 unchanged block</div>\n<div class="rdiff-ctx">T</div>\n<div class="rdiff-block">One <ins>changed </ins>line.</div>\n<div class="rdiff-skip">1 unchanged block</div>')
  })

  it('never lets document text forge an image marker', () => {
    write('mocks/settings.png', img('real'))
    const p = write('Plan.md', '# T\n\n## A\n\nText aaaaaaaaaaaaaaaa.png here.\n')
    const html = render(p)
    expect(html).not.toContain('data-asset="aaaaaaaaaaaaaaaa.png"')
  })
})

describe('images in the history', () => {
  it('stores each image once and records which copy every draft saw', () => {
    write('mocks/settings.png', img('first image'))
    const p = write('Plan.md', PLAN)
    snapshot(p, { summary: 'one', author: 'test' })
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('Some prose', 'Other prose'))
    snapshot(p, { summary: 'two', author: 'test' })
    expect(assets()).toHaveLength(1)
    const meta = readMeta(loadDoc(p).historyDir)
    expect(meta.revisions[0].images).toEqual(meta.revisions[1].images)
    expect(Object.keys(meta.revisions[0].images!)).toEqual(['mocks/settings.png'])
  })

  it('treats a new screenshot at the same path as a change', () => {
    const shot = write('mocks/settings.png', img('first image'))
    const p = write('Plan.md', PLAN)
    snapshot(p, { summary: 'one', author: 'test' })
    fs.writeFileSync(shot, img('second image'))
    // the markdown didn't change, but the page has unsaved changes
    expect(canonicalRevisionState(loadDoc(p), readMeta(loadDoc(p).historyDir)).dirty).toBe(true)
    snapshot(p, { author: 'test' })
    const meta = readMeta(loadDoc(p).historyDir)
    expect(meta.revisions[1].summary).toBe('Edited Layout')
    expect(assets()).toHaveLength(2)

    const html = render(p)
    expect(html).toMatch(/<figure class="rdiff-shot was"><figcaption>r001<\/figcaption><img data-asset="[0-9a-f]{16}\.png"/)
    expect(html).toMatch(/<figure class="rdiff-shot now"><figcaption>r002<\/figcaption>/)
    // r001's image isn't in the current draft, so the page's store carries it
    expect(html).toContain('<template id="pentimento-images">')
    expect(html).toContain(base64('first image'))
    expect(html).toContain(base64('second image'))
    // traces fold the old image under the new one
    expect(html).toContain('<summary>As it was in r001</summary>')

    // stepping back to r001 shows r001's picture
    const old = renderRevisionHtml(p, 'r001')
    expect(old).toContain(base64('first image'))
    expect(old).not.toContain(base64('second image'))
  })

  it('lists a removed image under cuttings, with its picture', () => {
    write('mocks/settings.png', img('first image'))
    const p = write('Plan.md', PLAN)
    snapshot(p, { summary: 'one', author: 'test' })
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/!\[Settings page\][^\n]*\n\n/, ''))
    snapshot(p, { summary: 'two', author: 'test' })
    const html = render(p)
    expect(html).toContain('<img class="cutting-shot" data-asset=')
    expect(html).toContain('<pre class="cutting-text">![Settings page](mocks/settings.png &quot;The settings page&quot;)</pre>')
  })

  it('saves a draft whose image is missing, and says so', () => {
    const p = write('Plan.md', PLAN)
    const res = snapshot(p, { summary: 'one', author: 'test' })
    expect(res.missingImages).toEqual(['mocks/settings.png'])
    // recorded as "no picture here", which is different from a draft saved before drafts kept images
    expect(readMeta(loadDoc(p).historyDir).revisions[0].images).toEqual({})
    // so the image turning up later is an unsaved change, and r001 doesn't borrow it
    write('mocks/settings.png', img('arrived later'))
    expect(canonicalRevisionState(loadDoc(p), readMeta(loadDoc(p).historyDir)).dirty).toBe(true)
    expect(renderRevisionHtml(p, 'r001')).not.toContain(base64('arrived later'))
  })

  it('puts the draft\'s images back on revert, keeping the one it replaces', () => {
    const shot = write('mocks/settings.png', img('first image'))
    const p = write('Plan.md', PLAN)
    snapshot(p, { summary: 'one', author: 'test' })
    fs.writeFileSync(shot, img('second image'))
    snapshot(p, { summary: 'two', author: 'test' })
    fs.writeFileSync(shot, img('third image, never saved'))
    revert(p, 'r001', 'test')
    expect(fs.readFileSync(shot)).toEqual(img('first image'))
    expect(assets()).toHaveLength(3)
    const meta = readMeta(loadDoc(p).historyDir)
    expect(meta.revisions[2].images).toEqual(meta.revisions[0].images)
  })

  it('deletes stored images with the history on untrack', () => {
    const shot = write('mocks/settings.png', img('first image'))
    const p = write('Plan.md', PLAN)
    snapshot(p, { summary: 'one', author: 'test' })
    untrack(p)
    expect(fs.existsSync(path.join(dir, '.history'))).toBe(false)
    expect(fs.existsSync(shot)).toBe(true)
  })

  it('verify reports a draft whose stored image is gone', () => {
    write('mocks/settings.png', img('first image'))
    const p = write('Plan.md', PLAN)
    snapshot(p, { summary: 'one', author: 'test' })
    fs.rmSync(path.join(dir, '.history', 'Plan', 'assets'), { recursive: true })
    expect(verifyDoc(p).map((i) => i.message).join('\n')).toMatch(/r001 shows mocks\/settings\.png, but its saved copy assets\/[0-9a-f]{16}\.png is missing/)
  })

  it('keeps images entries through meta.yml, and reads past ones it does not understand', () => {
    const text = 'revisions:\n  - id: r001\n    created_at: 2026-10-02T10:00:00+02:00\n    author: a\n    summary: s\n    images:\n      mocks/a.png: 0123456789abcdef\ncomments: []\n'
    expect(serializeMeta(parseMeta(text, 'meta.yml'))).toContain('mocks/a.png: 0123456789abcdef')
    // a newer version, or a hand edit, must never make a history unreadable
    const odd = text.replace('mocks/a.png: 0123456789abcdef', 'mocks/a.png: 0123456789abcdef\n      b.avif: 00000000000000000000\n      c.png: null')
    const meta = parseMeta(odd, 'meta.yml')
    expect(revisionImages(meta.revisions[0])).toEqual({ 'mocks/a.png': '0123456789abcdef' })
    expect(serializeMeta(meta)).toContain('c.png: null')
  })

  it('renders a diff page with both versions of a changed image', () => {
    const shot = write('mocks/settings.png', img('first image'))
    const p = write('Plan.md', PLAN)
    snapshot(p, { summary: 'one', author: 'test' })
    fs.writeFileSync(shot, img('second image'))
    snapshot(p, { summary: 'two', author: 'test' })
    const html = renderDiffPage(p, 'r001', 'r002')
    expect(html).toContain('<figure class="rdiff-shot was"><figcaption>r001</figcaption>')
    expect(html).toContain(base64('first image'))
    expect(html).toContain(base64('second image'))
  })
})

describe('image lint', () => {
  it('warns about missing, remote, unlabelled, unsupported, and oversized images', () => {
    write('big.png', Buffer.concat([img(''), Buffer.alloc(1024 * 1024)]))
    write('doc.pdf', 'pdf')
    const p = write('Plan.md', '# T\n\n![](big.png)\n\n![gone](nope.png)\n\n![far](https://example.com/a.png)\n\n![pdf](doc.pdf)\n')
    const found = lintDoc(fs.readFileSync(p, 'utf8'), p)
    expect(found.map((f) => `${f.line} ${f.rule}`)).toEqual([
      '3 image-size', '3 image-alt', '5 image-missing', '7 image-remote', '9 image-type',
    ])
  })
})

describe('images in the viewer', () => {
  it('serves stored and current images by hash, sandboxed', async () => {
    const shot = write('mocks/settings.png', img('first image'))
    const p = write('Plan.md', PLAN)
    snapshot(p, { summary: 'one', author: 'test' })
    fs.writeFileSync(shot, img('unsaved image'))
    const { app } = createApp(dir)
    const page = await app.request('/doc/Plan.md')
    expect(page.headers.get('content-security-policy')).toContain("img-src 'self' data:")
    const html = await page.text()
    expect(html).not.toContain('base64,')
    const figure = /<figure class="shot"><img src="(\/asset\/Plan\.md\/[0-9a-f]{16}\.png)"/.exec(html)
    expect(figure).not.toBeNull()

    const current = await app.request(figure![1])
    expect(current.status).toBe(200)
    expect(current.headers.get('content-type')).toBe('image/png')
    expect(current.headers.get('content-security-policy')).toMatch(/^sandbox;/)
    expect(current.headers.get('cache-control')).toContain('immutable')
    expect(Buffer.from(await current.arrayBuffer())).toEqual(img('unsaved image'))

    const stored = readMeta(loadDoc(p).historyDir).revisions[0].images!['mocks/settings.png']
    expect(Buffer.from(await (await app.request(`/asset/Plan.md/${stored}.png`)).arrayBuffer())).toEqual(img('first image'))
    expect((await app.request('/asset/Plan.md/0000000000000000.png')).status).toBe(404)
    expect((await app.request('/asset/Plan.md/..%2F..%2Fetc%2Fpasswd')).status).toBe(404)
    expect((await app.request(`/asset/Nope.md/${stored}.png`)).status).toBe(404)
  })
})

describe('comments on images', () => {
  const setup = () => {
    write('mocks/settings.png', img('first image'))
    const p = write('Plan.md', PLAN)
    snapshot(p, { summary: 'one', author: 'test' })
    const hash = readMeta(loadDoc(p).historyDir).revisions[0].images!['mocks/settings.png']
    return { p, asset: `${hash}.png` }
  }
  const post = (app: ReturnType<typeof createApp>['app'], body: Record<string, unknown>) =>
    app.request('/api/comment', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

  it('stores the image a comment is on, with the reference taken from the document', async () => {
    const { p, asset } = setup()
    const { app } = createApp(dir)
    const res = await post(app, {
      rel: 'Plan.md', text: 'Move the toggle left', quote: 'Settings page', anchor: '#layout',
      image: { asset, box: { x: 0.1, y: 0.2, w: 0.3, h: 0.25 }, width: 1280, height: 800, ref: 'ignored.png' },
    })
    expect(res.status).toBe(200)
    const [c] = readMeta(loadDoc(p).historyDir).comments
    expect(c.image).toEqual({ ref: 'mocks/settings.png', asset, box: { x: 0.1, y: 0.2, w: 0.3, h: 0.25 }, width: 1280, height: 800 })
    const payload = await (await app.request('/api/comments?rel=Plan.md')).json() as { assets: Record<string, string> }
    expect(payload.assets[asset]).toBe('r001')
  })

  it('refuses an image that is not in the document, or a box outside the image', async () => {
    const { asset } = setup()
    const { app } = createApp(dir)
    expect((await post(app, { rel: 'Plan.md', text: 'x', image: { asset: '0000000000000000.png' } })).status).toBe(400)
    expect((await post(app, { rel: 'Plan.md', text: 'x', image: { asset, box: { x: 0.9, y: 0, w: 0.5, h: 0.5 } } })).status).toBe(400)
    expect((await post(app, { rel: 'Plan.md', text: 'x', image: { asset, width: -3 } })).status).toBe(400)
  })

  it('tells the agent which file to open and where the box is, in pixels', () => {
    const { p, asset } = setup()
    const box = addComment(p, { text: 'Too cramped', quote: 'Settings page', image: { ref: 'mocks/settings.png', asset, box: { x: 0.1, y: 0.25, w: 0.5, h: 0.25 }, width: 1200, height: 800 } })
    const whole = addComment(p, { text: 'Darker', image: { ref: 'mocks/settings.png', asset } })
    const lines = describeImageComment(p, box).join('\n')
    expect(lines).toContain('image: mocks/settings.png ("Settings page")')
    expect(lines).toMatch(new RegExp(`file: .*\\.history/Plan/assets/${asset.replace('.', '\\.')}`))
    expect(lines).toContain('on: box 120–720 × 200–400 of 1200 × 800')
    expect(describeImageComment(p, whole).join('\n')).toContain('on: the whole image')
  })

  it('reads past image marks it does not understand', () => {
    const text = 'revisions: []\ncomments:\n  - id: c-1\n    anchor: ""\n    text: t\n    status: open\n    created_at: 2026-10-02T10:00:00+02:00\n    author: a\n    resolved_in: null\n    image:\n      ref: a.png\n      asset: 0123456789abcdef.avif\n'
    const meta = parseMeta(text, 'meta.yml')
    expect(commentImage(meta.comments[0])).toBeUndefined()
    expect(serializeMeta(meta)).toContain('asset: 0123456789abcdef.avif')
  })
})

describe('pre-release review: image files', () => {
  it('only shows files that are images, whatever the reference says', async () => {
    write('secret.env', 'API_KEY=sk-live-123\n')
    write('ok.png', img('ok'))
    write('notes.txt.png', 'not a png at all')
    fs.symlinkSync(path.join(dir, 'secret.env'), path.join(dir, 'link.png'))
    const p = write('Plan.md', '# T\n\n## A\n\n![a](ok.png?/../secret.env)\n\n![b](link.png)\n\n![c](notes.txt.png)\n\n![d](ok.png#/../secret.env)\n')
    const html = render(p)
    expect(html).not.toContain(Buffer.from('API_KEY=sk-live-123\n').toString('base64'))
    expect(html).not.toContain(Buffer.from('not a png at all').toString('base64'))
    // `ok.png?/../secret.env` is `ok.png`
    expect(html).toContain(base64('ok'))
    const { app } = createApp(dir)
    const page = await (await app.request('/doc/Plan.md')).text()
    for (const [, url] of page.matchAll(/src="(\/asset\/[^"]+)"/g)) {
      expect(Buffer.from(await (await app.request(url)).arrayBuffer())).toEqual(img('ok'))
    }
    expect(lintDoc(fs.readFileSync(p, 'utf8'), p).map((f) => f.rule)).toEqual(['image-type', 'image-type'])
    snapshot(p, { summary: 'one', author: 'test' })
    for (const f of fs.readdirSync(path.join(dir, '.history', 'Plan', 'assets'))) {
      expect(fs.readFileSync(path.join(dir, '.history', 'Plan', 'assets', f))).toEqual(img('ok'))
    }
  })

  it('never reads or writes stored copies through links', async () => {
    write('secret.png', img('outside the history'))
    const p = write('Plan.md', '# T\n\n## A\n\n![s](shot.png)\n')
    snapshot(p, { summary: 'one', author: 'test' })
    // a hand-made history that points a stored copy at another file
    const assets = path.join(dir, '.history', 'Plan', 'assets')
    fs.mkdirSync(assets, { recursive: true })
    fs.symlinkSync(path.join(dir, 'secret.png'), path.join(assets, '0123456789abcdef.png'))
    const metaPath = path.join(dir, '.history', 'Plan', 'meta.yml')
    fs.writeFileSync(metaPath, fs.readFileSync(metaPath, 'utf8').replace('images: {}', 'images:\n      shot.png: 0123456789abcdef'))
    expect(renderRevisionHtml(p, 'r001')).not.toContain(base64('outside the history'))
    const { app } = createApp(dir)
    expect((await app.request('/asset/Plan.md/0123456789abcdef.png')).status).toBe(404)
  })

  it('keeps working when an image is unreadable or too large', () => {
    const shot = write('mocks/settings.png', img('first image'))
    const p = write('Plan.md', PLAN)
    snapshot(p, { summary: 'one', author: 'test' })
    fs.chmodSync(shot, 0o000)
    try {
      expect(() => render(p)).not.toThrow()
      expect(() => canonicalRevisionState(loadDoc(p), readMeta(loadDoc(p).historyDir))).not.toThrow()
      expect(snapshot(p, { summary: 'two', author: 'test' }).missingImages).toEqual(['mocks/settings.png'])
    } finally {
      fs.chmodSync(shot, 0o644)
    }
    fs.truncateSync(shot, 21 * 1024 * 1024)
    expect(() => render(p)).not.toThrow()
    expect(lintDoc(fs.readFileSync(p, 'utf8'), p).map((f) => f.rule)).toContain('image-size')
  })

  it('stores what it hashed, readable by everyone and executable by no one', () => {
    const shot = write('mocks/settings.png', img('first image'))
    fs.chmodSync(shot, 0o755)
    const p = write('Plan.md', PLAN)
    snapshot(p, { summary: 'one', author: 'test' })
    const [asset] = fs.readdirSync(path.join(dir, '.history', 'Plan', 'assets'))
    const stored = path.join(dir, '.history', 'Plan', 'assets', asset)
    expect(fs.statSync(stored).mode & 0o777).toBe(0o644)
    expect(verifyDoc(p).filter((i) => i.level === 'error')).toEqual([])
    fs.writeFileSync(stored, img('tampered'))
    expect(verifyDoc(p).map((i) => i.message).join('\n')).toContain('no longer matches its name')
  })
})

describe('pre-release review: revert', () => {
  const twoDrafts = () => {
    const shot = write('mocks/settings.png', img('first image'))
    const p = write('Plan.md', PLAN)
    snapshot(p, { summary: 'one', author: 'test' })
    fs.writeFileSync(shot, img('second image'))
    snapshot(p, { summary: 'two', author: 'test' })
    return { p, shot }
  }

  it('puts the images back as they were when it fails', () => {
    const { p, shot } = twoDrafts()
    fs.writeFileSync(shot, img('unsaved image'))
    // history and frontmatter disagree, so the snapshot refuses to write
    fs.writeFileSync(path.join(dir, '.history', 'Plan', 'r003.md'), 'in the way')
    expect(() => revert(p, 'r001', 'test')).toThrow(/already exists/)
    expect(fs.readFileSync(shot)).toEqual(img('unsaved image'))
  })

  it('never writes through a link, never for embeds, and says what it skipped', () => {
    const { p, shot } = twoDrafts()
    fs.renameSync(shot, path.join(dir, 'mocks', 'v2.png'))
    fs.symlinkSync(path.join(dir, 'mocks', 'v2.png'), shot)
    const res = revert(p, 'r001', 'test')
    expect(res.restoredImages).toEqual([])
    expect(res.skippedImages).toEqual([{ ref: 'mocks/settings.png', reason: 'it is a link or a folder now' }])
    expect(fs.readFileSync(path.join(dir, 'mocks', 'v2.png'))).toEqual(img('second image'))
  })

  it('reports the images it put back', () => {
    const { p, shot } = twoDrafts()
    const res = revert(p, 'r001', 'test')
    expect(res.restoredImages).toEqual([fs.realpathSync(shot)].map((f) => path.join(path.dirname(f), path.basename(shot))))
    expect(fs.readFileSync(shot)).toEqual(img('first image'))
    expect(fs.statSync(shot).mode & 0o777).toBe(0o644)
  })
})

describe('pre-release review: references read as markdown-it reads them', () => {
  it('finds the same images markdown-it renders, and none in code', async () => {
    const MarkdownIt = (await import('markdown-it')).default
    const corpus = [
      '![a](a.png) ![b](<my file.png> "T") ![c](c%20d.png) ![e](a&amp;b.png)',
      '![x][r]\n\n![y][]\n\n![r]\n\n[r]: <ref file.png> "Ref"\n[y]: y.png',
      '\\\\![esc](esc.png) and \\![not](not.png)',
      '![multi](\nmulti.png\n "t\\"q")',
      '![q](shot.png?v=2) ![h](shot.png#frag)',
      '> ```\n> ![quoted](no1.png)\n> ```\n\n- ```\n  ![listed](no2.png)\n  ```\n\n````\n```\n![nested](no3.png)\n````',
      '~~~\n![tilde](no4.png)\n```\nstill code\n~~~\n\n![after](after.png)',
      'Inline `![code](no5.png)` and ``![double](no6.png)`` spans.',
      '[![badge](badge.svg)](https://example.com) ![remote](https://example.com/r.png)',
    ]
    const md = new MarkdownIt()
    for (const text of corpus) {
      const rendered: string[] = []
      const walk = (tokens: ReturnType<typeof md.parse>): void => {
        for (const t of tokens) {
          if (t.type === 'image') rendered.push(decodeURI(t.attrGet('src')!).replace(/[?#].*$/, ''))
          if (t.children) walk(t.children)
        }
      }
      walk(md.parse(text, {}))
      expect(findImageRefs(text).map((r) => r.target), text).toEqual(rendered)
    }
  })

  it('reads an Obsidian embed in a table, where the pipe is escaped', () => {
    expect(findImageRefs('| ![[a.png\\|100]] | x |').map((r) => [r.ref, r.alt])).toEqual([['[[a.png]]', 'a']])
  })
})

describe('pre-release review: the viewer', () => {
  it('keeps only the numbers of a box, and serves images without reading them twice', async () => {
    write('mocks/settings.png', img('first image'))
    const p = write('Plan.md', PLAN)
    snapshot(p, { summary: 'one', author: 'test' })
    const asset = `${readMeta(loadDoc(p).historyDir).revisions[0].images!['mocks/settings.png']}.png`
    const { app } = createApp(dir)
    const res = await app.request('/api/comment', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rel: 'Plan.md', text: 'x', image: { asset, box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2, note: '<img src=x onerror=alert(1)>' } } }),
    })
    expect(res.status).toBe(200)
    expect(readMeta(loadDoc(p).historyDir).comments[0].image!.box).toEqual({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 })
    const first = await app.request(`/asset/Plan.md/${asset}`)
    expect(first.headers.get('cross-origin-resource-policy')).toBe('same-origin')
    expect(first.headers.get('etag')).toBe(`"${asset}"`)
    const again = await app.request(`/asset/Plan.md/${asset}`, { headers: { 'if-none-match': `"${asset}"` } })
    expect(again.status).toBe(304)
  })

  it('lists every document even when one has an unreadable image', async () => {
    const shot = write('mocks/settings.png', img('first image'))
    const p = write('Plan.md', PLAN)
    snapshot(p, { summary: 'one', author: 'test' })
    fs.chmodSync(shot, 0o000)
    try {
      const { app } = createApp(dir)
      const res = await app.request('/')
      expect(res.status).toBe(200)
      expect(await res.text()).toContain('Settings')
    } finally {
      fs.chmodSync(shot, 0o644)
    }
  })

  it('never loads an image from a comment, and never links an embed anywhere', () => {
    const p = write('Plan.md', '# T\n\n## A\n\n![[javascript:alert(1)//x.png]]\n')
    snapshot(p, { summary: 'one', author: 'test' })
    addComment(p, { text: 'see ![t](https://tracker.example/pixel.png)' })
    const html = render(p)
    // at most a link to it, which loads nothing
    expect(html).not.toMatch(/<img[^>]+tracker/)
    expect(html).not.toContain('href="javascript:')
  })
})

describe('pre-release review: image sizes', () => {
  it('reads width and height from PNG, JPEG, GIF, WebP, and SVG headers', () => {
    const png = Buffer.concat([img(''), Buffer.from([0, 0, 0, 13]), Buffer.from('IHDR'), Buffer.from([0, 0, 5, 0, 0, 0, 2, 208])])
    const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, 1, 44, 1, 144, 3])
    const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.from([64, 0, 32, 0])])
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8X'), Buffer.alloc(8), Buffer.from([99, 0, 0, 49, 0, 0])])
    const svg = Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80px"></svg>')
    const files: Record<string, Buffer> = { 'a.png': png, 'b.jpg': jpg, 'c.gif': gif, 'd.webp': webp, 'e.svg': svg }
    for (const [name, bytes] of Object.entries(files)) write(`shots/${name}`, bytes)
    const p = write('Plan.md', `# T\n\n## A\n\n${Object.keys(files).map((n) => `![${n}](shots/${n})`).join('\n\n')}\n`)
    const html = render(p)
    const size = (alt: string) => new RegExp(`<img [^>]*width="(\\d+)" height="(\\d+)" alt="${alt.replace('.', '\\.')}"`).exec(html)?.slice(1).join('x')
    expect(size('a.png')).toBe('1280x720')
    expect(size('b.jpg')).toBe('400x300')
    expect(size('c.gif')).toBe('64x32')
    expect(size('d.webp')).toBe('100x50')
    expect(size('e.svg')).toBe('120x80')
  })
})
