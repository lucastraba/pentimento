import { describe, expect, it } from 'vitest'
import { parseFlow, renderFlowSvg } from '../src/flow.js'

describe('parseFlow', () => {
  it('reads edge chains, node order, and accents', () => {
    const g = parseFlow('A -> B -> C\nB -> D\naccent: B, D')
    expect(g.nodes).toEqual(['A', 'B', 'C', 'D'])
    expect(g.edges).toEqual([['A', 'B'], ['B', 'C'], ['B', 'D']])
    expect(g.accents).toEqual(new Set(['B', 'D']))
  })

  it('accepts a standalone node line', () => {
    expect(parseFlow('Lonely').nodes).toEqual(['Lonely'])
  })

  it('rejects empty content, empty node names, and unknown accent names', () => {
    expect(() => parseFlow('')).toThrow('flow needs at least one')
    expect(() => parseFlow('A -> -> B')).toThrow('empty node name')
    expect(() => parseFlow('A -> B\naccent: Z')).toThrow('unknown node "Z"')
  })
})

describe('renderFlowSvg', () => {
  it('lays out a chain left to right with arrows between layers', () => {
    const svg = renderFlowSvg('PLAN.md -> CLI -> plan.html\naccent: CLI')
    expect(svg).toMatch(/^<svg viewBox="0 0 \d+(\.\d+)? \d+(\.\d+)?" xmlns="http:\/\/www\.w3\.org\/2000\/svg">/)
    expect(svg).toContain('<rect class="nodebox"')
    expect(svg).toContain('<rect class="accentbox"')
    expect(svg.match(/<path class="flow"/g)).toHaveLength(2)
    expect(svg).toContain('marker-end="url(#arr)"')
    expect(svg).toContain('>PLAN.md</text>')
    const xs = [...svg.matchAll(/<rect class="\w+" x="([\d.]+)"/g)].map((m) => Number(m[1]))
    expect(xs[0]).toBeLessThan(xs[1])
    expect(xs[1]).toBeLessThan(xs[2])
  })

  it('stacks fan-out targets in the same column', () => {
    const svg = renderFlowSvg('A -> B\nA -> C')
    const rects = [...svg.matchAll(/<rect [^>]*x="([\d.]+)" y="([\d.]+)"/g)]
      .map((m) => ({ x: Number(m[1]), y: Number(m[2]) }))
    const [, b, c] = rects
    expect(b.x).toBe(c.x)
    expect(b.y).not.toBe(c.y)
  })

  it('escapes node labels and never emits active content', () => {
    const svg = renderFlowSvg('<img onerror=x> -> B')
    expect(svg).toContain('&lt;img onerror=x&gt;')
    expect(svg).not.toContain('<img')
  })

  it('survives a cycle without hanging', () => {
    const svg = renderFlowSvg('A -> B\nB -> A')
    expect(svg).toContain('>A</text>')
    expect(svg.match(/<path class="flow"/g)).toHaveLength(2)
  })
})
