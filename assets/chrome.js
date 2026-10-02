(() => {
  const root = document.documentElement
  const readStore = (key) => {
    try { return localStorage.getItem(key) } catch (err) { return null }
  }
  const writeStore = (key, value) => {
    try {
      if (value) localStorage.setItem(key, value)
      else localStorage.removeItem(key)
    } catch (err) {}
  }

  // --- images: a static page carries each one once, and every other copy names it in
  // data-asset (earlier drafts, traces, the diff, cuttings); fill those in from the carried ones
  const imageSrc = new Map()
  const learnImages = (scope) => {
    scope.querySelectorAll('img[data-asset][src]').forEach((img) => {
      if (!imageSrc.has(img.dataset.asset)) imageSrc.set(img.dataset.asset, img.getAttribute('src'))
    })
  }
  const fillImages = (scope) => {
    learnImages(scope)
    scope.querySelectorAll('img[data-asset]:not([src])').forEach((img) => {
      const src = imageSrc.get(img.dataset.asset)
      if (src) img.setAttribute('src', src)
    })
  }
  learnImages(document)
  const imageStore = document.getElementById('pentimento-images')
  if (imageStore) learnImages(imageStore.content)

  // --- color scheme: auto → dark → light → auto -----------------------------
  const syncScheme = () => {
    const t = root.dataset.theme || ''
    const label = t ? t[0].toUpperCase() + t.slice(1) : 'Auto'
    document.querySelectorAll('[data-scheme-toggle]').forEach((b) => {
      b.textContent = label
      b.setAttribute('aria-label', 'Color scheme: ' + (t || 'auto'))
    })
  }

  // --- traces: swap the document for the version with the last draft showing through
  const stash = new WeakMap()
  const applyTraces = () => {
    const main = document.querySelector('main')
    const tpl = document.getElementById('traces-tpl')
    if (!main) return
    const want = root.dataset.traces === 'on' && Boolean(tpl)
    const has = main.classList.contains('traces')
    if (want && !has) {
      stash.set(main, main.innerHTML)
      main.innerHTML = tpl.innerHTML
      fillImages(main)
      main.classList.add('traces')
    } else if (!want && has) {
      main.innerHTML = stash.get(main) ?? main.innerHTML
      fillImages(main)
      main.classList.remove('traces')
    }
    document.querySelectorAll('[data-traces-toggle]').forEach((b) => {
      b.setAttribute('aria-pressed', String(want))
      b.classList.toggle('traces-on', want)
    })
    if (want !== has) document.dispatchEvent(new CustomEvent('pentimento:content'))
  }
  const setTraces = (on) => {
    if (on) root.dataset.traces = 'on'
    else delete root.dataset.traces
    try { sessionStorage.setItem('pentimento-traces', on ? 'on' : '') } catch (err) {}
    applyTraces()
  }
  try { if (sessionStorage.getItem('pentimento-traces') === 'on') root.dataset.traces = 'on' } catch (err) {}

  // --- static pages: step through the embedded earlier drafts ---------------
  let currentMain = null
  document.addEventListener('input', (e) => {
    const slider = e.target && e.target.closest && e.target.closest('[data-draft-scrub]')
    if (!slider) return
    const main = document.querySelector('main')
    const templates = [...document.querySelectorAll('template.draft-tpl')]
    const label = document.querySelector('[data-draft-label]')
    if (!main) return
    const i = Number(slider.value)
    // traces compare the current draft with the one before it, so they switch off here
    if (root.dataset.traces === 'on') setTraces(false)
    if (currentMain === null) currentMain = main.innerHTML
    const tpl = templates[i]
    main.innerHTML = tpl ? tpl.innerHTML : currentMain
    fillImages(main)
    if (tpl) root.dataset.viewingDraft = tpl.dataset.rev
    else delete root.dataset.viewingDraft
    if (label) label.textContent = tpl ? tpl.dataset.rev + ' · earlier draft' : label.dataset.current
    document.querySelectorAll('[data-traces-toggle]').forEach((b) => { b.disabled = Boolean(tpl) })
  })

  // --- copy a cutting ------------------------------------------------------
  const copyText = async (text) => {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch (err) {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.setAttribute('readonly', '')
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      let ok = false
      try { ok = document.execCommand('copy') } catch (e) {}
      ta.remove()
      return ok
    }
  }

  // delegated so controls re-rendered by the live viewer keep working
  document.addEventListener('click', async (e) => {
    const t = e.target
    if (!t || !t.closest) return
    if (t.closest('[data-scheme-toggle]')) {
      const current = root.dataset.theme || ''
      const next = current === '' ? 'dark' : current === 'dark' ? 'light' : ''
      if (next) root.dataset.theme = next
      else delete root.dataset.theme
      writeStore('pentimento-theme', next)
      syncScheme()
      return
    }
    if (t.closest('[data-traces-toggle]')) {
      setTraces(root.dataset.traces !== 'on')
      return
    }
    const copy = t.closest('[data-copy]')
    if (copy) {
      const text = copy.closest('.cutting')?.querySelector('.cutting-text')?.textContent ?? ''
      const ok = await copyText(text)
      const before = copy.textContent
      copy.textContent = ok ? 'Copied' : 'Copy failed'
      setTimeout(() => { copy.textContent = before }, 1400)
    }
  })

  document.addEventListener('keydown', (e) => {
    if (e.key !== 't' || e.metaKey || e.ctrlKey || e.altKey) return
    const tag = (e.target && e.target.tagName) || ''
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || e.target.isContentEditable) return
    if (!document.getElementById('traces-tpl')) return
    setTraces(root.dataset.traces !== 'on')
  })

  // --- contents rail: mark the section being read ----------------------------
  let ticking = false
  const syncRail = () => {
    ticking = false
    const links = [...document.querySelectorAll('.rail a[href^="#"]')]
    if (!links.length) return
    const line = innerHeight * 0.28
    let current = null
    for (const a of links) {
      const target = document.getElementById(decodeURIComponent(a.getAttribute('href').slice(1)))
      if (target && target.getBoundingClientRect().top <= line) current = a
    }
    links.forEach((a) => a.setAttribute('aria-current', String(a === current)))
  }
  addEventListener('scroll', () => {
    if (!ticking) { ticking = true; requestAnimationFrame(syncRail) }
  }, { passive: true })

  window.__pSyncChrome = () => { fillImages(document); syncScheme(); applyTraces(); syncRail() }
  window.__pSyncChrome()

  // print with every fold open, then restore; CSS alone can't force <details> open
  let reopened = []
  addEventListener('beforeprint', () => {
    reopened = [...document.querySelectorAll('details:not([open])')]
    reopened.forEach((d) => { d.open = true })
  })
  addEventListener('afterprint', () => {
    reopened.forEach((d) => { d.open = false })
    reopened = []
  })
})()
