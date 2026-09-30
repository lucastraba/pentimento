import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { addComment, addReply, deleteComment, extractInlineComments, loadDoc, readMeta, reopenComment, resolveComment, snapshot } from '../src/core.js'
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
    const resolved = resolveComment(p, a.id, 'r001')
    expect(resolved.status).toBe('resolved')
    expect(resolved.resolved_in).toBe('r001')
    const meta = readMeta(loadDoc(p).historyDir)
    expect(meta.comments).toHaveLength(2)
    expect(meta.comments.filter((c) => c.status === 'open')).toHaveLength(1)
  })

  it('throws on unknown comment ids', () => {
    expect(() => resolveComment(p, 'c-nope')).toThrow(/no comment/)
  })

  it('reopens a resolved comment', () => {
    const c = addComment(p, { text: 'note' })
    resolveComment(p, c.id, 'r001')
    const reopened = reopenComment(p, c.id)
    expect(reopened.status).toBe('open')
    expect(reopened.resolved_in).toBeNull()
  })

  it('deletes a comment and renumbers nothing', () => {
    const a = addComment(p, { text: 'keep' })
    const b = addComment(p, { text: 'drop' })
    const removed = deleteComment(p, b.id)
    expect(removed.id).toBe(b.id)
    const meta = readMeta(loadDoc(p).historyDir)
    expect(meta.comments.map((c) => c.id)).toEqual([a.id])
    expect(() => deleteComment(p, b.id)).toThrow(/no comment/)
  })

  it('threads one level of replies', () => {
    const c = addComment(p, { text: 'why this?' })
    addReply(p, c.id, { text: 'deliberate — see d-1', author: 'agent' })
    const again = addReply(p, c.id, { text: 'ok, resolved then', author: 'lucas' })
    expect(again.replies).toHaveLength(2)
    expect(again.replies?.[0]).toMatchObject({ author: 'agent', text: 'deliberate — see d-1' })
    const meta = readMeta(loadDoc(p).historyDir)
    expect(meta.comments[0].replies).toHaveLength(2)
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

  it('records answers to ::: ask questions, replacing an earlier open answer', async () => {
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8') + '\n::: ask id=q-db\nWhich database?\n- SQLite [recommended]\n- Postgres\n:::\n')
    snapshot(p, { summary: 'ask', author: 'test' })
    const { app } = createApp(dir, { author: 'lucas' })
    const answer = (choice: string) => app.request('/api/answer', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rel: 'Plan.md', anchor: '#q-db', question: 'Which database?', choice }),
    })
    expect((await answer('Postgres')).status).toBe(200)
    expect((await answer('SQLite')).status).toBe(200)
    const answers = readMeta(loadDoc(p).historyDir).comments.filter((c) => c.answer !== undefined)
    expect(answers).toHaveLength(1)
    expect(answers[0]).toMatchObject({ anchor: '#q-db', answer: 'SQLite', text: 'Answer: SQLite', author: 'lucas' })
    const html = render(p)
    expect(html).toContain('data-choice="SQLite" aria-pressed="true"')
    expect(html).toContain('You answered “SQLite” · waiting for the next draft')
    expect((await app.request('/api/answer', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rel: 'Plan.md', anchor: 'no-hash', choice: 'x' }),
    })).status).toBe(400)
  })

  it('approves the latest revision and shows it in the page and the bar', async () => {
    const { app } = createApp(dir, { author: 'lucas' })
    const res = await app.request('/api/approve', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rel: 'Plan.md' }),
    })
    expect(res.status).toBe(200)
    expect(readMeta(loadDoc(p).historyDir).approvals).toEqual([expect.objectContaining({ rev: 'r001', author: 'lucas' })])
    let page = await (await app.request('/doc/Plan.md')).text()
    expect(page).toContain('<span class="approved" data-approved="r001">Approved</span>')
    expect(page).toContain('Approved r001</button>')
    // a newer draft keeps the old approval visible and offers the approve button again
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('long enough', 'long enough, and changed'))
    snapshot(p, { summary: 'second', author: 'test' })
    page = await (await app.request('/doc/Plan.md')).text()
    expect(page).toContain('data-approved="r001">Approved r001</span>')
    expect(page).toContain('id="vapprove"')
    expect((await app.request('/api/approve', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rel: 'Plan.md', rev: 'r009' }),
    })).status).toBe(404)
  })

  it('serves a view compared against an earlier revision with ?since=', async () => {
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('long enough', 'long enough, twice'))
    snapshot(p, { summary: 'second', author: 'test' })
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('twice', 'thrice'))
    snapshot(p, { summary: 'third', author: 'test' })
    const { app } = createApp(dir)
    expect(await (await app.request('/doc/Plan.md')).text()).toContain('What changed since r002')
    expect(await (await app.request('/doc/Plan.md?since=r001')).text()).toContain('What changed since r001')
    expect((await app.request('/doc/Plan.md?since=r777')).status).toBe(404)
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

  it('rejects cross-origin, non-JSON, and oversized mutations', async () => {
    const { app } = createApp(dir, { origin: 'http://localhost' })
    const body = JSON.stringify({ rel: 'Plan.md', text: 'note' })
    expect((await app.request('/api/comment', {
      method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body,
    })).status).toBe(403)
    expect((await app.request('/api/comment', {
      method: 'POST', headers: { origin: 'http://localhost', 'content-type': 'text/plain' }, body,
    })).status).toBe(415)
    expect((await app.request('/api/comment', {
      method: 'POST', headers: { origin: 'http://localhost', 'content-type': 'application/json' },
      body: JSON.stringify({ rel: 'Plan.md', text: 'x'.repeat(20_000) }),
    })).status).toBe(413)
    expect((await app.request('/api/comment', {
      method: 'POST', headers: { origin: 'http://localhost', 'content-type': 'application/json' },
      body: JSON.stringify({ rel: 'Plan.md', text: 'x'.repeat(5000) }),
    })).status).toBe(413)
  })

  it('uses an ephemeral capability for remote writes', async () => {
    let shutdowns = 0
    const { app } = createApp(dir, {
      origin: 'http://100.64.0.2:4820', writeToken: 'secret-token', onShutdown: () => { shutdowns++ },
    })
    const locked = await (await app.request('/doc/Plan.md')).text()
    expect(locked).toContain('"canComment":false')
    expect(locked).toContain('read-only link')
    expect(locked).not.toContain('data-stop-viewer type="button"')
    expect(await (await app.request('/')).text()).not.toContain('data-stop-viewer type="button"')
    const body = JSON.stringify({ rel: 'Plan.md', text: 'remote note' })
    expect((await app.request('/api/comment', {
      method: 'POST', headers: { origin: 'http://100.64.0.2:4820', 'content-type': 'application/json' }, body,
    })).status).toBe(403)
    expect((await app.request('/api/shutdown', {
      method: 'POST', headers: { origin: 'http://100.64.0.2:4820', 'content-type': 'application/json' }, body: '{}',
    })).status).toBe(403)

    const unlock = await app.request('/?write=secret-token')
    expect(unlock.status).toBe(302)
    const cookie = unlock.headers.get('set-cookie')?.split(';')[0] ?? ''
    expect(cookie).toContain('pentimento-write=')
    expect(unlock.headers.get('set-cookie')).toContain('HttpOnly')
    expect((await app.request('/api/comment', {
      method: 'POST',
      headers: { origin: 'http://100.64.0.2:4820', 'content-type': 'application/json', cookie },
      body,
    })).status).toBe(200)
    const writable = await (await app.request('/doc/Plan.md', { headers: { cookie } })).text()
    expect(writable).toContain('"canComment":true')
    expect(writable).toContain('data-stop-viewer type="button"')
    expect(await (await app.request('/', { headers: { cookie } })).text()).toContain('data-stop-viewer type="button"')
    expect((await app.request('/api/shutdown', {
      method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json', cookie }, body: '{}',
    })).status).toBe(403)
    expect((await app.request('/api/shutdown', {
      method: 'POST', headers: { origin: 'http://100.64.0.2:4820', 'content-type': 'text/plain', cookie }, body: '{}',
    })).status).toBe(415)
    expect(shutdowns).toBe(0)
    expect((await app.request('/api/shutdown', {
      method: 'POST', headers: { origin: 'http://100.64.0.2:4820', 'content-type': 'application/json', cookie }, body: '{}',
    })).status).toBe(202)
    expect(shutdowns).toBe(1)
  })

  it('disables commenting on historical revisions', async () => {
    const { app } = createApp(dir)
    const page = await (await app.request('/doc/Plan.md?rev=r001')).text()
    expect(page).toContain('"canComment":false')
    expect(page).toContain('"rev":"r001"')
    expect(page).toContain(" is read-only. ")
  })

  it('replaces the header panel with drawer data in the live viewer', async () => {
    addComment(p, { text: 'panel or drawer', quote: 'body text' })
    const { app } = createApp(dir)
    const page = await (await app.request('/doc/Plan.md')).text()
    expect(page).not.toContain('open comment</summary>')
    expect(page).toContain('id="vc-toggle"')
    expect(page).toContain('<span id="vc-count">1</span>')
    expect(page).toContain('"revisions":["r001"]')
    // the static render keeps the panel
    expect(render(p)).toContain('1 open comment')
  })

  it('serves the comment list over GET /api/comments', async () => {
    const c = addComment(p, { text: 'listed', quote: 'body text' })
    const { app } = createApp(dir)
    const res = await app.request('/api/comments?rel=Plan.md')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.comments.map((x: { id: string }) => x.id)).toEqual([c.id])
    expect(data.revisions).toEqual(['r001'])
    expect((await app.request('/api/comments?rel=../outside.md')).status).toBe(404)
  })

  it('scopes uncomment to the creating session', async () => {
    const { app } = createApp(dir)
    const post = (url: string, body: unknown) => app.request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const entry = await (await post('/api/comment', { rel: 'Plan.md', text: 'mine', session: 's-1' })).json()
    expect((await post('/api/uncomment', { rel: 'Plan.md', id: entry.id, session: 's-2' })).status).toBe(403)
    expect((await post('/api/uncomment', { rel: 'Plan.md', id: entry.id })).status).toBe(403)
    const ok = await post('/api/uncomment', { rel: 'Plan.md', id: entry.id, session: 's-1' })
    expect(ok.status).toBe(200)
    expect(readMeta(loadDoc(p).historyDir).comments).toHaveLength(0)
  })

  it('scopes temporary delete ownership by document and comment id', async () => {
    const other = path.join(dir, 'Other.md')
    fs.writeFileSync(other, '# Other\n\n## Section\n\nEnough body text for a document snapshot.\n')
    snapshot(other, { summary: 'first', author: 'test' })
    const { app } = createApp(dir)
    const post = (url: string, body: unknown) => app.request(url, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })
    const a = await (await post('/api/comment', { rel: 'Plan.md', text: 'a', session: 's-a' })).json()
    const b = await (await post('/api/comment', { rel: 'Other.md', text: 'b', session: 's-b' })).json()
    expect(a.id).toBe(b.id)
    expect((await post('/api/uncomment', { rel: 'Plan.md', id: a.id, session: 's-b' })).status).toBe(403)
    expect(readMeta(loadDoc(p).historyDir).comments).toHaveLength(1)
  })

  it('reopens and replies over the API', async () => {
    const c = addComment(p, { text: 'roundtrip', quote: 'body text' })
    resolveComment(p, c.id, 'r001')
    const { app } = createApp(dir, { author: 'lucas' })
    const post = (url: string, body: unknown) => app.request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    expect((await post('/api/reopen', { rel: 'Plan.md', id: c.id })).status).toBe(200)
    expect(readMeta(loadDoc(p).historyDir).comments[0].status).toBe('open')
    const replied = await (await post('/api/reply', { rel: 'Plan.md', id: c.id, text: 'answer' })).json()
    expect(replied.replies).toHaveLength(1)
    expect(replied.replies[0]).toMatchObject({ author: 'lucas', text: 'answer' })
    expect((await post('/api/reply', { rel: 'Plan.md', id: c.id, text: '  ' })).status).toBe(400)
    expect((await post('/api/reopen', { rel: 'Plan.md', id: 'c-nope' })).status).toBe(404)
  })
})
