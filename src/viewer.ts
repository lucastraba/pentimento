import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import {
  addComment, addReply, deleteComment, loadDoc, readMeta, reopenComment, resolveComment, type Meta,
} from './core.js'
import {
  FAVICON_TAG, render, renderDiffPage, renderRevisionHtml, renderStylesheet, RESTORE_SNIPPET,
} from './render.js'
import { themePicker } from './themes.js'
import { findPentimentoDocs } from './verify.js'

const ASSETS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets')

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const COMMENT_ICON = '<svg class="comment-icon" viewBox="0 0 20 20" aria-hidden="true">' +
  '<path d="M5.25 3.75h9.5a2.5 2.5 0 0 1 2.5 2.5v5.5a2.5 2.5 0 0 1-2.5 2.5H9l-4.25 2.5v-2.6a2.5 2.5 0 0 1-2-2.4v-5.5a2.5 2.5 0 0 1 2.5-2.5Z"/>' +
  '<path class="comment-dots" d="M7 9h.01M10 9h.01M13 9h.01"/></svg>'

// Index and diff pages reload on any change; document pages get viewer.js, which
// listens to the same stream and patches or morphs instead of reloading.
const SSE_SNIPPET = `<script>new EventSource('/__events').onmessage = () => location.reload()</script>`

const viewerBar = (rel: string, meta: Meta, current: string | null): string => {
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
    : ''
  return `<div class="vbar-pad"></div>
<nav class="vbar">
  <a href="/">◂ documents</a>
  <span class="vbar-name">${escapeHtml(rel)}${latest ? ` · ${latest}` : ''}</span>
  <select id="vrev" aria-label="Revision">${options}</select>
  ${diffLink}
  ${note}
  <button id="vc-toggle" class="vc-toggle" type="button" aria-expanded="false" aria-label="Comments">${COMMENT_ICON}<span id="vc-count">${openCount}</span></button>
</nav>`
}

const indexPage = (root: string): string => {
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
  return `<!doctype html>
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
  <div class="meta-row"><span class="badge">Pentimento viewer</span>${themePicker()}<span class="path-chip" title="${escapeHtml(root)}">${escapeHtml(root)}</span></div>
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
</body>
</html>
`
}

export interface ViewerApp {
  app: Hono
  broadcast: (payload: { docs: string[]; metas: string[] }) => void
}

export interface ViewerOptions {
  /** author recorded on comments added through the viewer */
  author?: string
}

export const createApp = (root: string, viewerOpts: ViewerOptions = {}): ViewerApp => {
  const absRoot = path.resolve(root)
  const viewerJs = fs.readFileSync(path.join(ASSETS, 'viewer.js'), 'utf8')
  const app = new Hono()
  const clients = new Set<(data: string) => void>()
  const broadcast = (payload: { docs: string[]; metas: string[] }) => {
    const data = JSON.stringify(payload)
    clients.forEach((send) => send(data))
  }
  // which browser session created which comment — scopes undo/delete; dies with the server
  const owners = new Map<string, string>()

  const resolveDoc = (rel: string): string | null => {
    const abs = path.resolve(absRoot, rel)
    if (!abs.startsWith(absRoot + path.sep) && abs !== absRoot) return null
    if (!abs.endsWith('.md') || !fs.existsSync(abs)) return null
    return abs
  }

  const commentsPayload = (abs: string) => {
    const meta = readMeta(loadDoc(abs).historyDir)
    return {
      comments: meta.comments,
      revisions: meta.revisions.map((r) => r.id),
    }
  }

  app.get('/', (c) => c.html(indexPage(absRoot)))

  app.get('/doc/*', (c) => {
    const rel = decodeURIComponent(c.req.path.slice('/doc/'.length))
    const abs = resolveDoc(rel)
    if (!abs) return c.notFound()
    const rev = c.req.query('rev') ?? null
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
    const cfg = {
      rel,
      rev,
      canComment: !rev,
      author: viewerOpts.author ?? 'reader',
      comments: meta.comments,
      revisions: meta.revisions.map((r) => r.id),
    }
    const cfgScript = `<script>window.__pentimento=${JSON.stringify(cfg).replace(/</g, '\\u003c')}</script>\n<script>\n${viewerJs}</script>`
    return c.html(html.replace('</body>', `${viewerBar(rel, meta, rev)}\n${cfgScript}\n</body>`))
  })

  app.get('/api/comments', (c) => {
    const abs = resolveDoc(c.req.query('rel') ?? '')
    if (!abs) return c.notFound()
    return c.json(commentsPayload(abs))
  })

  app.post('/api/comment', async (c) => {
    const b = await c.req.json().catch(() => null)
    if (!b) return c.text('bad json', 400)
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
    if (typeof b.session === 'string' && b.session) owners.set(entry.id, b.session)
    return c.json(entry)
  })

  app.post('/api/uncomment', async (c) => {
    const b = await c.req.json().catch(() => null)
    if (!b) return c.text('bad json', 400)
    const abs = resolveDoc(String(b.rel ?? ''))
    if (!abs) return c.notFound()
    const id = String(b.id ?? '')
    const session = String(b.session ?? '')
    if (!session || owners.get(id) !== session) {
      return c.text('only comments made in this session can be deleted', 403)
    }
    try {
      const removed = deleteComment(abs, id)
      owners.delete(id)
      return c.json(removed)
    } catch (e) {
      return c.text(e instanceof Error ? e.message : String(e), 404)
    }
  })

  app.post('/api/resolve', async (c) => {
    const b = await c.req.json().catch(() => null)
    if (!b) return c.text('bad json', 400)
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
    const rel = decodeURIComponent(c.req.path.slice('/diff/'.length))
    const abs = resolveDoc(rel)
    if (!abs) return c.notFound()
    const a = c.req.query('a')
    const b = c.req.query('b') ?? 'canonical'
    if (!a) return c.text('missing ?a=<rev>', 400)
    try {
      const html = renderDiffPage(abs, a, b)
      return c.html(html.replace('</body>', `${SSE_SNIPPET}\n</body>`))
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
}

export const serveViewer = (root: string, { host, port, author }: ServeOptions): void => {
  if (!host.trim() || host === '0.0.0.0' || host === '::' || host === '*') {
    throw new Error('refusing to bind all interfaces — use 127.0.0.1 or a Tailscale IP (--tailscale)')
  }
  const absRoot = path.resolve(root)
  const { app, broadcast } = createApp(absRoot, { author })

  // Batch watcher hits into one typed event: .md paths morph the affected document
  // page, .yml paths make every page re-fetch its comments.
  let timer: NodeJS.Timeout | null = null
  const docs = new Set<string>()
  const metas = new Set<string>()
  fs.watch(absRoot, { recursive: true }, (_event, fname) => {
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

  serve({ fetch: app.fetch, hostname: host, port })
}
