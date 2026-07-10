import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { bundledShim, checkShim, installShim, readGuide, shimRevision } from '../src/skill.js'

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pentimento-skill-'))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('guide', () => {
  it('serves the main guide and named topics', () => {
    expect(readGuide()).toContain('Pentimento authoring guide')
    expect(readGuide('directives')).toContain('directive')
    expect(readGuide('archetypes')).toContain('archetype')
    expect(readGuide('style')).toContain('before/after')
  })

  it('teaches the prose register in the main guide', () => {
    const guide = readGuide()
    expect(guide).toContain('## Prose')
    expect(guide).toContain('No false contrast')
    expect(guide).toContain('pentimento guide style')
  })

  it('makes the live viewer the default plan handoff', () => {
    expect(bundledShim()).toContain('Serve the plan after the first snapshot')
    expect(bundledShim()).toContain('tracked background process')
    expect(readGuide()).toContain('Serve the plan (default)')
    expect(readGuide()).toContain('give the URL to the user')
  })

  it('frames plans as a single-user loop, including VPS access', () => {
    expect(bundledShim()).toContain('one user and one canonical document')
    expect(bundledShim()).toContain('remote access, not a shared workspace')
    expect(readGuide()).toContain('revision instructions')
    expect(readGuide()).toContain('same user')
    expect(readGuide()).toContain('VPS')
  })

  it('rejects unknown topics with the available list', () => {
    expect(() => readGuide('nope')).toThrow(/unknown guide topic/)
  })
})

describe('shimRevision', () => {
  it('reads the stamped revision from the bundled shim', () => {
    expect(shimRevision(bundledShim())).toBeGreaterThanOrEqual(1)
  })

  it('returns 0 when no stamp is present', () => {
    expect(shimRevision('# no frontmatter')).toBe(0)
    expect(shimRevision('---\nname: x\n---\nbody')).toBe(0)
  })
})

describe('install and check', () => {
  it('creates, then reports unchanged on a second install', () => {
    expect(installShim(dir).action).toBe('created')
    expect(installShim(dir).action).toBe('unchanged')
  })

  it('reports missing, current, then stale', () => {
    expect(checkShim(dir).status).toBe('missing')
    installShim(dir)
    expect(checkShim(dir).status).toBe('current')

    const dest = path.join(dir, 'pentimento-plan', 'SKILL.md')
    const downgraded = fs.readFileSync(dest, 'utf8').replace(/pentimento_skill_revision: "\d+"/, 'pentimento_skill_revision: "0"')
    fs.writeFileSync(dest, downgraded)
    const res = checkShim(dir)
    expect(res.status).toBe('stale')
    expect(res.installed).toBeLessThan(res.bundled)
  })
})
