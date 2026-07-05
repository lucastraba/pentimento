#!/usr/bin/env node
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createTwoFilesPatch } from 'diff'
import { addComment, loadDoc, readMeta, readRevision, resolveComment, revert, snapshot } from './core.js'
import { renderDiffPage, renderToFile } from './render.js'
import { findVellumDocs, verifyDoc } from './verify.js'
import { serveViewer } from './viewer.js'

const USAGE = `vellum — living documents

Usage:
  vellum snapshot <doc> --summary "..." [--why "..."] [--source "..."] [--author name]
  vellum list <doc>
  vellum diff <doc> [revA] [revB] [--html [-o out.html]]
                                      (defaults: latest two; one arg diffs it against the canonical;
                                       --html renders a readable word-level diff page)
  vellum verify <doc-or-directory>    (check canonical/history/meta consistency)
  vellum revert <doc> <rev> [--author name]
  vellum render <doc> [-o out.html] [--artifact]
                                      (--artifact: fragment for claude.ai Artifact publishing;
                                       default: standalone HTML that works anywhere)
  vellum serve [dir] [--port 4820] [--host 127.0.0.1 | --tailscale] [--author name]
                                      (live viewer: document index, revision picker, diffs,
                                       hot reload, select-to-comment; never binds 0.0.0.0)
  vellum comments <doc>               (list comments, open first)
  vellum comment <doc> --text "..." [--anchor "#id"] [--quote "..."] [--author name]
  vellum address <doc>                (open comments formatted for an agent to act on)
  vellum resolve <doc> <comment-id> [--rev rNNN]

Inline comments: leave %% @c: a note %% in the markdown — snapshot extracts them
into meta.yml anchored to the nearest heading.
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
  console.error(`vellum: ${msg}`)
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
        author: flags.author,
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
      const targets = fs.statSync(doc).isDirectory() ? findVellumDocs(doc) : [doc]
      if (!targets.length) { console.log('no Vellum documents found'); break }
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
      const res = revert(doc, positional[1], flags.author)
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
      const host = flags.tailscale === 'true' ? tailscaleIp() : (flags.host ?? '127.0.0.1')
      serveViewer(root, { host, port, author: flags.author })
      console.log(`vellum viewer → http://${host}:${port}/  (watching ${root})`)
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
        author: flags.author,
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
      console.log(`  vellum snapshot ${positional[0]} --summary "Address review comments" --why "..."`)
      console.log(`  vellum resolve ${positional[0]} <comment-id> --rev <new revision>   # once per addressed comment`)
      break
    }
    case 'resolve': {
      if (!doc || !positional[1]) fail('resolve needs a document path and a comment id')
      const c = resolveComment(doc, positional[1], flags.rev)
      console.log(`${c.id} resolved${c.resolved_in ? ` in ${c.resolved_in}` : ''}`)
      break
    }
    default:
      console.log(USAGE)
      process.exit(cmd ? 1 : 0)
  }
}

try {
  main()
} catch (err) {
  fail(err instanceof Error ? err.message : String(err))
}
