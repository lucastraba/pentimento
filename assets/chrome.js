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
  const upgradeLegacyPicker = () => {
    const extras = [
      ['parchment', 'Parchment'], ['fjord', 'Fjord'], ['contrast', 'High Contrast'],
    ]
    document.querySelectorAll('.palettes').forEach((group) => {
      const scheme = group.querySelector('.tbtn')
      for (const [key, label] of extras) {
        if (group.querySelector(`[data-p="${key}"]`)) continue
        const button = document.createElement('button')
        button.className = 'pbtn'
        button.type = 'button'
        button.dataset.p = key
        button.setAttribute('aria-pressed', 'false')
        const dot = document.createElement('span')
        dot.className = `dot dot-${key}`
        button.append(dot, document.createTextNode(label))
        group.insertBefore(button, scheme)
      }
    })
  }
  const paletteButtons = () => [...document.querySelectorAll('.pbtn')]
  const sync = () => {
    upgradeLegacyPicker()
    const valid = paletteButtons().map((b) => b.dataset.p)
    const fallback = root.dataset.documentPalette || valid[0] || 'verdigris'
    const p = valid.includes(root.dataset.palette) ? root.dataset.palette : fallback
    root.dataset.palette = p
    const t = root.dataset.theme || ''
    const selected = paletteButtons().find((b) => b.dataset.p === p)
    const label = selected?.querySelector('.theme-copy strong')?.textContent || 'Theme'
    paletteButtons().forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.p === p)))
    document.querySelectorAll('.sbtn').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.theme || '') === t)))
    document.querySelectorAll('.theme-name').forEach((el) => { el.textContent = label })
    document.querySelectorAll('.scheme-name').forEach((el) => { el.textContent = t ? `${t[0].toUpperCase()}${t.slice(1)}` : 'Auto' })
    const schemeLabel = t ? `${t[0].toUpperCase()}${t.slice(1)}` : 'Auto'
    document.querySelectorAll('.tbtn').forEach((b) => { b.textContent = `◐ ${schemeLabel}` })
    const override = Boolean(readStore('pentimento-palette') || readStore('pentimento-theme'))
    if (override) root.dataset.readerOverride = 'true'
    else delete root.dataset.readerOverride
    document.querySelectorAll('.theme-reset').forEach((b) => { b.disabled = !override })
    document.querySelectorAll('.theme-trigger').forEach((el) => {
      el.setAttribute('aria-label', `Theme settings: ${label}, ${t || 'auto'}${override ? ', reader override' : ''}`)
    })
  }
  // delegated so buttons re-rendered by the live viewer's morph keep working
  document.addEventListener('click', (e) => {
    const t = e.target
    if (!t || !t.closest) return
    const pb = t.closest('.pbtn')
    if (pb) {
      root.dataset.palette = pb.dataset.p
      writeStore('pentimento-palette', pb.dataset.p === root.dataset.documentPalette ? '' : pb.dataset.p)
      sync()
      const picker = pb.closest('.theme-picker')
      if (picker) {
        picker.open = false
        picker.querySelector('.theme-trigger')?.focus()
      }
      return
    }
    const sb = t.closest('.sbtn')
    if (sb) {
      const next = sb.dataset.theme || ''
      if (next) root.dataset.theme = next
      else delete root.dataset.theme
      writeStore('pentimento-theme', next)
      sync()
      return
    }
    if (t.closest('.tbtn')) {
      // Compatibility with the compact pre-0.6 picker: auto → dark → light → auto.
      const current = root.dataset.theme || ''
      const next = current === '' ? 'dark' : current === 'dark' ? 'light' : ''
      if (next) root.dataset.theme = next
      else delete root.dataset.theme
      writeStore('pentimento-theme', next)
      sync()
      return
    }
    if (t.closest('.theme-reset')) {
      writeStore('pentimento-palette', '')
      writeStore('pentimento-theme', '')
      root.dataset.palette = root.dataset.documentPalette || 'verdigris'
      delete root.dataset.theme
      sync()
      const picker = t.closest('.theme-picker')
      if (picker) {
        picker.open = false
        picker.querySelector('.theme-trigger')?.focus()
      }
      return
    }
    if (!t.closest('.theme-picker')) document.querySelectorAll('.theme-picker[open]').forEach((picker) => { picker.open = false })
  })
  document.addEventListener('keydown', (e) => {
    const current = e.target.closest?.('.pbtn')
    if (current && ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'].includes(e.key)) {
      const buttons = paletteButtons()
      const delta = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1
      buttons[(buttons.indexOf(current) + delta + buttons.length) % buttons.length]?.focus()
      e.preventDefault()
    }
    if (e.key === 'Escape') {
      document.querySelectorAll('.theme-picker[open]').forEach((picker) => {
        picker.open = false
        picker.querySelector('.theme-trigger')?.focus()
      })
    }
  })
  window.__pSyncPalette = sync
  sync()

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
