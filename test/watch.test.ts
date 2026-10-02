import fs from 'node:fs'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { serveViewer } from '../src/viewer.js'
import { watchTree, type TreeWatcher } from '../src/watch.js'

let dir: string
let watcher: TreeWatcher | null = null

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pentimento-watch-'))
})

afterEach(() => {
  watcher?.close()
  watcher = null
  vi.restoreAllMocks()
  fs.rmSync(dir, { recursive: true, force: true })
})

const mkdir = (rel: string): void => fs.mkdirSync(path.join(dir, rel), { recursive: true })

const until = async (check: () => boolean): Promise<void> => {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 20))
  expect(check()).toBe(true)
}

describe('watchTree', () => {
  it('watches folders, not files, and skips the ones no document lives in', () => {
    for (const rel of ['notes/deep', '.history/Plan', 'node_modules/pkg/lib', '.git/objects', '.obsidian', '.cache', 'venv/lib', 'dist']) mkdir(rel)
    for (let i = 0; i < 50; i++) fs.writeFileSync(path.join(dir, 'notes', `n${i}.md`), 'x')
    watcher = watchTree(dir, () => {}, () => {})
    // the root, notes, notes/deep, .history, .history/Plan
    expect(watcher.size()).toBe(5)
  })

  it('reports changes as paths from the root, including in folders made later', async () => {
    mkdir('notes')
    const seen: string[] = []
    watcher = watchTree(dir, (rel) => seen.push(rel), () => {})
    fs.writeFileSync(path.join(dir, 'notes', 'Plan.md'), 'one')
    await until(() => seen.includes('notes/Plan.md'))
    mkdir('notes/later')
    await until(() => watcher!.size() === 3)
    fs.writeFileSync(path.join(dir, 'notes', 'later', 'shot.png'), 'png')
    await until(() => seen.includes('notes/later/shot.png'))
  })

  it('warns once and keeps going when the system is out of watchers', () => {
    mkdir('a/b')
    const watch = vi.spyOn(fs, 'watch').mockImplementation(() => {
      throw Object.assign(new Error('ENOSPC: System limit for number of file watchers reached'), { code: 'ENOSPC' })
    })
    const problems: string[] = []
    watcher = watchTree(dir, () => {}, (m) => problems.push(m))
    expect(watch).toHaveBeenCalledTimes(3)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('run out of file watchers')
  })

  it('stops at the folder limit', () => {
    mkdir('a/b/c')
    const problems: string[] = []
    watcher = watchTree(dir, () => {}, (m) => problems.push(m), 2)
    expect(watcher.size()).toBe(2)
    expect(problems).toEqual(['live updates cover the first 2 folders only; reload the page to see changes elsewhere'])
  })
})

describe('serveViewer without file watchers', () => {
  it('still serves pages', async () => {
    fs.writeFileSync(path.join(dir, 'Plan.md'), '# Plan\n')
    vi.spyOn(fs, 'watch').mockImplementation(() => {
      throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' })
    })
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const server = serveViewer(dir, { host: '127.0.0.1', port: 0 })
    try {
      if (!server.listening) await new Promise((r) => server.once('listening', r))
      const { port } = server.address() as AddressInfo
      expect((await fetch(`http://127.0.0.1:${port}/`)).status).toBe(200)
      expect(errors).toHaveBeenCalledWith(expect.stringContaining('run out of file watchers'))
    } finally {
      server.close()
    }
  })
})
