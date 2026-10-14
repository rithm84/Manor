/** What every language's driver needs to know about an interface beyond its declaration, computed once here. */
import { allTypes, hiddenParams, inputParams, isConcurrent, isInteractive, nodeClass, nodeIn, tableMode, typeOf, type FunctionInterface, type ProblemInterface } from './problemInterface.ts'
import { isTableKind, nodeSchemas, recordSchemas, schemaOf, type RecordKind, type TableKind } from './problemKinds.ts'

export interface DriverMeta {
  readonly table: boolean
  /** Table kinds the interface uses, with their class names and fields. */
  readonly kinds: Record<string, { readonly cls: string; readonly js: string; readonly values: readonly (readonly [string, string])[]; readonly links: readonly string[]; readonly lists: readonly string[]; readonly goLower: boolean }>
  readonly records: Record<string, readonly (readonly [string, string])[]>
  readonly nested: boolean
  readonly interactive: boolean
  readonly concurrent: boolean
  /** Names of the input lines after the table line, in order. */
  readonly inputs: readonly string[]
  /** Input lines per case, including the table line. */
  readonly width: number
  /** Whether the answer holds nodes and prints as a node table. */
  readonly wrap: boolean
  readonly hidden: readonly string[]
}

function answerType(spec: ProblemInterface): string | null {
  if (spec.kind !== 'function') return null
  if (spec.output.mode === 'return') return spec.returns === 'void' ? null : spec.returns
  const name = spec.output.param
  return spec.params.find(p => p.name === name)!.type
}

export function driverMeta(spec: ProblemInterface): DriverMeta {
  const table = tableMode(spec)
  const used = new Set(allTypes(spec).flatMap(t => t.tag === 'node' && isTableKind(t.name) ? [t.name] : []))
  const kinds = table ? Object.fromEntries([...used].map(kind => { const s = schemaOf(kind as TableKind); return [kind, { cls: s.className, js: s.jsName, values: s.values, links: s.links, lists: s.lists, goLower: s.goLower === true }] })) : {}
  const records = Object.fromEntries((Object.keys(recordSchemas) as RecordKind[]).filter(name => allTypes(spec).some(t => t.tag === 'record' && t.name === name)).map(name => [name, recordSchemas[name].fields]))
  const interactive = isInteractive(spec)
  const inputs = spec.kind === 'function' ? inputParams(spec).map(p => p.name) : spec.kind === 'class' ? ['__ops', '__calls', ...(interactive ? hiddenParams(spec).map(p => p.name) : [])] : ['__value']
  const answer = answerType(spec)
  return {
    table, kinds, records, nested: allTypes(spec).some(t => t.tag === 'nested'), interactive, concurrent: isConcurrent(spec), inputs,
    width: inputs.length + (table ? 1 : 0), wrap: table && answer !== null && nodeIn(typeOf(answer)) !== null, hidden: hiddenParams(spec).map(p => p.name),
  }
}

/**
 * The friendly lines one test case holds, in order: a function's visible parameters (API objects take no line) and
 * then its hidden ones; a class's operations and arguments and then its hidden parameters; a concurrent class's
 * constructor arguments and thread scripts; a codec's value.
 */
export function caseLines(spec: ProblemInterface): { readonly name: string; readonly type: string; readonly shape?: string; readonly ref?: string }[] {
  if (spec.kind === 'codec') return [spec.encode.param]
  if (spec.kind === 'class') return spec.concurrency ? [{ name: 'constructor', type: '$constructor' }, { name: 'threads', type: '$threads' }] : [{ name: 'operations', type: '$operations' }, { name: 'arguments', type: '$arguments' }, ...hiddenParams(spec)]
  return [...spec.params.filter(p => typeOf(p.type).tag !== 'object'), ...hiddenParams(spec)]
}

/** The class name a table kind's nodes have. */
export function kindClass(kind: string): string { return isTableKind(kind) ? nodeSchemas[kind].className : nodeClass(kind as never) }
export type { FunctionInterface }
