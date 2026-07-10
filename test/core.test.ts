import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addComment,
  deleteComment,
  loadDoc,
  readMeta,
  readRevision,
  resolveComment,
  revert,
  snapshot,
  stampFrontmatter,
  writeMeta,
} from '../src/core.js'
import { verifyDoc } from '../src/verify.js'

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

  it('rejects history folders outside the canonical document directory', () => {
    const p = write('Plan.md', '---\nHistory Folder: ../outside\n---\n# Plan\n')
    expect(() => loadDoc(p)).toThrow(/History Folder.*inside/)

    const absolute = write('Absolute.md', `---\nHistory Folder: ${JSON.stringify(path.join(dir, 'absolute'))}\n---\n# Plan\n`)
    expect(() => loadDoc(absolute)).toThrow(/History Folder.*relative/)
  })

  it('rejects history folders reached through an escaping symlink', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'pentimento-outside-history-'))
    try {
      fs.symlinkSync(outside, path.join(dir, '.history'))
      const p = write('Plan.md', '# Plan\n')
      expect(() => loadDoc(p)).toThrow(/History Folder.*symlink/)
    } finally {
      fs.rmSync(outside, { recursive: true, force: true })
    }
  })

  it('reads only revision IDs recorded for the document', () => {
    const p = write('Plan.md', '# Plan\n')
    snapshot(p, { summary: 'one' })
    expect(readRevision(p, 'r001')).toContain('# Plan')
    expect(() => readRevision(p, '../../../secret')).toThrow(/Invalid revision/)
    expect(() => readRevision(p, 'r999')).toThrow(/No revision r999/)
  })

  it('validates metadata before writing a new revision', () => {
    const p = write('Plan.md', '# Plan\n\nInitial body.\n')
    snapshot(p, { summary: 'one' })
    const doc = loadDoc(p)
    fs.writeFileSync(path.join(doc.historyDir, 'meta.yml'), 'revisions: broken\ncomments: []\n')
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('Initial', 'Draft'))

    expect(() => snapshot(p, { summary: 'two' })).toThrow(/Invalid meta\.yml.*revisions.*array/)
    expect(fs.existsSync(path.join(doc.historyDir, 'r002.md'))).toBe(false)
    expect(loadDoc(p).body).toContain('Draft body')
  })

  it('rolls history and metadata back when the canonical commit fails', () => {
    const p = write('Plan.md', '# Plan\n\nInitial body.\n')
    snapshot(p, { summary: 'one' })
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('Initial', 'Draft'))
    const doc = loadDoc(p)
    const originalRename = fs.renameSync
    const rename = vi.spyOn(fs, 'renameSync')
    rename.mockImplementationOnce(originalRename)
    rename.mockImplementationOnce(() => { throw new Error('simulated canonical failure') })

    expect(() => snapshot(p, { summary: 'two' })).toThrow(/Snapshot failed without changing the canonical document/)
    rename.mockRestore()
    expect(fs.existsSync(path.join(doc.historyDir, 'r002.md'))).toBe(false)
    expect(readMeta(doc.historyDir).revisions.map((entry) => entry.id)).toEqual(['r001'])
    expect(loadDoc(p).body).toContain('Draft body')
    expect(loadDoc(p).frontmatter['Current Revision']).toBe('r001')
  })

  it('reports malformed metadata through verify instead of crashing', () => {
    const p = write('Plan.md', '# Plan\n\nInitial body with enough text to verify.\n')
    snapshot(p, { summary: 'one' })
    const doc = loadDoc(p)
    fs.writeFileSync(path.join(doc.historyDir, 'meta.yml'), 'revisions: broken\ncomments: []\n')
    expect(verifyDoc(p)).toEqual([
      expect.objectContaining({ level: 'error', message: expect.stringMatching(/Invalid meta\.yml.*revisions.*array/) }),
    ])
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

  it('does not change the canonical when a revert cannot create its revision', () => {
    const p = write('Plan.md', '# Plan\n\noriginal\n')
    snapshot(p, { summary: 'one' })
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('original', 'changed'))
    snapshot(p, { summary: 'two' })
    const before = fs.readFileSync(p, 'utf8')
    fs.writeFileSync(path.join(loadDoc(p).historyDir, 'r003.md'), 'collision')
    expect(() => revert(p, 'r001')).toThrow(/refusing to overwrite/)
    expect(fs.readFileSync(p, 'utf8')).toBe(before)
  })
})

describe('metadata and comments', () => {
  it('rejects duplicate IDs and invalid resolution references', () => {
    const p = write('Plan.md', '# Plan\n\nBody.\n')
    snapshot(p, { summary: 'one' })
    const comment = addComment(p, { text: 'Review this' })
    const doc = loadDoc(p)
    const meta = readMeta(doc.historyDir)
    meta.comments.push({ ...meta.comments[0] })
    expect(() => writeMeta(doc.historyDir, meta)).toThrow(/duplicate comment id/)
    expect(() => resolveComment(p, comment.id, 'r999')).toThrow(/missing revision r999/)
  })

  it('does not reuse a same-day comment id after deletion', () => {
    const p = write('Plan.md', '# Plan\n\nBody.\n')
    snapshot(p, { summary: 'one' })
    const first = addComment(p, { text: 'First' })
    const second = addComment(p, { text: 'Second' })
    deleteComment(p, first.id)
    const third = addComment(p, { text: 'Third' })
    expect(third.id).not.toBe(second.id)
    expect(Number(third.id.split('-').at(-1))).toBeGreaterThan(Number(second.id.split('-').at(-1)))
  })

  it('records a closing note and resolution in one metadata write', () => {
    const p = write('Plan.md', '# Plan\n\nBody.\n')
    snapshot(p, { summary: 'one' })
    const comment = addComment(p, { text: 'Review this' })
    const resolved = resolveComment(p, comment.id, 'r001', { text: 'Addressed', author: 'Agent' })
    expect(resolved).toMatchObject({ status: 'resolved', resolved_in: 'r001' })
    expect(resolved.replies).toEqual([expect.objectContaining({ text: 'Addressed', author: 'Agent' })])
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
