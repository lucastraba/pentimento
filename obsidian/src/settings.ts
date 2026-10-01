import { PluginSettingTab, Setting, type App } from 'obsidian'
import type PentimentoPlugin from './main'

export interface PentimentoSettings {
  /** recorded on each draft; empty means "unknown", as with the CLI outside git */
  author: string
  /** once a day, save a draft of every note that has drafts and changed since the last one */
  dailyDrafts: boolean
}

export const DEFAULT_SETTINGS: PentimentoSettings = {
  author: '',
  dailyDrafts: false,
}

export class PentimentoSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: PentimentoPlugin) {
    super(app, plugin)
  }

  display(): void {
    const { containerEl } = this
    containerEl.empty()

    new Setting(containerEl)
      .setName('Your name')
      .setDesc('Recorded as the author of each draft you save.')
      .addText((text) => text
        .setPlaceholder('Lucas')
        .setValue(this.plugin.settings.author)
        .onChange(async (value) => {
          this.plugin.settings.author = value.trim()
          await this.plugin.saveSettings()
        }))

    new Setting(containerEl)
      .setName('Save a draft every day')
      .setDesc('Once a day, notes that already have drafts and changed since their last one get a new draft. Notes you are editing right now are left until you stop for a while.')
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.dailyDrafts)
        .onChange(async (value) => {
          this.plugin.settings.dailyDrafts = value
          await this.plugin.saveSettings()
          if (value) void this.plugin.runDailyDrafts()
        }))
  }
}
