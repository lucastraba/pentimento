import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { splitRaw } from './core.js'

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../skill')
const SKILL_NAME = 'pentimento-plan'

/** Guide topics served by `pentimento guide [topic]`, mapped to files under skill/references. */
const GUIDE_TOPICS: Record<string, string> = {
  guide: 'references/guide.md',
  directives: 'references/directives.md',
  archetypes: 'references/archetypes.md',
}

export const guideTopics = (): string[] => Object.keys(GUIDE_TOPICS).filter((t) => t !== 'guide')

export const readGuide = (topic = 'guide'): string => {
  const rel = GUIDE_TOPICS[topic]
  if (!rel) {
    throw new Error(`unknown guide topic "${topic}" (available: ${guideTopics().join(', ')})`)
  }
  return fs.readFileSync(path.join(SKILL_DIR, rel), 'utf8')
}

/** The canonical shim SKILL.md that ships with this CLI version. */
export const bundledShim = (): string => fs.readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf8')

/** Read the pentimento_skill_revision stamped in a SKILL.md's frontmatter (0 if absent). */
export const shimRevision = (raw: string): number => {
  const { frontmatterRaw } = splitRaw(raw)
  if (!frontmatterRaw) return 0
  const fm = (parseYaml(frontmatterRaw) ?? {}) as Record<string, unknown>
  const meta = (fm.metadata ?? {}) as Record<string, unknown>
  const n = Number(meta.pentimento_skill_revision)
  return Number.isFinite(n) ? n : 0
}

export interface InstallResult {
  path: string
  action: 'created' | 'updated' | 'unchanged'
}

/** Write the bundled shim into <parentDir>/pentimento-plan/SKILL.md. */
export const installShim = (parentDir: string): InstallResult => {
  const dest = path.join(path.resolve(parentDir), SKILL_NAME, 'SKILL.md')
  const shim = bundledShim()
  const existed = fs.existsSync(dest)
  const same = existed && fs.readFileSync(dest, 'utf8') === shim
  if (!same) {
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, shim, 'utf8')
  }
  return { path: dest, action: same ? 'unchanged' : existed ? 'updated' : 'created' }
}

export interface CheckResult {
  path: string
  status: 'missing' | 'stale' | 'current'
  installed: number
  bundled: number
}

/** Compare the installed shim under <parentDir> against the bundled one. */
export const checkShim = (parentDir: string): CheckResult => {
  const dest = path.join(path.resolve(parentDir), SKILL_NAME, 'SKILL.md')
  const bundled = shimRevision(bundledShim())
  if (!fs.existsSync(dest)) return { path: dest, status: 'missing', installed: 0, bundled }
  const installed = shimRevision(fs.readFileSync(dest, 'utf8'))
  return { path: dest, status: installed < bundled ? 'stale' : 'current', installed, bundled }
}
