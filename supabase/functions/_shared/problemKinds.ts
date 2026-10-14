/**
 * Registries for the interface types beyond plain values: node kinds that travel as a node table, record classes that
 * travel as JSON arrays of their fields, and the class definitions starter code shows for each. Pure module with no
 * imports so every other harness module can share it.
 *
 * Table node kinds are decoded from one shared table line per case (see problemShapes.ts), so each language needs only
 * one generic decoder and encoder driven by these schemas. Every kind links only to nodes of its own kind.
 */
export type FieldScalar = 'int' | 'bool' | 'char' | 'string'
export interface NodeSchema {
  /** The class name in solutions; several kinds share LeetCode's `Node`, so an interface uses at most one of those. */
  readonly className: string
  /** JavaScript names LeetCode's `Node` classes `_Node`. */
  readonly jsName: string
  readonly values: readonly (readonly [string, FieldScalar])[]
  readonly links: readonly string[]
  readonly lists: readonly string[]
  /** The friendly JSON format a value of this kind reads and prints in, unless a parameter names another. */
  readonly shape: string
  /** Go field names stay lower case, as LeetCode's Go definition writes them. */
  readonly goLower?: boolean
}
const node = (values: NodeSchema['values'], links: readonly string[], shape: string): NodeSchema => ({ className: 'Node', jsName: '_Node', values, links, lists: [], shape })
const val: NodeSchema['values'] = [['val', 'int']]
export const nodeSchemas = {
  ListNode: { className: 'ListNode', jsName: 'ListNode', values: val, links: ['next'], lists: [], shape: 'list' },
  TreeNode: { className: 'TreeNode', jsName: 'TreeNode', values: val, links: ['left', 'right'], lists: [], shape: 'tree' },
  NaryNode: { className: 'Node', jsName: '_Node', values: val, links: [], lists: ['children'], shape: 'nary' },
  SinglyListNode: node(val, ['next'], 'list'),
  DoublyListNode: node(val, ['prev', 'next'], 'list'),
  MultilevelNode: node(val, ['prev', 'next', 'child'], 'multilevel'),
  BiNode: node(val, ['left', 'right'], 'tree'),
  ParentNode: node(val, ['left', 'right', 'parent'], 'tree'),
  QuadNode: node([['val', 'bool'], ['isLeaf', 'bool']], ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'], 'quad'),
  RandomTreeNode: node(val, ['left', 'right', 'random'], 'randomTree'),
  NodeCopy: { className: 'NodeCopy', jsName: 'NodeCopy', values: val, links: ['left', 'right', 'random'], lists: [], shape: 'randomTree' },
  ExprNode: node([['val', 'char']], ['left', 'right'], 'tree'),
  RopeTreeNode: { className: 'RopeTreeNode', jsName: 'RopeTreeNode', values: [['len', 'int'], ['val', 'string']], links: ['left', 'right'], lists: [], shape: 'rope', goLower: true },
} as const satisfies Record<string, NodeSchema>
export type TableKind = keyof typeof nodeSchemas
export const tableKinds = Object.keys(nodeSchemas) as TableKind[]
/** Kinds whose class definitions this module generates; ListNode, TreeNode, and NaryNode keep their existing definitions. */
export const generatedKinds = tableKinds.filter(kind => !['ListNode', 'TreeNode', 'NaryNode'].includes(kind))
export function isTableKind(name: string): name is TableKind { return Object.hasOwn(nodeSchemas, name) }
export function schemaOf(kind: TableKind): NodeSchema { return nodeSchemas[kind] }

export type RecordField = readonly [string, 'int' | 'list<int>']
export interface RecordSchema { readonly fields: readonly RecordField[]; readonly cppPointer: boolean }
/** Record classes: `Employee` prints as `[id, importance, [subordinates]]` and `Interval` as `[start, end]`. */
export const recordSchemas = {
  Employee: { fields: [['id', 'int'], ['importance', 'int'], ['subordinates', 'list<int>']], cppPointer: true },
  Interval: { fields: [['start', 'int'], ['end', 'int']], cppPointer: false },
} as const satisfies Record<string, RecordSchema>
export type RecordKind = keyof typeof recordSchemas
export function isRecordKind(name: string): name is RecordKind { return Object.hasOwn(recordSchemas, name) }

export function goField(name: string, lower = false): string { return lower ? name : name[0].toUpperCase() + name.slice(1) }
const zero = { int: '0', bool: 'false', char: "' '", string: '""' } as const
const pyZero = { int: '0', bool: 'False', char: "' '", string: "''" } as const
const scalarType = {
  python: { int: 'int', bool: 'bool', char: 'str', string: 'str' }, cpp: { int: 'int', bool: 'bool', char: 'char', string: 'string' },
  java: { int: 'int', bool: 'boolean', char: 'char', string: 'String' }, go: { int: 'int', bool: 'bool', char: 'byte', string: 'string' },
} as const

/** LeetCode-style class definitions for a generated node kind, with a no-argument constructor the drivers use. */
export function nodeDefinitions(kind: TableKind): { python: string; javascript: string; cpp: string; java: string; go: string } {
  const s = schemaOf(kind); const c = s.className; const v = s.values
  const pointers = [...s.links]
  const pyArgs = [...v.map(([n, t]) => `${n}: ${scalarType.python[t]} = ${pyZero[t]}`), ...pointers.map(n => `${n}: 'Optional[${c}]' = None`)].join(', ')
  const cppInit = (values: string[]): string => [...v.map(([n], i) => `${n}(${values[i]})`), ...pointers.map(n => `${n}(nullptr)`)].join(', ')
  const cppValues = v.map(([n, t]) => `${scalarType.cpp[t]} _${n}`).join(', ')
  return {
    python: `class ${c}:\n    def __init__(self, ${pyArgs}):\n${[...v.map(([n]) => n), ...pointers].map(n => `        self.${n} = ${n}\n`).join('')}`,
    javascript: `function ${s.jsName}(${[...v.map(([n]) => n), ...pointers].join(', ')}) {\n${v.map(([n, t]) => `    this.${n} = ${n} === undefined ? ${t === 'bool' ? 'false' : t === 'int' ? '0' : zero[t]} : ${n};\n`).join('')}${pointers.map(n => `    this.${n} = ${n} === undefined ? null : ${n};\n`).join('')}}\n`,
    cpp: `class ${c} {\npublic:\n${v.map(([n, t]) => `    ${scalarType.cpp[t]} ${n};\n`).join('')}${pointers.map(n => `    ${c}* ${n};\n`).join('')}\n    ${c}() : ${cppInit(v.map(([, t]) => zero[t]))} {}\n    ${c}(${cppValues}) : ${cppInit(v.map(([n]) => `_${n}`))} {}\n};\n`,
    java: `class ${c} {\n${v.map(([n, t]) => `    public ${scalarType.java[t]} ${n};\n`).join('')}${pointers.map(n => `    public ${c} ${n};\n`).join('')}\n    public ${c}() {}\n\n    public ${c}(${v.map(([n, t]) => `${scalarType.java[t]} _${n}`).join(', ')}) {\n${v.map(([n]) => `        ${n} = _${n};\n`).join('')}    }\n}\n`,
    go: `type ${c} struct {\n${v.map(([n, t]) => `    ${goField(n, s.goLower)} ${scalarType.go[t]}\n`).join('')}${pointers.map(n => `    ${goField(n, s.goLower)} *${c}\n`).join('')}}\n`,
  }
}

/** Class definitions for a record kind, as LeetCode's definitions write them, plus a no-argument constructor. */
export function recordDefinitions(kind: RecordKind): { python: string; javascript: string; cpp: string; java: string; go: string } {
  const f = recordSchemas[kind].fields
  const types = { python: { int: 'int', 'list<int>': 'List[int]' }, cpp: { int: 'int', 'list<int>': 'vector<int>' }, java: { int: 'int', 'list<int>': 'List<Integer>' }, go: { int: 'int', 'list<int>': '[]int' } } as const
  return {
    python: `class ${kind}:\n    def __init__(self, ${f.map(([n, t]) => `${n}: ${types.python[t]} = None`).join(', ')}):\n${f.map(([n]) => `        self.${n} = ${n}\n`).join('')}`,
    javascript: `function ${kind}(${f.map(([n]) => n).join(', ')}) {\n${f.map(([n]) => `    this.${n} = ${n};\n`).join('')}}\n`,
    cpp: `class ${kind} {\npublic:\n${f.map(([n, t]) => `    ${types.cpp[t]} ${n};\n`).join('')}\n    ${kind}() {}\n    ${kind}(${f.map(([n, t]) => `${types.cpp[t]} _${n}`).join(', ')}) : ${f.map(([n]) => `${n}(_${n})`).join(', ')} {}\n};\n`,
    java: `class ${kind} {\n${f.map(([n, t]) => `    public ${types.java[t]} ${n};\n`).join('')}\n    public ${kind}() {}\n\n    public ${kind}(${f.map(([n, t]) => `${types.java[t]} _${n}`).join(', ')}) {\n${f.map(([n]) => `        ${n} = _${n};\n`).join('')}    }\n}\n`,
    go: `type ${kind} struct {\n${f.map(([n, t]) => `    ${goField(n)} ${types.go[t]}\n`).join('')}}\n`,
  }
}
