/**
 * ::: flow — diagrams without coordinates. The author writes edge chains
 * ("A -> B -> C") and the renderer computes a layered left-to-right layout in
 * the same constrained SVG vocabulary as ::: figure (nodebox/accentbox/flow).
 */

interface FlowGraph {
  nodes: string[]
  edges: [string, string][]
  accents: Set<string>
}

const NODE_W_PAD = 28
const CHAR_W = 7.5
const NODE_H = 36
const ROW_PITCH = 64
const COL_GAP = 56
const MARGIN = 12

export const parseFlow = (content: string): FlowGraph => {
  const nodes: string[] = []
  const edges: [string, string][] = []
  const accents = new Set<string>()
  const addNode = (name: string): void => {
    if (!nodes.includes(name)) nodes.push(name)
  }
  for (const raw of content.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const accent = /^accent\s*:\s*(.+)$/.exec(line)
    if (accent) {
      accent[1].split(',').map((s) => s.trim()).filter(Boolean).forEach((n) => accents.add(n))
      continue
    }
    const chain = line.split('->').map((s) => s.trim())
    if (chain.some((n) => !n)) throw new Error(`flow: empty node name in "${line}"`)
    chain.forEach(addNode)
    for (let i = 0; i + 1 < chain.length; i++) edges.push([chain[i], chain[i + 1]])
  }
  if (!nodes.length) throw new Error('flow needs at least one "A -> B" line')
  for (const name of accents) {
    if (!nodes.includes(name)) throw new Error(`flow: accent names unknown node "${name}"`)
  }
  return { nodes, edges, accents }
}

/** Longest-path layering; the iteration cap keeps accidental cycles from hanging the render. */
const depths = (graph: FlowGraph): Map<string, number> => {
  const depth = new Map(graph.nodes.map((n) => [n, 0]))
  for (let pass = 0; pass < graph.nodes.length; pass++) {
    let moved = false
    for (const [from, to] of graph.edges) {
      const want = depth.get(from)! + 1
      if (want > depth.get(to)! && want < graph.nodes.length) {
        depth.set(to, want)
        moved = true
      }
    }
    if (!moved) break
  }
  return depth
}

const escapeXml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export const renderFlowSvg = (content: string): string => {
  const graph = parseFlow(content)
  const depth = depths(graph)

  const columns: string[][] = []
  for (const node of graph.nodes) {
    const d = depth.get(node)!
    ;(columns[d] ??= []).push(node)
  }

  const colWidth = columns.map((col) => Math.max(90, ...col.map((n) => n.length * CHAR_W + NODE_W_PAD)))
  const colX: number[] = []
  let x = MARGIN
  for (let c = 0; c < columns.length; c++) {
    colX[c] = x
    x += colWidth[c] + COL_GAP
  }
  const width = x - COL_GAP + MARGIN
  const rows = Math.max(...columns.map((col) => col.length))
  const height = MARGIN * 2 + rows * ROW_PITCH - (ROW_PITCH - NODE_H)

  const pos = new Map<string, { x: number; y: number; w: number }>()
  columns.forEach((col, c) => {
    col.forEach((node, r) => {
      pos.set(node, { x: colX[c], y: MARGIN + r * ROW_PITCH, w: colWidth[c] })
    })
  })

  const boxes = graph.nodes.map((node) => {
    const p = pos.get(node)!
    const cls = graph.accents.has(node) ? 'accentbox' : 'nodebox'
    return `<rect class="${cls}" x="${p.x}" y="${p.y}" width="${p.w}" height="${NODE_H}" rx="5"/>` +
      `<text x="${p.x + p.w / 2}" y="${p.y + NODE_H / 2 + 4}" text-anchor="middle">${escapeXml(node)}</text>`
  })

  const paths = graph.edges.map(([from, to]) => {
    const a = pos.get(from)!
    const b = pos.get(to)!
    const forward = b.x > a.x
    const x1 = forward ? a.x + a.w : a.x
    const x2 = forward ? b.x : b.x + b.w
    const y1 = a.y + NODE_H / 2
    const y2 = b.y + NODE_H / 2
    const d = y1 === y2 && forward
      ? `M${x1} ${y1} H${x2 - 4}`
      : `M${x1} ${y1} C${x1 + COL_GAP / 2} ${y1}, ${x2 - COL_GAP / 2} ${y2}, ${x2 - (forward ? 4 : -4)} ${y2}`
    return `<path class="flow" d="${d}" marker-end="url(#arr)"/>`
  })

  return `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">` +
    '<defs><marker id="arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">' +
    '<path d="M0 0 L8 4 L0 8 z" fill="var(--soft)"/></marker></defs>' +
    `${paths.join('')}${boxes.join('')}</svg>`
}
