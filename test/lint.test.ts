import { describe, expect, it } from 'vitest'
import { lintDoc } from '../src/lint.js'

const rules = (raw: string) => lintDoc(raw).map((f) => f.rule)

describe('lint', () => {
  it('passes clean prose', () => {
    expect(lintDoc('# T\n\nOne markdown file, a hidden history, and a render the author does not control.\n')).toEqual([])
  })

  it('flags promotional words with the line number', () => {
    const f = lintDoc('# T\n\nWe leverage a robust and seamless architecture.\n')
    expect(f.map((x) => x.rule)).toEqual(['banned-word'])
    expect(f[0].line).toBe(3)
    expect(f[0].message).toContain('leverage')
  })

  it('flags false contrast, hooks, throat-clearing, and closers', () => {
    expect(rules("It isn't just fast — it's a philosophy.\n")).toContain('false-contrast')
    expect(rules("Here's the thing about caching.\n")).toContain('engagement-hook')
    expect(rules("It's worth noting that tests pass.\n")).toContain('throat-clearing')
    expect(rules('The future looks bright for this module.\n')).toContain('closer')
  })

  it('flags the tells of prose trying not to sound generated', () => {
    expect(rules('This document walks the loop as a reader sees it.\n')).toContain('narration')
    expect(rules('The numbers tell the story.\n')).toContain('narration')
    expect(rules('This is the load-bearing idea.\n')).toContain('stock-phrase')
    expect(rules('The review loop is the product.\n')).toContain('stock-phrase')
    expect(rules('This is a review tool, not a forum.\n')).toContain('tidy-contrast')
    expect(rules('Use SQLite, which needs no server.\n')).toEqual([])
  })

  it('ignores phrases that are quoted or in code', () => {
    expect(rules('Agents wrote "leverage" and "isn\'t just X" everywhere.\n')).toEqual([])
    expect(rules('The lint list includes `robust`.\n')).toEqual([])
  })

  it('warns when a document leans on directives', () => {
    const block = '::: callout info\nA note.\n:::\n\n'
    expect(rules(`# T\n\nShort prose.\n\n${block.repeat(3)}`)).not.toContain('directive-density')
    expect(rules(`# T\n\nShort prose.\n\n${block.repeat(4)}`)).toContain('directive-density')
    expect(rules('::: verdict\n- a :: b\n:::\n\n::: verdict\n- c :: d\n:::\n')).toContain('repeated-verdict')
    const ask = '::: ask\nQ?\n- a\n- b\n:::\n\n'
    expect(rules(ask.repeat(3))).toContain('too-many-asks')
    expect(rules('::: callout decision\nx\n:::\n\n'.repeat(5))).toContain('decision-density')
  })

  it('steers new diagrams to ::: flow', () => {
    expect(rules('::: figure aria="x"\n<svg viewBox="0 0 1 1"></svg>\n:::\n')).toContain('figure')
    expect(rules('::: flow aria="x"\nA -(b)-> C\n:::\n')).not.toContain('figure')
  })

  it('points at settings earlier releases used', () => {
    expect(rules('---\nPalette: iris\n---\n# T\n\n## A <!-- id: a; eyebrow: Intro -->\n\ntext\n')).toEqual(['palette', 'eyebrow'])
  })

  it('flags two em-dashes in one paragraph and doc-level density', () => {
    const line = 'The fix — which is small — lands today.\n'
    expect(rules(line)).toContain('em-dash')
    const doc = Array.from({ length: 3 }, () => line).join('\n')
    expect(rules(doc)).toContain('em-dash-density')
  })

  it('flags bold-lead bullets but not timeline syntax', () => {
    expect(rules('- **Speed:** improved a lot\n')).toContain('bold-lead-bullet')
    const timeline = '::: timeline\n1. **Schema** [next] — the two tables everything reads.\n:::\n'
    expect(lintDoc(timeline)).toEqual([])
  })

  it('skips frontmatter, code fences, and figure/diff bodies', () => {
    const doc = [
      '---', 'Archetype: audit', '---', '# T', '',
      '```', 'const robust = leverage(seamless)', '```', '',
      '::: figure aria="x"', '<svg>robust seamless</svg>', ':::', '',
      '::: diff head="f"', '```txt', '-robust', '+leverage', '```', ':::', '',
    ].join('\n')
    // the figure itself earns a steer toward ::: flow; its SVG body is not prose
    expect(rules(doc)).toEqual(['figure'])
  })

  it('flags emoji in headings', () => {
    expect(rules('## Rocket launch 🚀\n')).toContain('emoji-heading')
  })
  it('flags directives outside the vocabulary', () => {
    expect(rules('## S\n\n::: compare\ntext\n:::\n')).toContain('unknown-directive')
    expect(rules('## S\n\n::: checklist\n- [x] a\n:::\n')).not.toContain('unknown-directive')
    expect(rules('```\n::: mystery\n```\n')).not.toContain('unknown-directive')
  })

  it('does not lint flow bodies as prose', () => {
    expect(rules('## S\n\n::: flow\nRobust Gateway -> B\n:::\n')).toEqual([])
  })
})
