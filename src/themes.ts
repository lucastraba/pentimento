export type Scheme = 'light' | 'dark'

type ThemeValues = {
  bg: string
  raise: string
  surfaceAlt: string
  ink: string
  soft: string
  line: string
  controlLine: string
  accent: string
  accentDeep: string
  onAccent: string
  onCategory: string
  wash: string
  codeBg: string
  crit: string
  high: string
  med: string
  addBg: string
  addInk: string
  delBg: string
  delInk: string
  impl: string
  brain: string
  audit: string
  design: string
  shadowColor: string
}

export type Palette = {
  key: string
  label: string
  description: string
  display: 'serif' | 'sans'
  preview: [string, string, string]
  light: ThemeValues
  dark: ThemeValues
}

export const PALETTES: readonly Palette[] = [
  {
    key: 'verdigris',
    label: 'Verdigris',
    description: 'Calm, literary, and distinctly Pentimento.',
    display: 'serif',
    preview: ['#F7F8F6', '#2E7D6E', '#1E2529'],
    light: {
      bg: '#F7F8F6', raise: '#FFFFFF', surfaceAlt: '#F0F4F2', ink: '#1E2529', soft: '#5A6670',
      line: '#DDE3E0', controlLine: '#5A6670', accent: '#2E7D6E', accentDeep: '#1F5F54',
      onAccent: '#FFFFFF', onCategory: '#FFFFFF', wash: 'rgba(46,125,110,.08)', codeBg: '#EEF1EF',
      crit: '#A92F26', high: '#865304', med: '#5A6670', addBg: '#E7F2EB', addInk: '#22593B',
      delBg: '#F8E9E7', delInk: '#7A2C24', impl: '#346493', brain: '#684A9A', audit: '#865304',
      design: '#2E7D6E', shadowColor: 'rgba(31,48,42,.10)',
    },
    dark: {
      bg: '#131719', raise: '#1B2124', surfaceAlt: '#20292B', ink: '#E6E4DC', soft: '#98A29E',
      line: '#2A3236', controlLine: '#98A29E', accent: '#4FB3A0', accentDeep: '#72C9B8',
      onAccent: '#081513', onCategory: '#101416', wash: 'rgba(79,179,160,.10)', codeBg: '#1F2629',
      crit: '#E8756B', high: '#E0AC54', med: '#A8B1AD', addBg: '#1C2E24', addInk: '#8FCFA9',
      delBg: '#33211F', delInk: '#E39C93', impl: '#82AFDF', brain: '#B49BE1', audit: '#E0AC54',
      design: '#58BEAA', shadowColor: 'rgba(0,0,0,.32)',
    },
  },
  {
    key: 'mist',
    label: 'Mist',
    description: 'Crisp, neutral, and distraction-free.',
    display: 'sans',
    preview: ['#FAFAFA', '#0066DC', '#171717'],
    light: {
      bg: '#FAFAFA', raise: '#FFFFFF', surfaceAlt: '#F3F6F9', ink: '#171717', soft: '#626262',
      line: '#E4E4E7', controlLine: '#626262', accent: '#0066DC', accentDeep: '#0057BC',
      onAccent: '#FFFFFF', onCategory: '#FFFFFF', wash: 'rgba(0,102,220,.07)', codeBg: '#F2F2F2',
      crit: '#B42318', high: '#835100', med: '#5F6368', addBg: '#E8F5EC', addInk: '#196338',
      delBg: '#FBEAE8', delInk: '#8B2720', impl: '#265D97', brain: '#65479B', audit: '#835100',
      design: '#0066DC', shadowColor: 'rgba(17,24,39,.10)',
    },
    dark: {
      bg: '#0A0A0A', raise: '#151515', surfaceAlt: '#101C27', ink: '#EDEDED', soft: '#969696',
      line: '#292929', controlLine: '#969696', accent: '#3291FF', accentDeep: '#66ACFF',
      onAccent: '#06111D', onCategory: '#0B0B0B', wash: 'rgba(50,145,255,.10)', codeBg: '#1A1A1A',
      crit: '#FF746C', high: '#E7AE54', med: '#A0A0A0', addBg: '#142B1D', addInk: '#88D3A2',
      delBg: '#321B1A', delInk: '#F09A94', impl: '#79AEED', brain: '#B69AE8', audit: '#E7AE54',
      design: '#3291FF', shadowColor: 'rgba(0,0,0,.48)',
    },
  },
  {
    key: 'iris',
    label: 'Iris',
    description: 'Expressive, editorial, and richly layered.',
    display: 'serif',
    preview: ['#F8F7FB', '#7653B5', '#241E33'],
    light: {
      bg: '#F8F7FB', raise: '#FFFFFF', surfaceAlt: '#F1EDF8', ink: '#241E33', soft: '#6A6284',
      line: '#E3DEEF', controlLine: '#6A6284', accent: '#7653B5', accentDeep: '#583B94',
      onAccent: '#FFFFFF', onCategory: '#FFFFFF', wash: 'rgba(118,83,181,.09)', codeBg: '#EFEDF6',
      crit: '#A92F3A', high: '#7D5200', med: '#675F78', addBg: '#EAF3EC', addInk: '#285D3C',
      delBg: '#F8E8EC', delInk: '#7E2937', impl: '#3B6295', brain: '#7653B5', audit: '#7D5200',
      design: '#7653B5', shadowColor: 'rgba(58,38,90,.12)',
    },
    dark: {
      bg: '#151020', raise: '#1E1830', surfaceAlt: '#251D3A', ink: '#EAE6F4', soft: '#A9A0C5',
      line: '#352B50', controlLine: '#A9A0C5', accent: '#A78BE0', accentDeep: '#C2ADEE',
      onAccent: '#160C27', onCategory: '#150F20', wash: 'rgba(167,139,224,.12)', codeBg: '#211A34',
      crit: '#F07B87', high: '#E3B461', med: '#ADA4BE', addBg: '#1B3025', addInk: '#91D2AA',
      delBg: '#382027', delInk: '#EDA0AA', impl: '#87B0E1', brain: '#B89BEF', audit: '#E3B461',
      design: '#A78BE0', shadowColor: 'rgba(4,1,10,.42)',
    },
  },
  {
    key: 'parchment',
    label: 'Parchment',
    description: 'Warm, bookish, and easy on the eyes.',
    display: 'serif',
    preview: ['#F6F0E5', '#98492F', '#33271F'],
    light: {
      bg: '#F6F0E5', raise: '#FFFAF2', surfaceAlt: '#F0E4D4', ink: '#33271F', soft: '#6F5C4C',
      line: '#DCCDBB', controlLine: '#6F5C4C', accent: '#98492F', accentDeep: '#78341F',
      onAccent: '#FFFFFF', onCategory: '#FFFFFF', wash: 'rgba(152,73,47,.09)', codeBg: '#EDE3D6',
      crit: '#A3312C', high: '#7C5000', med: '#6F5C4C', addBg: '#E8F0DF', addInk: '#365B2C',
      delBg: '#F6E2DE', delInk: '#7C3027', impl: '#42627C', brain: '#754A7D', audit: '#7C5000',
      design: '#98492F', shadowColor: 'rgba(76,48,28,.13)',
    },
    dark: {
      bg: '#18120F', raise: '#241A16', surfaceAlt: '#2D201A', ink: '#F1E4D4', soft: '#BDAA99',
      line: '#49372E', controlLine: '#BDAA99', accent: '#D98561', accentDeep: '#F0A17D',
      onAccent: '#1A0D08', onCategory: '#190F0A', wash: 'rgba(217,133,97,.12)', codeBg: '#2A1E19',
      crit: '#EE7C72', high: '#E2B15D', med: '#C0AD9D', addBg: '#243120', addInk: '#9BD28D',
      delBg: '#3B221E', delInk: '#EDA096', impl: '#89AEC8', brain: '#C29AC8', audit: '#E2B15D',
      design: '#D98561', shadowColor: 'rgba(0,0,0,.40)',
    },
  },
  {
    key: 'fjord',
    label: 'Fjord',
    description: 'Cool, technical, and quietly focused.',
    display: 'sans',
    preview: ['#F3F7F8', '#176B79', '#17272E'],
    light: {
      bg: '#F3F7F8', raise: '#FFFFFF', surfaceAlt: '#E7EFF2', ink: '#17272E', soft: '#52666F',
      line: '#CBDADF', controlLine: '#52666F', accent: '#176B79', accentDeep: '#0E5663',
      onAccent: '#FFFFFF', onCategory: '#FFFFFF', wash: 'rgba(23,107,121,.09)', codeBg: '#E8EEF0',
      crit: '#A92F3A', high: '#795000', med: '#52666F', addBg: '#E2F1EA', addInk: '#245D45',
      delBg: '#F6E5E7', delInk: '#7E2B35', impl: '#35658E', brain: '#65508F', audit: '#795000',
      design: '#176B79', shadowColor: 'rgba(24,58,68,.12)',
    },
    dark: {
      bg: '#0C151A', raise: '#132229', surfaceAlt: '#192B33', ink: '#E5F0F2', soft: '#9BB1B8',
      line: '#294049', controlLine: '#9BB1B8', accent: '#55B6C2', accentDeep: '#7ACBD4',
      onAccent: '#061316', onCategory: '#081317', wash: 'rgba(85,182,194,.12)', codeBg: '#17272E',
      crit: '#ED7B84', high: '#E1B15E', med: '#A5B7BC', addBg: '#183027', addInk: '#8FD1AE',
      delBg: '#352126', delInk: '#ECA0A7', impl: '#82B2D7', brain: '#B39DDA', audit: '#E1B15E',
      design: '#55B6C2', shadowColor: 'rgba(0,0,0,.42)',
    },
  },
  {
    key: 'contrast',
    label: 'High Contrast',
    description: 'Accessibility-first with unmistakable controls.',
    display: 'sans',
    preview: ['#FFFFFF', '#005FCC', '#000000'],
    light: {
      bg: '#FFFFFF', raise: '#FFFFFF', surfaceAlt: '#F0F2F5', ink: '#000000', soft: '#343A40',
      line: '#73777F', controlLine: '#3F444C', accent: '#005FCC', accentDeep: '#003F8F',
      onAccent: '#FFFFFF', onCategory: '#FFFFFF', wash: 'rgba(0,95,204,.12)', codeBg: '#ECEFF2',
      crit: '#A40016', high: '#704700', med: '#343A40', addBg: '#DDF2E4', addInk: '#124F2B',
      delBg: '#F8DDE1', delInk: '#7D1021', impl: '#174F85', brain: '#59388D', audit: '#704700',
      design: '#005FCC', shadowColor: 'rgba(0,0,0,.16)',
    },
    dark: {
      bg: '#000000', raise: '#0D0D0D', surfaceAlt: '#181818', ink: '#FFFFFF', soft: '#D0D4D8',
      line: '#8B9097', controlLine: '#C4C8CD', accent: '#65B5FF', accentDeep: '#9ED0FF',
      onAccent: '#000000', onCategory: '#000000', wash: 'rgba(101,181,255,.18)', codeBg: '#202020',
      crit: '#FF8794', high: '#FFD06A', med: '#D0D4D8', addBg: '#173821', addInk: '#A7E7BA',
      delBg: '#451A22', delInk: '#FFB1BA', impl: '#91C9FF', brain: '#D0B2FF', audit: '#FFD06A',
      design: '#65B5FF', shadowColor: 'rgba(0,0,0,.72)',
    },
  },
] as const

export const DEFAULT_PALETTE = 'verdigris'
export const PALETTE_KEYS = PALETTES.map((palette) => palette.key)

export const isPalette = (value: string): boolean => PALETTE_KEYS.includes(value)

const CSS_NAMES: Record<keyof ThemeValues, string> = {
  bg: 'bg', raise: 'raise', surfaceAlt: 'surface-alt', ink: 'ink', soft: 'soft', line: 'line',
  controlLine: 'control-line', accent: 'accent', accentDeep: 'accent-deep', onAccent: 'on-accent',
  onCategory: 'on-category', wash: 'wash', codeBg: 'code-bg', crit: 'crit', high: 'high', med: 'med',
  addBg: 'add-bg', addInk: 'add-ink', delBg: 'del-bg', delInk: 'del-ink', impl: 'impl', brain: 'brain',
  audit: 'audit', design: 'design', shadowColor: 'shadow-color',
}

const declarations = (palette: Palette, scheme: Scheme): string => {
  const values = palette[scheme]
  const colors = Object.entries(values).map(([key, value]) => `--${CSS_NAMES[key as keyof ThemeValues]}:${value}`).join(';')
  const display = palette.display === 'sans' ? 'var(--sans)' : 'var(--serif)'
  const standfirstStyle = palette.display === 'sans' ? 'normal' : 'italic'
  return `${colors};--font-display:${display};--standfirst-style:${standfirstStyle}`
}

const previewDeclarations = (palette: Palette, scheme: Scheme): string => {
  const values = palette[scheme]
  return `--preview-page:${values.bg};--preview-accent:${values.accent};--preview-ink:${values.ink}`
}

export const themeCss = (): string => PALETTES.map((palette) => {
  const selector = `:root[data-palette="${palette.key}"]`
  const previewSelector = `.preview-${palette.key}`
  return `${selector}{${declarations(palette, 'light')}}\n` +
    `@media (prefers-color-scheme:dark){${selector}{${declarations(palette, 'dark')}}}\n` +
    `:root[data-theme="light"][data-palette="${palette.key}"]{${declarations(palette, 'light')}}\n` +
    `:root[data-theme="dark"][data-palette="${palette.key}"]{${declarations(palette, 'dark')}}\n` +
    `${previewSelector}{${previewDeclarations(palette, 'light')}}\n` +
    `@media (prefers-color-scheme:dark){${previewSelector}{${previewDeclarations(palette, 'dark')}}}\n` +
    `:root[data-theme="light"] ${previewSelector}{${previewDeclarations(palette, 'light')}}\n` +
    `:root[data-theme="dark"] ${previewSelector}{${previewDeclarations(palette, 'dark')}}`
}).join('\n')

export const themeInitSnippet = (documentPalette = DEFAULT_PALETTE): string => {
  const keys = JSON.stringify(PALETTE_KEYS)
  return `<script>(()=>{const r=document.documentElement,k=${keys};let p=null,t=null;try{p=localStorage.getItem('pentimento-palette');t=localStorage.getItem('pentimento-theme')}catch(e){}if(!k.includes(p)){p=null;try{localStorage.removeItem('pentimento-palette')}catch(e){}}if(t!=='dark'&&t!=='light'){t=null;try{localStorage.removeItem('pentimento-theme')}catch(e){}}r.dataset.documentPalette='${documentPalette}';r.dataset.palette=p||'${documentPalette}';if(t)r.dataset.theme=t;else delete r.dataset.theme;if(p||t)r.dataset.readerOverride='true';else delete r.dataset.readerOverride})()</script>`
}

export const themePicker = (documentPalette = DEFAULT_PALETTE): string => {
  const cards = PALETTES.map((palette) => `<button class="pbtn" type="button" data-p="${palette.key}" aria-pressed="${palette.key === documentPalette}">
  <span class="theme-preview preview-${palette.key}" aria-hidden="true"><i></i><i></i><i></i></span>
  <span class="theme-copy"><strong>${palette.label}</strong><small>${palette.description}</small></span>
  <span class="theme-check" aria-hidden="true">✓</span>
</button>`).join('\n')
  return `<div class="theme-controls"><details class="theme-picker">
  <summary class="theme-trigger" aria-label="Theme settings"><span class="theme-trigger-dot" aria-hidden="true"></span><span class="theme-name">${PALETTES.find((p) => p.key === documentPalette)?.label ?? 'Theme'}</span><span class="theme-override" title="Reader override">●</span><svg class="theme-chevron" viewBox="0 0 12 12" aria-hidden="true"><path d="m3 4.5 3 3 3-3"/></svg></summary>
  <div class="theme-panel" role="dialog" aria-label="Choose theme">
    <div class="theme-panel-head"><strong>Theme</strong><button class="theme-reset" type="button">Use document default</button></div>
    <div class="theme-grid" role="group" aria-label="Theme">${cards}</div>
  </div>
</details><button class="tbtn" type="button" aria-label="Color scheme">◐ Auto</button></div>`
}
