import { MarkdownView, Modal, Notice, Plugin, Setting, TFile, type App } from 'obsidian'
import { draftStatus, restoreDraft, saveDraft, type DraftStore, type SaveDraftOptions } from '../../src/drafts'
import { DEFAULT_SETTINGS, PentimentoSettingTab, type PentimentoSettings } from './settings'
import { vaultStore } from './store'
import { HistoryView, VIEW_TYPE } from './view'

const DAILY_CHECK_MS = 30 * 60 * 1000
/** a note edited this recently is still being worked on; the daily draft waits */
const QUIET_MS = 15 * 60 * 1000

export default class PentimentoPlugin extends Plugin {
  settings: PentimentoSettings = DEFAULT_SETTINGS
  store!: DraftStore
  private statusEl!: HTMLElement
  private statusTimer: number | null = null
  private saving = new Set<string>()

  async onload(): Promise<void> {
    await this.loadSettings()
    this.store = vaultStore(this.app)

    this.registerView(VIEW_TYPE, (leaf) => new HistoryView(leaf, this))
    this.addRibbonIcon('history', 'Save draft', () => {
      const file = this.activeNote()
      if (file) void this.saveFile(file)
      else new Notice('Open a note to save a draft of it.')
    })

    this.addCommand({
      id: 'save-draft',
      name: 'Save draft',
      checkCallback: (checking) => this.withActiveNote(checking, (file) => this.saveFile(file)),
    })
    this.addCommand({
      id: 'save-draft-with-note',
      name: 'Save draft with a note…',
      checkCallback: (checking) => this.withActiveNote(checking, (file) => {
        new NoteModal(this.app, (summary, why) => void this.saveFile(file, { summary, why })).open()
      }),
    })
    this.addCommand({
      id: 'show-drafts',
      name: 'Show drafts',
      callback: () => void this.showHistory(),
    })

    this.statusEl = this.addStatusBarItem()
    this.statusEl.addClass('pentimento-statusbar', 'mod-clickable')
    this.statusEl.setAttr('aria-label', 'Show drafts')
    this.statusEl.addEventListener('click', () => void this.showHistory())

    this.registerEvent(this.app.workspace.on('file-open', () => this.scheduleStatus(0)))
    this.registerEvent(this.app.vault.on('modify', (file) => {
      if (file.path === this.app.workspace.getActiveFile()?.path) this.scheduleStatus(600)
    }))
    this.registerEvent(this.app.vault.on('rename', () => this.scheduleStatus(0)))

    this.addSettingTab(new PentimentoSettingTab(this.app, this))
    this.app.workspace.onLayoutReady(() => {
      this.scheduleStatus(0)
      void this.runDailyDrafts()
    })
    this.registerInterval(window.setInterval(() => void this.runDailyDrafts(), DAILY_CHECK_MS))
  }

  onunload(): void {
    if (this.statusTimer !== null) window.clearTimeout(this.statusTimer)
  }

  async loadSettings(): Promise<void> {
    this.settings = { ...DEFAULT_SETTINGS, ...((await this.loadData()) as Partial<PentimentoSettings> | null) }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings)
  }

  private activeNote(): TFile | null {
    const file = this.app.workspace.getActiveFile()
    return file && file.extension === 'md' ? file : null
  }

  private withActiveNote(checking: boolean, run: (file: TFile) => unknown): boolean {
    const file = this.activeNote()
    if (!file) return false
    if (!checking) void run(file)
    return true
  }

  /** Save the note as its next draft. Unsaved typing in an open editor is written first. */
  async saveFile(file: TFile, opts: Pick<SaveDraftOptions, 'summary' | 'why' | 'source'> = {}, quiet = false): Promise<boolean> {
    if (this.saving.has(file.path)) return false
    this.saving.add(file.path)
    try {
      await this.flushEditor(file)
      const res = await saveDraft(this.store, file.path, {
        ...opts,
        author: this.settings.author || undefined,
        updateCanonical: async (stamp) => { await this.app.vault.process(file, stamp) },
      })
      if (!quiet) new Notice(`Saved ${res.rev}: ${res.summary}`)
      return true
    } catch (e) {
      new Notice(`Pentimento: ${e instanceof Error ? e.message : String(e)}`, 8000)
      return false
    } finally {
      this.saving.delete(file.path)
      this.afterChange()
    }
  }

  /** Bring back an earlier draft, saving the note's current text first if it has changed. */
  async restore(file: TFile, rev: string): Promise<void> {
    try {
      await this.flushEditor(file)
      const status = await draftStatus(this.store, file.path)
      if (status?.dirty && status.latest) await saveDraft(this.store, file.path, {
        author: this.settings.author || undefined,
        summary: `Saved before restoring ${rev}`,
        updateCanonical: async (stamp) => { await this.app.vault.process(file, stamp) },
      })
      const res = await restoreDraft(this.store, file.path, rev, {
        author: this.settings.author || undefined,
        updateCanonical: async (stamp) => { await this.app.vault.process(file, stamp) },
      })
      new Notice(`Restored ${rev} as ${res.rev}`)
    } catch (e) {
      new Notice(`Pentimento: ${e instanceof Error ? e.message : String(e)}`, 8000)
    } finally {
      this.afterChange()
    }
  }

  private async flushEditor(file: TFile): Promise<void> {
    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
      const view = leaf.view
      if (view instanceof MarkdownView && view.file?.path === file.path) await view.save()
    }
  }

  private afterChange(): void {
    this.scheduleStatus(0)
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view instanceof HistoryView) void leaf.view.refresh()
    }
  }

  async showHistory(): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]
    if (!leaf) {
      const right = this.app.workspace.getRightLeaf(false)
      if (!right) return
      await right.setViewState({ type: VIEW_TYPE, active: true })
      leaf = right
    }
    await this.app.workspace.revealLeaf(leaf)
  }

  private scheduleStatus(delay: number): void {
    if (this.statusTimer !== null) window.clearTimeout(this.statusTimer)
    this.statusTimer = window.setTimeout(() => {
      this.statusTimer = null
      void this.updateStatus()
    }, delay)
  }

  /** "r004" when the note matches its latest draft, "r004 · edited" when it has moved since. */
  private async updateStatus(): Promise<void> {
    const file = this.activeNote()
    if (!file) { this.statusEl.hide(); return }
    let text = 'No drafts'
    let title = 'Save a draft to start this note\'s history'
    try {
      const s = await draftStatus(this.store, file.path)
      if (s?.latest) {
        text = s.dirty ? `${s.latest.id} · edited` : s.latest.id
        title = s.dirty ? `Changed since ${s.latest.id}: ${s.latest.summary}` : `${s.latest.id}: ${s.latest.summary}`
      }
    } catch {
      text = 'Drafts unreadable'
      title = 'The draft history for this note could not be read'
    }
    this.statusEl.setText(text)
    this.statusEl.setAttr('aria-label', title)
    this.statusEl.toggleClass('is-edited', text.endsWith('edited'))
    this.statusEl.show()
  }

  /** Once a day: a draft of each note that has drafts, changed since the last one, and sits idle. */
  async runDailyDrafts(): Promise<void> {
    if (!this.settings.dailyDrafts) return
    const today = new Date().toDateString()
    const saved: string[] = []
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (this.app.metadataCache.getFileCache(file)?.frontmatter?.['Pentimento'] !== true) continue
      if (Date.now() - file.stat.mtime < QUIET_MS) continue
      try {
        const s = await draftStatus(this.store, file.path)
        if (!s?.latest || !s.dirty || new Date(s.latest.created_at).toDateString() === today) continue
        if (await this.saveFile(file, { source: 'daily draft' }, true)) saved.push(file.basename)
      } catch { /* one unreadable history doesn't stop the rest */ }
    }
    if (saved.length) new Notice(`Saved daily drafts: ${saved.join(', ')}`)
  }
}

class NoteModal extends Modal {
  private summary = ''
  private why = ''

  constructor(app: App, private onSubmit: (summary: string, why: string) => void) {
    super(app)
  }

  onOpen(): void {
    this.setTitle('Save draft')
    new Setting(this.contentEl)
      .setName('What changed')
      .setDesc('Leave empty and Pentimento writes it from the changes.')
      .addText((t) => {
        t.setPlaceholder('New second verse').onChange((v) => { this.summary = v })
        t.inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.submit() })
        window.setTimeout(() => t.inputEl.focus(), 0)
      })
    new Setting(this.contentEl)
      .setName('Why')
      .addText((t) => t.setPlaceholder('Optional').onChange((v) => { this.why = v }))
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText('Save draft').setCta().onClick(() => this.submit()))
  }

  private submit(): void {
    this.close()
    this.onSubmit(this.summary.trim(), this.why.trim())
  }

  onClose(): void { this.contentEl.empty() }
}
