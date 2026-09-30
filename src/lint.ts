import { splitRaw } from './core.js'
import { DIRECTIVE_NAMES } from './render.js'

export interface LintFinding {
  line: number
  rule: string
  message: string
}

/** Directive openings by line, so an unknown name never renders as literal text silently. */
const directiveOpenings = (raw: string): { line: number; name: string; variant: string }[] => {
  const out: { line: number; name: string; variant: string }[] = []
  const lines = raw.split('\n')
  let inFence = false
  let open = false
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i].trim()
    if (/^```/.test(text)) { inFence = !inFence; continue }
    if (inFence) continue
    if (open) { if (/^:::$/.test(text)) open = false; continue }
    const m = /^:::\s*([\w-]+)(?:\s+([\w-]+)(?!=))?/.exec(text)
    if (m) { out.push({ line: i + 1, name: m[1], variant: m[2] ?? '' }); open = true }
  }
  return out
}

interface ClassifiedLine {
  line: number
  text: string
  /** directive block the line sits in, or null for plain body prose */
  block: string | null
}

/** Lines that count as prose, tagged with their surrounding directive block. */
const classify = (raw: string): ClassifiedLine[] => {
  const { frontmatterRaw } = splitRaw(raw)
  const fmLines = frontmatterRaw ? frontmatterRaw.split('\n').length + 2 : 0
  const lines = raw.split('\n')
  const out: ClassifiedLine[] = []
  let inFence = false
  let block: string | null = null
  for (let i = fmLines; i < lines.length; i++) {
    const text = lines[i]
    if (/^\s*```/.test(text)) { inFence = !inFence; continue }
    if (inFence) continue
    if (block === null) {
      const open = /^:::\s*([\w-]+)/.exec(text)
      if (open) { block = open[1]; continue }
    } else if (/^:::\s*$/.test(text)) { block = null; continue }
    if (block === 'figure' || block === 'diff' || block === 'flow') continue // SVG, diff, and edge-chain bodies are not prose
    out.push({ line: i + 1, text, block })
  }
  return out
}

// The register tells. Word lists stay conservative: every entry is a word an agent
// reaches for by default and a careful writer almost never needs.
const RULES: { rule: string; re: RegExp; message: string }[] = [
  {
    rule: 'banned-word',
    re: /\b(leverag\w+|utiliz\w+|delv\w+|robust(?:ly|ness)?|seamless(?:ly)?|crucial(?:ly)?|streamlin\w+|showcas\w+|foster(?:s|ing|ed)?|empower\w*|game-chang\w+|cutting-edge|state-of-the-art|best-in-class|paradigm)\b/gi,
    message: 'promotional register — use the plain word',
  },
  {
    rule: 'throat-clearing',
    re: /\b(it'?s worth noting|interestingly,|moreover,|furthermore,|in today'?s|needless to say)/gi,
    message: 'throat-clearing — cut it and start with the claim',
  },
  {
    rule: 'engagement-hook',
    re: /(here'?s the thing|the catch\?|the kicker|let'?s dive in|deep dive|dive into|buckle up)/gi,
    message: 'engagement hook — state the point directly',
  },
  {
    rule: 'false-contrast',
    re: /\bisn'?t just\b|\bnot just \w[^.\n]{0,50}\bbut\b|\bnot only\b[^.\n]{0,60}\bbut also\b|\bnot about \w[^.\n]{0,50}\babout\b/gi,
    message: 'false contrast — state the claim without the "not X but Y" frame',
  },
  {
    rule: 'narration',
    re: /\bthis (?:document|doc|plan|section|memo) (?:walks|explores|catalogs|catalogues|dives|takes a look|looks at|unpacks)\b|\bwalk(?:s|ing)? (?:it|through it) end to end\b|\blet'?s (?:walk|look|unpack|break)\b|\btells? the (?:whole )?story\b/gi,
    message: 'the document narrating itself — say the thing instead of announcing it',
  },
  {
    rule: 'stock-phrase',
    re: /\bload-bearing\b|\bthe real win\b|\bthe moment that matters\b|\bis the (?:product|point|whole game)\.|\bin (?:a single|one) move\b|\bheavy lifting\b|\bnorth star\b|\bsingle source of truth\b|\bat the end of the day\b|\bmove the needle\b|\bhere'?s why\b/gi,
    message: 'stock phrase — write the specific claim it stands in for',
  },
  {
    rule: 'tidy-contrast',
    re: /,\s+not\s+(?:a|an|the)\s+[\w-]+(?:\s+[\w-]+)?\.(?=\s|$)/gi,
    message: 'a ", not a Y." ending reads as a slogan — say what it is and stop',
  },
  {
    rule: 'closer',
    re: /the future (?:looks|is) bright|only time will tell|i hope this helps|stay tuned|exciting (?:times|journey)/gi,
    message: 'generic closer — end when the content ends',
  },
]

export const lintDoc = (raw: string): LintFinding[] => {
  const findings: LintFinding[] = []
  const openings = directiveOpenings(raw)
  for (const { line, name } of openings) {
    if (!DIRECTIVE_NAMES.includes(name)) {
      findings.push({
        line,
        rule: 'unknown-directive',
        message: `"::: ${name}" is not in the vocabulary (${DIRECTIVE_NAMES.join(', ')}) — it renders as literal text`,
      })
    }
  }
  const prose = classify(raw)
  let emDashes = 0
  let words = 0

  for (const { line, text, block } of prose) {
    // quoted phrases and code spans are mentions, not uses
    const said = text.replace(/`[^`]*`/g, ' ').replace(/"[^"\n]*"|“[^”\n]*”/g, ' ')
    for (const { rule, re, message } of RULES) {
      re.lastIndex = 0
      const m = re.exec(said)
      if (m) findings.push({ line, rule, message: `"${m[0]}" — ${message}` })
    }
    if (/^#{1,3}\s/.test(text) && /\p{Extended_Pictographic}/u.test(text)) {
      findings.push({ line, rule: 'emoji-heading', message: 'emoji in a heading' })
    }
    // the timeline syntax requires a bold lead and an em-dash, so both rules skip it
    if (block !== 'timeline') {
      if (block === null && /^\s*[-*+]\s+\*\*[^*]{1,40}(?::\*\*|\*\*\s*[:—])/.test(text)) {
        findings.push({ line, rule: 'bold-lead-bullet', message: 'bold-lead bullet — write a full claim or use prose' })
      }
      const dashes = (text.match(/—/g) || []).length
      emDashes += dashes
      if (dashes >= 2) {
        findings.push({ line, rule: 'em-dash', message: `${dashes} em-dashes in one paragraph — keep to one, or use a period, colon, or parentheses` })
      }
    }
    words += text.split(/\s+/).filter(Boolean).length
  }

  // structure budget: a quiet page is mostly prose
  const known = openings.filter((o) => DIRECTIVE_NAMES.includes(o.name))
  const budget = Math.max(3, Math.floor(words / 250))
  if (known.length > budget) {
    findings.push({
      line: known[budget].line,
      rule: 'directive-density',
      message: `${known.length} directives in ${words} words of prose — a quiet page is mostly prose; keep the ones whose structure carries information and write the rest as sentences or plain lists`,
    })
  }
  const count = (pred: (o: { name: string; variant: string }) => boolean) => known.filter(pred)
  const verdicts = count((o) => o.name === 'verdict')
  if (verdicts.length > 1) {
    findings.push({ line: verdicts[1].line, rule: 'repeated-verdict', message: 'more than one ::: verdict — one answer block per document' })
  }
  const asks = count((o) => o.name === 'ask')
  if (asks.length > 2) {
    findings.push({ line: asks[2].line, rule: 'too-many-asks', message: `${asks.length} ::: ask blocks — ask only what changes the next draft, at most two` })
  }
  const decisions = count((o) => o.name === 'callout' && o.variant === 'decision')
  if (decisions.length > 4) {
    findings.push({ line: decisions[4].line, rule: 'decision-density', message: `${decisions.length} decision callouts — keep them for choices that rule something out` })
  }
  const lines = raw.split('\n')
  lines.forEach((text, i) => {
    if (/^#{2,3}\s.*<!--[^>]*\beyebrow\s*:/.test(text)) {
      findings.push({ line: i + 1, rule: 'eyebrow', message: 'eyebrow labels are no longer rendered — remove `eyebrow:` from the heading comment' })
    }
  })
  const { frontmatterRaw } = splitRaw(raw)
  if (frontmatterRaw && /^Palette\s*:/m.test(frontmatterRaw)) {
    const line = lines.findIndex((l) => /^Palette\s*:/.test(l)) + 1
    findings.push({ line, rule: 'palette', message: 'Palette is ignored since 0.8 (one palette, light and dark) — remove it' })
  }

  if (words > 0 && emDashes >= 3 && emDashes > words / 100) {
    findings.push({
      line: 1,
      rule: 'em-dash-density',
      message: `${emDashes} em-dashes in ${words} words — the em-dash cadence is the loudest AI tell; target under 1 per 100 words`,
    })
  }

  return findings.sort((a, b) => a.line - b.line)
}
