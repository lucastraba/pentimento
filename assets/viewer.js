(() => {
  const cfg = window.__vellum
  if (!cfg) return
  const main = document.querySelector('main')
  const post = (url, body) =>
    fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

  // highlight commented quotes (best effort: quote within a single text node)
  for (const c of cfg.comments || []) {
    if (!c.quote || !main) continue
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT)
    let node
    while ((node = walker.nextNode())) {
      const i = node.textContent.indexOf(c.quote)
      if (i < 0) continue
      const range = document.createRange()
      range.setStart(node, i)
      range.setEnd(node, i + c.quote.length)
      const mark = document.createElement('mark')
      mark.className = 'vc-mark'
      mark.dataset.cid = c.id
      mark.title = c.text
      try { range.surroundContents(mark) } catch (e) { /* quote spans elements — panel still shows it */ }
      break
    }
  }

  // resolve buttons on the open-comments panel
  document.querySelectorAll('.vcomment[data-cid]').forEach((el) => {
    const b = document.createElement('button')
    b.className = 'vc-resolve'
    b.type = 'button'
    b.textContent = 'Resolve'
    b.addEventListener('click', () => post('/api/resolve', { rel: cfg.rel, id: el.dataset.cid }))
    el.appendChild(b)
  })

  if (!cfg.canComment || !main) return

  // select text → floating comment button → comment form
  const btn = document.createElement('button')
  btn.className = 'vc-add'
  btn.type = 'button'
  btn.textContent = '💬 Comment'
  btn.hidden = true
  document.body.appendChild(btn)
  let pending = null

  const nearestAnchor = (startNode) => {
    let el = startNode.nodeType === 1 ? startNode : startNode.parentElement
    if (!el) return ''
    const closest = el.closest('[id]')
    if (closest && main.contains(closest)) return '#' + closest.id
    let best = ''
    for (const cand of main.querySelectorAll('[id]')) {
      if (cand.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) best = '#' + cand.id
    }
    return best
  }

  document.addEventListener('mouseup', () => {
    setTimeout(() => {
      const s = getSelection()
      if (!s || s.isCollapsed || !main.contains(s.anchorNode)) { btn.hidden = true; return }
      const quote = s.toString().trim()
      if (!quote || quote.length > 600) { btn.hidden = true; return }
      const range = s.getRangeAt(0)
      const r = range.getBoundingClientRect()
      btn.style.top = (scrollY + r.bottom + 8) + 'px'
      btn.style.left = (scrollX + Math.max(8, r.left)) + 'px'
      const startText = range.startContainer.textContent || ''
      const endText = range.endContainer.textContent || ''
      pending = {
        quote,
        prefix: startText.slice(Math.max(0, range.startOffset - 32), range.startOffset),
        suffix: endText.slice(range.endOffset, range.endOffset + 32),
        anchor: nearestAnchor(range.startContainer),
      }
      btn.hidden = false
    }, 0)
  })

  btn.addEventListener('click', () => {
    btn.hidden = true
    if (!pending) return
    const sel = pending
    const form = document.createElement('div')
    form.className = 'vc-form'
    form.innerHTML =
      '<blockquote></blockquote>' +
      '<textarea placeholder="Leave a comment for the agent…"></textarea>' +
      '<div class="vc-row"><button class="vc-cancel" type="button">Cancel</button>' +
      '<button class="vc-save" type="button">Save comment</button></div>'
    form.querySelector('blockquote').textContent = sel.quote
    document.body.appendChild(form)
    form.querySelector('textarea').focus()
    form.querySelector('.vc-cancel').addEventListener('click', () => form.remove())
    form.querySelector('.vc-save').addEventListener('click', async () => {
      const text = form.querySelector('textarea').value.trim()
      if (!text) return
      await post('/api/comment', { rel: cfg.rel, text, ...sel })
      form.remove() // the meta.yml write triggers the SSE reload
    })
  })
})()
