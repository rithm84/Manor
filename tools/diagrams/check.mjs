// Layering guard for the generated diagrams: arrows must not run through nodes they are not attached to,
// through text that is not their own label, or across other arrows. `compose.mjs` fails on any finding;
// `node check.mjs` audits the exported scenes in docs/diagrams.
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const INSET = 3 // tolerance so an arrow touching a border is not a crossing
const EDGE = 0.02 // fraction of each segment ignored at its ends so shared endpoints do not count

/** Whether the segment (ax, ay)-(bx, by) enters the rectangle, using Liang-Barsky clipping. */
function segmentHitsRect(ax, ay, bx, by, rect) {
  const x0 = rect.x + INSET, y0 = rect.y + INSET, x1 = rect.x + rect.width - INSET, y1 = rect.y + rect.height - INSET
  const dx = bx - ax, dy = by - ay
  let t0 = 0, t1 = 1
  for (const [p, q] of [[-dx, ax - x0], [dx, x1 - ax], [-dy, ay - y0], [dy, y1 - ay]]) {
    if (p === 0) { if (q < 0) return false; continue }
    const t = q / p
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t } else { if (t < t0) return false; if (t < t1) t1 = t }
  }
  return t0 < t1
}

/** Whether two segments intersect away from their endpoints. */
function segmentsCross([p, q], [r, s]) {
  const d = (q[0] - p[0]) * (s[1] - r[1]) - (q[1] - p[1]) * (s[0] - r[0])
  if (d === 0) return false
  const t = ((r[0] - p[0]) * (s[1] - r[1]) - (r[1] - p[1]) * (s[0] - r[0])) / d
  const u = ((r[0] - p[0]) * (q[1] - p[1]) - (r[1] - p[1]) * (q[0] - p[0])) / d
  return t > EDGE && t < 1 - EDGE && u > EDGE && u < 1 - EDGE
}

const segments = (arrow) => arrow.points.slice(0, -1).map(([px, py], i) =>
  [[arrow.x + px, arrow.y + py], [arrow.x + arrow.points[i + 1][0], arrow.y + arrow.points[i + 1][1]]])

/** Human-readable problems in one scene's elements; empty when the layering is clean. */
export function layeringProblems(elements) {
  const nodes = elements.filter((e) => e.id.startsWith('node-'))
  const arrows = elements.filter((e) => e.type === 'arrow')
  const texts = elements.filter((e) => e.type === 'text')
  const bound = new Map(texts.filter((t) => t.containerId).map((t) => [t.containerId, t.text]))
  const within = (t, rect) => t.x >= rect.x && t.x < rect.x + rect.width && t.y >= rect.y && t.y < rect.y + rect.height
  const free = texts.filter((t) => !t.containerId && !nodes.some((n) => within(t, n))) // titles, zone labels, and notes
  const nameOf = (id) => { const node = nodes.find((n) => n.id === id); return node ? (bound.get(id) ?? texts.find((t) => within(t, node))?.text ?? id).split('\n')[0] : id }
  const otherArrowLabels = (arrow) => texts.filter((t) => t.containerId && t.containerId !== arrow.id && arrows.some((o) => o.id === t.containerId))
  const describe = (arrow) => `${nameOf(arrow.startBinding?.elementId)} -> ${nameOf(arrow.endBinding?.elementId)}`
  const problems = []
  for (const arrow of arrows) {
    const attached = new Set([arrow.startBinding?.elementId, arrow.endBinding?.elementId])
    for (const [a, b] of segments(arrow)) {
      for (const node of nodes) if (!attached.has(node.id) && segmentHitsRect(a[0], a[1], b[0], b[1], node)) problems.push(`arrow ${describe(arrow)} runs through node "${nameOf(node.id)}"`)
      for (const t of [...free, ...otherArrowLabels(arrow)]) if (segmentHitsRect(a[0], a[1], b[0], b[1], t)) problems.push(`arrow ${describe(arrow)} runs through text "${t.text.split('\n')[0]}"`)
    }
    for (const other of arrows) if (other.id > arrow.id) for (const s1 of segments(arrow)) for (const s2 of segments(other)) if (segmentsCross(s1, s2)) problems.push(`arrows cross: ${describe(arrow)} and ${describe(other)}`)
  }
  return problems
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../docs/diagrams')
  let failures = 0
  for (const name of (await readdir(dir)).filter((n) => n.endsWith('.excalidraw')).sort()) {
    const { elements } = JSON.parse(await readFile(resolve(dir, name), 'utf8'))
    for (const problem of layeringProblems(elements)) { failures += 1; console.error(`${name}: ${problem}`) }
  }
  if (failures) { console.error(`${failures} layering problem(s)`); process.exit(1) }
  console.log('layering clean')
}
