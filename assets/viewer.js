(() => {
  const cfg = window.__pentimento
  if (!cfg) return
  let main = document.querySelector('main')
  if (!main) return

  // --- state ------------------------------------------------------------
  const state = { comments: cfg.comments || [], revisions: cfg.revisions || [] }
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
      if (c.status !== 'open') continue
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
  const drawer = el('aside', 'vc-drawer')
  drawer.hidden = true
  document.body.appendChild(drawer)

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
    if (cfg.canComment) {
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
    drawer.textContent = ''
    const head = el('div', 'vc-drawer-head')
    head.appendChild(el('strong', '', 'Comments'))
    const close = el('button', 'vc-act', '✕')
    close.type = 'button'
    close.setAttribute('aria-label', 'Close comments')
    close.addEventListener('click', closeDrawer)
    head.appendChild(close)
    drawer.appendChild(head)
    const open = state.comments.filter((c) => c.status === 'open')
    const resolved = state.comments.filter((c) => c.status === 'resolved')
    drawer.appendChild(el('h3', 'vc-h', open.length + ' open'))
    if (!open.length) {
      drawer.appendChild(el('p', 'vc-empty', cfg.canComment ? 'Select text in the document to leave one.' : 'None.'))
    }
    open.forEach((c) => drawer.appendChild(card(c)))
    if (resolved.length) {
      drawer.appendChild(el('h3', 'vc-h', resolved.length + ' resolved'))
      resolved.forEach((c) => drawer.appendChild(card(c)))
    }
    syncCount()
  }

  const openDrawer = (focusId) => {
    renderDrawer()
    drawer.hidden = false
    const tg = document.getElementById('vc-toggle')
    if (tg) tg.setAttribute('aria-expanded', 'true')
    if (focusId) {
      const cardEl = drawer.querySelector('[data-cid="' + focusId + '"]')
      if (cardEl) {
        cardEl.scrollIntoView({ block: 'nearest' })
        cardEl.classList.add('vc-focus')
        setTimeout(() => cardEl.classList.remove('vc-focus'), 1600)
      }
      flash(rangesById.get(focusId))
    }
  }

  const closeDrawer = () => {
    drawer.hidden = true
    const tg = document.getElementById('vc-toggle')
    if (tg) tg.setAttribute('aria-expanded', 'false')
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
      if (window.__pSyncPalette) window.__pSyncPalette()
      rerender()
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
    if (!cfg.rev && msg.docs && msg.docs.indexOf(cfg.rel) >= 0) queueMorph()
  }

  // --- global delegated listeners (survive morphs) ---------------------------
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

  document.addEventListener('change', (e) => {
    if (e.target && e.target.id === 'vrev') {
      const v = e.target.value
      location.href = v === 'canonical' ? location.pathname : location.pathname + '?rev=' + v
    }
  })

  // --- boot ---------------------------------------------------------------
  applyHighlights()
  syncCount()

  if (!cfg.canComment) {
    // read-only revision: selecting text explains itself instead of doing nothing
    if (cfg.rev) {
      const hint = el('div', 'vc-hint')
      hint.hidden = true
      hint.appendChild(document.createTextNode('read-only revision — '))
      const link = el('a', '', 'comment on the current version')
      link.href = location.pathname
      hint.appendChild(link)
      document.body.appendChild(hint)
      let ht = null
      document.addEventListener('selectionchange', () => {
        if (ht) clearTimeout(ht)
        ht = setTimeout(() => {
          const s = getSelection()
          if (!s || s.isCollapsed || !s.rangeCount || !s.getRangeAt(0).intersectsNode(main)) { hint.hidden = true; return }
          const r = s.getRangeAt(0).getBoundingClientRect()
          hint.style.top = (scrollY + r.bottom + 8) + 'px'
          hint.style.left = (scrollX + Math.max(8, Math.min(r.left, innerWidth - 300))) + 'px'
          hint.hidden = false
        }, 180)
      })
    }
    return
  }

  // --- select text → comment button → popover form -------------------------
  const btn = el('button', 'vc-add')
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
    form.appendChild(el('blockquote', '', sel.quote))
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
    }

    cancel.addEventListener('click', () => closeForm(true))
    ta.addEventListener('input', () => saveDraft(sel, ta.value))
    form.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeForm(true)
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
