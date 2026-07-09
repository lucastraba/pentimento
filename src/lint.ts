import { splitRaw } from './core.js'

export interface LintFinding {
  line: number
  rule: string
  message: string
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
    if (block === 'figure' || block === 'diff') continue // SVG and diff bodies are not prose
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
    rule: 'closer',
    re: /the future (?:looks|is) bright|only time will tell|i hope this helps|stay tuned|exciting (?:times|journey)/gi,
    message: 'generic closer — end when the content ends',
  },
]

export const lintDoc = (raw: string): LintFinding[] => {
  const findings: LintFinding[] = []
  const prose = classify(raw)
  let emDashes = 0
  let words = 0

  for (const { line, text, block } of prose) {
    for (const { rule, re, message } of RULES) {
      re.lastIndex = 0
      const m = re.exec(text)
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

  if (words > 0 && emDashes >= 3 && emDashes > words / 100) {
    findings.push({
      line: 1,
      rule: 'em-dash-density',
      message: `${emDashes} em-dashes in ${words} words — the em-dash cadence is the loudest AI tell; target under 1 per 100 words`,
    })
  }

  return findings.sort((a, b) => a.line - b.line)
}
