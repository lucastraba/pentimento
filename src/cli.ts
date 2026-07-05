#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { createTwoFilesPatch } from 'diff'
import { loadDoc, readMeta, readRevision, revert, snapshot } from './core.js'
import { renderDiffPage, renderToFile } from './render.js'
import { findVellumDocs, verifyDoc } from './verify.js'

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
`

interface Args {
  positional: string[]
  flags: Record<string, string>
}

const parseArgs = (argv: string[]): Args => {
  const positional: string[] = []
  const flags: Record<string, string> = {}
  const boolean = new Set(['artifact', 'html'])
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
