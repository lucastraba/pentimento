/**
 * One palette, three schemes. The stylesheet carries the light and dark values; this module
 * only restores the reader's explicit scheme choice before first paint and renders the toggle.
 * Earlier releases shipped six palettes. Their names are still accepted in `Palette`
 * frontmatter and ignored, so old documents render without warnings.
 */

export type Scheme = 'auto' | 'light' | 'dark'

export const LEGACY_PALETTES: readonly string[] = ['verdigris', 'mist', 'iris', 'parchment', 'fjord', 'contrast']

const STORE_KEY = 'pentimento-theme'

/** Apply a stored light/dark override before first paint. Invalid values are dropped. */
export const themeInitSnippet = (): string =>
  `<script>(()=>{let t=null;try{t=localStorage.getItem('${STORE_KEY}')}catch(e){}if(t==='dark'||t==='light')document.documentElement.dataset.theme=t;else{try{localStorage.removeItem('${STORE_KEY}')}catch(e){}}})()</script>`

/** The scheme toggle: auto → dark → light → auto. chrome.js owns the behaviour. */
export const schemeToggle = (): string =>
  '<button class="tool scheme-toggle" type="button" data-scheme-toggle aria-label="Color scheme: auto">Auto</button>'
