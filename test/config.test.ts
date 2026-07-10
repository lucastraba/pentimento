import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { configPath, readUserConfig, setUserPalette } from '../src/config.js'
import { snapshot } from '../src/core.js'
import { render } from '../src/render.js'

let dir: string
let previous: string | undefined

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pentimento-config-'))
  previous = process.env.PENTIMENTO_CONFIG
  process.env.PENTIMENTO_CONFIG = path.join(dir, 'config.json')
})

afterEach(() => {
  if (previous === undefined) delete process.env.PENTIMENTO_CONFIG
  else process.env.PENTIMENTO_CONFIG = previous
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('user config', () => {
  it('stores and resets a personal palette atomically', () => {
    expect(configPath()).toBe(path.join(dir, 'config.json'))
    expect(readUserConfig()).toEqual({})

    const file = setUserPalette('iris')
    expect(file).toBe(configPath())
    expect(readUserConfig()).toEqual({ palette: 'iris' })
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ palette: 'iris' })

    setUserPalette(null)
    expect(readUserConfig()).toEqual({})
  })

  it('rejects unknown palette names and ignores malformed config', () => {
    expect(() => setUserPalette('neon')).toThrow('unknown theme: neon')
    fs.writeFileSync(configPath(), '{broken', 'utf8')
    expect(readUserConfig()).toEqual({})
  })

  it('provides the render default when frontmatter and environment do not override it', () => {
    setUserPalette('fjord')
    const doc = path.join(dir, 'Configured.md')
    fs.writeFileSync(doc, '# Configured\n\n## Section\n\ntext\n', 'utf8')
    snapshot(doc, { summary: 'configured', author: 'test' })
    const html = render(doc)
    expect(html).toContain("r.dataset.documentPalette='fjord'")
    expect(html).toContain('data-p="fjord" aria-pressed="true"')
  })
})
