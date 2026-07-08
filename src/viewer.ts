import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { addComment, loadDoc, readMeta, resolveComment, type Meta } from './core.js'
import { render, renderDiffPage, renderRevisionHtml } from './render.js'
import { findPentimentoDocs } from './verify.js'

const ASSETS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets')

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

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
  return `<div class="vbar-pad"></div>
<nav class="vbar">
  <a href="/">◂ documents</a>
  <span class="vbar-name">${escapeHtml(rel)}${latest ? ` · ${latest}` : ''}</span>
  <select id="vrev" aria-label="Revision">${options}</select>
  ${diffLink}
</nav>
<script>
document.getElementById('vrev').addEventListener('change', (e) => {
  const v = e.target.value
  location.href = v === 'canonical' ? location.pathname : location.pathname + '?rev=' + v
})
</script>
${SSE_SNIPPET}`
}

const indexPage = (root: string): string => {
  const css = fs.readFileSync(path.join(ASSETS, 'theme.css'), 'utf8')
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
      }
    })
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((d) =>
      `<a class="vcard" href="/doc/${encodeURI(d.rel)}">
  <div class="meta-row">
    <span class="badge badge-${escapeHtml(d.archetype)}">${escapeHtml(d.archetype)}</span>
    <span class="chip">${escapeHtml(d.rev)}</span>
    ${d.date ? `<span class="chip">${escapeHtml(d.date)}</span>` : ''}
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
<style>
${css}</style>
</head>
<body>
<div class="wrap">
<header class="doc">
  <div class="meta-row"><span class="badge">Pentimento viewer</span><span class="chip">${escapeHtml(root)}</span></div>
  <h1>Living documents</h1>
</header>
<main>
<div class="vcards">
${cards || '<p>No Pentimento documents found under this directory.</p>'}
</div>
</main>
</div>
${SSE_SNIPPET}
</body>
</html>
`
}

export interface ViewerApp {
  app: Hono
  broadcast: () => void
}

export interface ViewerOptions {
  /** author recorded on comments added through the viewer */
  author?: string
}

export const createApp = (root: string, viewerOpts: ViewerOptions = {}): ViewerApp => {
  const absRoot = path.resolve(root)
  const viewerJs = fs.readFileSync(path.join(ASSETS, 'viewer.js'), 'utf8')
  const app = new Hono()
  const clients = new Set<() => void>()
  const broadcast = () => clients.forEach((send) => send())

  const resolveDoc = (rel: string): string | null => {
    const abs = path.resolve(absRoot, rel)
    if (!abs.startsWith(absRoot + path.sep) && abs !== absRoot) return null
    if (!abs.endsWith('.md') || !fs.existsSync(abs)) return null
    return abs
  }

  app.get('/', (c) => c.html(indexPage(absRoot)))

  app.get('/doc/*', (c) => {
    const rel = decodeURIComponent(c.req.path.slice('/doc/'.length))
    const abs = resolveDoc(rel)
    if (!abs) return c.notFound()
    const rev = c.req.query('rev') ?? null
    let html: string
    try {
      html = rev ? renderRevisionHtml(abs, rev) : render(abs)
    } catch (e) {
      return c.text(e instanceof Error ? e.message : String(e), 500)
    }
    const meta = readMeta(loadDoc(abs).historyDir)
    const cfg = {
      rel,
      canComment: !rev,
      comments: meta.comments
        .filter((cm) => cm.status === 'open')
        .map((cm) => ({ id: cm.id, quote: cm.quote ?? null, text: cm.text })),
    }
    const cfgScript = `<script>window.__pentimento=${JSON.stringify(cfg).replace(/</g, '\\u003c')}</script>\n<script>\n${viewerJs}</script>`
    return c.html(html.replace('</body>', `${viewerBar(rel, meta, rev)}\n${cfgScript}\n</body>`))
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
    return c.json(entry)
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
    let send: () => void
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder()
        send = () => {
          try { controller.enqueue(encoder.encode('data: reload\n\n')) } catch { clients.delete(send) }
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

  let timer: NodeJS.Timeout | null = null
  fs.watch(absRoot, { recursive: true }, (_event, fname) => {
    if (!fname) return
    const f = String(fname)
    if (f.includes('node_modules') || f.includes('.git/')) return
    if (!/\.(md|yml)$/.test(f)) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(broadcast, 200)
  })

  serve({ fetch: app.fetch, hostname: host, port })
}
