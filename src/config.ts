import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { isPalette } from './themes.js'

export interface UserConfig {
  palette?: string
}

export const configPath = (): string => {
  if (process.env.PENTIMENTO_CONFIG?.trim()) return path.resolve(process.env.PENTIMENTO_CONFIG)
  const base = process.env.XDG_CONFIG_HOME?.trim() || path.join(os.homedir(), '.config')
  return path.join(base, 'pentimento', 'config.json')
}

export const readUserConfig = (): UserConfig => {
  const file = configPath()
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
    const palette = typeof parsed.palette === 'string' && isPalette(parsed.palette) ? parsed.palette : undefined
    return palette ? { palette } : {}
  } catch {
    return {}
  }
}

const writeUserConfig = (config: UserConfig): string => {
  const file = configPath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.tmp-${process.pid}`
  fs.writeFileSync(temp, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  fs.renameSync(temp, file)
  return file
}

export const setUserPalette = (palette: string | null): string => {
  if (palette !== null && !isPalette(palette)) throw new Error(`unknown theme: ${palette}`)
  const current = readUserConfig()
  if (palette) current.palette = palette
  else delete current.palette
  return writeUserConfig(current)
}
