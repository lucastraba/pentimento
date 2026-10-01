import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { snapshot } from '../src/core.js'
import { joinPath, locate, readHistory, restoreDraft, saveDraft, type DraftStore } from '../src/drafts.js'
import { verifyDoc } from '../src/verify.js'

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
