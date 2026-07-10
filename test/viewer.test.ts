import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { snapshot } from '../src/core.js'
import { createApp, isLoopbackHost, serveViewer, viewerOrigin } from '../src/viewer.js'

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

  it('requires capabilities for non-loopback binds and formats IPv6 origins', () => {
    expect(isLoopbackHost('127.0.0.2')).toBe(true)
    expect(isLoopbackHost('::1')).toBe(true)
    expect(isLoopbackHost('100.64.0.2')).toBe(false)
    expect(viewerOrigin('::1', 4820)).toBe('http://[::1]:4820')
    expect(() => serveViewer(dir, { host: '100.64.0.2', port: 4820 }))
      .toThrow('non-loopback viewers require an ephemeral write capability')
  })

  it('lets the writable viewer stop its root server', async () => {
    const onShutdown = vi.fn()
    const stoppable = createApp(dir, { onShutdown }).app
    expect(await (await stoppable.request('/')).text()).toContain('data-stop-viewer')
    expect(await (await stoppable.request('/doc/My%20Plan.md')).text()).toContain('data-stop-viewer')
    const response = await stoppable.request('/api/shutdown', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    })
    expect(response.status).toBe(202)
    expect(onShutdown).toHaveBeenCalledOnce()
  })

  it('lists documents on the index with badge and revision', async () => {
    const res = await app.request('/')
    const html = await res.text()
    expect(res.status).toBe(200)
    expect(html).toContain('My Plan')
    expect(html).toContain('badge-brainstorm')
    expect(html).toContain('r002')
    expect(html).toContain('/doc/My%20Plan.md')
    expect(html).toContain('class="theme-picker"')
    expect(html).toContain('class="theme-controls"')
    expect(html).toContain('Use document default')
    expect(html).toContain('class="path-chip"')
    expect(html).toContain('window.__pSyncPalette = sync')
    expect(html).toMatch(/script-src 'sha256-[A-Za-z0-9+/=]+'/)
    expect(html).not.toMatch(/script-src[^;]*'unsafe-inline'/)
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
  })

  it('serves the rendered document with the viewer bar and SSE', async () => {
    const res = await app.request('/doc/My%20Plan.md')
    const html = await res.text()
    expect(res.status).toBe(200)
    expect(html).toContain('<title>My Plan</title>')
    expect(html).toContain('second version')
    expect(html).toContain('class="vbar"')
    expect(html).toContain('class="comment-icon"')
    expect(html).not.toContain('💬')
    expect(html).toContain('.vc-add[hidden] { display: none; }')
    expect(html).toContain("EventSource('/__events')")
    expect(html).toContain('diff vs r001')
    expect(html).toMatch(/script-src 'sha256-[A-Za-z0-9+/=]+'/)
    expect(html).not.toMatch(/script-src[^;]*'unsafe-inline'/)
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('serves an old revision via ?rev=', async () => {
    const res = await app.request('/doc/My%20Plan.md?rev=r001')
    const html = await res.text()
    expect(html).toContain('first version')
    expect(html).not.toContain('second version')
    expect(html).toContain('<span class="chip">r001</span>')
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
  })

  it('serves diff pages between revisions', async () => {
    const res = await app.request('/diff/My%20Plan.md?a=r001&b=r002')
    const html = await res.text()
    expect(res.status).toBe(200)
    expect(html).toContain('<del>first</del>')
    expect(html).toContain('<ins>second</ins>')
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
  })

  it('blocks path traversal', async () => {
    fs.writeFileSync(path.join(os.tmpdir(), 'pentimento-outside.md'), '# outside\n')
    const res = await app.request('/doc/..%2Fpentimento-outside.md')
    expect(res.status).toBe(404)
  })

  it('handles malformed URL encoding and markdown-shaped directories as not found', async () => {
    fs.mkdirSync(path.join(dir, 'Folder.md'))
    expect((await app.request('/doc/%E0%A4%A')).status).toBe(404)
    expect((await app.request('/diff/%E0%A4%A?a=r001&b=r002')).status).toBe(404)
    expect((await app.request('/doc/Folder.md')).status).toBe(404)
  })

  it('blocks traversal through revision and diff query parameters', async () => {
    const outside = path.join(path.dirname(dir), `pentimento-secret-${path.basename(dir)}.md`)
    fs.writeFileSync(outside, '# secret\n')
    try {
      const rev = encodeURIComponent(`../../../${path.basename(outside, '.md')}`)
      expect((await app.request(`/doc/My%20Plan.md?rev=${rev}`)).status).toBe(404)
      expect((await app.request(`/diff/My%20Plan.md?a=${rev}&b=r002`)).status).toBe(404)
    } finally {
      fs.rmSync(outside, { force: true })
    }
  })

  it('does not serve markdown symlinks that escape the viewer root', async () => {
    const outside = path.join(path.dirname(dir), `pentimento-linked-${path.basename(dir)}.md`)
    fs.writeFileSync(outside, '# linked secret\n')
    try {
      fs.symlinkSync(outside, path.join(dir, 'Linked.md'))
      expect((await app.request('/doc/Linked.md')).status).toBe(404)
      expect(await (await app.request('/')).text()).not.toContain('linked secret')
    } finally {
      fs.rmSync(outside, { force: true })
    }
  })

  it('404s unknown documents', async () => {
    const res = await app.request('/doc/Nope.md')
    expect(res.status).toBe(404)
  })
})
