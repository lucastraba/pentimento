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
