(() => {
  const root = document.documentElement
  const btns = [...document.querySelectorAll('.pbtn')]
  const sync = () => {
    const p = root.dataset.palette || 'verdigris'
    btns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.p === p)))
  }
  const apply = (p) => {
    if (p === 'verdigris') delete root.dataset.palette
    else root.dataset.palette = p
    try { localStorage.setItem('pentimento-palette', p) } catch (e) {}
    sync()
  }
  sync()
  btns.forEach((b) => b.addEventListener('click', () => apply(b.dataset.p)))
})()
