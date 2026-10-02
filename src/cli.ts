#!/usr/bin/env node
import crypto from 'node:crypto'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createTwoFilesPatch } from 'diff'
import { configPath } from './config.js'
import {
  addComment, addReply, approve, canonicalRevisionState, describeImageComment, latestApproval, loadDoc, readMeta, readRevision,
  resolveComment, revert, snapshot, splitRaw, untrack,
} from './core.js'
import { renderDiffPage, renderToFile } from './render.js'
import { lintDoc } from './lint.js'
import { collectCuttings } from './semdiff.js'
import { bundledShim, checkShim, installShim, readGuide } from './skill.js'
import { findPentimentoDocs, verifyDoc } from './verify.js'
import { isLoopbackHost, serveViewer, viewerOrigin } from './viewer.js'

const USAGE = `pentimento — living documents

Usage:
  pentimento snapshot <doc> [--summary "..."] [--why "..."] [--source "..."] [--author name]
                                      (without --summary, the summary is computed from what
                                       changed: "Removed Bridge; rewrote Chorus")
  pentimento list <doc>
  pentimento cuttings <doc>               (passages cut from earlier drafts and not in the current one)
  pentimento diff <doc> [revA] [revB] [--html [-o out.html]]
                                      (defaults: latest two; one arg diffs it against the canonical;
                                       --html renders a readable word-level diff page)
  pentimento verify <doc-or-directory>    (check canonical/history/meta consistency)
  pentimento revert <doc> <rev> [--author name]
  pentimento untrack <doc> --yes          (delete the document's history and remove its
                                       Pentimento properties; the text is untouched)
  pentimento render <doc> [-o out.html] [--artifact] [--drafts N|all]
                                      (--artifact: fragment for claude.ai Artifact publishing;
                                       default: standalone HTML that works anywhere;
                                       --drafts: earlier drafts the page can step through, default 10)
  pentimento serve [dir] [--port 4820] [--host 127.0.0.1 | --tailscale] [--author name]
                                       (live viewer: document index, revision picker, diffs,
                                       hot reload, comments, and a protected stop control;
                                       one port serves all plans below dir; never binds 0.0.0.0)
  pentimento comments <doc>               (list open comments, plus a resolved count)
  pentimento comment <doc> --text "..." [--anchor "#id"] [--quote "..."] [--author name]
  pentimento address <doc>                (open comments formatted for an agent to act on)
  pentimento reply <doc> <comment-id> --text "..." [--author name]
  pentimento resolve <doc> <comment-id> [--rev rNNN] [--note "..."]
                                      (--note records a closing reply on the comment)
  pentimento approve <doc> [rNNN]         (sign off on a revision, the latest by default)
  pentimento lint <doc> [--strict]        (flag AI-register tells: banned words, false contrast,
                                       em-dash density; --strict exits nonzero for CI)
  pentimento guide [directives|archetypes|style]  (version-matched authoring instructions)
  pentimento skill install [dir]          (write the skill shim into dir; default .claude/skills)
  pentimento skill check [dir]            (warn if the installed skill shim is out of date)
  pentimento skill print                  (print the skill shim to stdout)

Inline comments: leave %% @c: a note %% in the markdown — snapshot extracts them
into meta.yml anchored to the nearest heading.

Skills stay current by deferring to the CLI: the shim is thin and calls \`pentimento guide\`,
which prints instructions matched to the installed version.
`

const VERSION = (() => {
  try {
    return String(JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version)
  } catch {
    return 'unknown'
  }
})()

interface Args {
  positional: string[]
  flags: Record<string, string>
}

const parseArgs = (argv: string[]): Args => {
  const positional: string[] = []
  const flags: Record<string, string> = {}
  const boolean = new Set(['artifact', 'html', 'tailscale', 'strict', 'yes'])
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
  const argv = process.argv.slice(2)
  if (argv.includes('--version') || argv.includes('-v')) { console.log(VERSION); return }
  const [cmd, ...rest] = argv
  if (!cmd || cmd === 'help' || argv.includes('--help') || argv.includes('-h')) { console.log(USAGE); return }
  const { positional, flags } = parseArgs(rest)
  const doc = positional[0]

  switch (cmd) {
    case 'snapshot': {
      if (!doc) fail('snapshot needs a document path')
      const res = snapshot(doc, {
        summary: flags.summary,
        why: flags.why,
        source: flags.source,
        author: flags.author ?? defaultAuthor(),
      })
      const saved = readMeta(loadDoc(doc).historyDir).revisions.find((r) => r.id === res.rev)
      console.log(`${res.rev} → ${res.historyFile}`)
      if (!flags.summary && saved) console.log(`summary: ${saved.summary}`)
      for (const missing of res.missingImages) console.log(`warning: ${missing} isn't there, so ${res.rev} was saved without it`)
      const style = lintDoc(loadDoc(doc).raw, loadDoc(doc).canonicalPath)
      if (style.length) console.log(`${style.length} style warning(s) — run: pentimento lint ${positional[0]}`)
      break
    }
    case 'lint': {
      if (!doc) fail('lint needs a document path')
      const findings = lintDoc(loadDoc(doc).raw, loadDoc(doc).canonicalPath)
      if (!findings.length) { console.log('no style warnings'); break }
      for (const f of findings) console.log(`  L${String(f.line).padStart(3)} [${f.rule}] ${f.message}`)
      console.log(`${findings.length} style warning(s)`)
      if (flags.strict === 'true') process.exit(1)
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
      const approvals = new Map((meta.approvals ?? []).map((a) => [a.rev, a]))
      for (const [rev, a] of approvals) console.log(`\napproved ${rev} — ${a.author}, ${a.created_at.slice(0, 10)}`)
      const open = meta.comments.filter((c) => c.status === 'open')
      if (open.length) console.log(`\n${open.length} open comment(s)`)
      break
    }
    case 'cuttings': {
      if (!doc) fail('cuttings needs a document path')
      const d = loadDoc(doc)
      const meta = readMeta(d.historyDir)
      const drafts = meta.revisions.map((r) => ({ id: r.id, body: splitRaw(readRevision(doc, r.id)).body }))
      if (canonicalRevisionState(d, meta).dirty) drafts.push({ id: 'canonical', body: d.body })
      const cuttings = collectCuttings(drafts)
      if (!cuttings.length) { console.log('no cuttings'); break }
      for (const c of cuttings) {
        console.log(`— cut in ${c.cutIn === 'canonical' ? 'the unsaved draft' : c.cutIn}${c.section ? `, from ${c.section}` : ''}`)
        console.log(c.text.split('\n').map((l) => `  ${l}`).join('\n'))
        console.log('')
      }
      break
    }
    case 'approve': {
      if (!doc) fail('approve needs a document path')
      const a = approve(doc, positional[1], flags.author ?? defaultAuthor())
      console.log(`approved ${a.rev}`)
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
    case 'untrack': {
      if (!doc) fail('untrack needs a document path')
      const d = loadDoc(doc)
      const count = readMeta(d.historyDir).revisions.length
      if (flags.yes !== 'true') {
        fail(`untrack deletes ${path.relative(process.cwd(), d.historyDir) || d.historyDir} (${count} draft${count === 1 ? '' : 's'}) and can't be undone; run again with --yes`)
      }
      const res = untrack(doc)
      console.log(`removed ${res.drafts} draft${res.drafts === 1 ? '' : 's'} and the Pentimento properties from ${d.name}`)
      break
    }
    case 'render': {
      if (!doc) fail('render needs a document path')
      const drafts = flags.drafts === undefined ? undefined : flags.drafts === 'all' ? 'all' as const : Number(flags.drafts)
      if (typeof drafts === 'number' && (!Number.isInteger(drafts) || drafts < 0)) fail('--drafts takes a whole number or "all"')
      const out = renderToFile(doc, flags.out, { artifact: flags.artifact === 'true', drafts })
      console.log(out)
      break
    }
    case 'serve': {
      const root = path.resolve(doc ?? '.')
      if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) fail(`not a directory: ${root}`)
      const port = Number(flags.port ?? 4820)
      const host = flags.tailscale === 'true' ? tailscaleIp() : (flags.host?.trim() || '127.0.0.1')
      const remote = !isLoopbackHost(host)
      const writeToken = remote ? crypto.randomBytes(24).toString('base64url') : undefined
      const origin = viewerOrigin(host, port)
      serveViewer(root, { host, port, author: flags.author ?? defaultAuthor(), writeToken })
      if (writeToken) {
        console.log(`pentimento write link → ${origin}/?write=${writeToken}`)
        console.log(`read-only link → ${origin}/`)
      } else {
        console.log(`pentimento viewer → ${origin}/`)
      }
      console.log(`watching ${root}`)
      break
    }
    case 'config': {
      // Palettes and the personal theme setting were removed in 0.11.
      console.log('Pentimento has one palette since 0.11; the page follows your system light/dark')
      console.log('setting, and the toggle in the page header overrides it per browser.')
      console.log(`Any old ${configPath()} can be deleted.`)
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
        if (c.image) console.log(`    on the image ${c.image.ref}${c.image.box ? ' (a marked part)' : ''}`)
        else if (c.quote) console.log(`    > ${c.quote}`)
        console.log(`    ${c.text}`)
        for (const r of c.replies ?? []) console.log(`    ↳ ${r.author}: ${r.text}`)
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
      const approval = latestApproval(meta)
      if (approval) console.log(`The reader approved ${approval.rev} on ${approval.created_at.slice(0, 10)}.\n`)
      for (const c of open) {
        if (c.answer !== undefined) {
          console.log(`[${c.id}] answer to the question at ${c.anchor} — ${c.author}, ${c.created_at.slice(0, 10)}`)
          if (c.quote) console.log(`  question: "${c.quote}"`)
          console.log(`  answer: ${c.answer}`)
          console.log('')
          continue
        }
        if (c.image) {
          console.log(`[${c.id}] on an image at ${c.anchor || '(document)'} — ${c.author}, ${c.created_at.slice(0, 10)}`)
          for (const line of describeImageComment(doc, c)) console.log(line)
          console.log(`  comment: ${c.text}`)
          for (const r of c.replies ?? []) console.log(`  reply (${r.author}): ${r.text}`)
          console.log('')
          continue
        }
        console.log(`[${c.id}] anchored at ${c.anchor || '(document)'} — ${c.author}, ${c.created_at.slice(0, 10)}`)
        if (c.quote) console.log(`  quoted text: "${c.quote}"`)
        if (c.prefix || c.suffix) console.log(`  context: …${c.prefix ?? ''}[quote]${c.suffix ?? ''}…`)
        console.log(`  comment: ${c.text}`)
        for (const r of c.replies ?? []) console.log(`  reply (${r.author}): ${r.text}`)
        console.log('')
      }
      console.log('To address: revise the canonical markdown accordingly, then:')
      console.log(`  pentimento snapshot ${positional[0]} --summary "Address review comments" --why "..."`)
      console.log(`  pentimento resolve ${positional[0]} <comment-id> --rev <new revision>   # once per addressed comment`)
      console.log(`  pentimento reply ${positional[0]} <comment-id> --text "..."             # when the answer is an explanation, not a revision`)
      break
    }
    case 'reply': {
      if (!doc || !positional[1]) fail('reply needs a document path and a comment id')
      if (!flags.text) fail('reply needs --text "..."')
      const c = addReply(doc, positional[1], { text: flags.text, author: flags.author ?? defaultAuthor() })
      console.log(`${c.id} now has ${c.replies?.length ?? 0} repl${(c.replies?.length ?? 0) === 1 ? 'y' : 'ies'}`)
      break
    }
    case 'resolve': {
      if (!doc || !positional[1]) fail('resolve needs a document path and a comment id')
      const c = resolveComment(doc, positional[1], flags.rev, flags.note
        ? { text: flags.note, author: flags.author ?? defaultAuthor() }
        : undefined)
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
