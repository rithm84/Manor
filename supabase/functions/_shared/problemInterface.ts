/**
 * Typed solving interfaces: a problem declares a function or class signature, and Manor generates
 * each language's starter code and the hidden driver that reads one JSON value per input line,
 * calls the solution, and prints the JSON result. The driver never sees expected answers.
 * Pure module so the Edge runtime and local import tooling share it.
 *
 * Function input: one JSON line per parameter, then one per hidden parameter. Class input: line 1
 * lists the constructor name and then each method call; line 2 lists each call's argument array;
 * hidden parameters follow. Class output is a JSON array with null for the constructor and void
 * methods. Codec input: one line holding a value of the encode parameter type; the output is
 * decode(encode(value)). `ListNode` is a JSON array of values and `TreeNode` is a level-order array
 * with null for missing children and trailing nulls removed. The Node types are each LeetCode's class
 * `Node` (`_Node` in JavaScript), at most one per interface: `RandomListNode` is
 * `[[val, randomIndex|null], ...]`, `GraphNode` is an adjacency list where node i + 1 has value i + 1
 * (`[]` is null), `NaryNode` is level order with a null after each child group, and `NextNode` reads
 * as a TreeNode and prints each level along next pointers followed by "#".
 *
 * Shaped node types (problemKinds.ts) travel as a node table built from friendly JSON outside the
 * program (problemShapes.ts). Hidden parameters feed shapes, references, and interactors without
 * reaching the solution. Interactive problems declare hidden APIs whose behavior a trusted Python
 * interactor supplies (problemApis.ts), and concurrent classes run thread scripts
 * (problemConcurrency.ts).
 */
import { generatedKinds, isRecordKind, isTableKind, nodeDefinitions, nodeSchemas, recordDefinitions, recordSchemas, type RecordKind, type TableKind } from './problemKinds.ts'
import { providedComments } from './problemProvided.ts'

export const harnessLanguages = ['cpp', 'python', 'javascript', 'java', 'go'] as const
export type HarnessLanguage = typeof harnessLanguages[number]
/** `shape` names a friendly input format for a node parameter; `ref` makes the parameter a node of another parameter's structure, given by value. */
export interface HarnessParam { readonly name: string; readonly type: string; readonly shape?: string; readonly ref?: string }
/** A returned node can be required to be one of a parameter's own nodes, printed by its value or by its position. */
export interface NodeReference { readonly param: string; readonly by: 'value' | 'index' }
export type HarnessOutput = { readonly mode: 'return'; readonly ref?: NodeReference; readonly shape?: string } | { readonly mode: 'param'; readonly param: string } | { readonly mode: 'prefix'; readonly param: string }
/** A hidden API object, or with `global` the free functions LeetCode defines for the solution (in Java, a base class `Solution` extends). `pointer` passes it by pointer in C++. */
export interface HarnessApi { readonly name: string; readonly methods: readonly HarnessMethod[]; readonly global?: boolean; readonly pointer?: boolean }
interface InterfaceExtras {
  readonly hidden?: readonly HarnessParam[]
  readonly apis?: readonly HarnessApi[]
  /** Trusted Python source that answers API calls; see problemApis.ts. */
  readonly interactor?: string
  /** The languages this problem offers; all harness languages when absent. */
  readonly languages?: readonly HarnessLanguage[]
}
export interface FunctionInterface extends InterfaceExtras { readonly kind: 'function'; readonly name: string; readonly params: readonly HarnessParam[]; readonly returns: string; readonly output: HarnessOutput }
export interface HarnessMethod { readonly name: string; readonly params: readonly HarnessParam[]; readonly returns: string; readonly output?: { readonly mode: 'prefix'; readonly param: string } }
/** With `concurrency`, line 1 holds the constructor arguments and line 2 the thread scripts; see problemConcurrency.ts. */
export interface ClassInterface extends InterfaceExtras { readonly kind: 'class'; readonly className: string; readonly constructorParams: readonly HarnessParam[]; readonly methods: readonly HarnessMethod[]; readonly concurrency?: boolean }
export interface CodecMethod { readonly name: string; readonly param: HarnessParam; readonly returns: string }
/** Round-trip problems: the driver prints decode(encode(value)), using one instance when sharedInstance is true and two otherwise. */
export interface CodecInterface { readonly kind: 'codec'; readonly className: string; readonly encode: CodecMethod; readonly decode: CodecMethod; readonly sharedInstance: boolean; readonly languages?: readonly HarnessLanguage[] }
export type ProblemInterface = FunctionInterface | ClassInterface | CodecInterface

type Scalar = 'int' | 'long' | 'double' | 'bool' | 'string' | 'char'
export const nodeKinds = ['RandomListNode', 'GraphNode', 'NaryNode', 'NextNode'] as const
export type NodeKind = typeof nodeKinds[number]
export type NodeName = 'ListNode' | 'TreeNode' | NodeKind | TableKind
/** `object` names an API, the class itself (a class method taking another instance), or the provided `NestedInteger`; `buffer` is a character buffer the solution fills. */
export type HarnessType = { readonly tag: 'scalar'; readonly name: Scalar } | { readonly tag: 'node'; readonly name: NodeName } | { readonly tag: 'array'; readonly item: HarnessType } | { readonly tag: 'list'; readonly item: HarnessType }
  | { readonly tag: 'record'; readonly name: RecordKind } | { readonly tag: 'nested' } | { readonly tag: 'object'; readonly name: string } | { readonly tag: 'buffer' } | { readonly tag: 'callback'; readonly int: boolean }
const scalars: readonly string[] = ['int', 'long', 'double', 'bool', 'string', 'char']
const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/
const reserved = new Set(['main', 'Main', 'Solution', 'ListNode', 'TreeNode', 'Node', '_Node', 'Constructor', 'class', 'function', 'return', 'var', 'let', 'const', 'new', 'this', 'self', 'int', 'long', 'double', 'char', 'bool', 'string', 'func', 'type', 'struct', 'map', 'range', 'len', 'list', 'input', 'print', 'object', 'default', 'interface', 'package', 'import', 'delete', 'in', 'is', 'not', 'and', 'or', 'lambda', 'None', 'True', 'False', 'null', 'true', 'false', 'go', 'select', 'chan', 'auto', 'operator', 'template', 'typename', 'final', 'static', 'public', 'private', 'void', 'float', 'boolean', 'byte', 'short', 'unsigned', 'signed', 'register', 'enum', 'union', 'switch', 'case', 'break', 'continue', 'for', 'while', 'do', 'if', 'else', 'try', 'catch', 'throw', 'throws', 'with', 'yield', 'async', 'await', 'export', 'extends', 'super', 'goto', 'fallthrough', 'defer', 'string', 'error', 'any', 'cap', 'make', 'append', 'copy', 'panic'])

/** Class and codec problems may name their class `Solution`, as LeetCode does; only function problems wrap user code in a generated `Solution`. */
function portableClassName(name: string): boolean { return /^[A-Z][A-Za-z0-9]*$/.test(name) && (name === 'Solution' || !reserved.has(name)) }
function isNodeKind(name: string): name is NodeKind { return (nodeKinds as readonly string[]).includes(name) }
/** Parses `int`, `string[][]`, `list<list<int>>`, `TreeNode`, and similar; arrays of lists are rejected because Java cannot type them cleanly, and Node types appear only alone. */
export function parseHarnessType(text: string): HarnessType {
  const value = text.trim()
  const sequence = (item: HarnessType): HarnessType => {
    if (item.tag === 'node' && isNodeKind(item.name) && item.name !== 'NaryNode') throw new TypeError(`Collections of ${item.name} are not a supported interface type: ${text}`)
    if (item.tag === 'buffer' || item.tag === 'callback' || item.tag === 'object') throw new TypeError(`Collections of this type are not supported: ${text}`)
    return item
  }
  if (value.endsWith('[]')) {
    const item = sequence(parseHarnessType(value.slice(0, -2)))
    if (item.tag === 'list') throw new TypeError(`Arrays of lists are not a supported interface type: ${text}`)
    return { tag: 'array', item }
  }
  if (value.startsWith('list<') && value.endsWith('>')) return { tag: 'list', item: sequence(parseHarnessType(value.slice(5, -1))) }
  if (value === 'ListNode' || value === 'TreeNode' || isNodeKind(value) || isTableKind(value)) return { tag: 'node', name: value }
  if (scalars.includes(value)) return { tag: 'scalar', name: value as Scalar }
  if (isRecordKind(value)) return { tag: 'record', name: value }
  if (value === 'NestedInteger') return { tag: 'nested' }
  if (value === 'buffer') return { tag: 'buffer' }
  if (value === 'callback' || value === 'callback<int>') return { tag: 'callback', int: value !== 'callback' }
  if (/^[A-Z][A-Za-z0-9]*$/.test(value) && !reserved.has(value)) return { tag: 'object', name: value }
  throw new TypeError(`Unsupported interface type: ${text}`)
}
function typeOf(text: string): HarnessType { return parseHarnessType(text) }
function walk(type: HarnessType): HarnessType[] { return type.tag === 'array' || type.tag === 'list' ? [type, ...walk(type.item)] : [type] }
/** Every declared parameter and non-void return type in declaration order, then those of the hidden APIs. Hidden parameters never reach the solution and are left out. */
function typeTexts(spec: ProblemInterface): string[] {
  const returned = (text: string): string[] => text === 'void' ? [] : [text]
  const methods = (list: readonly HarnessMethod[]): string[] => list.flatMap(m => [...m.params.map(p => p.type), ...returned(m.returns)])
  if (spec.kind === 'codec') return [spec.encode.param.type, spec.encode.returns, spec.decode.param.type, spec.decode.returns]
  const api = methods((spec.apis ?? []).flatMap(a => a.methods))
  if (spec.kind === 'function') return [...spec.params.map(p => p.type), ...returned(spec.returns), ...api]
  return [...spec.constructorParams.map(p => p.type), ...methods(spec.methods), ...api]
}
function allTypes(spec: ProblemInterface): HarnessType[] { return typeTexts(spec).flatMap(text => walk(typeOf(text))) }
function usesNode(spec: ProblemInterface, name: NodeName): boolean { return allTypes(spec).some(t => t.tag === 'node' && t.name === name) }
/** The single Node type an interface uses, if any. */
function nodeKindOf(spec: ProblemInterface): NodeKind | null { return nodeKinds.find(kind => usesNode(spec, kind)) ?? null }
/** Copy problems: an answer that reuses an input node is a shallow copy and prints this message instead. */
export const shallowCopyMessage = 'returned input nodes instead of a copy'
function tracksInputs(kind: NodeKind | null): boolean { return kind === 'RandomListNode' || kind === 'GraphNode' }
function nodeClass(name: NodeName): string { return isNodeKind(name) ? 'Node' : isTableKind(name) ? nodeSchemas[name].className : name }
/** Hidden parameters, which feed shapes, references, and interactors but never reach the solution. */
function hiddenParams(spec: ProblemInterface): readonly HarnessParam[] { return spec.kind === 'codec' ? [] : spec.hidden ?? [] }
/** Whether node values travel as a node table: any shaped kind, shape, or node reference turns it on for the whole interface. */
function tableMode(spec: ProblemInterface): boolean {
  if (spec.kind !== 'function') return false
  const types = [...spec.params, ...hiddenParams(spec)].map(p => p.type).concat(spec.returns === 'void' ? [] : [spec.returns]).flatMap(text => walk(typeOf(text)))
  const shaped = types.some((t, i) => (t.tag === 'node' && isTableKind(t.name) && !['ListNode', 'TreeNode', 'NaryNode'].includes(t.name)) || ((t.tag === 'array' || t.tag === 'list') && t.item.tag === 'node' && t.item.name === 'NaryNode'))
  return shaped || [...spec.params, ...hiddenParams(spec)].some(p => p.shape !== undefined || p.ref !== undefined) || (spec.output.mode === 'return' && (spec.output.ref !== undefined || spec.output.shape !== undefined))
}
function isInteractive(spec: ProblemInterface): boolean { return spec.kind !== 'codec' && (spec.apis ?? []).length > 0 }
function isConcurrent(spec: ProblemInterface): boolean { return spec.kind === 'class' && spec.concurrency === true }
/** The languages a problem offers. */
export function offeredLanguages(spec: ProblemInterface): readonly HarnessLanguage[] { return spec.languages ?? harnessLanguages }
/** The API a type names, if it names one. */
function apiOf(spec: ProblemInterface, name: string): HarnessApi | undefined { return spec.kind === 'codec' ? undefined : spec.apis?.find(api => api.name === name) }
/** The parameters that become input lines the program reads, in order: visible values, then hidden ones for an interactor. API objects have no line. */
function inputParams(spec: FunctionInterface): HarnessParam[] {
  const visible = spec.params.filter(p => typeOf(p.type).tag !== 'object')
  return isInteractive(spec) ? [...visible, ...hiddenParams(spec)] : visible
}
function upperFirst(name: string): string { return name[0].toUpperCase() + name.slice(1) }

const inputShapes: Readonly<Record<string, readonly string[]>> = { list: ['ListNode', 'SinglyListNode', 'DoublyListNode'], cycle: ['ListNode'], circular: ['ListNode', 'SinglyListNode'], merge: ['ListNode'], tree: ['TreeNode', 'BiNode', 'ParentNode', 'ExprNode'], crosslink: ['TreeNode'], leafring: ['TreeNode'], multilevel: ['MultilevelNode'], quad: ['QuadNode'], randomTree: ['RandomTreeNode', 'NodeCopy'], rope: ['RopeTreeNode'], nary: ['NaryNode'], nodes: ['NaryNode'] }
const outputShapes: Readonly<Record<string, readonly string[]>> = { circular: ['ListNode', 'SinglyListNode'], circularDoubly: ['BiNode'] }
/** The node kind a type holds, looking through collections. */
function nodeIn(t: HarnessType): NodeName | null { return t.tag === 'node' ? t.name : t.tag === 'array' || t.tag === 'list' ? nodeIn(t.item) : null }
function contains(t: HarnessType, test: (inner: HarnessType) => boolean): boolean { return walk(t).some(test) }

/** Rejects interfaces the drivers cannot express, before they reach storage. */
export function validateInterface(spec: ProblemInterface): void {
  const names = (params: readonly HarnessParam[], where: string, seen = new Set<string>()): void => {
    for (const param of params) {
      if (!identifier.test(param.name) || reserved.has(param.name) || param.name.startsWith('__')) throw new TypeError(`${where} parameter name is not portable across languages: ${param.name}`)
      if (seen.has(param.name)) throw new TypeError(`${where} repeats parameter ${param.name}`)
      seen.add(param.name); typeOf(param.type)
    }
  }
  if (spec.languages !== undefined && (spec.languages.length === 0 || new Set(spec.languages).size !== spec.languages.length || spec.languages.some(l => !(harnessLanguages as readonly string[]).includes(l)))) throw new TypeError('Languages must be distinct harness languages')
  const kinds = nodeKinds.filter(kind => usesNode(spec, kind))
  if (kinds.length > 1) throw new TypeError(`An interface uses at most one Node type; found ${kinds.join(', ')}`)
  const nodeClasses = [...new Set(allTypes(spec).flatMap(t => t.tag === 'node' && nodeClass(t.name) === 'Node' ? [t.name] : []))]
  if (nodeClasses.length > 1) throw new TypeError(`An interface uses at most one type named Node; found ${nodeClasses.join(', ')}`)
  const shaped = allTypes(spec).find(t => t.tag === 'node' && isTableKind(t.name) && !['ListNode', 'TreeNode', 'NaryNode'].includes(t.name))
  if (shaped !== undefined && !tableMode(spec)) throw new TypeError('Shaped node types are supported only in function interfaces')
  if (spec.kind === 'codec') {
    if (!portableClassName(spec.className)) throw new TypeError(`Class name is not portable: ${spec.className}`)
    for (const method of [spec.encode, spec.decode]) {
      if (!/^[A-Za-z][A-Za-z0-9]*$/.test(method.name) || reserved.has(method.name) || method.name === spec.className) throw new TypeError(`Codec method name is not portable: ${method.name}`)
      names([method.param], method.name)
      if (method.returns === 'void') throw new TypeError(`Codec method ${method.name} must return a value`)
      typeOf(method.returns)
    }
    if (spec.encode.name === spec.decode.name) throw new TypeError('Codec encode and decode need different names')
    if (spec.encode.returns.trim() !== spec.decode.param.type.trim()) throw new TypeError(`${spec.decode.name} must take the type ${spec.encode.name} returns`)
    if (spec.decode.returns.trim() !== spec.encode.param.type.trim()) throw new TypeError(`${spec.decode.name} must return the type ${spec.encode.name} takes`)
    if (typeof spec.sharedInstance !== 'boolean') throw new TypeError('Codec sharedInstance must be true or false')
    if (allTypes(spec).some(t => !['scalar', 'array', 'list', 'node'].includes(t.tag))) throw new TypeError('Codec interfaces take plain values and nodes')
    return
  }
  validateApis(spec)
  const hidden = hiddenParams(spec)
  if (spec.kind === 'function') {
    if (!identifier.test(spec.name) || reserved.has(spec.name)) throw new TypeError(`Function name is not portable: ${spec.name}`)
    if (spec.params.length === 0 && hidden.length === 0 && !isInteractive(spec)) throw new TypeError('A function interface needs at least one parameter')
    const seen = new Set<string>()
    names(spec.params, spec.name, seen); names(hidden, `${spec.name} hidden`, seen)
    if (spec.returns !== 'void') typeOf(spec.returns)
    for (const param of spec.params) {
      const t = typeOf(param.type)
      if (contains(t, x => x.tag === 'callback')) throw new TypeError('Callbacks belong to concurrent class methods')
      if (t.tag === 'object' && apiOf(spec, t.name) === undefined) throw new TypeError(`${param.type} is not a declared API`)
      if (t.tag === 'object' && apiOf(spec, t.name)?.global) throw new TypeError(`${param.type} is a global API and is not passed as a parameter`)
    }
    if (hidden.some(p => !['scalar', 'array', 'list', 'node'].includes(typeOf(p.type).tag))) throw new TypeError('Hidden parameters hold plain values or nodes')
    if (spec.output.mode === 'return' && spec.returns === 'void' && !isInteractive(spec)) throw new TypeError('A void function must output a mutated parameter')
    if (spec.returns !== 'void' && contains(typeOf(spec.returns), x => ['object', 'buffer', 'callback'].includes(x.tag))) throw new TypeError(`A function cannot return ${spec.returns}`)
    if (spec.output.mode !== 'return') {
      const target = spec.output.param
      const param = spec.params.find(p => p.name === target)
      if (param === undefined) throw new TypeError(`Output parameter ${target} is not a parameter`)
      const tag = typeOf(param.type).tag
      if (spec.output.mode === 'prefix' && (spec.returns !== 'int' || (tag !== 'array' && tag !== 'buffer'))) throw new TypeError('Prefix output requires an int return and an array or buffer parameter')
      if (spec.output.mode === 'param' && spec.returns !== 'void') throw new TypeError('Parameter output requires a void return')
      if (spec.output.mode === 'param' && tracksInputs(nodeKindOf(spec))) throw new TypeError('Copy problems must return the copy')
    }
    if (spec.params.some(p => typeOf(p.type).tag === 'buffer' && (spec.output.mode !== 'prefix' || spec.output.param !== p.name))) throw new TypeError('A buffer parameter must be the prefix output')
    if (tableMode(spec)) validateShapes(spec)
    return
  }
  if (!portableClassName(spec.className)) throw new TypeError(`Class name is not portable: ${spec.className}`)
  const seen = new Set<string>()
  names(spec.constructorParams, spec.className, seen); names(hidden, `${spec.className} hidden`, seen)
  if (hidden.length > 0 && !isInteractive(spec)) throw new TypeError('Class hidden parameters feed an interactor')
  if (hidden.some(p => !['scalar', 'array', 'list'].includes(typeOf(p.type).tag))) throw new TypeError('Class hidden parameters hold plain values')
  if (spec.methods.length === 0) throw new TypeError('A class interface needs at least one method')
  const concurrent = isConcurrent(spec)
  if (concurrent && (isInteractive(spec) || offeredLanguages(spec).includes('javascript'))) throw new TypeError('Concurrent classes run on threads, which JavaScript and interactors do not offer')
  if (spec.concurrency !== undefined && typeof spec.concurrency !== 'boolean') throw new TypeError('Class concurrency must be true or false')
  const methodNames = new Set<string>()
  for (const method of spec.methods) {
    if (!/^[a-z][A-Za-z0-9]*$/.test(method.name) || reserved.has(method.name) || reserved.has(upperFirst(method.name))) throw new TypeError(`Method name must be lower camel case and portable: ${method.name}`)
    if (methodNames.has(method.name)) throw new TypeError(`Overloaded methods are not supported: ${method.name}`)
    methodNames.add(method.name); names(method.params, method.name)
    if (method.returns !== 'void') typeOf(method.returns)
    for (const param of [...method.params, ...spec.constructorParams]) {
      const t = typeOf(param.type)
      if (t.tag === 'callback' && !concurrent) throw new TypeError('Callbacks belong to concurrent class methods')
      if (t.tag === 'object' && t.name !== spec.className) throw new TypeError(`Class methods take objects only of their own class: ${param.type}`)
      if (t.tag === 'buffer' && method.output?.param !== param.name) throw new TypeError('A buffer parameter must be its method\'s prefix output')
      if (concurrent && contains(t, x => x.tag !== 'scalar' && x.tag !== 'array' && x.tag !== 'list' && x.tag !== 'callback')) throw new TypeError('Concurrent class methods take plain values and callbacks')
    }
    if (method.output !== undefined && (method.output.mode !== 'prefix' || method.returns !== 'int' || typeOf(method.params.find(p => p.name === method.output?.param)?.type ?? 'void').tag !== 'buffer')) throw new TypeError(`Method ${method.name} prefix output needs an int return and a buffer parameter`)
    if (method.returns !== 'void' && contains(typeOf(method.returns), x => ['object', 'buffer', 'callback'].includes(x.tag))) throw new TypeError(`A method cannot return ${method.returns}`)
  }
}

function validateApis(spec: FunctionInterface | ClassInterface): void {
  const apis = spec.apis ?? []
  if (apis.length === 0) { if (spec.interactor !== undefined) throw new TypeError('An interactor answers declared APIs'); return }
  if (typeof spec.interactor !== 'string' || spec.interactor.trim() === '' || spec.interactor.length > 49152) throw new TypeError('Interactive problems need interactor source of at most 48 KiB')
  if (isConcurrent(spec)) throw new TypeError('Concurrent classes do not take APIs')
  if (apis.filter(api => api.global).length > 1) throw new TypeError('An interface has at most one global API')
  const taken = new Set([spec.kind === 'class' ? spec.className : spec.name, 'NestedInteger', ...Object.keys(nodeSchemas), ...Object.keys(recordSchemas), ...nodeKinds])
  for (const api of apis) {
    if (!portableClassName(api.name) || api.name === 'Solution' || taken.has(api.name)) throw new TypeError(`API name is not portable or is taken: ${api.name}`)
    taken.add(api.name)
    if (api.methods.length === 0) throw new TypeError(`API ${api.name} needs at least one method`)
    const methods = new Set<string>()
    for (const method of api.methods) {
      if (!/^[a-z][A-Za-z0-9]*$/.test(method.name) || reserved.has(method.name) || reserved.has(upperFirst(method.name)) || methods.has(method.name)) throw new TypeError(`API method name is not portable: ${method.name}`)
      methods.add(method.name)
      const seen = new Set<string>()
      for (const param of method.params) {
        if (!identifier.test(param.name) || reserved.has(param.name) || seen.has(param.name)) throw new TypeError(`API parameter name is not portable: ${param.name}`)
        seen.add(param.name)
        const t = typeOf(param.type)
        if (contains(t, x => !['scalar', 'array', 'list', 'buffer'].includes(x.tag))) throw new TypeError(`API parameters hold plain values or a buffer: ${param.type}`)
      }
      if (method.returns !== 'void') {
        const t = typeOf(method.returns)
        if (t.tag === 'object' ? apis.find(a => a.name === t.name && !a.global) === undefined : contains(t, x => !['scalar', 'array', 'list'].includes(x.tag))) throw new TypeError(`API methods return plain values or an API object: ${method.returns}`)
      }
    }
  }
}

function validateShapes(spec: FunctionInterface): void {
  if (isInteractive(spec)) throw new TypeError('Shaped nodes and interactors do not combine')
  if (allTypes(spec).some(t => t.tag === 'node' && (t.name === 'RandomListNode' || t.name === 'GraphNode' || t.name === 'NextNode'))) throw new TypeError('Shaped interfaces cannot use RandomListNode, GraphNode, or NextNode')
  const all = [...spec.params, ...hiddenParams(spec)]
  const byName = new Map(all.map(p => [p.name, p]))
  const kindOf = (p: HarnessParam): NodeName | null => nodeIn(typeOf(p.type))
  const intParam = (name: string | undefined): void => { if (name === undefined || byName.get(name)?.type !== 'int') throw new TypeError(`Shape argument ${name} must name an int parameter`) }
  for (const param of all) {
    const kind = kindOf(param)
    if (param.ref !== undefined) {
      const target = byName.get(param.ref)
      if (kind === null || typeOf(param.type).tag !== 'node' || target === undefined || target === param || kindOf(target) !== kind || target.ref !== undefined) throw new TypeError(`Reference ${param.name} must be a node of another parameter's structure of the same kind`)
      if (param.shape !== undefined) throw new TypeError(`Reference ${param.name} takes no shape`)
      continue
    }
    if (param.shape === undefined) continue
    const [shape, ...args] = param.shape.split(':')
    if (kind === null || !inputShapes[shape]?.includes(kind)) throw new TypeError(`Shape ${param.shape} does not fit ${param.type}`)
    if ((shape === 'nodes') !== (typeOf(param.type).tag === 'list' || typeOf(param.type).tag === 'array')) throw new TypeError('The nodes shape and only it reads a collection of nodes')
    if (shape === 'cycle') { if (args.length !== 1) throw new TypeError('cycle names its position parameter'); intParam(args[0]) }
    else if (shape === 'crosslink') { if (args.length !== 2) throw new TypeError('crosslink names its from and to parameters'); intParam(args[0]); intParam(args[1]) }
    else if (shape === 'merge') {
      const other = byName.get(args[0])
      if (args.length !== 3 || other === undefined || kindOf(other) !== kind || other.shape !== undefined) throw new TypeError('merge names a plain list of the same kind and two skip counts')
      intParam(args[1]); intParam(args[2])
    } else if (args.length > 0) throw new TypeError(`Shape ${shape} takes no arguments`)
  }
  for (const param of all) if (typeOf(param.type).tag !== 'node' && kindOf(param) !== null && param.shape !== 'nodes' && kindOf(param) !== 'ListNode' && kindOf(param) !== 'TreeNode') throw new TypeError(`Collections of ${kindOf(param)} read with the nodes shape`)
  if (spec.output.mode === 'return') {
    const returned = spec.returns === 'void' ? null : nodeIn(typeOf(spec.returns))
    const { ref, shape } = spec.output
    if (ref !== undefined) {
      const target = byName.get(ref.param)
      if (returned === null || typeOf(spec.returns).tag !== 'node' || target === undefined || kindOf(target) !== returned || (ref.by !== 'value' && ref.by !== 'index')) throw new TypeError('A returned reference names a parameter of the returned kind, by value or index')
      if (shape !== undefined) throw new TypeError('A returned reference takes no shape')
    }
    if (shape !== undefined && (returned === null || !outputShapes[shape]?.includes(returned))) throw new TypeError(`Output shape ${shape} does not fit ${spec.returns}`)
  }
}

// ---------- Type names per language ----------
/** Generation is synchronous per interface; this records which objects C++ passes by pointer and which name is the class itself. */
let context: { readonly pointers: ReadonlySet<string>; readonly self: string | null } = { pointers: new Set(), self: null }
/** Sets the interface whose object types the language type names describe. */
function useSpec(spec: ProblemInterface): void {
  context = { pointers: new Set(spec.kind === 'codec' ? [] : (spec.apis ?? []).filter(a => a.pointer).map(a => a.name)), self: spec.kind === 'class' ? spec.className : null }
}
const callbackTypes = { python: ["'Callable[[], None]'", "'Callable[[int], None]'"], cpp: ['function<void()>', 'function<void(int)>'], java: ['Runnable', 'IntConsumer'], go: ['func()', 'func(int)'] } as const
function pyType(t: HarnessType): string {
  if (t.tag === 'array' || t.tag === 'list') return `List[${pyType(t.item)}]`
  if (t.tag === 'node') return nodeClass(t.name) === 'Node' ? `'Optional[Node]'` : `Optional[${nodeClass(t.name)}]`
  if (t.tag === 'record' || t.tag === 'object') return `'${t.name}'`
  if (t.tag === 'nested') return 'NestedInteger'
  if (t.tag === 'buffer') return 'List[str]'
  if (t.tag === 'callback') return callbackTypes.python[t.int ? 1 : 0]
  return { int: 'int', long: 'int', double: 'float', bool: 'bool', string: 'str', char: 'str' }[t.name]
}
function jsType(t: HarnessType): string {
  if (t.tag === 'array' || t.tag === 'list') return `${jsType(t.item)}[]`
  if (t.tag === 'node') return `${isNodeKind(t.name) ? '_Node' : isTableKind(t.name) ? nodeSchemas[t.name].jsName : t.name}|null`
  if (t.tag === 'record' || t.tag === 'object') return t.name
  if (t.tag === 'nested') return 'NestedInteger'
  if (t.tag === 'buffer') return 'character[]'
  if (t.tag === 'callback') return 'Function'
  return { int: 'number', long: 'number', double: 'number', bool: 'boolean', string: 'string', char: 'character' }[t.name]
}
function cppType(t: HarnessType): string {
  if (t.tag === 'array' || t.tag === 'list') return `vector<${cppType(t.item)}>`
  if (t.tag === 'node') return `${nodeClass(t.name)}*`
  if (t.tag === 'record') return recordSchemas[t.name].cppPointer ? `${t.name}*` : t.name
  if (t.tag === 'nested') return 'NestedInteger'
  if (t.tag === 'object') return context.pointers.has(t.name) ? `${t.name}*` : t.name
  if (t.tag === 'buffer') return 'char*'
  if (t.tag === 'callback') return callbackTypes.cpp[t.int ? 1 : 0]
  return { int: 'int', long: 'long long', double: 'double', bool: 'bool', string: 'string', char: 'char' }[t.name]
}
function cppParam(t: HarnessType): string {
  if (t.tag === 'object' && !context.pointers.has(t.name)) return `${t.name}&`
  return t.tag === 'array' || t.tag === 'list' || t.tag === 'nested' || (t.tag === 'scalar' && t.name === 'string') ? `${cppType(t)}&` : cppType(t)
}
function javaBoxed(t: HarnessType): string {
  if (t.tag === 'scalar') return { int: 'Integer', long: 'Long', double: 'Double', bool: 'Boolean', string: 'String', char: 'Character' }[t.name]
  return javaType(t)
}
function javaType(t: HarnessType): string {
  if (t.tag === 'array') return `${javaType(t.item)}[]`
  if (t.tag === 'list') return `List<${javaBoxed(t.item)}>`
  if (t.tag === 'node') return nodeClass(t.name)
  if (t.tag === 'record' || t.tag === 'object') return t.name
  if (t.tag === 'nested') return 'NestedInteger'
  if (t.tag === 'buffer') return 'char[]'
  if (t.tag === 'callback') return callbackTypes.java[t.int ? 1 : 0]
  return { int: 'int', long: 'long', double: 'double', bool: 'boolean', string: 'String', char: 'char' }[t.name]
}
function goType(t: HarnessType): string {
  if (t.tag === 'array' || t.tag === 'list') return `[]${goType(t.item)}`
  if (t.tag === 'node') return `*${nodeClass(t.name)}`
  if (t.tag === 'record') return `*${t.name}`
  if (t.tag === 'nested') return '*NestedInteger'
  if (t.tag === 'object') return t.name === context.self ? t.name : `*${t.name}`
  if (t.tag === 'buffer') return '[]byte'
  if (t.tag === 'callback') return callbackTypes.go[t.int ? 1 : 0]
  return { int: 'int', long: 'int64', double: 'float64', bool: 'bool', string: 'string', char: 'byte' }[t.name]
}
function returnsOf(text: string, map: (t: HarnessType) => string, voidName: string): string { return text === 'void' ? voidName : map(typeOf(text)) }

// ---------- Starter code ----------
const pyNodes = { ListNode: 'class ListNode:\n    def __init__(self, val=0, next=None):\n        self.val = val\n        self.next = next\n', TreeNode: 'class TreeNode:\n    def __init__(self, val=0, left=None, right=None):\n        self.val = val\n        self.left = left\n        self.right = right\n' }
const jsNodes = { ListNode: 'function ListNode(val, next) {\n    this.val = (val === undefined ? 0 : val);\n    this.next = (next === undefined ? null : next);\n}\n', TreeNode: 'function TreeNode(val, left, right) {\n    this.val = (val === undefined ? 0 : val);\n    this.left = (left === undefined ? null : left);\n    this.right = (right === undefined ? null : right);\n}\n' }
const cppNodes = { ListNode: 'struct ListNode {\n    int val;\n    ListNode *next;\n    ListNode() : val(0), next(nullptr) {}\n    ListNode(int x) : val(x), next(nullptr) {}\n    ListNode(int x, ListNode *next) : val(x), next(next) {}\n};\n', TreeNode: 'struct TreeNode {\n    int val;\n    TreeNode *left;\n    TreeNode *right;\n    TreeNode() : val(0), left(nullptr), right(nullptr) {}\n    TreeNode(int x) : val(x), left(nullptr), right(nullptr) {}\n    TreeNode(int x, TreeNode *left, TreeNode *right) : val(x), left(left), right(right) {}\n};\n' }
const javaNodes = { ListNode: 'class ListNode {\n    int val;\n    ListNode next;\n    ListNode() {}\n    ListNode(int val) { this.val = val; }\n    ListNode(int val, ListNode next) { this.val = val; this.next = next; }\n}\n', TreeNode: 'class TreeNode {\n    int val;\n    TreeNode left;\n    TreeNode right;\n    TreeNode() {}\n    TreeNode(int val) { this.val = val; }\n    TreeNode(int val, TreeNode left, TreeNode right) { this.val = val; this.left = left; this.right = right; }\n}\n' }
const goNodes = { ListNode: 'type ListNode struct {\n    Val  int\n    Next *ListNode\n}\n', TreeNode: 'type TreeNode struct {\n    Val   int\n    Left  *TreeNode\n    Right *TreeNode\n}\n' }
/** LeetCode's `Node` class for each Node type; the Python and JavaScript drivers also use these as fallbacks. */
export const pyNodeKinds: Record<NodeKind, string> = {
  RandomListNode: "class Node:\n    def __init__(self, x: int, next: 'Node' = None, random: 'Node' = None):\n        self.val = int(x)\n        self.next = next\n        self.random = random\n",
  GraphNode: 'class Node:\n    def __init__(self, val = 0, neighbors = None):\n        self.val = val\n        self.neighbors = neighbors if neighbors is not None else []\n',
  NaryNode: "class Node:\n    def __init__(self, val: Optional[int] = None, children: Optional[List['Node']] = None):\n        self.val = val\n        self.children = children\n",
  NextNode: "class Node:\n    def __init__(self, val: int = 0, left: 'Node' = None, right: 'Node' = None, next: 'Node' = None):\n        self.val = val\n        self.left = left\n        self.right = right\n        self.next = next\n",
}
export const jsNodeKinds: Record<NodeKind, string> = {
  RandomListNode: 'function _Node(val, next, random) {\n    this.val = val;\n    this.next = next;\n    this.random = random;\n}\n',
  GraphNode: 'function _Node(val, neighbors) {\n    this.val = val === undefined ? 0 : val;\n    this.neighbors = neighbors === undefined ? [] : neighbors;\n}\n',
  NaryNode: 'function _Node(val, children) {\n    this.val = val === undefined ? null : val;\n    this.children = children === undefined ? null : children;\n}\n',
  NextNode: 'function _Node(val, left, right, next) {\n    this.val = val === undefined ? null : val;\n    this.left = left === undefined ? null : left;\n    this.right = right === undefined ? null : right;\n    this.next = next === undefined ? null : next;\n}\n',
}
const cppNodeKinds: Record<NodeKind, string> = {
  RandomListNode: 'class Node {\npublic:\n    int val;\n    Node* next;\n    Node* random;\n\n    Node(int _val) {\n        val = _val;\n        next = NULL;\n        random = NULL;\n    }\n};\n',
  GraphNode: 'class Node {\npublic:\n    int val;\n    vector<Node*> neighbors;\n    Node() {\n        val = 0;\n        neighbors = vector<Node*>();\n    }\n    Node(int _val) {\n        val = _val;\n        neighbors = vector<Node*>();\n    }\n    Node(int _val, vector<Node*> _neighbors) {\n        val = _val;\n        neighbors = _neighbors;\n    }\n};\n',
  NaryNode: 'class Node {\npublic:\n    int val;\n    vector<Node*> children;\n\n    Node() {}\n\n    Node(int _val) {\n        val = _val;\n    }\n\n    Node(int _val, vector<Node*> _children) {\n        val = _val;\n        children = _children;\n    }\n};\n',
  NextNode: 'class Node {\npublic:\n    int val;\n    Node* left;\n    Node* right;\n    Node* next;\n\n    Node() : val(0), left(NULL), right(NULL), next(NULL) {}\n\n    Node(int _val) : val(_val), left(NULL), right(NULL), next(NULL) {}\n\n    Node(int _val, Node* _left, Node* _right, Node* _next)\n        : val(_val), left(_left), right(_right), next(_next) {}\n};\n',
}
const javaNodeKinds: Record<NodeKind, string> = {
  RandomListNode: 'class Node {\n    int val;\n    Node next;\n    Node random;\n\n    public Node(int val) {\n        this.val = val;\n        this.next = null;\n        this.random = null;\n    }\n}\n',
  GraphNode: 'class Node {\n    public int val;\n    public List<Node> neighbors;\n    public Node() {\n        val = 0;\n        neighbors = new ArrayList<Node>();\n    }\n    public Node(int _val) {\n        val = _val;\n        neighbors = new ArrayList<Node>();\n    }\n    public Node(int _val, ArrayList<Node> _neighbors) {\n        val = _val;\n        neighbors = _neighbors;\n    }\n}\n',
  NaryNode: 'class Node {\n    public int val;\n    public List<Node> children;\n\n    public Node() {}\n\n    public Node(int _val) {\n        val = _val;\n    }\n\n    public Node(int _val, List<Node> _children) {\n        val = _val;\n        children = _children;\n    }\n}\n',
  NextNode: 'class Node {\n    public int val;\n    public Node left;\n    public Node right;\n    public Node next;\n\n    public Node() {}\n\n    public Node(int _val) {\n        val = _val;\n    }\n\n    public Node(int _val, Node _left, Node _right, Node _next) {\n        val = _val;\n        left = _left;\n        right = _right;\n        next = _next;\n    }\n}\n',
}
const goNodeKinds: Record<NodeKind, string> = {
  RandomListNode: 'type Node struct {\n    Val    int\n    Next   *Node\n    Random *Node\n}\n',
  GraphNode: 'type Node struct {\n    Val       int\n    Neighbors []*Node\n}\n',
  NaryNode: 'type Node struct {\n    Val      int\n    Children []*Node\n}\n',
  NextNode: 'type Node struct {\n    Val   int\n    Left  *Node\n    Right *Node\n    Next  *Node\n}\n',
}
function nodeBlock(spec: ProblemInterface, nodes: { ListNode: string; TreeNode: string }, kinds: Record<NodeKind, string>, language: HarnessLanguage): string {
  const kind = nodeKindOf(spec)
  const used = [...(['ListNode', 'TreeNode'] as const).filter(name => usesNode(spec, name)).map(name => nodes[name]), ...(kind === null ? [] : [kinds[kind]])]
  used.push(...generatedKinds.filter(name => usesNode(spec, name)).map(name => nodeDefinitions(name)[language]))
  used.push(...(Object.keys(recordSchemas) as RecordKind[]).filter(name => allTypes(spec).some(t => t.tag === 'record' && t.name === name)).map(name => recordDefinitions(name)[language]))
  const provided = providedComments(spec, language)
  if (provided !== '') used.push(provided)
  return used.join('\n') + (used.length > 0 ? '\n' : '')
}
function sig(params: readonly HarnessParam[], format: (name: string, t: HarnessType) => string): string { return params.map(p => format(p.name, typeOf(p.type))).join(', ') }

/** Starter code shows complete type definitions so editor diagnostics stay accurate. */
export function starterCode(spec: ProblemInterface): Partial<Record<HarnessLanguage, string>> {
  useSpec(spec)
  const all = allStarters(spec)
  return Object.fromEntries(offeredLanguages(spec).map(language => [language, all[language]]))
}

function allStarters(spec: ProblemInterface): Record<HarnessLanguage, string> {
  const concurrent = isConcurrent(spec)
  const pyHead = `from typing import ${concurrent ? 'Callable, ' : ''}List, Optional\n\n${nodeBlock(spec, pyNodes, pyNodeKinds, 'python')}`
  const cppHead = `#include <bits/stdc++.h>\nusing namespace std;\n\n${nodeBlock(spec, cppNodes, cppNodeKinds, 'cpp')}`
  const javaHead = `import java.util.*;\n${concurrent ? 'import java.util.function.*;\n' : ''}\n${nodeBlock(spec, javaNodes, javaNodeKinds, 'java')}`
  const goHead = `package main\n\n${nodeBlock(spec, goNodes, goNodeKinds, 'go')}`
  const jsHead = nodeBlock(spec, jsNodes, jsNodeKinds, 'javascript')
  const base = spec.kind === 'codec' ? undefined : spec.apis?.find(api => api.global)
  const extend = base === undefined ? '' : ` extends ${base.name}`
  const goZero = (text: string): string => text === 'void' ? '' : `\n    ${{ int: 'return 0', long: 'return 0', double: 'return 0', bool: 'return false', string: 'return ""', char: 'return 0' }[(typeOf(text) as { name: string }).name] ?? 'return nil'}`
  const javaZero = (text: string): string => { if (text === 'void') return ''; const t = typeOf(text); return `\n        return ${t.tag === 'scalar' ? { int: '0', long: '0', double: '0', bool: 'false', string: '""', char: "' '" }[t.name] : 'null'};` }
  const cppZero = (text: string): string => text === 'void' ? '' : `\n        return {};`
  if (spec.kind === 'function') {
    const jsDoc = ['/**', ...spec.params.map(p => ` * @param {${jsType(typeOf(p.type))}} ${p.name}`), ` * @return {${spec.returns === 'void' ? 'void' : jsType(typeOf(spec.returns))}}`, ' */'].join('\n')
    return {
      python: `${pyHead}class Solution:\n    def ${spec.name}(self${spec.params.map(p => `, ${p.name}: ${pyType(typeOf(p.type))}`).join('')}) -> ${returnsOf(spec.returns, pyType, 'None')}:\n        pass\n`,
      javascript: `${jsHead}${jsDoc}\nvar ${spec.name} = function(${spec.params.map(p => p.name).join(', ')}) {\n\n};\n`,
      cpp: `${cppHead}class Solution {\npublic:\n    ${returnsOf(spec.returns, cppType, 'void')} ${spec.name}(${sig(spec.params, (n, t) => `${cppParam(t)} ${n}`)}) {${cppZero(spec.returns)}\n    }\n};\n`,
      java: `${javaHead}class Solution${extend} {\n    public ${returnsOf(spec.returns, javaType, 'void')} ${spec.name}(${sig(spec.params, (n, t) => `${javaType(t)} ${n}`)}) {${javaZero(spec.returns)}\n    }\n}\n`,
      go: `${goHead}func ${spec.name}(${sig(spec.params, (n, t) => `${n} ${goType(t)}`)})${spec.returns === 'void' ? '' : ' ' + goType(typeOf(spec.returns))} {${goZero(spec.returns)}\n}\n`,
    }
  }
  if (spec.kind === 'codec') return codecStarter(spec, { python: pyHead, javascript: jsHead, cpp: cppHead, java: javaHead, go: goHead }, { go: goZero, java: javaZero, cpp: cppZero })
  const c = spec.className
  return {
    python: `${pyHead}class ${c}:\n\n    def __init__(self${spec.constructorParams.map(p => `, ${p.name}: ${pyType(typeOf(p.type))}`).join('')}):\n        pass\n${spec.methods.map(m => `\n    def ${m.name}(self${m.params.map(p => `, ${p.name}: ${pyType(typeOf(p.type))}`).join('')}) -> ${returnsOf(m.returns, pyType, 'None')}:\n        pass\n`).join('')}`,
    javascript: `${jsHead}class ${c} {\n    constructor(${spec.constructorParams.map(p => p.name).join(', ')}) {\n\n    }\n${spec.methods.map(m => `\n    /**\n${m.params.map(p => `     * @param {${jsType(typeOf(p.type))}} ${p.name}\n`).join('')}     * @return {${m.returns === 'void' ? 'void' : jsType(typeOf(m.returns))}}\n     */\n    ${m.name}(${m.params.map(p => p.name).join(', ')}) {\n\n    }\n`).join('')}}\n`,
    cpp: `${cppHead}class ${c} {\npublic:\n    ${c}(${sig(spec.constructorParams, (n, t) => `${cppParam(t)} ${n}`)}) {\n\n    }\n${spec.methods.map(m => `\n    ${returnsOf(m.returns, cppType, 'void')} ${m.name}(${sig(m.params, (n, t) => `${cppParam(t)} ${n}`)}) {${cppZero(m.returns)}\n    }\n`).join('')}};\n`,
    java: `${javaHead}class ${c}${c === 'Solution' ? extend : ''} {\n\n    public ${c}(${sig(spec.constructorParams, (n, t) => `${javaType(t)} ${n}`)}) {\n\n    }\n${spec.methods.map(m => `\n    public ${returnsOf(m.returns, javaType, 'void')} ${m.name}(${sig(m.params, (n, t) => `${javaType(t)} ${n}`)})${concurrent ? ' throws InterruptedException' : ''} {${javaZero(m.returns)}\n    }\n`).join('')}}\n`,
    go: `${goHead}type ${c} struct {\n\n}\n\nfunc Constructor(${sig(spec.constructorParams, (n, t) => `${n} ${goType(t)}`)}) ${c} {\n    return ${c}{}\n}\n${spec.methods.map(m => `\nfunc (this *${c}) ${upperFirst(m.name)}(${sig(m.params, (n, t) => `${n} ${goType(t)}`)})${m.returns === 'void' ? '' : ' ' + goType(typeOf(m.returns))} {${goZero(m.returns)}\n}\n`).join('')}`,
  }
}

/** LeetCode's codec shapes: a class in most languages and two top-level functions in JavaScript, with a note on how the judge calls them. */
function codecStarter(spec: CodecInterface, heads: Record<HarnessLanguage, string>, zero: { readonly go: (text: string) => string; readonly java: (text: string) => string; readonly cpp: (text: string) => string }): Record<HarnessLanguage, string> {
  const { className: c, encode: e, decode: d } = spec
  const shared = spec.sharedInstance
  const arg = e.param.name
  const methods = [e, d]
  const pyParam = (m: CodecMethod): string => `${m.param.name}: ${pyType(typeOf(m.param.type))}`
  const cppCodecParam = (t: HarnessType): string => t.tag === 'array' || t.tag === 'list' ? `${cppType(t)}&` : cppType(t)
  const usage = (lines: readonly string[]): string => lines.join('\n')
  return {
    python: `${heads.python}class ${c}:\n${methods.map(m => `\n    def ${m.name}(self, ${pyParam(m)}) -> ${pyType(typeOf(m.returns))}:\n        pass\n`).join('')}\n\n# Your ${c} object will be instantiated and called as such:\n${usage(shared ? [`# codec = ${c}()`, `# codec.${d.name}(codec.${e.name}(${arg}))`] : [`# ser = ${c}()`, `# deser = ${c}()`, `# ans = deser.${d.name}(ser.${e.name}(${arg}))`])}\n`,
    javascript: `${heads.javascript}${methods.map(m => `/**\n * @param {${jsType(typeOf(m.param.type))}} ${m.param.name}\n * @return {${jsType(typeOf(m.returns))}}\n */\nvar ${m.name} = function(${m.param.name}) {\n\n};\n`).join('\n')}\n/**\n * Your functions will be called as such:\n * ${d.name}(${e.name}(${arg}));\n */\n`,
    cpp: `${heads.cpp}class ${c} {\npublic:\n${methods.map(m => `    ${cppType(typeOf(m.returns))} ${m.name}(${cppCodecParam(typeOf(m.param.type))} ${m.param.name}) {${zero.cpp(m.returns)}\n    }\n`).join('\n')}};\n\n// Your ${c} object will be instantiated and called as such:\n${usage(shared ? [`// ${c} codec;`, `// codec.${d.name}(codec.${e.name}(${arg}));`] : [`// ${c} ser, deser;`, `// ${cppType(typeOf(d.returns))} ans = deser.${d.name}(ser.${e.name}(${arg}));`])}\n`,
    java: `${heads.java}public class ${c} {\n${methods.map(m => `\n    public ${javaType(typeOf(m.returns))} ${m.name}(${javaType(typeOf(m.param.type))} ${m.param.name}) {${zero.java(m.returns)}\n    }\n`).join('')}}\n\n// Your ${c} object will be instantiated and called as such:\n${usage(shared ? [`// ${c} codec = new ${c}();`, `// codec.${d.name}(codec.${e.name}(${arg}));`] : [`// ${c} ser = new ${c}();`, `// ${c} deser = new ${c}();`, `// ${javaType(typeOf(d.returns))} ans = deser.${d.name}(ser.${e.name}(${arg}));`])}\n`,
    go: `${heads.go}type ${c} struct {\n\n}\n\nfunc Constructor() ${c} {\n    return ${c}{}\n}\n${methods.map(m => `\nfunc (this *${c}) ${m.name}(${m.param.name} ${goType(typeOf(m.param.type))}) ${goType(typeOf(m.returns))} {${zero.go(m.returns)}\n}\n`).join('')}\n/**\n * Your ${c} object will be instantiated and called as such:\n${usage((shared ? ['obj := Constructor();', `ans := obj.${d.name}(obj.${e.name}(${arg}));`] : ['ser := Constructor();', 'deser := Constructor();', `data := ser.${e.name}(${arg});`, `ans := deser.${d.name}(data);`]).map(line => ` * ${line}`))}\n */\n`,
  }
}

export { typeOf, typeTexts, upperFirst, usesNode, nodeKindOf, tracksInputs, cppType, cppParam, javaType, javaBoxed, goType, pyType, jsType, useSpec, hiddenParams, tableMode, isInteractive, isConcurrent, apiOf, inputParams, nodeClass, nodeIn, allTypes, walk }
