import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { snapshot } from '../src/core.js'
import { joinPath, locate, readHistory, removeHistory, restoreDraft, saveDraft, type DraftStore } from '../src/drafts.js'
import { untrack } from '../src/core.js'
import { unstampCanonical } from '../src/model.js'
import { findPentimentoDocs, verifyDoc } from '../src/verify.js'

/** A store over a real folder, so drafts saved here can be checked by the CLI. */
const folderStore = (root: string): DraftStore => {
  const abs = (p: string) => path.join(root, p)
  return {
    read: async (p) => (fs.existsSync(abs(p)) ? fs.readFileSync(abs(p), 'utf8') : null),
    write: async (p, c) => { fs.mkdirSync(path.dirname(abs(p)), { recursive: true }); fs.writeFileSync(abs(p), c) },
    exists: async (p) => fs.existsSync(abs(p)),
    mkdir: async (p) => { fs.mkdirSync(abs(p), { recursive: true }) },
    remove: async (p) => { fs.rmSync(abs(p), { force: true }) },
    rmdir: async (p) => { fs.rmSync(abs(p), { recursive: true, force: true }) },
    mtime: async (p) => (fs.existsSync(abs(p)) ? fs.statSync(abs(p)).mtimeMs : null),
    isEmptyFolder: async (p) => fs.existsSync(abs(p)) && !fs.readdirSync(abs(p)).length,
  }
}

let dir: string
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pentimento-drafts-')) })
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

const song = '# Harbor Lights\n\n## Chorus\n\nharbor lights harbor lights\nkeep the water gold\n\n## Bridge\n\nmaybe it is the tide\n'

describe('paths', () => {
  it('joins POSIX paths and refuses to leave the vault', () => {
    expect(joinPath('Songs', '.history/Harbor', 'meta.yml')).toBe('Songs/.history/Harbor/meta.yml')
    expect(joinPath('', '.history/Harbor')).toBe('.history/Harbor')
    expect(() => joinPath('..', 'x')).toThrow('escapes the vault')
  })

  it('finds the history folder from frontmatter or the default', () => {
    expect(locate('Songs/Harbor.md', song).historyDir).toBe('Songs/.history/Harbor')
    expect(locate('Songs/Harbor.md', '---\nHistory Folder: .drafts/H\n---\n# x\n').historyDir).toBe('Songs/.drafts/H')
    expect(() => locate('Songs/Harbor.md', '---\nHistory Folder: ../elsewhere\n---\n')).toThrow('inside the document')
  })
})

describe('the history folder for Obsidian Sync', () => {
  it('starts a note\'s history in _history when the host asks, and keeps it there', async () => {
    fs.writeFileSync(path.join(dir, 'Note.md'), song)
    fs.writeFileSync(path.join(dir, 'Old.md'), song)
    const store = folderStore(dir)
    await saveDraft(store, 'Old.md')
    expect((await saveDraft(store, 'Note.md', { historyFolder: '_history' })).revisionPath).toBe('_history/Note/r001.md')
    expect(fs.readFileSync(path.join(dir, 'Note.md'), 'utf8')).toContain('History Folder: _history/Note')
    // once a note has drafts, its own folder wins over the host's choice
    expect((await saveDraft(store, 'Note.md')).revisionPath).toBe('_history/Note/r002.md')
    expect((await saveDraft(store, 'Old.md', { historyFolder: '_history' })).revisionPath).toBe('.history/Old/r002.md')
    expect(() => locate('Note.md', song, 'drafts' as never)).toThrow('historyFolder must be one of .history, _history')
  })

  it('follows the plugin\'s choice from the command line, in that vault only', () => {
    const settings = path.join(dir, 'vault', '.obsidian', 'plugins', 'pentimento')
    fs.mkdirSync(settings, { recursive: true })
    fs.writeFileSync(path.join(settings, 'data.json'), JSON.stringify({ historyFolder: '_history' }))
    fs.mkdirSync(path.join(dir, 'vault', 'Songs'))
    fs.writeFileSync(path.join(dir, 'vault', 'Songs', 'Harbor.md'), song)
    fs.writeFileSync(path.join(dir, 'Outside.md'), song)
    expect(snapshot(path.join(dir, 'vault', 'Songs', 'Harbor.md'), {}).historyFile).toBe(path.join(fs.realpathSync(dir), 'vault', 'Songs', '_history', 'Harbor', 'r001.md'))
    expect(snapshot(path.join(dir, 'Outside.md'), {}).historyFile).toBe(path.join(fs.realpathSync(dir), '.history', 'Outside', 'r001.md'))
    // a value the plugin never writes is ignored
    fs.writeFileSync(path.join(settings, 'data.json'), JSON.stringify({ historyFolder: '../../etc' }))
    fs.writeFileSync(path.join(dir, 'vault', 'Other.md'), song)
    expect(snapshot(path.join(dir, 'vault', 'Other.md'), {}).historyFile).toContain(path.join('vault', '.history', 'Other'))
  })

  it('writes the same _history files from the CLI and the plugin', async () => {
    const settings = path.join(dir, 'cli', '.obsidian', 'plugins', 'pentimento')
    fs.mkdirSync(settings, { recursive: true })
    fs.writeFileSync(path.join(settings, 'data.json'), JSON.stringify({ historyFolder: '_history' }))
    fs.mkdirSync(path.join(dir, 'vault'))
    fs.writeFileSync(path.join(dir, 'cli', 'Harbor.md'), song)
    fs.writeFileSync(path.join(dir, 'vault', 'Harbor.md'), song)
    snapshot(path.join(dir, 'cli', 'Harbor.md'), { author: 'L' })
    await saveDraft(folderStore(path.join(dir, 'vault')), 'Harbor.md', { author: 'L', historyFolder: '_history' })
    for (const f of ['Harbor.md', '_history/Harbor/r001.md']) {
      expect(fs.readFileSync(path.join(dir, 'vault', f), 'utf8')).toBe(fs.readFileSync(path.join(dir, 'cli', f), 'utf8'))
    }
  })
})

describe('saveDraft', () => {
  it('writes the same files the CLI writes', async () => {
    fs.mkdirSync(path.join(dir, 'cli'))
    fs.mkdirSync(path.join(dir, 'vault', 'Songs'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'cli', 'Harbor.md'), song)
    fs.writeFileSync(path.join(dir, 'vault', 'Songs', 'Harbor.md'), song)
    const store = folderStore(path.join(dir, 'vault'))

    snapshot(path.join(dir, 'cli', 'Harbor.md'), { author: 'L' })
    const first = await saveDraft(store, 'Songs/Harbor.md', { author: 'L' })
    expect(first).toMatchObject({ rev: 'r001', summary: 'First draft', revisionPath: 'Songs/.history/Harbor/r001.md' })

    const edit = (p: string) => fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('\n## Bridge\n\nmaybe it is the tide\n', ''))
    edit(path.join(dir, 'cli', 'Harbor.md'))
    edit(path.join(dir, 'vault', 'Songs', 'Harbor.md'))
    snapshot(path.join(dir, 'cli', 'Harbor.md'), { author: 'L' })
    expect((await saveDraft(store, 'Songs/Harbor.md', { author: 'L' })).summary).toBe('Removed Bridge')

    const cliFile = (p: string) => fs.readFileSync(path.join(dir, 'cli', p), 'utf8')
    const vaultFile = (p: string) => fs.readFileSync(path.join(dir, 'vault', 'Songs', p), 'utf8')
    for (const f of ['Harbor.md', '.history/Harbor/r001.md', '.history/Harbor/r002.md']) expect(vaultFile(f)).toBe(cliFile(f))
    const strip = (yml: string) => parse(yml).revisions.map(({ created_at: _, ...r }: { created_at: string }) => r)
    expect(strip(vaultFile('.history/Harbor/meta.yml'))).toEqual(strip(cliFile('.history/Harbor/meta.yml')))
    expect(verifyDoc(path.join(dir, 'vault', 'Songs', 'Harbor.md')).filter((i) => i.level !== 'info')).toEqual([])
  })

  it('stamps the canonical as it is when the host saves it, keeping late keystrokes', async () => {
    fs.writeFileSync(path.join(dir, 'Note.md'), song)
    const store = folderStore(dir)
    await saveDraft(store, 'Note.md', {
      updateCanonical: async (stamp) => {
        const typedMeanwhile = `${fs.readFileSync(path.join(dir, 'Note.md'), 'utf8')}one more line\n`
        fs.writeFileSync(path.join(dir, 'Note.md'), stamp(typedMeanwhile))
      },
    })
    const canonical = fs.readFileSync(path.join(dir, 'Note.md'), 'utf8')
    expect(canonical).toContain('Current Revision: r001')
    expect(canonical).toContain('one more line')
    const history = await readHistory(store, 'Note.md')
    expect(history?.dirty).toBe(true)
  })

  it('respects the CLI lock and rolls back when the canonical cannot be written', async () => {
    fs.writeFileSync(path.join(dir, 'Note.md'), song)
    const store = folderStore(dir)
    fs.mkdirSync(path.join(dir, '.history', 'Note', '.lock'), { recursive: true })
    await expect(saveDraft(store, 'Note.md')).rejects.toThrow('Another Pentimento operation')
    fs.rmSync(path.join(dir, '.history', 'Note', '.lock'), { recursive: true })

    await expect(saveDraft(store, 'Note.md', { updateCanonical: async () => { throw new Error('editor busy') } }))
      .rejects.toThrow('nothing was changed: editor busy')
    expect(fs.existsSync(path.join(dir, '.history', 'Note', 'r001.md'))).toBe(false)
    expect(fs.existsSync(path.join(dir, '.history', 'Note', 'meta.yml'))).toBe(false)
    expect(fs.existsSync(path.join(dir, '.history', 'Note', '.lock'))).toBe(false)
    expect(fs.readFileSync(path.join(dir, 'Note.md'), 'utf8')).toBe(song)
  })
})

describe('restoreDraft', () => {
  it('brings an earlier draft back as a new one', async () => {
    fs.writeFileSync(path.join(dir, 'Note.md'), song)
    const store = folderStore(dir)
    await saveDraft(store, 'Note.md')
    fs.writeFileSync(path.join(dir, 'Note.md'), fs.readFileSync(path.join(dir, 'Note.md'), 'utf8').replace('keep the water gold', 'burn the lamps'))
    await saveDraft(store, 'Note.md')
    const res = await restoreDraft(store, 'Note.md', 'r001')
    expect(res).toMatchObject({ rev: 'r003', summary: 'Restored r001' })
    const canonical = fs.readFileSync(path.join(dir, 'Note.md'), 'utf8')
    expect(canonical).toContain('keep the water gold')
    expect(canonical).toContain('Current Revision: r003')
    await expect(restoreDraft(store, 'Note.md', 'r009')).rejects.toThrow('No draft r009')
  })
})

describe('taking a note out of Pentimento', () => {
  it('returns a note to how it was before its first draft', async () => {
    fs.writeFileSync(path.join(dir, 'Note.md'), song)
    const store = folderStore(dir)
    await saveDraft(store, 'Note.md')
    await saveDraft(store, 'Note.md')
    const res = await removeHistory(store, 'Note.md')
    expect(res).toEqual({ historyDir: '.history/Note', drafts: 2 })
    expect(fs.readFileSync(path.join(dir, 'Note.md'), 'utf8')).toBe(song)
    expect(fs.existsSync(path.join(dir, '.history'))).toBe(false)
  })

  it('keeps the note\'s own properties and leaves other histories alone', async () => {
    const tagged = '---\ntags: [song]\n---\n# Other\n\ntext here\n'
    fs.writeFileSync(path.join(dir, 'Other.md'), tagged)
    fs.writeFileSync(path.join(dir, 'Note.md'), song)
    const store = folderStore(dir)
    await saveDraft(store, 'Other.md')
    // saving touches only the lines Pentimento owns
    expect(fs.readFileSync(path.join(dir, 'Other.md'), 'utf8')).toBe(
      '---\ntags: [song]\nPentimento: true\nCurrent Revision: r001\nHistory Folder: .history/Other\n---\n# Other\n\ntext here\n')
    await saveDraft(store, 'Note.md')
    await removeHistory(store, 'Other.md')
    expect(fs.readFileSync(path.join(dir, 'Other.md'), 'utf8')).toBe(tagged)
    expect(fs.existsSync(path.join(dir, '.history', 'Note', 'r001.md'))).toBe(true)
    // another note still has history, so the shared folder stays
    expect(fs.existsSync(path.join(dir, '.history'))).toBe(true)
  })

  it('waits for a save in progress, and refuses a history folder that is the note\'s own folder', async () => {
    fs.writeFileSync(path.join(dir, 'Note.md'), song)
    const store = folderStore(dir)
    await saveDraft(store, 'Note.md')
    fs.mkdirSync(path.join(dir, '.history', 'Note', '.lock'))
    await expect(removeHistory(store, 'Note.md')).rejects.toThrow('being saved')
    fs.writeFileSync(path.join(dir, 'Odd.md'), '---\nHistory Folder: .\n---\n# Odd\n')
    await expect(removeHistory(store, 'Odd.md')).rejects.toThrow('own folder')
  })

  it('works the same from the CLI', () => {
    const p = path.join(dir, 'Cli.md')
    fs.writeFileSync(p, song)
    snapshot(p, {})
    expect(untrack(p)).toMatchObject({ drafts: 1 })
    expect(fs.readFileSync(p, 'utf8')).toBe(song)
    expect(fs.existsSync(path.join(dir, '.history'))).toBe(false)
  })

  it('cleans up a history folder by any name, as Obsidian Sync needs', async () => {
    // `.history` doesn't sync with Obsidian Sync; `_history` does
    const synced = (title: string) => `---\nHistory Folder: _history/${title}\n---\n# ${title}\n\nsome text here\n`
    fs.writeFileSync(path.join(dir, 'Note.md'), synced('Note'))
    fs.writeFileSync(path.join(dir, 'Other.md'), synced('Other'))
    const store = folderStore(dir)
    await saveDraft(store, 'Note.md')
    await saveDraft(store, 'Other.md')
    expect(fs.existsSync(path.join(dir, '_history', 'Note', 'r001.md'))).toBe(true)
    await removeHistory(store, 'Note.md')
    expect(fs.existsSync(path.join(dir, '_history', 'Other'))).toBe(true)
    await removeHistory(store, 'Other.md')
    expect(fs.existsSync(path.join(dir, '_history'))).toBe(false)

    const p = path.join(dir, 'Cli.md')
    fs.writeFileSync(p, synced('Cli'))
    snapshot(p, {})
    untrack(p)
    expect(fs.existsSync(path.join(dir, '_history'))).toBe(false)

    // a renamed note keeps its old history folder name
    fs.writeFileSync(path.join(dir, 'Renamed.md'), synced('Old Title').replace('# Old Title', '# Renamed'))
    await saveDraft(store, 'Renamed.md')
    await removeHistory(store, 'Renamed.md')
    expect(fs.existsSync(path.join(dir, '_history'))).toBe(false)
  })

  it('never mistakes saved drafts for documents, wherever the history is', async () => {
    fs.writeFileSync(path.join(dir, 'Note.md'), '---\nHistory Folder: _history/Note\n---\n# Note\n\nsome text here\n')
    fs.writeFileSync(path.join(dir, 'Plain.md'), song)
    const store = folderStore(dir)
    await saveDraft(store, 'Note.md')
    await saveDraft(store, 'Note.md')
    await saveDraft(store, 'Plain.md')
    expect(findPentimentoDocs(dir).map((p) => path.relative(dir, p))).toEqual(['Note.md', 'Plain.md'])
  })

  it('leaves the user\'s own folders alone', async () => {
    fs.mkdirSync(path.join(dir, 'drafts'))
    fs.writeFileSync(path.join(dir, 'Note.md'), '---\nHistory Folder: drafts/history-of-note\n---\n# Note\n\nsome text here\n')
    const store = folderStore(dir)
    await saveDraft(store, 'Note.md')
    await removeHistory(store, 'Note.md')
    expect(fs.existsSync(path.join(dir, 'drafts', 'history-of-note'))).toBe(false)
    // not `<folder>/<note>`, so `drafts` is the user's, and stays
    expect(fs.existsSync(path.join(dir, 'drafts'))).toBe(true)
  })

  it('only removes the keys Pentimento owns', () => {
    expect(unstampCanonical('# no frontmatter\n')).toBe('# no frontmatter\n')
    expect(unstampCanonical('---\nPentimento: true\nCurrent Revision: r002\nHistory Folder: .history/X\nAuthor: me\n---\nbody\n'))
      .toBe('---\nAuthor: me\n---\nbody\n')
  })
})

describe('readHistory', () => {
  it('returns drafts oldest first and whether the note moved since the last one', async () => {
    fs.writeFileSync(path.join(dir, 'Note.md'), song)
    const store = folderStore(dir)
    expect((await readHistory(store, 'Note.md'))?.dirty).toBe(true)
    await saveDraft(store, 'Note.md')
    let h = await readHistory(store, 'Note.md')
    expect(h?.drafts.map((d) => d.id)).toEqual(['r001'])
    expect(h?.dirty).toBe(false)
    fs.appendFileSync(path.join(dir, 'Note.md'), '\nnew line\n')
    h = await readHistory(store, 'Note.md')
    expect(h?.dirty).toBe(true)
    expect(await readHistory(store, 'Missing.md')).toBeNull()
  })
})
