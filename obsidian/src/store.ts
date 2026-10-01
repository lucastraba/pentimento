import { normalizePath, type App } from 'obsidian'
import type { DraftStore } from '../../src/drafts'

/**
 * The draft store over Obsidian's vault adapter. The adapter reaches hidden folders such
 * as `.history/`, which the vault's file index leaves out, and works on mobile too.
 */
export const vaultStore = (app: App): DraftStore => {
  const adapter = app.vault.adapter
  const p = (path: string) => normalizePath(path)
  const ensureParent = async (path: string) => {
    const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
    if (parent && !(await adapter.exists(p(parent)))) await adapter.mkdir(p(parent))
  }
  return {
    read: async (path) => ((await adapter.exists(p(path))) ? adapter.read(p(path)) : null),
    write: async (path, content) => {
      await ensureParent(path)
      await adapter.write(p(path), content)
    },
    exists: (path) => adapter.exists(p(path)),
    mkdir: async (path) => {
      if (!(await adapter.exists(p(path)))) await adapter.mkdir(p(path))
    },
    remove: async (path) => {
      if (await adapter.exists(p(path))) await adapter.remove(p(path))
    },
    rmdir: async (path) => {
      if (await adapter.exists(p(path))) await adapter.rmdir(p(path), true)
    },
    mtime: async (path) => (await adapter.stat(p(path)))?.mtime ?? null,
    isEmptyFolder: async (path) => {
      if (!(await adapter.exists(p(path)))) return false
      const listed = await adapter.list(p(path))
      return !listed.files.length && !listed.folders.length
    },
  }
}
