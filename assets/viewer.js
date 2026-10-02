(() => {
  const cfg = window.__pentimento
  if (!cfg) return
  let main = document.querySelector('main')
  if (!main) return

  // --- state ------------------------------------------------------------
  const state = { comments: cfg.comments || [], revisions: cfg.revisions || [] }
  const canWrite = cfg.canWrite !== undefined ? cfg.canWrite : cfg.canComment
  // the revision on screen, or null for the current document; the scrubber changes it
  let viewingRev = cfg.rev || null
  const canCommentNow = () => canWrite && !viewingRev && !main.classList.contains('traces')
  const ownedKey = 'vc-owned:' + cfg.rel
  let session = ''
  let owned = new Set()
  try {
    session = sessionStorage.getItem('vc-session') || crypto.randomUUID()
    sessionStorage.setItem('vc-session', session)
    owned = new Set(JSON.parse(sessionStorage.getItem(ownedKey) || '[]'))
  } catch (e) { session = String(Math.random()).slice(2) }
  const rememberOwned = (id) => {
    owned.add(id)
    try { sessionStorage.setItem(ownedKey, JSON.stringify([...owned])) } catch (e) {}
  }

  const DRAFT_KEY = 'vc-draft:' + cfg.rel
  let form = null
  let morphQueued = false

  const api = async (url, body) => {
    let res
    try {
      res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    } catch (e) {
      throw new Error("the server didn't answer")
    }
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 140)
      throw new Error(detail || 'HTTP ' + res.status)
    }
    return res.json()
  }

  const el = (tag, cls, text) => {
    const n = document.createElement(tag)
    if (cls) n.className = cls
    if (text !== undefined) n.textContent = text
    return n
  }
  const commentIcon = () => {
    const ns = 'http://www.w3.org/2000/svg'
    const svg = document.createElementNS(ns, 'svg')
    svg.setAttribute('class', 'comment-icon')
    svg.setAttribute('viewBox', '0 0 20 20')
    svg.setAttribute('aria-hidden', 'true')
    const bubble = document.createElementNS(ns, 'path')
    bubble.setAttribute('d', 'M5.25 3.75h9.5a2.5 2.5 0 0 1 2.5 2.5v5.5a2.5 2.5 0 0 1-2.5 2.5H9l-4.25 2.5v-2.6a2.5 2.5 0 0 1-2-2.4v-5.5a2.5 2.5 0 0 1 2.5-2.5Z')
    const dots = document.createElementNS(ns, 'path')
    dots.setAttribute('class', 'comment-dots')
    dots.setAttribute('d', 'M7 9h.01M10 9h.01M13 9h.01')
    svg.append(bubble, dots)
    return svg
  }

  // --- anchoring: normalized cross-node text search ----------------------
  // Quotes are matched against a whitespace-collapsed view of main's text nodes,
  // so selections that cross bold/links/paragraphs anchor fine. prefix/suffix
  // (W3C-annotation context) disambiguate repeated quotes.
  const normalize = (s) => s.replace(/\s+/g, ' ').trim()

  let index = null
  const buildIndex = () => {
    const map = []
    let norm = ''
    let pendingSpace = false
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT)
    let node
    while ((node = walker.nextNode())) {
      const text = node.textContent
      for (let i = 0; i < text.length; i++) {
        if (/\s/.test(text[i])) { if (norm) pendingSpace = true; continue }
        if (pendingSpace) { norm += ' '; map.push(map[map.length - 1]); pendingSpace = false }
        norm += text[i]
        map.push({ node, offset: i })
      }
    }
    index = { norm, map }
  }

  const findRange = (c) => {
    if (!c.quote || !index) return null
    const q = normalize(c.quote)
    if (!q) return null
    const { norm, map } = index
    const starts = []
    let from = 0
    let at
    while ((at = norm.indexOf(q, from)) >= 0) { starts.push(at); from = at + 1 }
    if (!starts.length) return null
    let best = starts[0]
    if (starts.length > 1) {
      const p = normalize(c.prefix || '')
      const s = normalize(c.suffix || '')
      let bestScore = -1
      for (const st of starts) {
        let score = 0
        if (p && norm.slice(Math.max(0, st - p.length), st) === p) score += 2
        if (s && norm.slice(st + q.length, st + q.length + s.length) === s) score += 2
        if (score > bestScore) { bestScore = score; best = st }
      }
    }
    const a = map[best]
    const b = map[best + q.length - 1]
    if (!a || !b) return null
    const range = document.createRange()
    try {
      range.setStart(a.node, a.offset)
      range.setEnd(b.node, b.offset + 1)
    } catch (e) { return null }
    return range
  }

  // --- highlights (CSS Custom Highlight API) -----------------------------
  const canHighlight = typeof Highlight !== 'undefined' && typeof CSS !== 'undefined' && CSS.highlights
  const rangesById = new Map()

  const applyHighlights = () => {
    buildIndex()
    rangesById.clear()
    if (!canHighlight) return
    const hl = new Highlight()
    for (const c of state.comments) {
      // answers show on their question block, not as highlights
      if (c.status !== 'open' || c.answer !== undefined) continue
      const r = findRange(c)
      if (!r) continue
      rangesById.set(c.id, r)
      hl.add(r)
    }
    CSS.highlights.set('vc-open', hl)
  }

  const flash = (range) => {
    if (!canHighlight || !range) return
    CSS.highlights.set('vc-flash', new Highlight(range))
    setTimeout(() => CSS.highlights.delete('vc-flash'), 1600)
  }

  const caretAt = (x, y) => {
    if (document.caretPositionFromPoint) {
      const p = document.caretPositionFromPoint(x, y)
      return p ? { node: p.offsetNode, offset: p.offset } : null
    }
    if (document.caretRangeFromPoint) {
      const r = document.caretRangeFromPoint(x, y)
      return r ? { node: r.startContainer, offset: r.startOffset } : null
    }
    return null
  }

  const commentAtPoint = (x, y) => {
    const pos = caretAt(x, y)
    if (!pos || !pos.node || pos.node.nodeType !== Node.TEXT_NODE) return null
    for (const [id, range] of rangesById) {
      try { if (range.comparePoint(pos.node, pos.offset) === 0) return id } catch (e) {}
    }
    return null
  }

  // --- toast --------------------------------------------------------------
  let toastEl = null
  const toastAt = (rect, message, actionLabel, actionFn) => {
    if (toastEl) toastEl.remove()
    const t = el('div', 'vc-toast')
    t.setAttribute('role', 'status')
    t.appendChild(el('span', '', message))
    if (actionLabel) {
      const b = el('button', 'vc-act', actionLabel)
      b.type = 'button'
      b.addEventListener('click', async () => {
        t.remove()
        if (toastEl === t) toastEl = null
        try { await actionFn() } catch (e) { toastAt(null, e.message) }
      })
      t.appendChild(b)
    }
    if (rect && (rect.width || rect.height)) {
      t.classList.add('anchored')
      t.style.top = (scrollY + rect.bottom + 10) + 'px'
      t.style.left = (scrollX + Math.max(8, Math.min(rect.left, innerWidth - 240))) + 'px'
    }
    document.body.appendChild(t)
    toastEl = t
    setTimeout(() => {
      if (toastEl === t) { t.remove(); toastEl = null }
    }, 6000)
  }

  // --- drawer ---------------------------------------------------------------
  const drawer = el('div', 'vc-drawer')
  drawer.id = 'vc-drawer'
  drawer.setAttribute('role', 'dialog')
  drawer.setAttribute('aria-label', 'Comments')
  drawer.hidden = true
  document.body.appendChild(drawer)
  let drawerOpener = null

  const openCount = () => state.comments.filter((c) => c.status === 'open').length
  const syncCount = () => {
    const n = document.getElementById('vc-count')
    if (n) n.textContent = String(openCount())
  }

  const revBefore = (rev) => {
    const i = state.revisions.indexOf(rev)
    return i > 0 ? state.revisions[i - 1] : null
  }

  const action = (label, fn) => {
    const b = el('button', 'vc-act', label)
    b.type = 'button'
    b.addEventListener('click', fn)
    return b
  }

  const jumpTo = (id) => {
    const range = rangesById.get(id)
    if (!range) return
    const target = range.startContainer.parentElement
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' })
    flash(range)
  }

  const doResolve = async (c) => {
    try {
      await api('/api/resolve', { rel: cfg.rel, id: c.id })
      c.status = 'resolved'
      c.resolved_in = null
      rerender()
      toastAt(null, 'Resolved ' + c.id, 'Undo', async () => {
        await api('/api/reopen', { rel: cfg.rel, id: c.id })
        c.status = 'open'
        rerender()
      })
    } catch (e) { toastAt(null, "Couldn't resolve — " + e.message) }
  }

  const doReopen = async (c) => {
    try {
      await api('/api/reopen', { rel: cfg.rel, id: c.id })
      c.status = 'open'
      c.resolved_in = null
      rerender()
    } catch (e) { toastAt(null, "Couldn't reopen — " + e.message) }
  }

  const doDelete = async (c) => {
    try {
      await api('/api/uncomment', { rel: cfg.rel, id: c.id, session })
      state.comments = state.comments.filter((x) => x.id !== c.id)
      rerender()
    } catch (e) { toastAt(null, "Couldn't delete — " + e.message) }
  }

  const replyBox = (cardEl, c) => {
    if (cardEl.querySelector('.vc-replybox')) { cardEl.querySelector('.vc-replybox textarea').focus(); return }
    const box = el('div', 'vc-replybox')
    const ta = el('textarea')
    ta.placeholder = 'Reply…'
    const send = action('Send', async () => {
      const text = ta.value.trim()
      if (!text) { ta.focus(); return }
      send.disabled = true
      try {
        const updated = await api('/api/reply', { rel: cfg.rel, id: c.id, text })
        c.replies = updated.replies
        rerender()
      } catch (e) {
        send.disabled = false
        toastAt(null, "Couldn't reply — " + e.message)
      }
    })
    box.appendChild(ta)
    box.appendChild(send)
    cardEl.appendChild(box)
    ta.focus()
  }

  const card = (c) => {
    const div = el('div', 'vc-card')
    div.dataset.cid = c.id
    div.dataset.status = c.status
    if (c.quote) div.appendChild(el('blockquote', '', c.quote))
    div.appendChild(el('p', 'vc-text', c.text))
    for (const r of c.replies || []) {
      const rp = el('p', 'vc-reply')
      rp.appendChild(el('strong', '', r.author + ' '))
      rp.appendChild(document.createTextNode(r.text))
      div.appendChild(rp)
    }
    div.appendChild(el('div', 'vc-meta', c.author + ' · ' + String(c.created_at).slice(0, 10)))
    if (c.status === 'resolved') {
      if (c.resolved_in) {
        const prev = revBefore(c.resolved_in)
        if (prev) {
          const a = el('a', 'vc-resolved', 'resolved in ' + c.resolved_in + ' · what changed')
          a.href = '/diff/' + encodeURI(cfg.rel) + '?a=' + prev + '&b=' + c.resolved_in
          div.appendChild(a)
        } else {
          div.appendChild(el('span', 'vc-resolved', 'resolved in ' + c.resolved_in))
        }
      } else {
        div.appendChild(el('span', 'vc-resolved', 'resolved'))
      }
    }
    const row = el('div', 'vc-actions')
    if (rangesById.has(c.id)) row.appendChild(action('Jump', () => jumpTo(c.id)))
    if (canWrite) {
      if (c.status === 'open') {
        row.appendChild(action('Resolve', () => doResolve(c)))
        row.appendChild(action('Reply', () => replyBox(div, c)))
      } else {
        row.appendChild(action('Reopen', () => doReopen(c)))
      }
      if (owned.has(c.id)) row.appendChild(action('Delete', () => doDelete(c)))
    }
    if (row.childNodes.length) div.appendChild(row)
    return div
  }

  const renderDrawer = () => {
    const hadFocus = drawer.contains(document.activeElement)
    drawer.textContent = ''
    const head = el('div', 'vc-drawer-head')
    head.appendChild(el('strong', '', 'Comments'))
    const controls = el('div', 'vc-actions')
    if (canCommentNow()) {
      controls.appendChild(action('New comment', () => openForm({
        quote: '', prefix: '', suffix: '', anchor: location.hash || '', rect: null,
      })))
    }
    const close = el('button', 'vc-act', '✕')
    close.type = 'button'
    close.setAttribute('aria-label', 'Close comments')
    close.addEventListener('click', closeDrawer)
    controls.appendChild(close)
    head.appendChild(controls)
    drawer.appendChild(head)
    const open = state.comments.filter((c) => c.status === 'open')
    const resolved = state.comments.filter((c) => c.status === 'resolved')
    drawer.appendChild(el('h3', 'vc-h', open.length + ' open'))
    if (!open.length) {
      drawer.appendChild(el('p', 'vc-empty', canWrite ? 'Select text in the document to leave one.' : 'None.'))
    }
    open.forEach((c) => drawer.appendChild(card(c)))
    if (resolved.length) {
      drawer.appendChild(el('h3', 'vc-h', resolved.length + ' resolved'))
      resolved.forEach((c) => drawer.appendChild(card(c)))
    }
    syncCount()
    if (hadFocus) close.focus()
  }

  const openDrawer = (focusId) => {
    drawerOpener = document.activeElement
    renderDrawer()
    drawer.hidden = false
    const tg = document.getElementById('vc-toggle')
    if (tg) tg.setAttribute('aria-expanded', 'true')
    if (focusId) {
      const cardEl = drawer.querySelector('[data-cid="' + focusId + '"]')
      if (cardEl) {
        cardEl.tabIndex = -1
        cardEl.scrollIntoView({ block: 'nearest' })
        cardEl.classList.add('vc-focus')
        cardEl.focus()
        setTimeout(() => cardEl.classList.remove('vc-focus'), 1600)
      }
      flash(rangesById.get(focusId))
    } else drawer.querySelector('[aria-label="Close comments"]')?.focus()
  }

  const closeDrawer = () => {
    drawer.hidden = true
    const tg = document.getElementById('vc-toggle')
    if (tg) tg.setAttribute('aria-expanded', 'false')
    const restore = drawerOpener?.isConnected ? drawerOpener : tg
    drawerOpener = null
    restore?.focus()
  }

  const rerender = () => {
    applyHighlights()
    if (!drawer.hidden) renderDrawer()
    else syncCount()
  }

  // --- live updates: comments refetch + document morph ---------------------
  const refreshComments = async () => {
    try {
      const res = await fetch('/api/comments?rel=' + encodeURIComponent(cfg.rel))
      if (!res.ok) return
      const data = await res.json()
      state.comments = data.comments || []
      state.revisions = data.revisions || state.revisions
      rerender()
    } catch (e) { /* transient — the next event retries */ }
  }

  const morph = async () => {
    morphQueued = false
    try {
      const active = document.activeElement
      const focusSelector = active?.id
        ? '#' + CSS.escape(active.id)
        : active?.matches?.('[data-stop-viewer]') ? '[data-stop-viewer]' : null
      const res = await fetch(location.pathname + location.search)
      if (!res.ok) return
      const html = await res.text()
      const doc = new DOMParser().parseFromString(html, 'text/html')
      const newWrap = doc.querySelector('.wrap')
      const wrap = document.querySelector('.wrap')
      if (!newWrap || !wrap) return
      wrap.innerHTML = newWrap.innerHTML
      main = document.querySelector('main')
      const newBar = doc.querySelector('.vbar')
      const bar = document.querySelector('.vbar')
      if (newBar && bar) bar.innerHTML = newBar.innerHTML
      if (doc.title) document.title = doc.title
      afterSwap()
      if (focusSelector) document.querySelector(focusSelector)?.focus()
    } catch (e) { /* keep the current view */ }
  }

  const queueMorph = () => {
    if (form) { morphQueued = true; return }
    morph()
  }

  const es = new EventSource('/__events')
  es.onmessage = (e) => {
    let msg
    try { msg = JSON.parse(e.data) } catch (err) { return }
    if (msg.metas && msg.metas.length) refreshComments()
    if (!viewingRev && msg.docs && msg.docs.indexOf(cfg.rel) >= 0) queueMorph()
    // a new screenshot changes the page without a markdown edit
    else if (!viewingRev && msg.images) queueMorph()
    // approvals and answers live in meta.yml and change what the page shows
    else if (!viewingRev && msg.metas && msg.metas.length) queueMorph()
  }

  // --- global delegated listeners (survive morphs) ---------------------------
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !drawer.hidden) {
      closeDrawer()
      e.preventDefault()
    }
  })

  document.addEventListener('click', (e) => {
    const t = e.target
    if (t.closest && t.closest('#vc-toggle')) {
      if (drawer.hidden) openDrawer()
      else closeDrawer()
      return
    }
    if (form || !main.contains(t)) return
    const s = getSelection()
    if (s && !s.isCollapsed) return
    const id = commentAtPoint(e.clientX, e.clientY)
    if (id) openDrawer(id)
  })

  // --- after any content swap: rebind everything that reads the page --------
  const syncTracesButton = () => {
    const has = Boolean(document.getElementById('traces-tpl'))
    document.querySelectorAll('.vbar [data-traces-toggle]').forEach((b) => { b.hidden = !has })
  }
  const syncAsk = () => {
    document.querySelectorAll('.ask-opt').forEach((b) => { b.disabled = !canCommentNow() })
  }
  function afterSwap() {
    main = document.querySelector('main')
    if (window.__pSyncChrome) window.__pSyncChrome()
    syncTracesButton()
    syncAsk()
    syncSinceNote()
    rerender()
  }
  document.addEventListener('pentimento:content', () => {
    main = document.querySelector('main')
    syncAsk()
    rerender()
  })

  // --- scrubber: drag through the drafts ----------------------------------
  const stops = cfg.stops || []
  const pageCache = new Map()
  const urlFor = (id) => location.pathname + (id && id !== stops[stops.length - 1]?.id ? '?rev=' + id : '')
  const fetchPage = (id) => {
    if (!pageCache.has(id)) {
      pageCache.set(id, fetch(location.pathname + (id === 'canonical' ? '' : '?rev=' + id)).then((r) => {
        if (!r.ok) throw new Error('HTTP ' + r.status)
        return r.text()
      }).catch((e) => { pageCache.delete(id); throw e }))
    }
    return pageCache.get(id)
  }
  let scrubSeq = 0
  const showStop = async (index) => {
    const stop = stops[index]
    if (!stop) return
    const label = document.getElementById('vscrub-label')
    if (label) {
      label.textContent = stop.label + ' '
      label.appendChild(el('small', '', stop.note))
    }
    const seq = ++scrubSeq
    let html
    try { html = await fetchPage(stop.id) } catch (e) { return }
    if (seq !== scrubSeq) return
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const newWrap = doc.querySelector('.wrap')
    const wrap = document.querySelector('.wrap')
    if (!newWrap || !wrap) return
    const isLatest = index === stops.length - 1
    viewingRev = isLatest ? null : stop.id
    wrap.innerHTML = newWrap.innerHTML
    history.replaceState(null, '', isLatest ? location.pathname : location.pathname + '?rev=' + stop.id)
    btn && (btn.hidden = true)
    afterSwap()
  }
  document.addEventListener('input', (e) => {
    if (e.target && e.target.id === 'vscrub') showStop(Number(e.target.value))
  })
  void urlFor

  // --- since you last read -------------------------------------------------
  const SEEN_KEY = 'pentimento-seen:' + cfg.rel
  const latestRev = state.revisions[state.revisions.length - 1] || null
  let seenAtBoot = null
  try { seenAtBoot = localStorage.getItem(SEEN_KEY) } catch (e) {}
  const markSeen = () => {
    if (!viewingRev && latestRev) { try { localStorage.setItem(SEEN_KEY, latestRev) } catch (e) {} }
  }
  addEventListener('pagehide', markSeen)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') markSeen() })
  function syncSinceNote() {
    const header = document.querySelector('header.doc')
    if (!header || header.querySelector('.since-note')) return
    const params = new URLSearchParams(location.search)
    if (viewingRev || params.get('since')) return
    // approved earlier than the latest draft: offer the diff since sign-off
    const approved = header.querySelector('.approved[data-approved]')
    const approvedRev = approved?.getAttribute('data-approved')
    const seen = seenAtBoot
    const previous = state.revisions[state.revisions.length - 2]
    let rev = null
    let text = ''
    if (approvedRev && approvedRev !== latestRev && state.revisions.includes(approvedRev)) {
      rev = approvedRev
      text = 'You approved ' + approvedRev + '. '
    } else if (seen && seen !== latestRev && seen !== previous && state.revisions.includes(seen)) {
      rev = seen
      text = 'You last read ' + seen + '. '
    }
    if (!rev) return
    const note = el('p', 'since-note', text)
    const a = el('a', '', 'Show everything that changed since then')
    a.href = location.pathname + '?since=' + rev
    note.appendChild(a)
    const after = header.querySelector('.latest') || header.querySelector('.standfirst') || header.querySelector('h1')
    after.after(note)
  }

  // --- approve -----------------------------------------------------------------
  document.addEventListener('click', async (e) => {
    const t = e.target
    const approveBtn = t.closest && t.closest('#vapprove')
    if (approveBtn) {
      if (!confirm('Approve ' + approveBtn.dataset.rev + '? The agent sees this as your sign-off.')) return
      approveBtn.disabled = true
      try {
        await api('/api/approve', { rel: cfg.rel, rev: approveBtn.dataset.rev })
        await morph()
        toastAt(null, 'Approved ' + approveBtn.dataset.rev)
      } catch (err) {
        approveBtn.disabled = false
        toastAt(null, "Couldn't approve: " + err.message)
      }
      return
    }
    // --- ask: answer a question in the page -------------------------------------
    const opt = t.closest && t.closest('.ask-opt')
    if (!opt || opt.disabled || !canCommentNow()) return
    const box = opt.closest('.ask')
    if (!box) return
    const question = box.querySelector('.ask-q')?.textContent.replace(/#$/, '').trim() || ''
    const anchorId = '#' + box.dataset.ask
    if (opt.hasAttribute('data-other')) {
      openForm({ quote: question, prefix: '', suffix: '', anchor: anchorId, rect: opt.getBoundingClientRect() })
      return
    }
    const choice = opt.dataset.choice
    box.querySelectorAll('.ask-opt').forEach((b) => b.setAttribute('aria-pressed', String(b === opt)))
    try {
      const entry = await api('/api/answer', { rel: cfg.rel, anchor: anchorId, question, choice })
      state.comments = state.comments.filter((c) => !(c.answer !== undefined && c.anchor === anchorId && c.status === 'open'))
      state.comments.push(entry)
      const stateLine = box.querySelector('.ask-state')
      if (stateLine) stateLine.textContent = 'You answered “' + choice + '” · waiting for the next draft'
      syncCount()
    } catch (err) {
      toastAt(null, "Couldn't save the answer: " + err.message)
    }
  })

  // --- boot ---------------------------------------------------------------
  const viewerBar = document.querySelector('.vbar')
  if (viewerBar && typeof ResizeObserver !== 'undefined') {
    const syncBarHeight = () => document.documentElement.style.setProperty('--vbar-height', viewerBar.offsetHeight + 'px')
    new ResizeObserver(syncBarHeight).observe(viewerBar)
    syncBarHeight()
  }
  let btn = null
  applyHighlights()
  syncCount()
  syncTracesButton()
  syncAsk()
  syncSinceNote()

  // an old draft or the traces view: selecting text explains why it can't be commented
  const hint = el('div', 'vc-hint')
  hint.hidden = true
  document.body.appendChild(hint)
  let ht = null
  document.addEventListener('selectionchange', () => {
    if (ht) clearTimeout(ht)
    ht = setTimeout(() => {
      const s = getSelection()
      const blocked = viewingRev || main.classList.contains('traces')
      if (!blocked || !s || s.isCollapsed || !s.rangeCount || !s.getRangeAt(0).intersectsNode(main)) { hint.hidden = true; return }
      hint.textContent = ''
      if (viewingRev) {
        hint.appendChild(document.createTextNode(viewingRev + ' is read-only. '))
        const link = el('a', '', 'Comment on the current draft')
        link.href = location.pathname
        hint.appendChild(link)
      } else {
        hint.appendChild(document.createTextNode('Hide traces (T) to comment.'))
      }
      const r = s.getRangeAt(0).getBoundingClientRect()
      hint.style.top = (scrollY + r.bottom + 8) + 'px'
      hint.style.left = (scrollX + Math.max(8, Math.min(r.left, innerWidth - 300))) + 'px'
      hint.hidden = false
    }, 180)
  })

  if (!canWrite) return

  // --- select text → comment button → popover form -------------------------
  btn = el('button', 'vc-add')
  btn.append(commentIcon(), document.createTextNode('Comment'))
  btn.type = 'button'
  btn.hidden = true
  document.body.appendChild(btn)
  btn.addEventListener('mousedown', (e) => e.preventDefault()) // keep the selection alive

  let pending = null

  const nearestAnchor = (startNode) => {
    let node = startNode.nodeType === 1 ? startNode : startNode.parentElement
    if (!node) return ''
    const closest = node.closest('[id]')
    if (closest && main.contains(closest)) return '#' + closest.id
    let best = ''
    for (const cand of main.querySelectorAll('[id]')) {
      if (cand.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) best = '#' + cand.id
    }
    return best
  }

  const captureSelection = () => {
    if (!canCommentNow()) { btn.hidden = true; pending = null; return }
    const s = getSelection()
    if (!s || s.isCollapsed || !s.rangeCount) { btn.hidden = true; pending = null; return }
    const range = s.getRangeAt(0)
    // intersects, not contains: a drag that starts in the margin still counts
    if (!range.intersectsNode(main)) { btn.hidden = true; pending = null; return }
    const raw = s.toString().trim()
    if (!raw) { btn.hidden = true; pending = null; return }
    const rect = range.getBoundingClientRect()
    btn.style.top = (scrollY + rect.bottom + 8) + 'px'
    btn.style.left = (scrollX + Math.max(8, Math.min(rect.left, innerWidth - 140))) + 'px'
    const startText = range.startContainer.textContent || ''
    const endText = range.endContainer.textContent || ''
    pending = {
      quote: raw.slice(0, 600),
      truncated: raw.length > 600,
      prefix: startText.slice(Math.max(0, range.startOffset - 32), range.startOffset),
      suffix: endText.slice(range.endOffset, range.endOffset + 32),
      anchor: nearestAnchor(range.startContainer),
      range: range.cloneRange(),
      rect,
    }
    btn.hidden = false
  }

  let selTimer = null
  document.addEventListener('selectionchange', () => {
    if (form) return
    if (selTimer) clearTimeout(selTimer)
    selTimer = setTimeout(captureSelection, 180)
  })

  const saveDraft = (sel, text) => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        quote: sel.quote, truncated: sel.truncated, prefix: sel.prefix, suffix: sel.suffix, anchor: sel.anchor, text,
      }))
    } catch (e) {}
  }
  const clearDraft = () => { try { localStorage.removeItem(DRAFT_KEY) } catch (e) {} }

  const openForm = (sel) => {
    if (!sel) return
    if (form) form.remove()
    btn.hidden = true
    form = el('div', 'vc-form')
    if (sel.quote) form.appendChild(el('blockquote', '', sel.quote))
    if (sel.truncated) form.appendChild(el('p', 'vc-note', 'Long selection — quote kept to its first 600 characters.'))
    const ta = el('textarea')
    ta.placeholder = 'Leave a comment for the agent…'
    if (sel.text) ta.value = sel.text
    form.appendChild(ta)
    const err = el('p', 'vc-err')
    err.hidden = true
    form.appendChild(err)
    const row = el('div', 'vc-row')
    const cancel = el('button', 'vc-cancel', 'Cancel')
    cancel.type = 'button'
    const save = el('button', 'vc-save', 'Save comment')
    save.type = 'button'
    row.appendChild(cancel)
    row.appendChild(save)
    form.appendChild(row)
    document.body.appendChild(form)

    const rect = sel.rect || (sel.range && sel.range.getBoundingClientRect())
    if (rect && (rect.width || rect.height)) {
      form.style.top = (scrollY + rect.bottom + 10) + 'px'
      const w = Math.min(form.offsetWidth || 544, innerWidth - 16)
      form.style.left = (scrollX + Math.max(8, Math.min(rect.left, innerWidth - w - 8))) + 'px'
    } else {
      form.classList.add('vc-form-fallback')
    }
    ta.focus()

    const closeForm = (dropDraft) => {
      if (!form) return
      form.remove()
      form = null
      if (dropDraft) clearDraft()
      if (morphQueued) morph()
      if (!drawer.hidden) drawer.querySelector('[aria-label="Close comments"]')?.focus()
    }

    cancel.addEventListener('click', () => closeForm(true))
    ta.addEventListener('input', () => saveDraft(sel, ta.value))
    form.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeForm(true) }
      else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') save.click()
    })

    save.addEventListener('click', async () => {
      const text = ta.value.trim()
      if (!text) { ta.focus(); return }
      save.disabled = true
      cancel.disabled = true
      save.textContent = 'Saving…'
      err.hidden = true
      // the acknowledgment happens where the reader is looking: highlight the live
      // range before the server answers
      let optimistic = null
      if (canHighlight && sel.range) {
        optimistic = sel.range
        const hl = CSS.highlights.get('vc-open') || new Highlight()
        hl.add(optimistic)
        CSS.highlights.set('vc-open', hl)
      }
      try {
        const entry = await api('/api/comment', {
          rel: cfg.rel, text, quote: sel.quote, prefix: sel.prefix, suffix: sel.suffix, anchor: sel.anchor, session,
        })
        rememberOwned(entry.id)
        state.comments.push(entry)
        clearDraft()
        save.textContent = 'Saved ✓'
        rerender()
        const saved = rangesById.get(entry.id)
        const rect2 = (saved && saved.getBoundingClientRect()) || rect
        setTimeout(() => {
          closeForm(true)
          toastAt(rect2, 'Saved ' + entry.id, 'Undo', async () => {
            await api('/api/uncomment', { rel: cfg.rel, id: entry.id, session })
            state.comments = state.comments.filter((x) => x.id !== entry.id)
            rerender()
          })
        }, 350)
      } catch (e) {
        if (optimistic && canHighlight) {
          const hl = CSS.highlights.get('vc-open')
          if (hl) hl.delete(optimistic)
        }
        save.disabled = false
        cancel.disabled = false
        save.textContent = 'Save comment'
        err.textContent = "Couldn't save — " + e.message + '. Your text is kept.'
        err.hidden = false
      }
    })
  }

  btn.addEventListener('click', () => { if (pending) openForm(pending) })

  // a draft interrupted by a reload (or a closed tab) comes back
  try {
    const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null')
    if (draft && draft.text) {
      const r = findRange(draft)
      openForm({ ...draft, range: r, rect: r && r.getBoundingClientRect() })
    } else if (draft) {
      clearDraft()
    }
  } catch (e) {}
})()
