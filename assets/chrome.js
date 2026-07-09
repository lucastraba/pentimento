(() => {
  const root = document.documentElement
  const syncPalette = () => {
    const p = root.dataset.palette || 'verdigris'
    document.querySelectorAll('.pbtn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.p === p)))
  }
  const syncTheme = () => {
    const t = root.dataset.theme || ''
    const label = t === 'dark' ? '◐ Dark' : t === 'light' ? '◐ Light' : '◐ Auto'
    document.querySelectorAll('.tbtn').forEach((b) => { b.textContent = label })
  }
  // delegated so buttons re-rendered by the live viewer's morph keep working
  document.addEventListener('click', (e) => {
    const t = e.target
    if (!t || !t.closest) return
    const pb = t.closest('.pbtn')
    if (pb) {
      const p = pb.dataset.p
      if (p === 'verdigris') delete root.dataset.palette
      else root.dataset.palette = p
      try { localStorage.setItem('pentimento-palette', p) } catch (err) {}
      syncPalette()
      return
    }
    if (t.closest('.tbtn')) {
      // cycle: auto → dark → light → auto
      const cur = root.dataset.theme || ''
      const next = cur === '' ? 'dark' : cur === 'dark' ? 'light' : ''
      if (next) root.dataset.theme = next
      else delete root.dataset.theme
      try {
        if (next) localStorage.setItem('pentimento-theme', next)
        else localStorage.removeItem('pentimento-theme')
      } catch (err) {}
      syncTheme()
    }
  })
  window.__pSyncPalette = () => { syncPalette(); syncTheme() }
  syncPalette()
  syncTheme()

  // print with every fold open, then restore — CSS alone can't force <details> open
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
