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
    expect(readGuide('archetypes')).toContain('Archetype: plan')
    expect(readGuide('style')).toContain('## Example 1')
  })

  it('sets a directive budget and teaches the register by example', () => {
    const guide = readGuide()
    expect(guide).toContain('## Directive budget')
    expect(guide).toContain('zero to three directives')
    expect(guide).toContain('## Prose')
    expect(guide).toContain('pentimento guide style')
    expect(bundledShim()).toContain('use few of them')
    // the style page shows whole documents rather than a list of bans
    expect(readGuide('style').match(/^````markdown$/gm)).toHaveLength(2)
  })

  it('makes the live viewer the default plan handoff', () => {
    expect(bundledShim()).toContain('start `pentimento serve .` in the background')
    expect(readGuide()).toContain('tracked background process')
    expect(readGuide()).toContain('give it to\n   the user')
  })

  it('frames plans as a single-user loop with approval, including remote access', () => {
    expect(bundledShim()).toContain('One user, one document')
    expect(bundledShim()).toContain('same user opens the page from another trusted device')
    expect(readGuide()).toContain('pentimento address')
    expect(readGuide()).toContain('approval')
    expect(readGuide()).toContain('--tailscale')
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
