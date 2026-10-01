// Loads the built main.js against a minimal fake of Obsidian's API, backed by a real folder,
// and walks a note through the save / edit / restore / daily-draft cycle. It exercises the
// plugin's own code paths; the panel's DOM drawing is left to a real Obsidian.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Module from 'node:module'
import assert from 'node:assert/strict'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pentimento-vault-'))
const abs = (p) => path.join(root, p)
const notices = []

class TFile {
  constructor(p) { this.path = p; this.extension = path.extname(p).slice(1); this.basename = path.basename(p, '.md') }
  get stat() { return { mtime: fs.statSync(abs(this.path)).mtimeMs } }
}
const status = { text: '', shown: false, classes: new Set(), attrs: {},
  addClass(...c) { c.forEach((x) => this.classes.add(x)) }, setAttr(k, v) { this.attrs[k] = v }, addEventListener() {},
  setText(t) { this.text = t }, hide() { this.shown = false }, show() { this.shown = true },
  toggleClass(c, on) { on ? this.classes.add(c) : this.classes.delete(c) } }
let active = null
const handlers = {}
const app = {
  vault: {
    adapter: {
      exists: async (p) => fs.existsSync(abs(p)),
      read: async (p) => fs.readFileSync(abs(p), 'utf8'),
      write: async (p, c) => fs.writeFileSync(abs(p), c),
      mkdir: async (p) => fs.mkdirSync(abs(p), { recursive: true }),
      remove: async (p) => fs.rmSync(abs(p)),
      rmdir: async (p) => fs.rmSync(abs(p), { recursive: true }),
      stat: async (p) => (fs.existsSync(abs(p)) ? { mtime: fs.statSync(abs(p)).mtimeMs } : null),
    },
    process: async (file, fn) => { const out = fn(fs.readFileSync(abs(file.path), 'utf8')); fs.writeFileSync(abs(file.path), out); return out },
    getMarkdownFiles: () => fs.readdirSync(root).filter((f) => f.endsWith('.md')).map((f) => new TFile(f)),
    on: (name, fn) => { handlers[name] = fn; return {} },
  },
  workspace: {
    getActiveFile: () => active,
    getLeavesOfType: () => [],
    on: (name, fn) => { handlers[name] = fn; return {} },
    onLayoutReady: (fn) => fn(),
  },
  metadataCache: {
    getFileCache: (file) => {
      const m = /^---\n([\s\S]*?)\n---/.exec(fs.readFileSync(abs(file.path), 'utf8'))
      return { frontmatter: m && /^Pentimento: true$/m.test(m[1]) ? { Pentimento: true } : undefined }
    },
  },
}

class Plugin {
  constructor(a) { this.app = a; this.commands = {} }
  registerView() {} addRibbonIcon() {} addSettingTab() {} registerEvent() {} registerInterval(id) { clearInterval(id); return id }
  addCommand(c) { this.commands[c.id] = c } addStatusBarItem() { return status }
  async loadData() { return { author: 'Lucas', dailyDrafts: false } } async saveData() {}
}
const fake = {
  Plugin, TFile, ItemView: class {}, Modal: class {}, PluginSettingTab: class {}, Setting: class {}, MarkdownView: class {},
  Notice: class { constructor(m) { notices.push(m) } },
  normalizePath: (p) => p.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, ''),
  sanitizeHTMLToDom: () => null,
}
const load = Module._load
Module._load = function (req, ...rest) { return req === 'obsidian' ? fake : load.call(this, req, ...rest) }
globalThis.window = globalThis
const require = Module.createRequire(import.meta.url)
const Pentimento = require('../main.js').default

const settle = () => new Promise((r) => setTimeout(r, 20))
const write = (p, s) => fs.writeFileSync(abs(p), s)
const read = (p) => fs.readFileSync(abs(p), 'utf8')

write('Harbor.md', '# Harbor Lights\n\n## Chorus\nharbor lights, harbor lights\nkeep the water gold tonight\n\n## Bridge\nmaybe it is the tide, maybe it is the wine\n')
write('Untracked.md', '# Shopping\n\neggs\n')
active = new TFile('Harbor.md')

const plugin = new Pentimento(app)
await plugin.onload()
await settle()
assert.equal(status.text, 'No drafts')
assert.equal(plugin.commands['save-draft'].checkCallback(true), true)

await plugin.saveFile(active)
assert.match(notices.at(-1), /^Saved r001: First draft$/)
assert.match(read('Harbor.md'), /Current Revision: r001/)
await settle()
await new Promise((r) => setTimeout(r, 10))

write('Harbor.md', read('Harbor.md').replace('harbor lights, harbor lights\nkeep the water gold tonight', 'so let the harbor burn its lamps\nlet the last boat slip its ropes'))
handlers.modify(active)
await new Promise((r) => setTimeout(r, 700))
assert.equal(status.text, 'r001 · edited')
assert.ok(status.classes.has('is-edited'))

await plugin.saveFile(active)
assert.equal(notices.at(-1), 'Saved r002: Rewrote Chorus')
write('Harbor.md', read('Harbor.md').replace(/\n## Bridge\n.*\n/, '\n'))
await plugin.saveFile(active)
assert.equal(notices.at(-1), 'Saved r003: Removed Bridge')

// restore r001 after a further unsaved edit: the edit is kept as its own draft first
write('Harbor.md', read('Harbor.md') + '\none stray line\n')
await plugin.restore(active, 'r001')
assert.equal(notices.at(-1), 'Restored r001 as r005')
assert.match(read('Harbor.md'), /keep the water gold tonight/)
const meta = read('.history/Harbor/meta.yml')
assert.match(meta, /summary: Saved before restoring r001/)
assert.match(meta, /summary: Restored r001/)
assert.match(meta, /author: Lucas/)

// daily drafts: only tracked notes that changed, are idle, and have no draft today
plugin.settings.dailyDrafts = true
write('Harbor.md', read('Harbor.md') + '\na late addition\n')
await plugin.runDailyDrafts()
assert.ok(!fs.existsSync(abs('.history/Harbor/r006.md')), 'a draft from today blocks the daily one')
const m = read('.history/Harbor/meta.yml').replace(/(created_at: "?)\d{4}-\d{2}-\d{2}/g, '$12026-01-01')
write('.history/Harbor/meta.yml', m)
await plugin.runDailyDrafts()
assert.ok(!fs.existsSync(abs('.history/Harbor/r006.md')), 'a note edited minutes ago is left alone')
const old = new Date(Date.now() - 60 * 60 * 1000)
fs.utimesSync(abs('Harbor.md'), old, old)
await plugin.runDailyDrafts()
assert.ok(fs.existsSync(abs('.history/Harbor/r006.md')), 'an idle, changed note gets its daily draft')
assert.equal(notices.at(-1), 'Saved daily drafts: Harbor')
assert.ok(!fs.existsSync(abs('.history/Untracked')), 'notes without drafts are never touched')
assert.match(read('.history/Harbor/meta.yml'), /source: daily draft/)

console.log('harness: all checks passed')
console.log(notices.join('\n'))
fs.rmSync(root, { recursive: true })
