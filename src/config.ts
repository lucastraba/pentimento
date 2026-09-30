import os from 'node:os'
import path from 'node:path'

/** Personal config location. Nothing reads it since 0.11 removed palettes; kept for the migration notice. */
export const configPath = (): string => {
  if (process.env.PENTIMENTO_CONFIG?.trim()) return path.resolve(process.env.PENTIMENTO_CONFIG)
  const base = process.env.XDG_CONFIG_HOME?.trim() || path.join(os.homedir(), '.config')
  return path.join(base, 'pentimento', 'config.json')
}
