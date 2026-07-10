import crypto from 'node:crypto'
import fs from 'node:fs'
import type { Server as HttpServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { getCookie, setCookie } from 'hono/cookie'
import {
  addComment, addReply, deleteComment, isPathInside, loadDoc, readMeta, reopenComment,
  resolveComment, resolveContainedPath, type Meta,
} from './core.js'
import {
  contentSecurityPolicy, FAVICON_TAG, render, renderDiffPage, renderRevisionHtml, renderStylesheet,
  RESTORE_SNIPPET, secureHtml,
} from './render.js'
import { themePicker } from './themes.js'
import { findPentimentoDocs } from './verify.js'

const ASSETS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets')

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const COMMENT_ICON = '<svg class="comment-icon" viewBox="0 0 20 20" aria-hidden="true">' +
  '<path d="M5.25 3.75h9.5a2.5 2.5 0 0 1 2.5 2.5v5.5a2.5 2.5 0 0 1-2.5 2.5H9l-4.25 2.5v-2.6a2.5 2.5 0 0 1-2-2.4v-5.5a2.5 2.5 0 0 1 2.5-2.5Z"/>' +
  '<path class="comment-dots" d="M7 9h.01M10 9h.01M13 9h.01"/></svg>'

const STOP_ICON = '<svg class="stop-icon" viewBox="0 0 20 20" aria-hidden="true">' +
  '<path d="M10 2.5v7M5.2 5.3a7 7 0 1 0 9.6 0"/></svg>'
const stopButton = (): string =>
  `<button class="viewer-stop" data-stop-viewer type="button">${STOP_ICON}<span>Stop viewer</span></button>`
const STOP_SNIPPET = `<script>(() => {
  document.addEventListener('click', async (event) => {
    const button = event.target.closest?.('[data-stop-viewer]')
    if (!button || !confirm('Stop this viewer for every document it serves?')) return
    button.disabled = true
    button.querySelector('span').textContent = 'Stopping…'
    try {
      const response = await fetch('/api/shutdown', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
      })
      if (!response.ok) throw new Error(await response.text())
      button.querySelector('span').textContent = 'Viewer stopped'
      document.documentElement.dataset.viewerStopped = 'true'
      const status = document.createElement('div')
      status.className = 'viewer-stopped-status'
      status.role = 'status'
      status.tabIndex = -1
      status.textContent = 'Viewer stopped. This page is now offline.'
      document.body.append(status)
      status.focus()
    } catch (error) {
      button.disabled = false
      button.querySelector('span').textContent = 'Stop viewer'
      alert(error instanceof Error ? error.message : String(error))
    }
  })
})()</script>`

// Index and diff pages reload on any change; document pages get viewer.js, which
// listens to the same stream and patches or morphs instead of reloading.
const SSE_SNIPPET = `<script>new EventSource('/__events').onmessage = () => location.reload()</script>`

const viewerBar = (rel: string, meta: Meta, current: string | null, canComment = true, canStop = false): string => {
  const latest = meta.revisions[meta.revisions.length - 1]?.id ?? null
  const selected = current ?? 'canonical'
  const options = [
    `<option value="canonical"${selected === 'canonical' ? ' selected' : ''}>canonical (now)</option>`,
    ...[...meta.revisions].reverse().map((r) =>
      `<option value="${r.id}"${selected === r.id ? ' selected' : ''}>${r.id} · ${escapeHtml(r.summary.slice(0, 48))}</option>`),
  ].join('')
  const idx = current ? meta.revisions.findIndex((r) => r.id === current) : meta.revisions.length - 1
  const prev = idx > 0 ? meta.revisions[idx - 1].id : null
  const diffTo = current ?? 'canonical'
  const diffLink = prev
    ? `<a href="/diff/${encodeURI(rel)}?a=${prev}&amp;b=${diffTo}">diff vs ${prev}</a>`
    : ''
  const openCount = meta.comments.filter((c) => c.status === 'open').length
  const note = current
    ? `<span class="vbar-note">read-only revision — comments attach to the current version</span>`
    : canComment ? '' : `<span class="vbar-note">read-only link — open the private write link to comment</span>`
  return `<div class="vbar-pad"></div>
<nav class="vbar">
  <a href="/">◂ documents</a>
  <span class="vbar-name">${escapeHtml(rel)}${latest ? ` · ${latest}` : ''}</span>
  <select id="vrev" aria-label="Revision">${options}</select>
  ${diffLink}
  ${note}
  <button id="vc-toggle" class="vc-toggle" type="button" aria-expanded="false" aria-label="Comments">${COMMENT_ICON}<span id="vc-count">${openCount}</span></button>
  ${canStop ? stopButton() : ''}
</nav>`
}

const indexPage = (root: string, canStop = false): string => {
  const css = renderStylesheet()
  const chromeJs = fs.readFileSync(path.join(ASSETS, 'chrome.js'), 'utf8')
  const cards = findPentimentoDocs(root)
    .map((p) => {
      const doc = loadDoc(p)
      let meta: Meta = { revisions: [], comments: [] }
      try { meta = readMeta(doc.historyDir) } catch { /* show the doc anyway */ }
      const latest = meta.revisions[meta.revisions.length - 1]
      const rel = path.relative(root, p).split(path.sep).join('/')
      const archetype = String(doc.frontmatter['Archetype'] ?? 'design-doc')
      return {
        rel,
        name: doc.name,
        archetype,
        rev: String(doc.frontmatter['Current Revision'] ?? '—'),
        summary: latest?.summary ?? '',
        date: latest?.created_at?.slice(0, 10) ?? '',
        open: meta.comments.filter((c) => c.status === 'open').length,
      }
    })
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((d) =>
      `<a class="vcard" href="/doc/${encodeURI(d.rel)}">
  <div class="meta-row">
    <span class="badge badge-${escapeHtml(d.archetype)}">${escapeHtml(d.archetype)}</span>
    <span class="chip">${escapeHtml(d.rev)}</span>
    ${d.date ? `<span class="chip">${escapeHtml(d.date)}</span>` : ''}
    ${d.open ? `<span class="chip chip-comments">${COMMENT_ICON}${d.open}</span>` : ''}
  </div>
  <h3>${escapeHtml(d.name)}</h3>
  ${d.summary ? `<p>${escapeHtml(d.summary)}</p>` : ''}
</a>`)
    .join('\n')
  return secureHtml(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pentimento — living documents</title>
${FAVICON_TAG}
<style>
${css}</style>
</head>
<body>
${RESTORE_SNIPPET}
<div class="wrap">
<header class="doc">
  <div class="meta-row"><span class="badge">Pentimento viewer</span>${themePicker()}${canStop ? stopButton() : ''}<span class="path-chip" title="${escapeHtml(root)}">${escapeHtml(root)}</span></div>
  <h1>Living documents</h1>
</header>
<main>
<div class="vcards">
${cards || '<p>No Pentimento documents found under this directory.</p>'}
</div>
</main>
</div>
<script>${chromeJs}</script>
${SSE_SNIPPET}
${canStop ? STOP_SNIPPET : ''}
</body>
</html>
`)
}

export interface ViewerApp {
  app: Hono
  broadcast: (payload: { docs: string[]; metas: string[] }) => void
}

export interface ViewerOptions {
  /** author recorded on comments added through the viewer */
  author?: string
  /** fixed viewer origin used to reject cross-origin browser mutations */
  origin?: string
  /** ephemeral capability required for writes in remote mode */
  writeToken?: string
  /** stop the root viewer process after an authorized browser request */
  onShutdown?: () => void
}

const WRITE_COOKIE = 'pentimento-write'
const MAX_BODY = 16 * 1024
const sameToken = (actual: string | undefined, expected: string): boolean => {
  if (!actual || actual.length !== expected.length) return false
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
}

export const createApp = (root: string, viewerOpts: ViewerOptions = {}): ViewerApp => {
  const absRoot = fs.realpathSync(path.resolve(root))
  const viewerJs = fs.readFileSync(path.join(ASSETS, 'viewer.js'), 'utf8')
  const app = new Hono()
  const clients = new Set<(data: string) => void>()
  const broadcast = (payload: { docs: string[]; metas: string[] }) => {
    const data = JSON.stringify(payload)
    clients.forEach((send) => send(data))
  }
  // which browser session created which comment — scopes undo/delete; dies with the server
  const owners = new Map<string, string>()
  const canWrite = (c: Context): boolean => !viewerOpts.writeToken || sameToken(getCookie(c, WRITE_COOKIE), viewerOpts.writeToken)
  const canStop = (c: Context): boolean => Boolean(viewerOpts.onShutdown) && canWrite(c)
  const expectedOrigin = (c: Context): string => viewerOpts.origin ?? new URL(c.req.url).origin
  const htmlResponse = (c: Context, html: string): Response => {
    const secured = secureHtml(html)
    c.header('Content-Security-Policy', contentSecurityPolicy(secured, true))
    c.header('Referrer-Policy', 'no-referrer')
    c.header('X-Content-Type-Options', 'nosniff')
    c.header('X-Frame-Options', 'DENY')
    c.header('Cache-Control', 'no-store')
    return c.html(secured)
  }

  app.use('/api/*', bodyLimit({ maxSize: MAX_BODY, onError: (c) => c.text('request body too large', 413) }))
  app.use('/api/*', async (c, next) => {
    if (c.req.method !== 'POST') return next()
    const origin = c.req.header('origin')
    if (origin && origin !== expectedOrigin(c)) return c.text('cross-origin mutation refused', 403)
    if (!/^application\/json(?:\s*;|$)/i.test(c.req.header('content-type') ?? '')) {
      return c.text('mutations require application/json', 415)
    }
    if (!canWrite(c)) return c.text('write capability required', 403)
    return next()
  })

  const resolveDoc = (rel: string): string | null => {
    try {
      const abs = resolveContainedPath(absRoot, rel, 'Document path')
      if (!abs.endsWith('.md') || !fs.existsSync(abs)) return null
      if (!fs.statSync(abs).isFile()) return null
      const real = fs.realpathSync(abs)
      return isPathInside(absRoot, real) ? real : null
    } catch {
      return null
    }
  }

  const hasRevision = (abs: string, rev: string): boolean => {
    if (!/^r\d{3,}$/.test(rev)) return false
    return readMeta(loadDoc(abs).historyDir).revisions.some((entry) => entry.id === rev)
  }

  const commentsPayload = (abs: string) => {
    const meta = readMeta(loadDoc(abs).historyDir)
    return {
      comments: meta.comments,
      revisions: meta.revisions.map((r) => r.id),
    }
  }

  const decodeRel = (encoded: string): string | null => {
    try { return decodeURIComponent(encoded) } catch { return null }
  }
  const ownerKey = (abs: string, id: string): string => `${abs}\0${id}`
  const tooLong = (value: unknown, max: number): boolean => typeof value === 'string' && value.length > max

  app.get('/', (c) => {
    const presented = c.req.query('write')
    if (viewerOpts.writeToken && presented) {
      if (!sameToken(presented, viewerOpts.writeToken)) return c.text('invalid write capability', 403)
      setCookie(c, WRITE_COOKIE, viewerOpts.writeToken, {
        path: '/', httpOnly: true, sameSite: 'Strict', maxAge: 12 * 60 * 60,
      })
      c.header('Cache-Control', 'no-store')
      return c.redirect('/')
    }
    return htmlResponse(c, indexPage(absRoot, canStop(c)))
  })

  app.get('/doc/*', (c) => {
    const rel = decodeRel(c.req.path.slice('/doc/'.length))
    if (rel === null) return c.notFound()
    const abs = resolveDoc(rel)
    if (!abs) return c.notFound()
    const rev = c.req.query('rev') ?? null
    if (rev && !hasRevision(abs, rev)) return c.notFound()
    let html: string
    try {
      // the viewer replaces the static header panel with its drawer
      html = rev
        ? renderRevisionHtml(abs, rev, { omitCommentsPanel: true })
        : render(abs, { omitCommentsPanel: true })
    } catch (e) {
      return c.text(e instanceof Error ? e.message : String(e), 500)
    }
    const meta = readMeta(loadDoc(abs).historyDir)
    const canComment = !rev && canWrite(c)
    const stoppable = canStop(c)
    const cfg = {
      rel,
      rev,
      canComment,
      author: viewerOpts.author ?? 'reader',
      comments: meta.comments,
      revisions: meta.revisions.map((r) => r.id),
    }
    const cfgScript = `<script>window.__pentimento=${JSON.stringify(cfg).replace(/</g, '\\u003c')}</script>\n<script>\n${viewerJs}</script>`
    return htmlResponse(c, html.replace('</body>', `${viewerBar(rel, meta, rev, canComment, stoppable)}\n${cfgScript}\n${stoppable ? STOP_SNIPPET : ''}\n</body>`))
  })

  app.get('/api/comments', (c) => {
    const abs = resolveDoc(c.req.query('rel') ?? '')
    if (!abs) return c.notFound()
    return c.json(commentsPayload(abs))
  })

  app.post('/api/shutdown', (c) => {
    if (!viewerOpts.onShutdown) return c.text('viewer shutdown is unavailable', 501)
    viewerOpts.onShutdown()
    return c.json({ stopping: true }, 202)
  })

  app.post('/api/comment', async (c) => {
    const b = await c.req.json().catch(() => null)
    if (!b) return c.text('bad json', 400)
    if (tooLong(b.rel, 1024) || tooLong(b.text, 4000) || tooLong(b.anchor, 256) ||
      tooLong(b.quote, 600) || tooLong(b.prefix, 200) || tooLong(b.suffix, 200) || tooLong(b.session, 128)) {
      return c.text('comment field too large', 413)
    }
    const abs = resolveDoc(String(b.rel ?? ''))
    if (!abs) return c.notFound()
    const text = String(b.text ?? '').trim()
    if (!text) return c.text('missing text', 400)
    const entry = addComment(abs, {
      text,
      anchor: typeof b.anchor === 'string' ? b.anchor : '',
      quote: typeof b.quote === 'string' && b.quote ? b.quote.slice(0, 600) : undefined,
      prefix: typeof b.prefix === 'string' && b.prefix ? b.prefix : undefined,
      suffix: typeof b.suffix === 'string' && b.suffix ? b.suffix : undefined,
      author: viewerOpts.author ?? 'reader',
    })
    if (typeof b.session === 'string' && b.session) owners.set(ownerKey(abs, entry.id), b.session)
    return c.json(entry)
  })

  app.post('/api/uncomment', async (c) => {
    const b = await c.req.json().catch(() => null)
    if (!b) return c.text('bad json', 400)
    if (tooLong(b.rel, 1024) || tooLong(b.id, 128) || tooLong(b.session, 128)) return c.text('field too large', 413)
    const abs = resolveDoc(String(b.rel ?? ''))
    if (!abs) return c.notFound()
    const id = String(b.id ?? '')
    const session = String(b.session ?? '')
    if (!session || owners.get(ownerKey(abs, id)) !== session) {
      return c.text('only comments made in this session can be deleted', 403)
    }
    try {
      const removed = deleteComment(abs, id)
      owners.delete(ownerKey(abs, id))
      return c.json(removed)
    } catch (e) {
      return c.text(e instanceof Error ? e.message : String(e), 404)
    }
  })

  app.post('/api/resolve', async (c) => {
    const b = await c.req.json().catch(() => null)
    if (!b) return c.text('bad json', 400)
    if (tooLong(b.rel, 1024) || tooLong(b.id, 128)) return c.text('field too large', 413)
    const abs = resolveDoc(String(b.rel ?? ''))
    if (!abs) return c.notFound()
    try {
      return c.json(resolveComment(abs, String(b.id ?? '')))
    } catch (e) {
      return c.text(e instanceof Error ? e.message : String(e), 404)
    }
  })

  app.post('/api/reopen', async (c) => {
    const b = await c.req.json().catch(() => null)
    if (!b) return c.text('bad json', 400)
    if (tooLong(b.rel, 1024) || tooLong(b.id, 128)) return c.text('field too large', 413)
    const abs = resolveDoc(String(b.rel ?? ''))
    if (!abs) return c.notFound()
    try {
      return c.json(reopenComment(abs, String(b.id ?? '')))
    } catch (e) {
      return c.text(e instanceof Error ? e.message : String(e), 404)
    }
  })

  app.post('/api/reply', async (c) => {
    const b = await c.req.json().catch(() => null)
    if (!b) return c.text('bad json', 400)
    if (tooLong(b.rel, 1024) || tooLong(b.id, 128) || tooLong(b.text, 4000)) return c.text('field too large', 413)
    const abs = resolveDoc(String(b.rel ?? ''))
    if (!abs) return c.notFound()
    const text = String(b.text ?? '').trim()
    if (!text) return c.text('missing text', 400)
    try {
      return c.json(addReply(abs, String(b.id ?? ''), { text, author: viewerOpts.author ?? 'reader' }))
    } catch (e) {
      return c.text(e instanceof Error ? e.message : String(e), 404)
    }
  })

  app.get('/diff/*', (c) => {
    const rel = decodeRel(c.req.path.slice('/diff/'.length))
    if (rel === null) return c.notFound()
    const abs = resolveDoc(rel)
    if (!abs) return c.notFound()
    const a = c.req.query('a')
    const b = c.req.query('b') ?? 'canonical'
    if (!a) return c.text('missing ?a=<rev>', 400)
    if ((a !== 'canonical' && !hasRevision(abs, a)) || (b !== 'canonical' && !hasRevision(abs, b))) return c.notFound()
    try {
      const html = renderDiffPage(abs, a, b)
      return htmlResponse(c, html.replace('</body>', `${SSE_SNIPPET}\n</body>`))
    } catch (e) {
      return c.text(e instanceof Error ? e.message : String(e), 500)
    }
  })

  app.get('/__events', () => {
    let send: (data: string) => void
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder()
        send = (data: string) => {
          try { controller.enqueue(encoder.encode(`data: ${data}\n\n`)) } catch { clients.delete(send) }
        }
        clients.add(send)
        controller.enqueue(encoder.encode(': connected\n\n'))
      },
      cancel() {
        clients.delete(send)
      },
    })
    return new Response(stream, {
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      },
    })
  })

  return { app, broadcast }
}

export interface ServeOptions {
  host: string
  port: number
  author?: string
  writeToken?: string
}

export const isLoopbackHost = (host: string): boolean =>
  host === 'localhost' || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host)

export const viewerOrigin = (host: string, port: number): string =>
  `http://${host.includes(':') ? `[${host}]` : host}:${port}`

export const serveViewer = (root: string, { host, port, author, writeToken }: ServeOptions): HttpServer => {
  if (!host.trim() || host === '0.0.0.0' || host === '::' || host === '*') {
    throw new Error('refusing to bind all interfaces — use 127.0.0.1 or a Tailscale IP (--tailscale)')
  }
  if (!isLoopbackHost(host) && !writeToken) {
    throw new Error('non-loopback viewers require an ephemeral write capability')
  }
  const absRoot = path.resolve(root)
  let timer: NodeJS.Timeout | null = null
  let watcher: fs.FSWatcher | null = null
  let server: HttpServer | null = null
  let stopping = false
  const onShutdown = () => {
    if (stopping) return
    stopping = true
    setTimeout(() => {
      if (timer) clearTimeout(timer)
      watcher?.close()
      server?.close()
      setTimeout(() => server?.closeAllConnections(), 250)
    }, 50)
  }
  const { app, broadcast } = createApp(absRoot, {
    author, origin: viewerOrigin(host, port), writeToken, onShutdown,
  })

  // Batch watcher hits into one typed event: .md paths morph the affected document
  // page, .yml paths make every page re-fetch its comments.
  const docs = new Set<string>()
  const metas = new Set<string>()
  watcher = fs.watch(absRoot, { recursive: true }, (_event, fname) => {
    if (!fname) return
    const f = String(fname).split(path.sep).join('/')
    if (f.includes('node_modules') || f.includes('.git/')) return
    if (/\.md$/.test(f)) docs.add(f)
    else if (/\.yml$/.test(f)) metas.add(f)
    else return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      broadcast({ docs: [...docs], metas: [...metas] })
      docs.clear()
      metas.clear()
    }, 200)
  })

  server = serve({ fetch: app.fetch, hostname: host, port }) as HttpServer
  return server
}
