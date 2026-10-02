import fs from 'node:fs'
import path from 'node:path'

/**
 * The viewer's live updates: one watch per folder. Node's recursive watch adds a watch per
 * file on Linux, `node_modules` included, so one viewer over a large tree used up the
 * machine's inotify watches and every viewer then crashed on its next new file. Folders no
 * document lives in are skipped, and a watch that can't be made or fails turns live updates
 * off for that folder instead of ending the server.
 */

// tool folders: dependencies, build output, and Python environments hold thousands of folders and no documents
const SKIP = new Set(['node_modules', '.git', '.obsidian', '.trash', 'dist', 'venv', '__pycache__'])
const skipped = (name: string): boolean => SKIP.has(name) || (name.startsWith('.') && name !== '.history')

export interface TreeWatcher {
  close(): void
  /** folders being watched */
  size(): number
}

export const watchTree = (
  root: string,
  /** a file or folder changed, as a POSIX path relative to `root` */
  onChange: (rel: string) => void,
  /** said once, the first time some folder can't be watched */
  onProblem: (message: string) => void,
  limit = 10000,
): TreeWatcher => {
  const watchers = new Map<string, { watcher: fs.FSWatcher; ino: number }>()
  let warned = false
  const problem = (message: string): void => {
    if (warned) return
    warned = true
    onProblem(message)
  }
  const rel = (full: string): string => path.relative(root, full).split(path.sep).join('/')
  const drop = (dir: string): void => {
    for (const [d, w] of watchers) {
      if (d === dir || d.startsWith(dir + path.sep)) { w.watcher.close(); watchers.delete(d) }
    }
  }
  /** The folder's inode if it is a real folder, checked right before it is watched or entered; a link is not one. */
  const folderId = (dir: string): number | null => {
    try {
      const st = fs.lstatSync(dir)
      return st.isDirectory() ? st.ino : null
    } catch {
      return null
    }
  }
  const add = (dir: string): boolean => {
    const ino = folderId(dir)
    if (ino === null) return false
    const current = watchers.get(dir)
    if (current) {
      if (current.ino === ino) return true
      // another folder now has this path, and the old watch still follows the old folder
      drop(dir)
    }
    if (watchers.size >= limit) {
      problem(`live updates cover the first ${limit} folders only; reload the page to see changes elsewhere`)
      return false
    }
    let watcher: fs.FSWatcher
    try {
      watcher = fs.watch(dir, (event, name) => {
        // an event can come without a name; then anything in the folder may have changed
        if (!name) { rescan(dir); return }
        const full = path.join(dir, String(name))
        onChange(rel(full))
        if (event !== 'rename') return
        if (folderId(full) === null) drop(full)
        else if (!skipped(path.basename(full))) walk(full, true)
      })
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      problem(code === 'ENOSPC'
        ? 'live updates are off for some folders: the system has run out of file watchers (fs.inotify.max_user_watches). The pages still work; reload to see changes.'
        : `live updates are off for ${dir}: ${error instanceof Error ? error.message : String(error)}`)
      return false
    }
    watcher.on('error', (error) => {
      drop(dir)
      problem(`live updates stopped for ${dir}: ${error.message}`)
    })
    watchers.set(dir, { watcher, ino })
    return true
  }
  /**
   * Watch a folder and the folders below it. `fresh` means it appeared after the start, so the
   * files already in it (written before its watch existed) are reported as changes.
   */
  const walk = (dir: string, fresh = false): void => {
    if (!add(dir)) return
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) { if (!skipped(entry.name)) walk(full, fresh) }
      else if (fresh && entry.isFile()) onChange(rel(full))
    }
  }
  /** Report every file in a folder, and watch any folder in it that isn't watched yet. */
  const rescan = (dir: string): void => {
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { drop(dir); return }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) { if (!skipped(entry.name)) walk(full, !watchers.has(full)) }
      else if (entry.isFile()) onChange(rel(full))
    }
  }
  walk(root)
  return {
    close: () => { for (const w of watchers.values()) w.watcher.close(); watchers.clear() },
    size: () => watchers.size,
  }
}
