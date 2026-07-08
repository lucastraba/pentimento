import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { addComment, extractInlineComments, loadDoc, readMeta, resolveComment, snapshot } from '../src/core.js'
import { render } from '../src/render.js'
import { createApp } from '../src/viewer.js'

let dir: string
let p: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pentimento-comments-'))
  p = path.join(dir, 'Plan.md')
  fs.writeFileSync(p, '# T\n\n## Section One <!-- id: one -->\n\nSome body text that is long enough.\n')
  snapshot(p, { summary: 'first', author: 'test' })
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('comments core', () => {
  it('adds and resolves comments with sequential ids', () => {
    const a = addComment(p, { text: 'first note', anchor: '#one', author: 'lucas' })
    const b = addComment(p, { text: 'second note', quote: 'body text' })
    expect(a.id).toMatch(/^c-\d{4}-\d{2}-\d{2}-001$/)
    expect(b.id.endsWith('-002')).toBe(true)
    const resolved = resolveComment(p, a.id, 'r002')
    expect(resolved.status).toBe('resolved')
    expect(resolved.resolved_in).toBe('r002')
    const meta = readMeta(loadDoc(p).historyDir)
    expect(meta.comments).toHaveLength(2)
    expect(meta.comments.filter((c) => c.status === 'open')).toHaveLength(1)
  })

  it('throws on unknown comment ids', () => {
    expect(() => resolveComment(p, 'c-nope')).toThrow(/no comment/)
  })
})

describe('inline %% @c %% extraction', () => {
  it('anchors to the nearest heading and cleans the source', () => {
    const { cleaned, found } = extractInlineComments(
      '# T\n\n## Alpha <!-- id: alpha -->\n\ntext %% @c: fix this %% more\n\n## Beta\n\nother %% @c: and this %%\n')
    expect(found).toEqual([
      { text: 'fix this', anchor: '#alpha' },
      { text: 'and this', anchor: '#beta' },
    ])
    expect(cleaned).not.toContain('%%')
    expect(cleaned).toContain('text more')
  })

  it('extracts into meta.yml at snapshot time and removes from canonical and history', () => {
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('long enough.', 'long enough. %% @c: tighten %%'))
    const res = snapshot(p, { summary: 'second', author: 'lucas' })
    const doc = loadDoc(p)
    expect(doc.raw).not.toContain('%%')
    expect(fs.readFileSync(res.historyFile, 'utf8')).not.toContain('%%')
    const meta = readMeta(doc.historyDir)
    expect(meta.comments).toHaveLength(1)
    expect(meta.comments[0]).toMatchObject({ text: 'tighten', anchor: '#one', status: 'open', author: 'lucas' })
  })
})

describe('comments in render and viewer', () => {
  it('renders an open-comments panel; resolved comments disappear', () => {
    const c = addComment(p, { text: 'needs work', anchor: '#one', quote: 'body text' })
    let html = render(p)
    expect(html).toContain('1 open comment')
    expect(html).toContain('needs work')
    expect(html).toContain('<blockquote>body text</blockquote>')
    resolveComment(p, c.id)
    html = render(p)
    expect(html).not.toContain('open comment')
  })

  it('escapes hostile comment text instead of rendering it as HTML', () => {
    addComment(p, { text: '<a/onclick=alert(1)>x</a> [y](javascript:alert(1)) <img src=x onerror=alert(1)>' })
    const html = render(p)
    expect(html).not.toContain('<a/onclick')
    expect(html).not.toContain('<img')
    expect(html).not.toMatch(/href\s*=\s*"?javascript:/i)
    expect(html).toContain('&lt;a/onclick')
  })

  it('accepts comments over POST /api/comment and resolves over /api/resolve', async () => {
    const { app } = createApp(dir, { author: 'lucas' })
    const res = await app.request('/api/comment', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rel: 'Plan.md', text: 'from the viewer', anchor: '#one', quote: 'body text', prefix: 'Some ', suffix: ' that' }),
    })
    expect(res.status).toBe(200)
    const entry = await res.json()
    expect(entry.author).toBe('lucas')
    const page = await (await app.request('/doc/Plan.md')).text()
    expect(page).toContain('window.__pentimento')
    expect(page).toContain('from the viewer')
    const resolveRes = await app.request('/api/resolve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rel: 'Plan.md', id: entry.id }),
    })
    expect(resolveRes.status).toBe(200)
    expect(readMeta(loadDoc(p).historyDir).comments[0].status).toBe('resolved')
  })

  it('rejects empty text and unknown docs', async () => {
    const { app } = createApp(dir)
    const bad = await app.request('/api/comment', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rel: 'Plan.md', text: '   ' }),
    })
    expect(bad.status).toBe(400)
    const nope = await app.request('/api/comment', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rel: '../outside.md', text: 'x' }),
    })
    expect(nope.status).toBe(404)
  })

  it('disables commenting on historical revisions', async () => {
    const { app } = createApp(dir)
    const page = await (await app.request('/doc/Plan.md?rev=r001')).text()
    expect(page).toContain('"canComment":false')
  })
})
