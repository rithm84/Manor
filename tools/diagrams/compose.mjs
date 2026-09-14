// Build docs/diagrams/*.excalidraw from the scene specs in scenes.mjs using vendored community icon libraries.
// Every scene shares one style: Excalifont, hand-drawn strokes, the Excalidraw palette, and icons cloned from tools/diagrams/libraries.
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { scenes } from './scenes.mjs'
import { layeringProblems } from './check.mjs'

const root = fileURLToPath(new URL('.', import.meta.url))
const out = resolve(root, '../../docs/diagrams')
const FONT = 5 // Excalifont
const libraries = new Map()

async function libraryItems(name) {
  if (!libraries.has(name)) {
    const lib = JSON.parse(await readFile(resolve(root, 'libraries', `${name}.excalidrawlib`), 'utf8'))
    libraries.set(name, (lib.libraryItems ?? lib.library ?? []).map((item) => (Array.isArray(item) ? { name: null, elements: item } : item)))
  }
  return libraries.get(name)
}

let counter = 0
const id = (prefix) => `${prefix}-${(counter += 1)}`
const base = (extra) => ({
  angle: 0, seed: 1 + counter, version: 1, versionNonce: 1, isDeleted: false, groupIds: [], frameId: null, boundElements: null,
  updated: 1, link: null, locked: false, opacity: 100, roughness: 1, strokeWidth: 1.5, strokeStyle: 'solid', fillStyle: 'solid',
  strokeColor: '#1e1e1e', backgroundColor: 'transparent', ...extra
})

const CHAR = 0.6 // average Excalifont advance as a fraction of the font size
const textWidth = (text, size) => Math.max(...text.split('\n').map((line) => line.length)) * size * CHAR
/** Greedy word wrap to a pixel width; explicit newlines are kept. */
function wrap(content, maxWidth, size) {
  const perLine = Math.max(8, Math.floor(maxWidth / (size * CHAR)))
  return content.split('\n').flatMap((paragraph) => {
    const lines = []; let line = ''
    for (const word of paragraph.split(' ')) {
      if (line && (line + ' ' + word).length > perLine) { lines.push(line); line = word } else line = line ? line + ' ' + word : word
    }
    return [...lines, line]
  }).join('\n')
}
const textHeight = (text, size) => text.split('\n').length * size * 1.25

function text(content, x, y, { size = 16, color = '#1e1e1e', align = 'center', container = null, width = null } = {}) {
  const w = width ?? textWidth(content, size), h = textHeight(content, size)
  return base({ id: id('text'), type: 'text', x, y, width: w, height: h, text: content, originalText: content, fontSize: size, fontFamily: FONT,
    textAlign: align, verticalAlign: container ? 'middle' : 'top', strokeColor: color, lineHeight: 1.25, baseline: size, containerId: container, autoResize: true })
}

/** Geometry of one element. Linear elements anchor `x,y` at their first point, so their extent comes from the points, which can be negative. */
function bounds(e) {
  if (!e.points) return [e.x, e.y, e.x + e.width, e.y + e.height]
  const xs = e.points.map(([px]) => e.x + px), ys = e.points.map(([, py]) => e.y + py)
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

/** Clone a library item into a box of the given size, scaled to fit, preserving its groups and bindings under new ids. */
async function icon(spec, x, y, box) {
  const items = await libraryItems(spec.library)
  const item = typeof spec.item === 'number' ? items[spec.item] : items.find((candidate) => candidate.name === spec.item)
  if (!item) throw new Error(`Icon ${spec.library}/${spec.item} does not exist`)
  // Library captions are dropped; the node label names the component.
  const els = item.elements.filter((e) => !e.isDeleted && (spec.keepText || e.type !== 'text'))
  const boxes = els.map(bounds)
  const minX = Math.min(...boxes.map((b) => b[0])), minY = Math.min(...boxes.map((b) => b[1]))
  const maxX = Math.max(...boxes.map((b) => b[2])), maxY = Math.max(...boxes.map((b) => b[3]))
  const scale = box / Math.max(maxX - minX, maxY - minY)
  const ox = x + (box - (maxX - minX) * scale) / 2, oy = y + (box - (maxY - minY) * scale) / 2
  const map = new Map(els.map((e) => [e.id, id('icon')]))
  const group = id('group')
  return els.map((e) => {
    const c = structuredClone(e)
    c.id = map.get(e.id); c.x = ox + (e.x - minX) * scale; c.y = oy + (e.y - minY) * scale; c.width = e.width * scale; c.height = e.height * scale
    c.groupIds = [group]; c.frameId = null; c.locked = false
    if (c.fontSize) { c.fontSize *= scale; c.fontFamily = FONT }
    if (c.points) c.points = c.points.map(([px, py]) => [px * scale, py * scale])
    if (c.containerId) c.containerId = map.get(c.containerId) ?? null
    if (c.boundElements) c.boundElements = c.boundElements.map((b) => ({ ...b, id: map.get(b.id) ?? b.id })).filter((b) => map.has(b.id))
    if (c.startBinding) c.startBinding = { ...c.startBinding, elementId: map.get(c.startBinding.elementId) ?? c.startBinding.elementId }
    if (c.endBinding) c.endBinding = { ...c.endBinding, elementId: map.get(c.endBinding.elementId) ?? c.endBinding.elementId }
    return c
  })
}

/** Intersection of the segment from a rectangle's center toward a target point with the rectangle's border. */
function border(rect, tx, ty) {
  const cx = rect.x + rect.width / 2, cy = rect.y + rect.height / 2
  const dx = tx - cx, dy = ty - cy
  if (dx === 0 && dy === 0) return [cx, cy]
  const sx = dx === 0 ? Infinity : (rect.width / 2) / Math.abs(dx), sy = dy === 0 ? Infinity : (rect.height / 2) / Math.abs(dy)
  const s = Math.min(sx, sy)
  return [cx + dx * s, cy + dy * s]
}

export async function build(scene) {
  counter = 0
  const elements = []
  const nodes = new Map()
  const title = text(scene.title, 0, 0, { size: 28, align: 'left' })
  elements.push(title)
  if (scene.subtitle) elements.push(text(scene.subtitle, 0, 40, { size: 15, align: 'left', color: '#5c5f66' }))
  for (const zone of scene.zones ?? []) {
    const rect = base({ id: id('zone'), type: 'rectangle', x: zone.x, y: zone.y, width: zone.w, height: zone.h, strokeColor: zone.stroke ?? '#868e96',
      backgroundColor: zone.fill ?? '#f8f9fa', strokeStyle: 'dashed', roughness: 1, roundness: { type: 3 } })
    elements.push(rect, text(zone.label, zone.x + 14, zone.y + 10, { size: 15, align: 'left', color: zone.stroke ?? '#868e96' }))
    nodes.set(zone.id, rect)
  }
  for (const node of scene.nodes) {
    const w = node.w ?? 180
    const labelSize = node.size ?? 15
    const label = wrap(node.label, w - 20, labelSize)
    const note = node.note ? wrap(node.note, w - 20, 12) : null
    const box = node.iconSize ?? 60
    const contentH = (node.icon ? 12 + box + 6 : 0) + textHeight(label, labelSize) + (note ? textHeight(note, 12) + 2 : 0)
    const h = node.h ?? Math.max(node.icon ? 140 : 60, contentH + 20)
    const rect = base({ id: id('node'), type: node.shape ?? 'rectangle', x: node.x, y: node.y, width: w, height: h, backgroundColor: node.fill ?? '#ffffff',
      strokeColor: node.stroke ?? '#1e1e1e', roundness: node.shape ? null : { type: 3 }, boundElements: [] })
    nodes.set(node.id, rect)
    elements.push(rect)
    if (node.icon) {
      const top = node.y + (h - contentH) / 2
      elements.push(...await icon(node.icon, node.x + (w - box) / 2, top, box))
      elements.push(text(label, node.x + 10, top + box + 6, { size: labelSize, width: w - 20 }))
      if (note) elements.push(text(note, node.x + 10, top + box + 6 + textHeight(label, labelSize) + 2, { size: 12, color: '#5c5f66', width: w - 20 }))
    } else {
      // Plain boxes and diamonds carry the note as a second, smaller-looking line inside the label.
      const content = note ? `${label}\n${note}` : label
      const th = textHeight(content, labelSize)
      const bound = text(content, node.x + 10, node.y + (h - th) / 2, { size: labelSize, container: rect.id, width: w - 20 })
      rect.boundElements.push({ type: 'text', id: bound.id })
      elements.push(bound)
    }
  }
  for (const edge of scene.edges ?? []) {
    const a = nodes.get(edge.from), b = nodes.get(edge.to)
    if (!a || !b) throw new Error(`Edge ${edge.from} -> ${edge.to} references a missing node`)
    const via = edge.via ?? []
    const [ax, ay] = border(a, ...(via[0] ?? [b.x + b.width / 2, b.y + b.height / 2]))
    const [bx, by] = border(b, ...(via[via.length - 1] ?? [a.x + a.width / 2, a.y + a.height / 2]))
    const points = [[0, 0], ...via.map(([vx, vy]) => [vx - ax, vy - ay]), [bx - ax, by - ay]]
    const arrow = base({ id: id('arrow'), type: 'arrow', x: ax, y: ay, width: Math.abs(bx - ax), height: Math.abs(by - ay), points,
      strokeColor: edge.color ?? '#1e1e1e', strokeStyle: edge.style ?? 'solid', strokeWidth: edge.width ?? 1.5, roughness: 1,
      startArrowhead: edge.both ? 'arrow' : null, endArrowhead: edge.none ? null : 'arrow', elbowed: false,
      startBinding: { elementId: a.id, focus: 0, gap: 4 }, endBinding: { elementId: b.id, focus: 0, gap: 4 }, boundElements: [] })
    a.boundElements = [...(a.boundElements ?? []), { type: 'arrow', id: arrow.id }]
    b.boundElements = [...(b.boundElements ?? []), { type: 'arrow', id: arrow.id }]
    elements.push(arrow)
    if (edge.label) {
      // Excalidraw places a bound label at the route's middle point (or between the two middle points), so the route decides where it lands.
      const route = [[ax, ay], ...via, [bx, by]], half = route.length / 2
      const mid = route.length % 2 ? route[(route.length - 1) / 2] : [(route[half - 1][0] + route[half][0]) / 2, (route[half - 1][1] + route[half][1]) / 2]
      const label = text(edge.label, mid[0] - textWidth(edge.label, 13) / 2, mid[1] - textHeight(edge.label, 13) / 2, { size: 13, color: edge.color ?? '#1e1e1e', container: arrow.id })
      label.verticalAlign = 'middle'
      arrow.boundElements.push({ type: 'text', id: label.id })
      elements.push(label)
    }
  }
  for (const note of scene.notes ?? []) elements.push(text(note.text, note.x, note.y, { size: note.size ?? 13, align: 'left', color: note.color ?? '#5c5f66' }))
  return { type: 'excalidraw', version: 2, source: 'manor-diagrams', elements, appState: { viewBackgroundColor: '#ffffff', gridSize: 20 }, files: {} }
}

const only = process.argv[2]
for (const [name, scene] of Object.entries(scenes)) {
  if (only && name !== only) continue
  const built = await build(scene)
  const problems = layeringProblems(built.elements)
  if (problems.length) throw new Error(`Scene ${name} has layering problems; reroute its edges with via waypoints:\n  ${problems.join('\n  ')}`)
  await writeFile(resolve(out, `${name}.excalidraw`), JSON.stringify(built, null, 2) + '\n')
  console.log('composed', name)
}
