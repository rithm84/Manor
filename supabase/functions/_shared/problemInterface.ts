/**
 * Typed solving interfaces: a problem declares a function or class signature, and Manor generates
 * each language's starter code and the hidden driver that reads one JSON value per input line,
 * calls the solution, and prints the JSON result. The driver never sees expected answers.
 * Pure module with no imports so the Edge runtime and local import tooling share it.
 *
 * Function input: one JSON line per parameter. Class input: line 1 lists the constructor name and
 * then each method call; line 2 lists each call's argument array. Class output is a JSON array with
 * null for the constructor and void methods. Codec input: one line holding a value of the encode
 * parameter type; the output is decode(encode(value)). `ListNode` is a JSON array of values and
 * `TreeNode` is a level-order array with null for missing children and trailing nulls removed. The
 * Node types are each LeetCode's class `Node` (`_Node` in JavaScript), at most one per interface:
 * `RandomListNode` is `[[val, randomIndex|null], ...]`, `GraphNode` is an adjacency list where node
 * i + 1 has value i + 1 (`[]` is null), `NaryNode` is level order with a null after each child group,
 * and `NextNode` reads as a TreeNode and prints each level along next pointers followed by "#".
 */
export const harnessLanguages = ['cpp', 'python', 'javascript', 'java', 'go'] as const
export type HarnessLanguage = typeof harnessLanguages[number]
export interface HarnessParam { readonly name: string; readonly type: string }
export type HarnessOutput = { readonly mode: 'return' } | { readonly mode: 'param'; readonly param: string } | { readonly mode: 'prefix'; readonly param: string }
export interface FunctionInterface { readonly kind: 'function'; readonly name: string; readonly params: readonly HarnessParam[]; readonly returns: string; readonly output: HarnessOutput }
export interface HarnessMethod { readonly name: string; readonly params: readonly HarnessParam[]; readonly returns: string }
export interface ClassInterface { readonly kind: 'class'; readonly className: string; readonly constructorParams: readonly HarnessParam[]; readonly methods: readonly HarnessMethod[] }
export interface CodecMethod { readonly name: string; readonly param: HarnessParam; readonly returns: string }
/** Round-trip problems: the driver prints decode(encode(value)), using one instance when sharedInstance is true and two otherwise. */
export interface CodecInterface { readonly kind: 'codec'; readonly className: string; readonly encode: CodecMethod; readonly decode: CodecMethod; readonly sharedInstance: boolean }
export type ProblemInterface = FunctionInterface | ClassInterface | CodecInterface

type Scalar = 'int' | 'long' | 'double' | 'bool' | 'string' | 'char'
export const nodeKinds = ['RandomListNode', 'GraphNode', 'NaryNode', 'NextNode'] as const
export type NodeKind = typeof nodeKinds[number]
export type NodeName = 'ListNode' | 'TreeNode' | NodeKind
export type HarnessType = { readonly tag: 'scalar'; readonly name: Scalar } | { readonly tag: 'node'; readonly name: NodeName } | { readonly tag: 'array'; readonly item: HarnessType } | { readonly tag: 'list'; readonly item: HarnessType }
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
    if (item.tag === 'node' && isNodeKind(item.name)) throw new TypeError(`Collections of ${item.name} are not a supported interface type: ${text}`)
    return item
  }
  if (value.endsWith('[]')) {
    const item = sequence(parseHarnessType(value.slice(0, -2)))
    if (item.tag === 'list') throw new TypeError(`Arrays of lists are not a supported interface type: ${text}`)
    return { tag: 'array', item }
  }
  if (value.startsWith('list<') && value.endsWith('>')) return { tag: 'list', item: sequence(parseHarnessType(value.slice(5, -1))) }
  if (value === 'ListNode' || value === 'TreeNode' || isNodeKind(value)) return { tag: 'node', name: value }
  if (scalars.includes(value)) return { tag: 'scalar', name: value as Scalar }
  throw new TypeError(`Unsupported interface type: ${text}`)
}
function typeOf(text: string): HarnessType { return parseHarnessType(text) }
function walk(type: HarnessType): HarnessType[] { return type.tag === 'array' || type.tag === 'list' ? [type, ...walk(type.item)] : [type] }
/** Every declared parameter and non-void return type, in declaration order. */
function typeTexts(spec: ProblemInterface): string[] {
  const returned = (text: string): string[] => text === 'void' ? [] : [text]
  if (spec.kind === 'function') return [...spec.params.map(p => p.type), ...returned(spec.returns)]
  if (spec.kind === 'codec') return [spec.encode.param.type, spec.encode.returns, spec.decode.param.type, spec.decode.returns]
  return [...spec.constructorParams.map(p => p.type), ...spec.methods.flatMap(m => [...m.params.map(p => p.type), ...returned(m.returns)])]
}
function allTypes(spec: ProblemInterface): HarnessType[] { return typeTexts(spec).flatMap(text => walk(typeOf(text))) }
function usesNode(spec: ProblemInterface, name: NodeName): boolean { return allTypes(spec).some(t => t.tag === 'node' && t.name === name) }
/** The single Node type an interface uses, if any. */
function nodeKindOf(spec: ProblemInterface): NodeKind | null { return nodeKinds.find(kind => usesNode(spec, kind)) ?? null }
/** Copy problems: an answer that reuses an input node is a shallow copy and prints this message instead. */
export const shallowCopyMessage = 'returned input nodes instead of a copy'
function tracksInputs(kind: NodeKind | null): boolean { return kind === 'RandomListNode' || kind === 'GraphNode' }
function nodeClass(name: NodeName): string { return isNodeKind(name) ? 'Node' : name }
function upperFirst(name: string): string { return name[0].toUpperCase() + name.slice(1) }

/** Rejects interfaces the drivers cannot express, before they reach storage. */
export function validateInterface(spec: ProblemInterface): void {
  const names = (params: readonly HarnessParam[], where: string): void => {
    const seen = new Set<string>()
    for (const param of params) {
      if (!identifier.test(param.name) || reserved.has(param.name) || param.name.startsWith('__')) throw new TypeError(`${where} parameter name is not portable across languages: ${param.name}`)
      if (seen.has(param.name)) throw new TypeError(`${where} repeats parameter ${param.name}`)
      seen.add(param.name); typeOf(param.type)
    }
  }
  const kinds = nodeKinds.filter(kind => usesNode(spec, kind))
  if (kinds.length > 1) throw new TypeError(`An interface uses at most one Node type; found ${kinds.join(', ')}`)
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
    return
  }
  if (spec.kind === 'function') {
    if (!identifier.test(spec.name) || reserved.has(spec.name)) throw new TypeError(`Function name is not portable: ${spec.name}`)
    if (spec.params.length === 0) throw new TypeError('A function interface needs at least one parameter')
    names(spec.params, spec.name)
    if (spec.returns !== 'void') typeOf(spec.returns)
    if (spec.output.mode === 'return' && spec.returns === 'void') throw new TypeError('A void function must output a mutated parameter')
    if (spec.output.mode !== 'return') {
      const target = spec.output.param
      const param = spec.params.find(p => p.name === target)
      if (param === undefined) throw new TypeError(`Output parameter ${target} is not a parameter`)
      if (spec.output.mode === 'prefix' && (spec.returns !== 'int' || typeOf(param.type).tag !== 'array')) throw new TypeError('Prefix output requires an int return and an array parameter')
      if (spec.output.mode === 'param' && spec.returns !== 'void') throw new TypeError('Parameter output requires a void return')
      if (spec.output.mode === 'param' && tracksInputs(nodeKindOf(spec))) throw new TypeError('Copy problems must return the copy')
    }
    return
  }
  if (!portableClassName(spec.className)) throw new TypeError(`Class name is not portable: ${spec.className}`)
  names(spec.constructorParams, spec.className)
  if (spec.methods.length === 0) throw new TypeError('A class interface needs at least one method')
  const methodNames = new Set<string>()
  for (const method of spec.methods) {
    if (!/^[a-z][A-Za-z0-9]*$/.test(method.name) || reserved.has(method.name) || reserved.has(upperFirst(method.name))) throw new TypeError(`Method name must be lower camel case and portable: ${method.name}`)
    if (methodNames.has(method.name)) throw new TypeError(`Overloaded methods are not supported: ${method.name}`)
    methodNames.add(method.name); names(method.params, method.name)
    if (method.returns !== 'void') typeOf(method.returns)
  }
}

// ---------- Type names per language ----------
function pyType(t: HarnessType): string {
  if (t.tag === 'array' || t.tag === 'list') return `List[${pyType(t.item)}]`
  if (t.tag === 'node') return isNodeKind(t.name) ? `'Optional[Node]'` : `Optional[${t.name}]`
  return { int: 'int', long: 'int', double: 'float', bool: 'bool', string: 'str', char: 'str' }[t.name]
}
function jsType(t: HarnessType): string {
  if (t.tag === 'array' || t.tag === 'list') return `${jsType(t.item)}[]`
  if (t.tag === 'node') return `${isNodeKind(t.name) ? '_Node' : t.name}|null`
  return { int: 'number', long: 'number', double: 'number', bool: 'boolean', string: 'string', char: 'character' }[t.name]
}
function cppType(t: HarnessType): string {
  if (t.tag === 'array' || t.tag === 'list') return `vector<${cppType(t.item)}>`
  if (t.tag === 'node') return `${nodeClass(t.name)}*`
  return { int: 'int', long: 'long long', double: 'double', bool: 'bool', string: 'string', char: 'char' }[t.name]
}
function cppParam(t: HarnessType): string { return t.tag === 'array' || t.tag === 'list' || (t.tag === 'scalar' && t.name === 'string') ? `${cppType(t)}&` : cppType(t) }
function javaBoxed(t: HarnessType): string {
  if (t.tag === 'scalar') return { int: 'Integer', long: 'Long', double: 'Double', bool: 'Boolean', string: 'String', char: 'Character' }[t.name]
  return javaType(t)
}
function javaType(t: HarnessType): string {
  if (t.tag === 'array') return `${javaType(t.item)}[]`
  if (t.tag === 'list') return `List<${javaBoxed(t.item)}>`
  if (t.tag === 'node') return nodeClass(t.name)
  return { int: 'int', long: 'long', double: 'double', bool: 'boolean', string: 'String', char: 'char' }[t.name]
}
function goType(t: HarnessType): string {
  if (t.tag === 'array' || t.tag === 'list') return `[]${goType(t.item)}`
  if (t.tag === 'node') return `*${nodeClass(t.name)}`
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
function nodeBlock(spec: ProblemInterface, nodes: { ListNode: string; TreeNode: string }, kinds: Record<NodeKind, string>): string {
  const kind = nodeKindOf(spec)
  const used = [...(['ListNode', 'TreeNode'] as const).filter(name => usesNode(spec, name)).map(name => nodes[name]), ...(kind === null ? [] : [kinds[kind]])]
  return used.join('\n') + (used.length > 0 ? '\n' : '')
}
function sig(params: readonly HarnessParam[], format: (name: string, t: HarnessType) => string): string { return params.map(p => format(p.name, typeOf(p.type))).join(', ') }

/** Starter code shows complete type definitions so editor diagnostics stay accurate. */
export function starterCode(spec: ProblemInterface): Record<HarnessLanguage, string> {
  const pyHead = `from typing import List, Optional\n\n${nodeBlock(spec, pyNodes, pyNodeKinds)}`
  const cppHead = `#include <bits/stdc++.h>\nusing namespace std;\n\n${nodeBlock(spec, cppNodes, cppNodeKinds)}`
  const javaHead = `import java.util.*;\n\n${nodeBlock(spec, javaNodes, javaNodeKinds)}`
  const goHead = `package main\n\n${nodeBlock(spec, goNodes, goNodeKinds)}`
  const jsHead = nodeBlock(spec, jsNodes, jsNodeKinds)
  const goZero = (text: string): string => text === 'void' ? '' : `\n    ${{ int: 'return 0', long: 'return 0', double: 'return 0', bool: 'return false', string: 'return ""', char: 'return 0' }[(typeOf(text) as { name: string }).name] ?? 'return nil'}`
  const javaZero = (text: string): string => { if (text === 'void') return ''; const t = typeOf(text); return `\n        return ${t.tag === 'scalar' ? { int: '0', long: '0', double: '0', bool: 'false', string: '""', char: "' '" }[t.name] : 'null'};` }
  const cppZero = (text: string): string => text === 'void' ? '' : `\n        return {};`
  if (spec.kind === 'function') {
    const jsDoc = ['/**', ...spec.params.map(p => ` * @param {${jsType(typeOf(p.type))}} ${p.name}`), ` * @return {${spec.returns === 'void' ? 'void' : jsType(typeOf(spec.returns))}}`, ' */'].join('\n')
    return {
      python: `${pyHead}class Solution:\n    def ${spec.name}(self${spec.params.map(p => `, ${p.name}: ${pyType(typeOf(p.type))}`).join('')}) -> ${returnsOf(spec.returns, pyType, 'None')}:\n        pass\n`,
      javascript: `${jsHead}${jsDoc}\nvar ${spec.name} = function(${spec.params.map(p => p.name).join(', ')}) {\n\n};\n`,
      cpp: `${cppHead}class Solution {\npublic:\n    ${returnsOf(spec.returns, cppType, 'void')} ${spec.name}(${sig(spec.params, (n, t) => `${cppParam(t)} ${n}`)}) {${cppZero(spec.returns)}\n    }\n};\n`,
      java: `${javaHead}class Solution {\n    public ${returnsOf(spec.returns, javaType, 'void')} ${spec.name}(${sig(spec.params, (n, t) => `${javaType(t)} ${n}`)}) {${javaZero(spec.returns)}\n    }\n}\n`,
      go: `${goHead}func ${spec.name}(${sig(spec.params, (n, t) => `${n} ${goType(t)}`)})${spec.returns === 'void' ? '' : ' ' + goType(typeOf(spec.returns))} {${goZero(spec.returns)}\n}\n`,
    }
  }
  if (spec.kind === 'codec') return codecStarter(spec, { python: pyHead, javascript: jsHead, cpp: cppHead, java: javaHead, go: goHead }, { go: goZero, java: javaZero, cpp: cppZero })
  const c = spec.className
  return {
    python: `${pyHead}class ${c}:\n\n    def __init__(self${spec.constructorParams.map(p => `, ${p.name}: ${pyType(typeOf(p.type))}`).join('')}):\n        pass\n${spec.methods.map(m => `\n    def ${m.name}(self${m.params.map(p => `, ${p.name}: ${pyType(typeOf(p.type))}`).join('')}) -> ${returnsOf(m.returns, pyType, 'None')}:\n        pass\n`).join('')}`,
    javascript: `${jsHead}class ${c} {\n    constructor(${spec.constructorParams.map(p => p.name).join(', ')}) {\n\n    }\n${spec.methods.map(m => `\n    /**\n${m.params.map(p => `     * @param {${jsType(typeOf(p.type))}} ${p.name}\n`).join('')}     * @return {${m.returns === 'void' ? 'void' : jsType(typeOf(m.returns))}}\n     */\n    ${m.name}(${m.params.map(p => p.name).join(', ')}) {\n\n    }\n`).join('')}}\n`,
    cpp: `${cppHead}class ${c} {\npublic:\n    ${c}(${sig(spec.constructorParams, (n, t) => `${cppParam(t)} ${n}`)}) {\n\n    }\n${spec.methods.map(m => `\n    ${returnsOf(m.returns, cppType, 'void')} ${m.name}(${sig(m.params, (n, t) => `${cppParam(t)} ${n}`)}) {${cppZero(m.returns)}\n    }\n`).join('')}};\n`,
    java: `${javaHead}class ${c} {\n\n    public ${c}(${sig(spec.constructorParams, (n, t) => `${javaType(t)} ${n}`)}) {\n\n    }\n${spec.methods.map(m => `\n    public ${returnsOf(m.returns, javaType, 'void')} ${m.name}(${sig(m.params, (n, t) => `${javaType(t)} ${n}`)}) {${javaZero(m.returns)}\n    }\n`).join('')}}\n`,
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

export { typeOf, typeTexts, upperFirst, usesNode, nodeKindOf, tracksInputs, cppType, cppParam, javaType, goType }
