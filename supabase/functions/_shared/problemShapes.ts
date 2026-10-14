/**
 * Shaped node inputs and outputs. Test cases keep LeetCode's friendly formats (a list and the position its tail links
 * to, two lists that share a tail, level-order trees with parent pointers, quad trees, and so on); before a case
 * reaches a program, its node parameters become one shared node table, and the program reads each node parameter as an
 * index into it. The program prints returned nodes as a table of its own, marking which rows are input nodes, and the
 * answer is formatted back into the friendly format here, where structural checks (cycles, parent and prev pointers,
 * references to input nodes) also happen. Each language therefore needs only a generic table decoder and encoder.
 *
 * Program input for a table-mode case: line 1 is the table `[[kind, values..., links..., lists...], ...]` with links
 * as row indices or null; then one line per visible parameter, where node values are row indices (arrays of them for
 * collections) and other values pass through unchanged. Program output for a returned node value is
 * `{"n": [[kind, inputRow|null, values..., links..., lists...], ...], "v": <row indices>}`.
 */
import { hiddenParams, nodeIn, tableMode, typeOf, type FunctionInterface, type HarnessParam, type HarnessType, type ProblemInterface } from './problemInterface.ts'
import { isTableKind, schemaOf, type TableKind } from './problemKinds.ts'

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
interface Built { readonly kind: TableKind; readonly values: Json[]; readonly links: Record<string, number | null>; readonly lists: Record<string, number[]> }
/** A parameter's structure: its root or roots as row indices, and its nodes in their natural order. */
interface Structure { readonly value: Json; readonly order: readonly number[] }
interface Prepared { readonly rows: readonly Built[]; readonly structures: ReadonlyMap<string, Structure>; readonly lines: readonly string[] }

class ShapeError extends Error {}
const fail = (message: string): never => { throw new ShapeError(message) }

function caseValues(spec: FunctionInterface, input: string): Map<string, { raw: string; value: Json }> {
  const params = [...spec.params, ...hiddenParams(spec)]
  const lines = input.split('\n').filter(line => line.trim() !== '')
  if (lines.length !== params.length) fail(`Each test case needs ${params.length} input lines, one JSON value per line; received ${lines.length} lines`)
  return new Map(params.map((p, i) => [p.name, { raw: lines[i], value: JSON.parse(lines[i]) as Json }]))
}

function prepare(spec: FunctionInterface, input: string): Prepared {
  const values = caseValues(spec, input)
  const rows: Built[] = []
  const structures = new Map<string, Structure>()
  const add = (kind: TableKind, nodeValues: Json[]): number => {
    const s = schemaOf(kind)
    rows.push({ kind, values: nodeValues, links: Object.fromEntries(s.links.map(l => [l, null])), lists: Object.fromEntries(s.lists.map(l => [l, []])) })
    return rows.length - 1
  }
  const int = (name: string): number => { const v = values.get(name)?.value; return typeof v === 'number' && Number.isInteger(v) ? v : fail(`${name} must be an integer`) }
  const all = [...spec.params, ...hiddenParams(spec)]
  const nodeParams = all.filter(p => nodeIn(typeOf(p.type)) !== null)
  const order = [...nodeParams.filter(p => p.ref === undefined && !p.shape?.startsWith('merge:')), ...nodeParams.filter(p => p.shape?.startsWith('merge:')), ...nodeParams.filter(p => p.ref !== undefined)]
  for (const param of order) {
    const kind = nodeIn(typeOf(param.type))
    if (kind === null || !isTableKind(kind)) fail(`${param.type} cannot be shaped`)
    const value = values.get(param.name)!.value
    if (param.ref !== undefined) {
      const target = structures.get(param.ref)!
      const found = value === null ? null : target.order.find(row => rows[row].values[0] === value)
      if (found === undefined) fail(`${param.name} names no node of ${param.ref}`)
      structures.set(param.name, { value: found ?? null, order: found === null || found === undefined ? [] : [found] })
      continue
    }
    const [shape, ...args] = (param.shape ?? schemaOf(kind as TableKind).shape).split(':')
    const t = typeOf(param.type)
    if (shape === 'nodes') { const built = build(kind as TableKind, 'nary', value, [], add, rows, int, structures); structures.set(param.name, { value: shuffled(built.order), order: built.order }); continue }
    if (t.tag === 'node') { structures.set(param.name, build(kind as TableKind, shape, value, args, add, rows, int, structures)); continue }
    const each = (type: HarnessType, v: Json): { value: Json; order: number[] } => {
      if (type.tag === 'node') { const built = build(kind as TableKind, shape, v, args, add, rows, int, structures); return { value: built.value, order: [...built.order] } }
      if (!Array.isArray(v)) return fail(`${param.name} must be an array`)
      const items = v.map(x => each((type as { item: HarnessType }).item, x))
      return { value: items.map(x => x.value), order: items.flatMap(x => x.order) }
    }
    structures.set(param.name, each(t, value))
  }
  const table = rows.map(row => { const s = schemaOf(row.kind); return [row.kind, ...row.values, ...s.links.map(l => row.links[l]), ...s.lists.map(l => row.lists[l])] })
  const lines = [JSON.stringify(table), ...spec.params.filter(p => typeOf(p.type).tag !== 'object').map(p => nodeIn(typeOf(p.type)) === null ? values.get(p.name)!.raw : JSON.stringify(structures.get(p.name)!.value))]
  return { rows, structures, lines }
}

/** A fixed permutation, so a collection of a tree's nodes arrives out of tree order but identically on every run. */
function shuffled(order: readonly number[]): number[] {
  const out = [...order]; let seed = 2654435761 ^ out.length
  for (let i = out.length - 1; i > 0; i--) { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; const j = seed % (i + 1); [out[i], out[j]] = [out[j], out[i]] }
  return out
}

type Add = (kind: TableKind, values: Json[]) => number
function build(kind: TableKind, shape: string, value: Json, args: readonly string[], add: Add, rows: Built[], int: (name: string) => number, structures: ReadonlyMap<string, Structure>): Structure {
  const array = (v: Json): Json[] => Array.isArray(v) ? v : fail('A node value must be a JSON array')
  const link = (from: number, field: string, to: number | null): void => { rows[from].links[field] = to }
  const valueOf = (x: Json): Json[] => {
    const field = schemaOf(kind).values[0][1]
    if (field === 'char') return typeof x === 'string' && x.length === 1 ? [x] : fail('Node values must be single characters')
    if (field === 'int') return typeof x === 'number' && Number.isInteger(x) ? [x] : fail('Node values must be integers')
    return [x]
  }
  if (shape === 'list' || shape === 'cycle' || shape === 'circular' || shape === 'merge') {
    const items = array(value).map(x => add(kind, valueOf(x)))
    items.forEach((row, i) => { if (i + 1 < items.length) link(row, 'next', items[i + 1]); if (kind === 'DoublyListNode' && i > 0) link(row, 'prev', items[i - 1]) })
    if (shape === 'cycle') { const pos = int(args[0]); if (pos >= items.length || pos < -1) fail('The cycle position is outside the list'); if (pos >= 0) link(items[items.length - 1], 'next', items[pos]) }
    if (shape === 'circular' && items.length > 0) link(items[items.length - 1], 'next', items[0])
    if (shape === 'merge') {
      const other = structures.get(args[0])!; const skip = int(args[1]); const otherSkip = int(args[2])
      if (skip < 0 || skip > items.length || otherSkip < 0 || otherSkip > other.order.length) fail('A skip count is outside its list')
      const own = items.slice(0, skip); const shared = otherSkip < other.order.length ? other.order[otherSkip] : null
      if (own.length > 0) link(own[own.length - 1], 'next', shared)
      return { value: own.length > 0 ? own[0] : shared, order: [...own, ...(shared === null ? [] : other.order.slice(otherSkip))] }
    }
    return { value: items.length > 0 ? items[0] : null, order: items }
  }
  if (shape === 'tree' || shape === 'crosslink' || shape === 'leafring' || shape === 'randomTree' || shape === 'rope') {
    const v = array(value)
    const make = (x: Json): number => {
      if (shape === 'randomTree') { const pair = array(x); return add(kind, valueOf(pair[0])) }
      if (shape === 'rope') return typeof x === 'string' ? add(kind, [0, x]) : typeof x === 'number' && Number.isInteger(x) ? add(kind, [x, '']) : fail('Rope entries are lengths or strings')
      return add(kind, valueOf(x))
    }
    const positions = new Map<number, number>()
    if (v.length === 0 || v[0] === null) return { value: null, order: [] }
    const root = make(v[0]); positions.set(0, root)
    const queue = [root]; const order = [root]; let i = 1, k = 0
    while (i < v.length) {
      const parent = queue[k++]
      if (parent === undefined) fail('A level-order tree has children after its last node')
      for (const side of ['left', 'right']) {
        if (i < v.length && v[i] !== null) { const child = make(v[i]); positions.set(i, child); link(parent, side, child); if (kind === 'ParentNode') link(child, 'parent', parent); queue.push(child); order.push(child) }
        i++
      }
    }
    if (shape === 'randomTree') v.forEach((x, at) => { if (x !== null) { const target = array(x)[1]; if (target !== null) { const row = typeof target === 'number' ? positions.get(target) : undefined; if (row === undefined) fail('A random index names no node'); link(positions.get(at)!, 'random', row ?? null) } } })
    if (shape === 'crosslink') {
      const find = (name: string): number => order.find(row => rows[row].values[0] === int(name)) ?? fail(`${name} names no node`)
      link(find(args[0]), 'right', find(args[1]))
    }
    if (shape === 'leafring') {
      const leaves: number[] = []
      const visit = (row: number | null): void => { if (row === null) return; const r = rows[row]; if (r.links.left === null && r.links.right === null) { leaves.push(row); return } visit(r.links.left); visit(r.links.right) }
      visit(root)
      leaves.forEach((leaf, at) => { link(leaf, 'right', leaves[(at + 1) % leaves.length]); link(leaf, 'left', leaves[(at - 1 + leaves.length) % leaves.length]) })
    }
    return { value: root, order }
  }
  if (shape === 'multilevel') {
    const v = array(value); let previous: number[] | null = null; let i = 0; let first: number | null = null; const order: number[] = []
    while (i < v.length) {
      let offset = 0
      if (previous !== null) { while (i < v.length && v[i] === null) { offset++; i++ } }
      const level: number[] = []
      while (i < v.length && v[i] !== null) { level.push(add(kind, valueOf(v[i]))); i++ }
      i++
      if (level.length === 0) break
      level.forEach((row, at) => { if (at > 0) { link(level[at - 1], 'next', row); link(row, 'prev', level[at - 1]) } })
      if (previous === null) first = level[0]
      else { if (offset >= previous.length) fail('A child level starts past the end of its parent level'); link(previous[offset], 'child', level[0]) }
      order.push(...level); previous = level
    }
    return { value: first, order }
  }
  if (shape === 'quad') {
    const v = array(value)
    if (v.length === 0 || v[0] === null) return { value: null, order: [] }
    const make = (x: Json): number => { const pair = array(x); return add(kind, [pair[1] === 1 || pair[1] === true, pair[0] === 1 || pair[0] === true]) }
    const root = make(v[0]); const queue = [root]; const order = [root]; let i = 1, k = 0
    while (i < v.length && k < queue.length) {
      const parent = queue[k++]
      for (const side of schemaOf(kind).links) { if (i < v.length && v[i] !== null) { const child = make(v[i]); link(parent, side, child); queue.push(child); order.push(child) } i++ }
    }
    return { value: root, order }
  }
  if (shape === 'nary') {
    const v = array(value)
    if (v.length === 0) return { value: null, order: [] }
    const root = add(kind, valueOf(v[0])); const queue = [root]; const order = [root]; let i = 2, k = 0
    while (i < v.length) {
      const parent = queue[k++]
      if (parent === undefined) fail('An n-ary tree has children after its last node')
      while (i < v.length && v[i] !== null) { const child = add(kind, valueOf(v[i])); rows[parent].lists.children.push(child); queue.push(child); order.push(child); i++ }
      i++
    }
    return { value: root, order }
  }
  return fail(`Unknown shape ${shape}`)
}

/** Program input for one case: a table-mode case becomes the table line plus visible parameters; other cases pass through. */
export function prepareInput(spec: ProblemInterface, input: string): string {
  if (!tableMode(spec)) return input
  return prepare(spec as FunctionInterface, input).lines.join('\n') + '\n'
}

interface OutRow { readonly kind: string; readonly input: number | null; readonly values: Json[]; readonly links: Record<string, number | null>; readonly lists: Record<string, number[]> }
function outRows(raw: Json): { rows: OutRow[]; value: Json } {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray(raw.n)) fail('The program printed a malformed node table')
  const table = raw as { n: Json[]; v: Json }
  const rows = table.n.map(entry => {
    const row = Array.isArray(entry) ? entry : fail('Malformed node row')
    const kind = String(row[0]); if (!isTableKind(kind)) fail('Unknown node kind in output')
    const s = schemaOf(kind as TableKind); let at = 2
    const values = s.values.map(() => row[at++]); const links = Object.fromEntries(s.links.map(l => [l, row[at++] as number | null])); const lists = Object.fromEntries(s.lists.map(l => [l, row[at++] as number[]]))
    return { kind, input: row[1] as number | null, values, links, lists }
  })
  return { rows, value: table.v }
}

const notTree = 'the returned tree has a cycle or a shared node'
function formatNode(spec: FunctionInterface, prepared: Prepared, rows: OutRow[], start: number | null, kind: TableKind): Json {
  const output = spec.output.mode === 'return' ? spec.output : { mode: 'return' as const }
  if (output.ref !== undefined) {
    if (start === null) return null
    const input = rows[start].input
    const structure = prepared.structures.get(output.ref.param)!
    const position = input === null ? -1 : structure.order.indexOf(input)
    if (position < 0) return `the returned node is not a node of ${output.ref.param}`
    return output.ref.by === 'index' ? position : prepared.rows[input!].values[0]
  }
  const shape = output.shape ?? schemaOf(kind).shape
  const val = (row: number): Json => rows[row].values[0]
  if (shape === 'list' || shape === 'circular') {
    if (start === null) return []
    let first = start
    if (shape === 'circular') {
      const heads = spec.params.filter(p => p.shape === 'circular').map(p => prepared.structures.get(p.name)!.value)
      const cycle = new Set<number>(); for (let row: number | null = start; row !== null && !cycle.has(row); row = rows[row].links.next) cycle.add(row)
      const head = rows.findIndex(r => r.input !== null && heads.includes(r.input))
      if (head >= 0 && cycle.has(head)) first = head
    }
    const out: Json[] = []; const seen = new Set<number>(); let row: number | null = first
    while (row !== null) {
      if (seen.has(row)) { if (shape === 'circular' && row === first) return out; return 'the returned list has a cycle' }
      seen.add(row); out.push(val(row)); row = rows[row].links.next
    }
    return shape === 'circular' ? 'the returned list is not circular' : out
  }
  if (shape === 'circularDoubly') {
    if (start === null) return []
    const out: Json[] = []; const seen = new Set<number>(); let row = start
    for (;;) {
      seen.add(row); out.push(val(row))
      const next = rows[row].links.right
      if (next === null || rows[next].links.left !== row) return 'the returned list is not a circular doubly linked list'
      if (next === start) return out
      if (seen.has(next)) return 'the returned list is not a circular doubly linked list'
      row = next
    }
  }
  if (shape === 'multilevel') {
    const out: Json[] = []; const seen = new Set<number>(); let row: number | null = start; let previous: number | null = null
    while (row !== null) {
      const r = rows[row]
      if (seen.has(row)) return 'the returned list has a cycle'
      if (r.links.prev !== previous) return 'prev pointers do not match the list order'
      if (r.links.child !== null) return 'a child pointer is still set'
      seen.add(row); out.push(val(row)); previous = row; row = r.links.next
    }
    return out
  }
  if (shape === 'tree' || shape === 'randomTree') {
    const out: Json[] = []; const queue: (number | null)[] = [start]; const seen = new Set<number>(); const position = new Map<number, number>()
    if (kind === 'ParentNode' && start !== null && rows[start].links.parent !== null) return 'the root still has a parent'
    for (let k = 0; k < queue.length; k++) {
      const row = queue[k]
      if (row === null) { out.push(null); continue }
      if (seen.has(row)) return notTree
      seen.add(row); position.set(row, out.length); out.push(row)
      for (const side of ['left', 'right']) {
        const child: number | null = rows[row].links[side]
        if (kind === 'ParentNode' && child !== null && rows[child].links.parent !== row) return 'parent pointers are not set correctly'
        queue.push(child)
      }
    }
    while (out.length > 0 && out[out.length - 1] === null) out.pop()
    const result: Json[] = []
    for (const entry of out) {
      if (entry === null) { result.push(null); continue }
      const row = entry as number
      if (shape !== 'randomTree') { result.push(val(row)); continue }
      const target = rows[row].links.random
      if (target !== null && !position.has(target)) return 'a random pointer leaves the returned tree'
      result.push([val(row), target === null ? null : position.get(target)!])
    }
    return result
  }
  if (shape === 'quad') {
    const out: Json[] = []; const queue: (number | null)[] = [start]; const seen = new Set<number>()
    for (let k = 0; k < queue.length; k++) {
      const row = queue[k]
      if (row === null) { out.push(null); continue }
      if (seen.has(row)) return notTree
      seen.add(row); const r = rows[row]
      out.push([r.values[1] ? 1 : 0, r.values[0] ? 1 : 0])
      const children = schemaOf(kind).links.map(l => r.links[l])
      if (children.some(c => c !== null)) queue.push(...children)
      else if (!r.values[1]) return 'an internal node has no children'
      else queue.push(null, null, null, null)
    }
    while (out.length > 0 && out[out.length - 1] === null) out.pop()
    return out
  }
  if (shape === 'nary') {
    if (start === null) return []
    const out: Json[] = [val(start), null]; const queue = [start]; const seen = new Set([start])
    for (let k = 0; k < queue.length; k++) {
      for (const child of rows[queue[k]].lists.children) { if (seen.has(child)) return notTree; seen.add(child); out.push(val(child)); queue.push(child) }
      out.push(null)
    }
    while (out.length > 0 && out[out.length - 1] === null) out.pop()
    return out
  }
  return fail(`Shape ${shape} cannot print a returned value`)
}

/** The friendly answer for a program's raw output; answers without nodes, and every non-table interface, pass through. */
export function formatOutput(spec: ProblemInterface, input: string, raw: string): string {
  if (!tableMode(spec) || spec.kind !== 'function') return raw
  const f = spec
  const target = f.output.mode === 'return' ? (f.returns === 'void' ? null : f.returns) : f.params.find(p => p.name === (f.output as { param: string }).param)!.type
  if (target === null || nodeIn(typeOf(target)) === null) return raw
  const prepared = prepare(f, input)
  const { rows, value } = outRows(JSON.parse(raw) as Json)
  const kind = nodeIn(typeOf(target)) as TableKind
  const walk = (t: HarnessType, v: Json): Json => {
    if (t.tag === 'node') return formatNode(f, prepared, rows, v as number | null, kind)
    if (v === null) return null
    return (v as Json[]).map(x => walk((t as { item: HarnessType }).item, x))
  }
  return JSON.stringify(walk(typeOf(target), value))
}

/** Rewrites each finished case's answer in a batch's driver output; `inputs` are the friendly case inputs in order. */
export function formatDriverStdout(spec: ProblemInterface, inputs: readonly string[], stdout: string): string {
  if (!tableMode(spec)) return stdout
  let index = 0
  return stdout.replace(/\u001eMANOR (\d+) (\d+) ([^\n]*)/g, (line, at: string, ms: string, answer: string) => {
    const input = inputs[Number(at)]; index++
    if (answer === '!' || input === undefined) return line
    let text: string
    try { text = formatOutput(spec, input, answer) } catch (error) { text = JSON.stringify(error instanceof ShapeError ? error.message : 'the program printed an unreadable answer') }
    return `\u001eMANOR ${at} ${ms} ${text}`
  })
}

export { ShapeError }
export type { HarnessParam }
