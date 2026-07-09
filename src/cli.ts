#!/usr/bin/env node
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createTwoFilesPatch } from 'diff'
import { addComment, loadDoc, readMeta, readRevision, resolveComment, revert, snapshot } from './core.js'
import { renderDiffPage, renderToFile } from './render.js'
import { bundledShim, checkShim, installShim, readGuide } from './skill.js'
import { findPentimentoDocs, verifyDoc } from './verify.js'
import { serveViewer } from './viewer.js'

const USAGE = `pentimento — living documents

Usage:
  pentimento snapshot <doc> --summary "..." [--why "..."] [--source "..."] [--author name]
  pentimento list <doc>
  pentimento diff <doc> [revA] [revB] [--html [-o out.html]]
                                      (defaults: latest two; one arg diffs it against the canonical;
                                       --html renders a readable word-level diff page)
  pentimento verify <doc-or-directory>    (check canonical/history/meta consistency)
  pentimento revert <doc> <rev> [--author name]
  pentimento render <doc> [-o out.html] [--artifact]
                                      (--artifact: fragment for claude.ai Artifact publishing;
                                       default: standalone HTML that works anywhere)
  pentimento serve [dir] [--port 4820] [--host 127.0.0.1 | --tailscale] [--author name]
                                      (live viewer: document index, revision picker, diffs,
                                       hot reload, select-to-comment; never binds 0.0.0.0)
  pentimento comments <doc>               (list open comments, plus a resolved count)
  pentimento comment <doc> --text "..." [--anchor "#id"] [--quote "..."] [--author name]
  pentimento address <doc>                (open comments formatted for an agent to act on)
  pentimento resolve <doc> <comment-id> [--rev rNNN]
  pentimento guide [directives|archetypes]  (version-matched authoring instructions)
  pentimento skill install [dir]          (write the skill shim into dir; default .claude/skills)
  pentimento skill check [dir]            (warn if the installed skill shim is out of date)
  pentimento skill print                  (print the skill shim to stdout)

Inline comments: leave %% @c: a note %% in the markdown — snapshot extracts them
into meta.yml anchored to the nearest heading.

Skills stay current by deferring to the CLI: the shim is thin and calls \`pentimento guide\`,
which prints instructions matched to the installed version.
`

interface Args {
  positional: string[]
  flags: Record<string, string>
}

const parseArgs = (argv: string[]): Args => {
  const positional: string[] = []
  const flags: Record<string, string> = {}
  const boolean = new Set(['artifact', 'html', 'tailscale'])
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--') && boolean.has(a.slice(2))) flags[a.slice(2)] = 'true'
    else if (a.startsWith('--')) flags[a.slice(2)] = argv[++i] ?? ''
    else if (a === '-o') flags.out = argv[++i] ??
      ''
    else if (a === '-s') flags.summary = argv[++i] ?? ''
    else positional.push(a)
  }
  return { positional, flags }
}

const fail = (msg: string): never => {
  console.error(`pentimento: ${msg}`)
  process.exit(1)
}

const tailscaleIp = (): string => {
  try {
    const out = execSync('tailscale ip -4', { encoding: 'utf8', timeout: 5000 }).trim().split('\n')[0]
    if (/^100\./.test(out)) return out
  } catch { /* fall through to interface scan */ }
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      // Tailscale hands out CGNAT range 100.64.0.0/10
      if (a.family === 'IPv4' && /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(a.address)) return a.address
    }
  }
  return fail('could not determine a Tailscale IP (is tailscale up?)')
}

const defaultAuthor = (): string | undefined => {
  try {
    const name = execSync('git config user.name', { encoding: 'utf8', timeout: 3000 }).trim()
    if (name) return name
  } catch {
    // not in a git repo or git missing — fall through
  }
  return process.env.USER || process.env.USERNAME || undefined
}

const main = (): void => {
  const [cmd, ...rest] = process.argv.slice(2)
  const { positional, flags } = parseArgs(rest)
  const doc = positional[0]

  switch (cmd) {
    case 'snapshot': {
      if (!doc) fail('snapshot needs a document path')
      if (!flags.summary) fail('snapshot needs --summary "what changed"')
      const res = snapshot(doc, {
        summary: flags.summary,
        why: flags.why,
        source: flags.source,
        author: flags.author ?? defaultAuthor(),
      })
      console.log(`${res.rev} → ${res.historyFile}`)
      break
    }
    case 'list': {
      if (!doc) fail('list needs a document path')
      const meta = readMeta(loadDoc(doc).historyDir)
      if (!meta.revisions.length) { console.log('no revisions'); break }
      for (const r of meta.revisions) {
        console.log(`${r.id}  ${r.created_at}  ${r.author}`)
        console.log(`      ${r.summary}`)
        if (r.why) console.log(`      why: ${r.why}`)
      }
      const open = meta.comments.filter((c) => c.status === 'open')
      if (open.length) console.log(`\n${open.length} open comment(s)`)
      break
    }
    case 'diff': {
      if (!doc) fail('diff needs a document path')
      const d = loadDoc(doc)
      const meta = readMeta(d.historyDir)
      const revs = meta.revisions.map((r) => r.id)
      let a: string
      let b: string
      let bContent: string
      if (positional.length >= 3) {
        ;[a, b] = [positional[1], positional[2]]
        bContent = readRevision(doc, b)
      } else if (positional.length === 2) {
        a = positional[1]
        b = 'canonical'
        bContent = d.raw
      } else {
        if (revs.length < 2) fail('need at least two revisions to diff (or pass revisions explicitly)')
        ;[a, b] = revs.slice(-2)
        bContent = readRevision(doc, b)
      }
      if (flags.html === 'true') {
        const out = flags.out
          ? path.resolve(flags.out)
          : path.join(path.dirname(d.canonicalPath), `${d.name.toLowerCase()}-${a}-${b === 'canonical' ? 'now' : b}.html`)
        fs.writeFileSync(out, renderDiffPage(doc, a, b), 'utf8')
        console.log(out)
      } else {
        process.stdout.write(createTwoFilesPatch(`${d.name} ${a}`, `${d.name} ${b}`, readRevision(doc, a), bContent))
      }
      break
    }
    case 'verify': {
      if (!doc) fail('verify needs a document path or a directory')
      const targets = fs.statSync(doc).isDirectory() ? findPentimentoDocs(doc) : [doc]
      if (!targets.length) { console.log('no Pentimento documents found'); break }
      let errors = 0
      for (const t of targets) {
        const issues = verifyDoc(t)
        const label = path.relative(process.cwd(), t) || t
        if (!issues.length) { console.log(`✓ ${label}`); continue }
        console.log(`${issues.some((i) => i.level === 'error') ? '✗' : '•'} ${label}`)
        for (const i of issues) {
          console.log(`    ${i.level.toUpperCase().padEnd(5)} ${i.message}`)
          if (i.level === 'error') errors++
        }
      }
      if (errors) process.exit(1)
      break
    }
    case 'revert': {
      if (!doc || !positional[1]) fail('revert needs a document path and a revision (e.g. r002)')
      const res = revert(doc, positional[1], flags.author ?? defaultAuthor())
      console.log(`canonical restored from ${positional[1]}; recorded as ${res.rev}`)
      break
    }
    case 'render': {
      if (!doc) fail('render needs a document path')
      const out = renderToFile(doc, flags.out, { artifact: flags.artifact === 'true' })
      console.log(out)
      break
    }
    case 'serve': {
      const root = path.resolve(doc ?? '.')
      if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) fail(`not a directory: ${root}`)
      const port = Number(flags.port ?? 4820)
      const host = flags.tailscale === 'true' ? tailscaleIp() : (flags.host?.trim() || '127.0.0.1')
      serveViewer(root, { host, port, author: flags.author ?? defaultAuthor() })
      console.log(`pentimento viewer → http://${host}:${port}/  (watching ${root})`)
      break
    }
    case 'comments': {
      if (!doc) fail('comments needs a document path')
      const meta = readMeta(loadDoc(doc).historyDir)
      const open = meta.comments.filter((c) => c.status === 'open')
      const resolved = meta.comments.length - open.length
      if (!meta.comments.length) { console.log('no comments'); break }
      for (const c of open) {
        console.log(`[${c.id}] OPEN ${c.anchor || '(document)'} — ${c.author}, ${c.created_at.slice(0, 10)}`)
        if (c.quote) console.log(`    > ${c.quote}`)
        console.log(`    ${c.text}`)
      }
      if (resolved) console.log(`(+ ${resolved} resolved)`)
      break
    }
    case 'comment': {
      if (!doc) fail('comment needs a document path')
      if (!flags.text) fail('comment needs --text "..."')
      const entry = addComment(doc, {
        text: flags.text,
        anchor: flags.anchor,
        quote: flags.quote,
        author: flags.author ?? defaultAuthor(),
      })
      console.log(entry.id)
      break
    }
    case 'address': {
      if (!doc) fail('address needs a document path')
      const d = loadDoc(doc)
      const meta = readMeta(d.historyDir)
      const open = meta.comments.filter((c) => c.status === 'open')
      if (!open.length) { console.log('no open comments — nothing to address'); break }
      console.log(`${d.name} (${d.frontmatter['Current Revision'] ?? 'no revision'}) has ${open.length} open comment${open.length > 1 ? 's' : ''}:\n`)
      for (const c of open) {
        console.log(`[${c.id}] anchored at ${c.anchor || '(document)'} — ${c.author}, ${c.created_at.slice(0, 10)}`)
        if (c.quote) console.log(`  quoted text: "${c.quote}"`)
        if (c.prefix || c.suffix) console.log(`  context: …${c.prefix ?? ''}[quote]${c.suffix ?? ''}…`)
        console.log(`  comment: ${c.text}\n`)
      }
      console.log('To address: revise the canonical markdown accordingly, then:')
      console.log(`  pentimento snapshot ${positional[0]} --summary "Address review comments" --why "..."`)
      console.log(`  pentimento resolve ${positional[0]} <comment-id> --rev <new revision>   # once per addressed comment`)
      break
    }
    case 'resolve': {
      if (!doc || !positional[1]) fail('resolve needs a document path and a comment id')
      const c = resolveComment(doc, positional[1], flags.rev)
      console.log(`${c.id} resolved${c.resolved_in ? ` in ${c.resolved_in}` : ''}`)
      break
    }
    case 'guide': {
      // Version-matched authoring instructions, printed from this CLI's own files so a
      // stale skill file can never hide new features. Topic defaults to the main guide.
      console.log(readGuide(positional[0] ?? 'guide').trimEnd())
      break
    }
    case 'skill': {
      const sub = positional[0] ?? 'check'
      const dir = positional[1] ?? '.claude/skills'
      if (sub === 'print') {
        process.stdout.write(bundledShim())
      } else if (sub === 'install') {
        const res = installShim(dir)
        console.log(`${res.action}: ${res.path}`)
        if (res.action !== 'unchanged') {
          console.log('Tip: keep one copy per repo. opencode reads both .claude/skills and')
          console.log('.agents/skills — installing into both double-lists the skill.')
        }
      } else if (sub === 'check') {
        const res = checkShim(dir)
        if (res.status === 'missing') {
          console.log(`no skill at ${res.path} — install with: pentimento skill install ${dir}`)
          process.exit(1)
        } else if (res.status === 'stale') {
          console.log(`stale: ${res.path} is revision ${res.installed}, current is ${res.bundled}`)
          console.log(`refresh with: pentimento skill install ${dir}`)
          process.exit(1)
        } else {
          console.log(`current: ${res.path} (revision ${res.installed})`)
        }
      } else {
        fail(`unknown skill subcommand "${sub}" (use install | check | print)`)
      }
      break
    }
    default: {
      const wantsHelp = !cmd || cmd === 'help' || cmd === '--help' || cmd === '-h'
      console.log(USAGE)
      process.exit(wantsHelp ? 0 : 1)
    }
  }
}

try {
  main()
} catch (err) {
  fail(err instanceof Error ? err.message : String(err))
}
