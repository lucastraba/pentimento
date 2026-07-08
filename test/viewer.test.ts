import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { snapshot } from '../src/core.js'
import { createApp, serveViewer } from '../src/viewer.js'

let dir: string
let app: ReturnType<typeof createApp>['app']

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pentimento-viewer-'))
  const p = path.join(dir, 'My Plan.md')
  fs.writeFileSync(p, '---\nArchetype: brainstorm\n---\n# My Plan\n\n## Ideas\n\nfirst version of the idea\n')
  snapshot(p, { summary: 'first draft', author: 'test' })
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('first version', 'second version'))
  snapshot(p, { summary: 'revised', author: 'test' })
  ;({ app } = createApp(dir))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('viewer', () => {
  it('refuses to bind all interfaces, including via an empty host', () => {
    for (const host of ['', '  ', '0.0.0.0', '::', '*']) {
      expect(() => serveViewer(dir, { host, port: 0 })).toThrow(/all interfaces/)
    }
  })

  it('lists documents on the index with badge and revision', async () => {
    const res = await app.request('/')
    const html = await res.text()
    expect(res.status).toBe(200)
    expect(html).toContain('My Plan')
    expect(html).toContain('badge-brainstorm')
    expect(html).toContain('r002')
    expect(html).toContain('/doc/My%20Plan.md')
  })

  it('serves the rendered document with the viewer bar and SSE', async () => {
    const res = await app.request('/doc/My%20Plan.md')
    const html = await res.text()
    expect(res.status).toBe(200)
    expect(html).toContain('<title>My Plan</title>')
    expect(html).toContain('second version')
    expect(html).toContain('class="vbar"')
    expect(html).toContain("EventSource('/__events')")
    expect(html).toContain('diff vs r001')
  })

  it('serves an old revision via ?rev=', async () => {
    const res = await app.request('/doc/My%20Plan.md?rev=r001')
    const html = await res.text()
    expect(html).toContain('first version')
    expect(html).not.toContain('second version')
    expect(html).toContain('<span class="chip">r001</span>')
  })

  it('serves diff pages between revisions', async () => {
    const res = await app.request('/diff/My%20Plan.md?a=r001&b=r002')
    const html = await res.text()
    expect(res.status).toBe(200)
    expect(html).toContain('<del>first</del>')
    expect(html).toContain('<ins>second</ins>')
  })

  it('blocks path traversal', async () => {
    fs.writeFileSync(path.join(os.tmpdir(), 'pentimento-outside.md'), '# outside\n')
    const res = await app.request('/doc/..%2Fpentimento-outside.md')
    expect(res.status).toBe(404)
  })

  it('404s unknown documents', async () => {
    const res = await app.request('/doc/Nope.md')
    expect(res.status).toBe(404)
  })
})
