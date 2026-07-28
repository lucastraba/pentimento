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
    expect(lintDoc(doc)).toEqual([])
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
