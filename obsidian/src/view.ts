import { ItemView, Modal, Notice, sanitizeHTMLToDom, setIcon, type App, type TFile, type WorkspaceLeaf } from 'obsidian'
import { readHistory, restoreDraft, type DocHistory } from '../../src/drafts'
import { collectCuttings, renderDiffHtml, wordCount } from '../../src/semdiff'
import type PentimentoPlugin from './main'

export const VIEW_TYPE = 'pentimento-history'

type Tab = 'changes' | 'drafts' | 'cuttings'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const shortDate = (iso: string): string => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

/** The side panel: what changed, every draft, and what was cut, for the open note. */
export class HistoryView extends ItemView {
  private file: TFile | null = null
  private tab: Tab = 'changes'
  /** compare the note against this draft; null picks the sensible default */
  private base: string | null = null
  /** show one draft's own changes (against the draft before it) instead of the note's */
  private single: string | null = null
  private rendering = 0

  constructor(leaf: WorkspaceLeaf, private plugin: PentimentoPlugin) {
    super(leaf)
  }

  getViewType(): string { return VIEW_TYPE }
  getDisplayText(): string { return 'Drafts' }
  getIcon(): string { return 'history' }

  async onOpen(): Promise<void> {
    this.registerEvent(this.app.workspace.on('file-open', (file) => {
      if (file && file.extension === 'md') this.show(file)
    }))
    const active = this.app.workspace.getActiveFile()
    this.show(active && active.extension === 'md' ? active : null)
  }

  show(file: TFile | null): void {
    if (file?.path !== this.file?.path) {
      this.base = null
      this.single = null
    }
    this.file = file
    void this.refresh()
  }

  /** Re-read the note's history and redraw. Later calls win over slower earlier ones. */
  async refresh(): Promise<void> {
    const run = ++this.rendering
    const file = this.file
    let history: DocHistory | null = null
    let error: string | null = null
    if (file) {
      try { history = await readHistory(this.plugin.store, file.path) } catch (e) { error = e instanceof Error ? e.message : String(e) }
    }
    if (run !== this.rendering) return
    this.draw(file, history, error)
  }

  private draw(file: TFile | null, h: DocHistory | null, error: string | null): void {
    const root = this.contentEl
    root.empty()
    root.addClass('pentimento-view')
    if (!file) {
      root.createEl('p', { cls: 'pentimento-empty', text: 'Open a note to see its drafts.' })
      return
    }
    const head = root.createDiv({ cls: 'pentimento-head' })
    head.createEl('h4', { cls: 'pentimento-title', text: file.basename })
    const hide = head.createEl('button', { cls: 'clickable-icon pentimento-hide', attr: { 'aria-label': 'Hide drafts' } })
    setIcon(hide, 'panel-right-close')
    hide.addEventListener('click', () => this.plugin.hideHistory())
    if (error || !h) {
      root.createEl('p', { cls: 'pentimento-empty', text: error ?? 'This note could not be read.' })
      return
    }

    const latest = h.meta.revisions[h.meta.revisions.length - 1]
    const status = root.createDiv({ cls: 'pentimento-status-line' })
    if (latest) {
      status.createSpan({ cls: 'pentimento-rev', text: latest.id })
      status.createSpan({ text: ` · ${shortDate(latest.created_at)} · ${h.dirty ? 'edited since' : 'saved'}` })
    } else {
      status.createSpan({ text: 'No drafts yet' })
    }
    const save = status.createEl('button', { cls: 'mod-cta pentimento-save', text: 'Save draft' })
    save.addEventListener('click', () => { if (this.file) void this.plugin.saveFile(this.file) })

    if (!h.drafts.length) {
      root.createEl('p', {
        cls: 'pentimento-empty',
        text: 'Save a draft to start the history. Each one keeps a copy of the note as it is, so you can see what changed and get back anything you cut.',
      })
      return
    }

    const tabs = root.createDiv({ cls: 'pentimento-tabs' })
    const cuttings = collectCuttings(h.dirty ? [...h.drafts, { id: 'canonical', body: h.body }] : h.drafts)
    const labels: [Tab, string][] = [['changes', 'Changes'], ['drafts', `Drafts (${h.drafts.length})`], ['cuttings', `Cuttings (${cuttings.length})`]]
    for (const [tab, label] of labels) {
      const b = tabs.createEl('button', { text: label, cls: tab === this.tab ? 'is-active' : '' })
      b.addEventListener('click', () => { this.tab = tab; this.single = null; void this.refresh() })
    }

    const body = root.createDiv({ cls: 'pentimento-body' })
    if (this.tab === 'changes') this.drawChanges(body, h)
    else if (this.tab === 'drafts') this.drawDrafts(body, h)
    else this.drawCuttings(body, cuttings)
  }

  private drawChanges(el: HTMLElement, h: DocHistory): void {
    const ids = h.drafts.map((d) => d.id)
    if (this.single) {
      const i = ids.indexOf(this.single)
      const back = el.createEl('a', { cls: 'pentimento-back', text: '← Changes in the note now', href: '#' })
      back.addEventListener('click', (e) => { e.preventDefault(); this.single = null; void this.refresh() })
      el.createEl('p', { cls: 'pentimento-caption', text: i > 0 ? `What changed in ${this.single}` : `${this.single} is the first draft` })
      if (i > 0) this.diff(el, h.drafts[i - 1].body, h.drafts[i].body)
      return
    }
    if (!h.dirty && ids.length < 2) {
      el.createEl('p', { cls: 'pentimento-empty', text: 'This is the first draft, and the note hasn\'t changed since.' })
      return
    }
    // default: unsaved edits against the latest draft, else the latest draft against the one before
    const fallback = h.dirty ? ids[ids.length - 1] : ids[ids.length - 2]
    const base = this.base && ids.includes(this.base) ? this.base : fallback
    const row = el.createDiv({ cls: 'pentimento-compare' })
    row.createSpan({ text: h.dirty ? 'The note now, against ' : `${ids[ids.length - 1]}, against ` })
    const select = row.createEl('select', { cls: 'dropdown' })
    for (const id of [...ids].reverse()) {
      if (!h.dirty && id === ids[ids.length - 1]) continue
      select.createEl('option', { text: id, value: id }).selected = id === base
    }
    select.addEventListener('change', () => { this.base = select.value; void this.refresh() })
    this.diff(el, h.drafts[ids.indexOf(base)].body, h.dirty ? h.body : h.drafts[ids.length - 1].body)
  }

  private diff(el: HTMLElement, from: string, to: string): void {
    const box = el.createDiv({ cls: 'pentimento-diff' })
    // renderDiffHtml escapes all document text; sanitizing keeps Obsidian's rule of no raw HTML
    box.append(sanitizeHTMLToDom(renderDiffHtml(from, to)))
  }

  private drawDrafts(el: HTMLElement, h: DocHistory): void {
    const list = el.createEl('ol', { cls: 'pentimento-drafts' })
    for (const r of [...h.meta.revisions].reverse()) {
      const draft = h.drafts.find((d) => d.id === r.id)
      const li = list.createEl('li')
      const top = li.createDiv({ cls: 'pentimento-draft-top' })
      top.createSpan({ cls: 'pentimento-rev', text: r.id })
      top.createSpan({ cls: 'pentimento-when', text: `${shortDate(r.created_at)}${draft ? ` · ${wordCount(draft.body)} words` : ''}` })
      li.createDiv({ cls: 'pentimento-summary', text: r.summary })
      if (r.why) li.createDiv({ cls: 'pentimento-why', text: r.why })
      const actions = li.createDiv({ cls: 'pentimento-actions' })
      const show = actions.createEl('a', { text: 'What changed', href: '#' })
      show.addEventListener('click', (e) => {
        e.preventDefault()
        this.single = r.id
        this.tab = 'changes'
        void this.refresh()
      })
      if (r.id !== h.drafts[h.drafts.length - 1]?.id || h.dirty) {
        const restore = actions.createEl('a', { text: 'Restore', href: '#' })
        restore.addEventListener('click', (e) => {
          e.preventDefault()
          new ConfirmModal(this.app, `Restore ${r.id}?`, 'The note goes back to this draft. Its current text is saved first, so nothing is lost.', 'Restore', async () => {
            if (this.file) await this.plugin.restore(this.file, r.id)
          }).open()
        })
      }
    }
    const remove = el.createEl('a', { cls: 'pentimento-remove', text: 'Remove Pentimento from this note…', href: '#' })
    remove.addEventListener('click', (e) => {
      e.preventDefault()
      if (this.file) void this.plugin.confirmRemove(this.file)
    })
  }

  private drawCuttings(el: HTMLElement, cuttings: ReturnType<typeof collectCuttings>): void {
    el.createEl('p', {
      cls: 'pentimento-caption',
      text: 'Passages you removed or rewrote in earlier drafts. Anything that comes back in the note drops off this list.',
    })
    if (!cuttings.length) {
      el.createEl('p', { cls: 'pentimento-empty', text: 'Nothing has been cut yet.' })
      return
    }
    for (const c of cuttings) {
      const item = el.createDiv({ cls: 'pentimento-cutting' })
      item.createEl('pre', { cls: 'pentimento-cutting-text', text: c.text })
      const meta = item.createDiv({ cls: 'pentimento-cutting-meta' })
      meta.createSpan({ text: `${c.section ? `${c.section} · ` : ''}cut in ${c.cutIn === 'canonical' ? 'your unsaved edits' : c.cutIn}` })
      const copy = meta.createEl('a', { text: 'Copy', href: '#' })
      copy.addEventListener('click', async (e) => {
        e.preventDefault()
        await navigator.clipboard.writeText(c.text)
        new Notice('Copied')
      })
    }
  }
}

export class ConfirmModal extends Modal {
  constructor(
    app: App, private heading: string, private message: string, private action: string,
    private onConfirm: () => Promise<void>, private destructive = false,
  ) {
    super(app)
  }

  onOpen(): void {
    this.setTitle(this.heading)
    this.contentEl.createEl('p', { text: this.message })
    const row = this.contentEl.createDiv({ cls: 'modal-button-container' })
    row.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close())
    const go = row.createEl('button', { cls: this.destructive ? 'mod-warning' : 'mod-cta', text: this.action })
    go.addEventListener('click', async () => {
      go.disabled = true
      try { await this.onConfirm() } finally { this.close() }
    })
  }

  onClose(): void { this.contentEl.empty() }
}
