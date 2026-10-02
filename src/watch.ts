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
  const watchers = new Map<string, fs.FSWatcher>()
  let warned = false
  const problem = (message: string): void => {
    if (warned) return
    warned = true
    onProblem(message)
  }
  const drop = (dir: string): void => {
    for (const [d, w] of watchers) {
      if (d === dir || d.startsWith(dir + path.sep)) { w.close(); watchers.delete(d) }
    }
  }
  const add = (dir: string): void => {
    if (watchers.has(dir)) return
    if (watchers.size >= limit) {
      problem(`live updates cover the first ${limit} folders only; reload the page to see changes elsewhere`)
      return
    }
    let watcher: fs.FSWatcher
    try {
      watcher = fs.watch(dir, (event, name) => {
        if (!name) return
        const full = path.join(dir, String(name))
        onChange(path.relative(root, full).split(path.sep).join('/'))
        if (event !== 'rename') return
        let stat: fs.Stats
        try { stat = fs.statSync(full) } catch { drop(full); return }
        if (stat.isDirectory() && !skipped(path.basename(full))) walk(full)
      })
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      problem(code === 'ENOSPC'
        ? 'live updates are off for some folders: the system has run out of file watchers (fs.inotify.max_user_watches). The pages still work; reload to see changes.'
        : `live updates are off for ${dir}: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    watcher.on('error', (error) => {
      drop(dir)
      problem(`live updates stopped for ${dir}: ${error.message}`)
    })
    watchers.set(dir, watcher)
  }
  const walk = (dir: string): void => {
    add(dir)
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    // symbolic links are not followed, so a link back up the tree can't loop
    for (const entry of entries) if (entry.isDirectory() && !skipped(entry.name)) walk(path.join(dir, entry.name))
  }
  walk(root)
  return {
    close: () => { for (const w of watchers.values()) w.close(); watchers.clear() },
    size: () => watchers.size,
  }
}
