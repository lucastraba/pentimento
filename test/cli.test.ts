import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cli = path.join(root, 'dist/cli.js')
const run = (...args: string[]): string => execFileSync(process.execPath, [cli, ...args], {
  cwd: root,
  encoding: 'utf8',
  timeout: 5000,
})

describe('CLI discovery', () => {
  it('prints the package version', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string }
    expect(run('--version').trim()).toBe(pkg.version)
  })

  it('shows help without starting a serve process', () => {
    const output = run('serve', '--help')
    expect(output).toContain('Usage:')
    expect(output).toContain('pentimento serve')
    expect(output).not.toContain('viewer →')
  })
})
