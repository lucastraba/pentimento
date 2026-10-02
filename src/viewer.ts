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
  addComment, addReply, answerQuestion, approve, canonicalRevisionState, deleteComment, imageFile, imageMarkProblem,
  imageRefFor, isPathInside, latestApproval, loadDoc, readMeta, reopenComment, resolveComment, resolveContainedPath,
  type ImageMark, type Meta,
} from './core.js'
import { ASSET_RE, imageExtension } from './imageref.js'
import { MIME } from './images.js'
import { watchTree, type TreeWatcher } from './watch.js'
import {
  contentSecurityPolicy, FAVICON_TAG, render, renderDiffPage, renderRevisionHtml, renderStylesheet,
  RESTORE_SNIPPET, secureHtml,
} from './render.js'
import { schemeToggle } from './themes.js'
import { findPentimentoDocs } from './verify.js'

const ASSETS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets')

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const COMMENT_ICON = '<svg class="icon" viewBox="0 0 20 20" aria-hidden="true">' +
  '<path d="M5.25 3.75h9.5a2.5 2.5 0 0 1 2.5 2.5v5.5a2.5 2.5 0 0 1-2.5 2.5H9l-4.25 2.5v-2.6a2.5 2.5 0 0 1-2-2.4v-5.5a2.5 2.5 0 0 1 2.5-2.5Z"/>' +
  '<path class="dots" d="M7 9h.01M10 9h.01M13 9h.01"/></svg>'

const STOP_ICON = '<svg class="icon" viewBox="0 0 20 20" aria-hidden="true">' +
  '<path d="M10 2.5v7M5.2 5.3a7 7 0 1 0 9.6 0"/></svg>'
const stopButton = (compact = false): string =>
  `<button class="${compact ? 'vb' : 'tool'} stop viewer-stop" data-stop-viewer type="button" title="Stop viewer for every document it serves" aria-label="Stop viewer">${STOP_ICON}${compact ? '' : '<span>Stop viewer</span>'}</button>`
const STOP_SNIPPET = `<script>(() => {
  document.addEventListener('click', async (event) => {
    const button = event.target.closest?.('[data-stop-viewer]')
    if (!button || !confirm('Stop this viewer for every document it serves?')) return
    button.disabled = true
    const label = button.querySelector('span')
    if (label) label.textContent = 'Stopping…'
    try {
      const response = await fetch('/api/shutdown', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
      })
      if (!response.ok) throw new Error(await response.text())
      if (label) label.textContent = 'Viewer stopped'
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
      if (label) label.textContent = 'Stop viewer'
      alert(error instanceof Error ? error.message : String(error))
    }
  })
})()</script>`

// Index and diff pages reload on any change; document pages get viewer.js, which
// listens to the same stream and patches or morphs instead of reloading.
const SSE_SNIPPET = `<script>new EventSource('/__events').onmessage = () => location.reload()</script>`

const shortDate = (iso: string): string => {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? `${Number(m[3])} ${months[Number(m[2]) - 1]}` : ''
}

/** One stop per saved revision, plus "now" when the file has unsaved changes. */
const scrubStops = (meta: Meta, dirty: boolean): { id: string; label: string; note: string }[] => [
  ...meta.revisions.map((r) => ({ id: r.id, label: r.id, note: shortDate(r.created_at) })),
  ...(dirty || !meta.revisions.length ? [{ id: 'canonical', label: 'now', note: 'unsaved' }] : []),
]

const viewerBar = (
  meta: Meta,
  current: string | null,
  canonicalDirty: boolean,
  canWrite: boolean,
  canStop = false,
): string => {
  const stops = scrubStops(meta, canonicalDirty)
  const latest = meta.revisions[meta.revisions.length - 1]?.id ?? null
  const at = current ? stops.findIndex((s) => s.id === current) : stops.length - 1
  const stop = stops[Math.max(0, at)]
  const scrub = stops.length > 1
    ? `<label class="scrub"><input id="vscrub" type="range" min="0" max="${stops.length - 1}" step="1" value="${Math.max(0, at)}" aria-label="Revision">` +
      `<span class="scrub-label" id="vscrub-label">${escapeHtml(stop.label)} <small>${escapeHtml(stop.note)}</small></span></label>`
    : `<span class="scrub"><span class="scrub-label">${escapeHtml(stop?.label ?? 'draft')}</span></span>`
  const openCount = meta.comments.filter((c) => c.status === 'open').length
  const approval = latestApproval(meta)
  const approvedLatest = Boolean(approval && latest && approval.rev === latest && !canonicalDirty)
  const approveButton = canWrite && latest && !current
    ? approvedLatest
      ? `<button class="vb approved" type="button" disabled>Approved ${escapeHtml(latest)}</button>`
      : `<button class="vb approve" id="vapprove" type="button" data-rev="${escapeHtml(latest)}" title="Sign off on ${escapeHtml(latest)}">Approve<span class="label-long">&nbsp;${escapeHtml(latest)}</span></button>`
    : ''
  const note = !canWrite && !current ? '<span class="vbar-note">read-only link</span>' : ''
  return `<div class="vbar-pad"></div>
<nav class="vbar" aria-label="Viewer">
  <a href="/" title="All documents">←<span class="label-long">&nbsp;Documents</span></a>
  <span class="sep"></span>
  ${scrub}
  <button class="vb" type="button" data-traces-toggle aria-pressed="false" title="Show the previous draft under this one (T)">Traces</button>
  <span class="sep"></span>
  <button id="vc-toggle" class="vb vc-toggle" type="button" aria-controls="vc-drawer" aria-expanded="false" aria-label="Comments">${COMMENT_ICON}<span id="vc-count">${openCount}</span></button>
  ${approveButton}
  ${note}
  ${canStop ? stopButton(true) : ''}
</nav>`
}

const KIND_LABELS: Record<string, string> = {
  implementation: 'Implementation plan', brainstorm: 'Brainstorm', audit: 'Audit', 'design-doc': 'Design doc', plan: 'Plan',
}

const indexPage = (root: string, canStop = false): string => {
  const css = renderStylesheet()
  const chromeJs = fs.readFileSync(path.join(ASSETS, 'chrome.js'), 'utf8')
  const rootName = path.basename(root)
  const items = findPentimentoDocs(root)
    .map((p) => {
      const doc = loadDoc(p)
      let meta: Meta = { revisions: [], comments: [] }
      try { meta = readMeta(doc.historyDir) } catch { /* show the doc anyway */ }
      const latest = meta.revisions[meta.revisions.length - 1]
      const revisionState = canonicalRevisionState(doc, meta)
      const rel = path.relative(root, p).split(path.sep).join('/')
      const archetype = doc.frontmatter['Archetype'] ? String(doc.frontmatter['Archetype']) : ''
      const title = /^#\s+(.+)$/m.exec(doc.body)?.[1]?.replace(/[`*_]/g, '').trim() || doc.name
      return {
        rel,
        title,
        kind: archetype ? KIND_LABELS[archetype] ?? archetype : '',
        rev: revisionState.label,
        summary: latest?.summary ?? '',
        date: latest?.created_at?.slice(0, 10) ?? '',
        open: meta.comments.filter((c) => c.status === 'open').length,
        approved: latestApproval(meta)?.rev === latest?.id && !revisionState.dirty,
      }
    })
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((d) =>
      `<li><a href="/doc/${encodeURI(d.rel)}">
  <div class="meta">${d.kind ? `<span class="kind">${escapeHtml(d.kind)}</span>` : ''}<span>${escapeHtml(d.rev)}</span>${d.date ? `<span>${escapeHtml(shortDate(d.date))}</span>` : ''}${d.approved ? '<span class="approved">Approved</span>' : ''}${d.open ? `<span>${d.open} open comment${d.open > 1 ? 's' : ''}</span>` : ''}</div>
  <h3>${escapeHtml(d.title)}</h3>
  ${d.summary ? `<p>${escapeHtml(d.summary)}</p>` : ''}
</a></li>`)
    .join('\n')
  return secureHtml(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pentimento · ${escapeHtml(rootName)}</title>
${FAVICON_TAG}
<style>
${css}</style>
</head>
<body>
${RESTORE_SNIPPET}
<div class="wrap">
<header class="doc">
  <div class="meta"><span class="kind">Pentimento</span><span>${escapeHtml(rootName)}</span><span class="meta-tools">${schemeToggle()}${canStop ? stopButton() : ''}</span></div>
  <h1>Documents</h1>
</header>
<main>
${items ? `<ul class="doclist">\n${items}\n</ul>` : '<div class="empty-state"><h2>Nothing here yet</h2><p>Write a Markdown file in this folder, then save its first draft:</p><code>pentimento snapshot Song.md</code></div>'}
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
  const broadcast = (payload: { docs: string[]; metas: string[]; images?: boolean }) => {
    const data = JSON.stringify(payload)
    clients.forEach((send) => send(data))
  }
  // which browser session created which comment — scopes undo/delete; dies with the server
  const owners = new Map<string, string>()
  const canWrite = (c: Context): boolean => !viewerOpts.writeToken || sameToken(getCookie(c, WRITE_COOKIE), viewerOpts.writeToken)
  const canStop = (c: Context): boolean => Boolean(viewerOpts.onShutdown) && canWrite(c)
  const expectedOrigin = (c: Context): string => viewerOpts.origin ?? new URL(c.req.url).origin
  const htmlResponse = (c: Context, html: string): Response => {
    const secured = secureHtml(html, { selfImages: true })
    c.header('Content-Security-Policy', contentSecurityPolicy(secured, true, true))
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

  /** The first draft that saved each stored image, so a comment on a replaced image can link to it. */
  const assetDrafts = (meta: Meta): Record<string, string> => {
    const out: Record<string, string> = {}
    for (const r of meta.revisions) {
      for (const [ref, hash] of Object.entries(r.images ?? {})) {
        const asset = `${hash}.${imageExtension(ref.replace(/^\[\[|\]\]$/g, ''))}`
        if (!(asset in out)) out[asset] = r.id
      }
    }
    return out
  }

  const commentsPayload = (abs: string) => {
    const meta = readMeta(loadDoc(abs).historyDir)
    return {
      comments: meta.comments,
      revisions: meta.revisions.map((r) => r.id),
      assets: assetDrafts(meta),
    }
  }

  const decodeRel = (encoded: string): string | null => {
    try { return decodeURIComponent(encoded) } catch { return null }
  }
  const imageUrl = (rel: string) => (asset: string): string => `/asset/${encodeURIComponent(rel)}/${asset}`

  /** A comment on an image names it by its stored copy; the reference comes from the document itself. */
  const imageMark = (abs: string, raw: unknown): ImageMark | string | null => {
    if (raw === undefined || raw === null) return null
    const r = (typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    const asset = typeof r.asset === 'string' && ASSET_RE.test(r.asset) ? r.asset : ''
    const ref = asset ? imageRefFor(abs, asset) : null
    if (!ref) return 'the image is not in the document'
    const mark: ImageMark = { ref, asset }
    if (r.box !== undefined && r.box !== null) mark.box = r.box as ImageMark['box']
    if (r.width !== undefined) mark.width = r.width as number
    if (r.height !== undefined) mark.height = r.height as number
    const problem = imageMarkProblem(mark)
    return problem ? `image ${problem}` : mark
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
    const since = c.req.query('since') ?? undefined
    if (since && !hasRevision(abs, since)) return c.notFound()
    let html: string
    try {
      // the viewer replaces the static header panel with its drawer
      html = rev
        ? renderRevisionHtml(abs, rev, { omitCommentsPanel: true, since, drafts: 0, imageUrl: imageUrl(rel) })
        : render(abs, { omitCommentsPanel: true, since, drafts: 0, imageUrl: imageUrl(rel) })
    } catch (e) {
      return c.text(e instanceof Error ? e.message : String(e), 500)
    }
    const doc = loadDoc(abs)
    const meta = readMeta(doc.historyDir)
    const revisionState = canonicalRevisionState(doc, meta)
    const canComment = !rev && canWrite(c)
    const stoppable = canStop(c)
    const cfg = {
      rel,
      rev,
      canComment,
      canWrite: canWrite(c),
      author: viewerOpts.author ?? 'reader',
      comments: meta.comments,
      revisions: meta.revisions.map((r) => r.id),
      assets: assetDrafts(meta),
      stops: scrubStops(meta, revisionState.dirty),
      dirty: revisionState.dirty,
    }
    const cfgScript = `<script>window.__pentimento=${JSON.stringify(cfg).replace(/</g, '\\u003c')}</script>\n<script>\n${viewerJs}</script>`
    return htmlResponse(c, html.replace('</body>', `${viewerBar(meta, rev, revisionState.dirty, canWrite(c), stoppable)}\n${cfgScript}\n${stoppable ? STOP_SNIPPET : ''}\n</body>`))
  })

  // Images by content hash, so the browser keeps them across the page re-fetches after every
  // change. The sandbox policy matters for SVG: opened directly at this address, its scripts
  // would otherwise run on the viewer's origin, where the write cookie goes with every request.
  app.get('/asset/*', (c) => {
    const rest = c.req.path.slice('/asset/'.length)
    const slash = rest.lastIndexOf('/')
    const rel = slash > 0 ? decodeRel(rest.slice(0, slash)) : null
    const asset = rest.slice(slash + 1)
    if (rel === null || !ASSET_RE.test(asset)) return c.notFound()
    const abs = resolveDoc(rel)
    if (!abs) return c.notFound()
    let file: string | null
    try { file = imageFile(abs, asset) } catch { return c.notFound() }
    if (!file) return c.notFound()
    c.header('Content-Type', MIME[imageExtension(asset)!])
    c.header('Cache-Control', 'private, max-age=31536000, immutable')
    c.header('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'")
    c.header('X-Content-Type-Options', 'nosniff')
    c.header('Referrer-Policy', 'no-referrer')
    return c.body(fs.readFileSync(file))
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
    const image = imageMark(abs, b.image)
    if (typeof image === 'string') return c.text(image, 400)
    const entry = addComment(abs, {
      text,
      anchor: typeof b.anchor === 'string' ? b.anchor : '',
      quote: typeof b.quote === 'string' && b.quote ? b.quote.slice(0, 600) : undefined,
      prefix: typeof b.prefix === 'string' && b.prefix ? b.prefix : undefined,
      suffix: typeof b.suffix === 'string' && b.suffix ? b.suffix : undefined,
      author: viewerOpts.author ?? 'reader',
      ...(image ? { image } : {}),
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

  app.post('/api/approve', async (c) => {
    const b = await c.req.json().catch(() => null)
    if (!b) return c.text('bad json', 400)
    if (tooLong(b.rel, 1024) || tooLong(b.rev, 16)) return c.text('field too large', 413)
    const abs = resolveDoc(String(b.rel ?? ''))
    if (!abs) return c.notFound()
    const rev = typeof b.rev === 'string' && b.rev ? b.rev : undefined
    if (rev && !hasRevision(abs, rev)) return c.notFound()
    try {
      return c.json(approve(abs, rev, viewerOpts.author ?? 'reader'))
    } catch (e) {
      return c.text(e instanceof Error ? e.message : String(e), 409)
    }
  })

  app.post('/api/answer', async (c) => {
    const b = await c.req.json().catch(() => null)
    if (!b) return c.text('bad json', 400)
    if (tooLong(b.rel, 1024) || tooLong(b.anchor, 128) || tooLong(b.question, 600) || tooLong(b.choice, 300)) {
      return c.text('field too large', 413)
    }
    const abs = resolveDoc(String(b.rel ?? ''))
    if (!abs) return c.notFound()
    const anchor = String(b.anchor ?? '')
    const choice = String(b.choice ?? '').trim()
    if (!/^#[a-z][\w-]*$/.test(anchor) || !choice) return c.text('answer needs an #anchor and a choice', 400)
    return c.json(answerQuestion(abs, {
      anchor, choice, question: String(b.question ?? '').slice(0, 600), author: viewerOpts.author ?? 'reader',
    }))
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
      const html = renderDiffPage(abs, a, b, { imageUrl: imageUrl(rel) })
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
  let watcher: TreeWatcher | null = null
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
  // page, .yml paths make every page re-fetch its comments, and a changed image morphs
  // every page, since a new screenshot changes the page without a markdown edit.
  const docs = new Set<string>()
  const metas = new Set<string>()
  let imagesChanged = false
  watcher = watchTree(absRoot, (f) => {
    if (/\.md$/.test(f)) docs.add(f)
    else if (/\.yml$/.test(f)) metas.add(f)
    // stored copies are named by their hash and change only with a snapshot, which morphs the page anyway
    else if (imageExtension(f) && !ASSET_RE.test(f.slice(f.lastIndexOf('/') + 1))) imagesChanged = true
    else return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      broadcast({ docs: [...docs], metas: [...metas], ...(imagesChanged ? { images: true } : {}) })
      docs.clear()
      metas.clear()
      imagesChanged = false
    }, 200)
  }, (message) => console.error(`pentimento: ${message}`))

  server = serve({ fetch: app.fetch, hostname: host, port }) as HttpServer
  return server
}
