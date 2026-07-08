import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadDoc, readMeta, revert, snapshot, stampFrontmatter } from '../src/core.js'

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pentimento-test-'))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

const write = (name: string, content: string): string => {
  const p = path.join(dir, name)
  fs.writeFileSync(p, content)
  return p
}

describe('snapshot', () => {
  it('initializes history and stamps frontmatter on a bare document', () => {
    const p = write('Plan.md', '# Plan\n\nHello.\n')
    const res = snapshot(p, { summary: 'first', author: 'test' })
    expect(res.rev).toBe('r001')
    const doc = loadDoc(p)
    expect(doc.frontmatter['Pentimento']).toBe(true)
    expect(doc.frontmatter['Current Revision']).toBe('r001')
    expect(doc.frontmatter['History Folder']).toBe('.history/Plan')
    expect(fs.readFileSync(res.historyFile, 'utf8')).toBe(doc.raw)
    const meta = readMeta(doc.historyDir)
    expect(meta.revisions).toHaveLength(1)
    expect(meta.revisions[0]).toMatchObject({ id: 'r001', summary: 'first', author: 'test' })
  })

  it('bumps the revision on each snapshot (audit C1)', () => {
    const p = write('Plan.md', '# Plan\n\nv1\n')
    snapshot(p, { summary: 'one' })
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('v1', 'v2'))
    const res = snapshot(p, { summary: 'two' })
    expect(res.rev).toBe('r002')
    expect(loadDoc(p).frontmatter['Current Revision']).toBe('r002')
    expect(readMeta(loadDoc(p).historyDir).revisions.map((r) => r.id)).toEqual(['r001', 'r002'])
  })

  it('refuses to overwrite an existing revision file when state disagrees', () => {
    const p = write('Plan.md', '# Plan\n')
    snapshot(p, { summary: 'one' })
    // simulate frontmatter drift back to no revision
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('Current Revision: r001', 'Current Revision: r000'))
    expect(() => snapshot(p, { summary: 'again' })).toThrow(/refusing to overwrite/)
  })

  it('migrates a legacy Vellum-marked doc: reads its revision, swaps the marker', () => {
    const p = write('Plan.md', '---\nVellum: true\nCurrent Revision: r002\nHistory Folder: .history/Plan\n---\n# Plan\n\nv3\n')
    const res = snapshot(p, { summary: 'first after rename' })
    expect(res.rev).toBe('r003')
    const doc = loadDoc(p)
    expect(doc.frontmatter['Pentimento']).toBe(true)
    expect(doc.frontmatter['Vellum']).toBeUndefined()
    expect(doc.frontmatter['Current Revision']).toBe('r003')
  })

  it('errors loudly on a malformed Current Revision (audit M5)', () => {
    const p = write('Plan.md', '---\nPentimento: true\nCurrent Revision: rev 2026 draft\n---\n# Plan\n')
    expect(() => snapshot(p, { summary: 'x' })).toThrow(/Invalid Current Revision/)
  })

  it('preserves multi-line frontmatter values (audit H3)', () => {
    const p = write('Plan.md', '---\nAliases:\n  - "One"\n  - "Two"\nType: "[[Project]]"\n---\n# Plan\n')
    snapshot(p, { summary: 'x' })
    const doc = loadDoc(p)
    expect(doc.frontmatter['Aliases']).toEqual(['One', 'Two'])
    expect(doc.frontmatter['Type']).toBe('[[Project]]')
    expect(doc.raw).toContain('Type: "[[Project]]"')
  })

  it('handles unicode and spaces in names', () => {
    const p = write('Тру крайм плюс.md', '# Тру крайм\n')
    const res = snapshot(p, { summary: 'x' })
    expect(res.historyFile).toContain('.history/Тру крайм плюс/r001.md')
  })
})

describe('revert', () => {
  it('restores an old body as a new revision, keeping history append-only', () => {
    const p = write('Plan.md', '# Plan\n\noriginal\n')
    snapshot(p, { summary: 'one' })
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('original', 'changed'))
    snapshot(p, { summary: 'two' })
    const res = revert(p, 'r001')
    expect(res.rev).toBe('r003')
    const doc = loadDoc(p)
    expect(doc.body).toContain('original')
    expect(doc.frontmatter['Current Revision']).toBe('r003')
    expect(readMeta(doc.historyDir).revisions).toHaveLength(3)
  })
})

describe('stampFrontmatter', () => {
  it('adds frontmatter to a bare document', () => {
    const out = stampFrontmatter('# Hi\n', { Pentimento: true, 'Current Revision': 'r001' })
    expect(out).toMatch(/^---\n/)
    expect(out).toContain('Pentimento: true')
    expect(out).toContain('# Hi')
  })
})
