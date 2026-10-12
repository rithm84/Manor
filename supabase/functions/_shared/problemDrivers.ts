/** Hidden drivers for interpreted languages and program assembly for every harness language. */
import { jsNodeKinds, nodeKindOf, pyNodeKinds, type HarnessLanguage, type ProblemInterface } from './problemInterface.ts'
import { cppDriver, goDriver, javaDriver } from './problemCompiledDrivers.ts'
import { javascriptNodeCode, pythonNodeCode } from './problemNodeDrivers.ts'

// ---------- Drivers ----------
function typeLiteral(spec: ProblemInterface): string { return JSON.stringify(spec) }
function nodeFallback(spec: ProblemInterface, definitions: typeof pyNodeKinds): string { const kind = nodeKindOf(spec); return kind === null ? '' : definitions[kind] }
const nodeKindNames = "('RandomListNode', 'GraphNode', 'NaryNode', 'NextNode')"

/** The solution runs from its own compiled source so tracebacks and syntax errors cite the editor's lines; common modules are preloaded as on familiar judges. */
const pythonProgram = (source: string, spec: ProblemInterface): string => `import sys as __manor_sys, json as __manor_json, linecache as __manor_linecache
def __manor_setup():
    g = globals()
    for module in ('collections', 'heapq', 'bisect', 'math', 'itertools', 'functools', 're', 'string', 'random', 'operator'):
        g.setdefault(module, __import__(module))
    for module in ('typing', 'collections', 'heapq', 'bisect', 'math', 'itertools', 'functools'):
        loaded = __import__(module)
        for name in getattr(loaded, '__all__', [n for n in dir(loaded) if not n.startswith('_')]):
            if hasattr(loaded, name):
                g.setdefault(name, getattr(loaded, name))
__manor_setup()
class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next
class TreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right
${nodeFallback(spec, pyNodeKinds)}${pythonNodeCode}__manor_source = ${JSON.stringify(source)}
__manor_linecache.cache['solution.py'] = (len(__manor_source), None, __manor_source.splitlines(True), 'solution.py')
exec(compile(__manor_source, 'solution.py', 'exec'), globals())
def __manor_type(text):
    text = text.strip()
    if text.endswith('[]'): return ('seq', __manor_type(text[:-2]))
    if text.startswith('list<'): return ('seq', __manor_type(text[5:-1]))
    return (text,)
def __manor_decode(t, v):
    if t[0] == 'seq': return [__manor_decode(t[1], x) for x in v]
    if t[0] == 'double': return float(v)
    if t[0] in ${nodeKindNames}: return __manor_node_decode(t[0], v)
    if t[0] == 'ListNode':
        head = None
        for x in reversed(v): head = ListNode(x, head)
        return head
    if t[0] == 'TreeNode':
        if not v or v[0] is None: return None
        root = TreeNode(v[0]); queue = [root]; i = 1; k = 0
        while i < len(v):
            node = queue[k]; k += 1
            if v[i] is not None: node.left = TreeNode(v[i]); queue.append(node.left)
            i += 1
            if i < len(v) and v[i] is not None: node.right = TreeNode(v[i]); queue.append(node.right)
            i += 1
        return root
    return v
def __manor_encode(t, v):
    if t[0] == 'seq': return None if v is None else [__manor_encode(t[1], x) for x in v]
    if t[0] == 'double': return float(v)
    if t[0] in ('int', 'long'): return int(v)
    if t[0] == 'bool': return bool(v)
    if t[0] in ${nodeKindNames}: return __manor_node_encode(t[0], v)
    if t[0] == 'ListNode':
        out = []; seen = 0
        while v is not None:
            out.append(v.val); v = v.next; seen += 1
            if seen > 1000000: raise RuntimeError('Returned list does not terminate')
        return out
    if t[0] == 'TreeNode':
        out = []; queue = [v]; k = 0
        while k < len(queue):
            node = queue[k]; k += 1
            if node is None: out.append(None); continue
            out.append(node.val); queue.append(node.left); queue.append(node.right)
            if len(queue) > 2000000: raise RuntimeError('Returned tree is too large')
        while out and out[-1] is None: out.pop()
        return out
    return v
def __manor_json_text(value):
    return __manor_json.dumps(value, separators=(',', ':'), ensure_ascii=False, allow_nan=False)
def __manor_case(spec, lines):
    __manor_inputs.clear()
    if spec['kind'] == 'codec':
        encode, decode = spec['encode'], spec['decode']
        value = __manor_decode(__manor_type(encode['param']['type']), __manor_json.loads(lines[0]))
        ser = globals()[spec['className']]()
        deser = ser if spec['sharedInstance'] else globals()[spec['className']]()
        return __manor_encode(__manor_type(decode['returns']), getattr(deser, decode['name'])(getattr(ser, encode['name'])(value)))
    if spec['kind'] == 'function':
        params = spec['params']
        args = [__manor_decode(__manor_type(p['type']), __manor_json.loads(line)) for p, line in zip(params, lines)]
        result = getattr(Solution(), spec['name'])(*args)
        output = spec['output']
        if output['mode'] == 'return': return __manor_encode(__manor_type(spec['returns']), result)
        index = [p['name'] for p in params].index(output['param'])
        value = args[index] if output['mode'] == 'param' else args[index][:max(0, result)]
        return __manor_encode(__manor_type(params[index]['type']), value)
    ops = __manor_json.loads(lines[0]); calls = __manor_json.loads(lines[1])
    if len(ops) != len(calls) or not ops or ops[0] != spec['className']: raise ValueError('Operations must start with the class name and match the argument arrays')
    methods = {m['name']: m for m in spec['methods']}
    obj = globals()[spec['className']](*[__manor_decode(__manor_type(p['type']), a) for p, a in zip(spec['constructorParams'], calls[0])])
    out = [None]
    for op, call in zip(ops[1:], calls[1:]):
        m = methods.get(op)
        if m is None: raise ValueError('Unknown operation: ' + str(op))
        result = getattr(obj, op)(*[__manor_decode(__manor_type(p['type']), a) for p, a in zip(m['params'], call)])
        out.append(None if m['returns'] == 'void' else __manor_encode(__manor_type(m['returns']), result))
    return out
def __manor_main():
    import time, traceback
    spec = __manor_json.loads(${JSON.stringify(typeLiteral(spec))})
    width = len(spec['params']) if spec['kind'] == 'function' else 1 if spec['kind'] == 'codec' else 2
    lines = [line for line in __manor_sys.stdin.read().split('\\n') if line.strip() != '']
    if not lines or len(lines) % width != 0: raise ValueError('Each test case needs %d input lines, one JSON value per line; received %d lines' % (width, len(lines)))
    for index in range(len(lines) // width):
        started = time.perf_counter()
        try:
            text = __manor_json_text(__manor_case(spec, lines[index * width:(index + 1) * width]))
        except Exception:
            __manor_sys.stdout.flush(); error = __manor_sys.exc_info()[1]; frames = [f for f in traceback.extract_tb(error.__traceback__) if f.filename == 'solution.py']; __manor_sys.stderr.write(('Traceback (most recent call last):\\n' + ''.join(traceback.format_list(frames)) if frames else '') + ''.join(traceback.format_exception_only(type(error), error))); __manor_sys.stderr.flush()
            text = '!'
        __manor_sys.stdout.write('\\x1eMANOR %d %d %s\\n' % (index, round((time.perf_counter() - started) * 1000), text)); __manor_sys.stdout.flush()
__manor_main()
`

const javascriptDriver = (spec: ProblemInterface): string => `

;(() => {
  const __spec = ${typeLiteral(spec)};
  const __type = text => text.endsWith('[]') ? ['seq', __type(text.slice(0, -2))] : text.startsWith('list<') ? ['seq', __type(text.slice(5, -1))] : [text];
  const __nodeKinds = ['RandomListNode', 'GraphNode', 'NaryNode', 'NextNode'];${javascriptNodeCode}
  const __decode = (t, v) => {
    if (t[0] === 'seq') return v.map(x => __decode(t[1], x));
    if (__nodeKinds.includes(t[0])) return __nodeDecode(t[0], v);
    if (t[0] === 'ListNode') { let head = null; for (let i = v.length - 1; i >= 0; i--) head = new ListNode(v[i], head); return head; }
    if (t[0] === 'TreeNode') {
      if (v.length === 0 || v[0] === null) return null;
      const root = new TreeNode(v[0]); const queue = [root]; let i = 1, k = 0;
      while (i < v.length) {
        const node = queue[k++];
        if (v[i] !== null) { node.left = new TreeNode(v[i]); queue.push(node.left); } i++;
        if (i < v.length && v[i] !== null) { node.right = new TreeNode(v[i]); queue.push(node.right); } i++;
      }
      return root;
    }
    return v;
  };
  const __encode = (t, v) => {
    if (t[0] === 'seq') return v === null || v === undefined ? null : Array.from(v, x => __encode(t[1], x));
    if (t[0] === 'bool') return Boolean(v);
    if (__nodeKinds.includes(t[0])) return __nodeEncode(t[0], v);
    if (t[0] === 'ListNode') { const out = []; while (v !== null && v !== undefined) { out.push(v.val); v = v.next; if (out.length > 1000000) throw new Error('Returned list does not terminate'); } return out; }
    if (t[0] === 'TreeNode') {
      const out = []; const queue = [v]; let k = 0;
      while (k < queue.length) { const node = queue[k++]; if (node === null || node === undefined) { out.push(null); continue; } out.push(node.val); queue.push(node.left ?? null, node.right ?? null); }
      while (out.length > 0 && out[out.length - 1] === null) out.pop();
      return out;
    }
    if (v === undefined) return null;
    return v;
  };
  const runCase = lines => {
    __inputs.clear();
    if (__spec.kind === 'codec') {
      const value = __decode(__type(__spec.encode.param.type), JSON.parse(lines[0]));
      return __encode(__type(__spec.decode.returns), ${javascriptCodecCall(spec)});
    }
    if (__spec.kind === 'function') {
      const args = __spec.params.map((p, i) => __decode(__type(p.type), JSON.parse(lines[i])));
      const result = ${spec.kind === 'function' ? spec.name : 'null'}(...args);
      const output = __spec.output;
      if (output.mode === 'return') return __encode(__type(__spec.returns), result);
      const index = __spec.params.findIndex(p => p.name === output.param);
      return __encode(__type(__spec.params[index].type), output.mode === 'param' ? args[index] : args[index].slice(0, Math.max(0, result)));
    }
    const ops = JSON.parse(lines[0]); const calls = JSON.parse(lines[1]);
    if (ops.length !== calls.length || ops.length === 0 || ops[0] !== __spec.className) throw new Error('Operations must start with the class name and match the argument arrays');
    const methods = new Map(__spec.methods.map(m => [m.name, m]));
    const obj = new ${spec.kind === 'class' ? spec.className : 'Object'}(...__spec.constructorParams.map((p, i) => __decode(__type(p.type), calls[0][i])));
    const out = [null];
    for (let i = 1; i < ops.length; i++) {
      const m = methods.get(ops[i]);
      if (m === undefined) throw new Error('Unknown operation: ' + ops[i]);
      const result = obj[m.name](...m.params.map((p, j) => __decode(__type(p.type), calls[i][j])));
      out.push(m.returns === 'void' ? null : __encode(__type(m.returns), result));
    }
    return out;
  };
  const width = __spec.kind === 'function' ? __spec.params.length : __spec.kind === 'codec' ? 1 : 2;
  const lines = require('fs').readFileSync(0, 'utf8').split('\\n').filter(line => line.trim() !== '');
  if (lines.length === 0 || lines.length % width !== 0) throw new Error(\`Each test case needs \${width} input lines, one JSON value per line; received \${lines.length} lines\`);
  const write = text => require('fs').writeSync(1, text);
  for (let index = 0; index < lines.length / width; index++) {
    const started = performance.now();
    let text;
    try { text = JSON.stringify(runCase(lines.slice(index * width, (index + 1) * width))); if (text === undefined) text = 'null'; }
    catch (error) { const stack = error && error.stack ? String(error.stack).split('\\n') : [String(error)]; const cut = stack.findIndex(line => line.includes('at runCase')); process.stderr.write((cut > 0 ? stack.slice(0, cut) : stack).join('\\n') + '\\n'); text = '!'; }
    write('\\x1eMANOR ' + index + ' ' + Math.round(performance.now() - started) + ' ' + text + '\\n');
  }
})();
`

/** LeetCode's JavaScript codecs are two top-level functions; a solution that defines the codec class instead is called through instances. */
function javascriptCodecCall(spec: ProblemInterface): string {
  if (spec.kind !== 'codec') return 'null'
  const { className: c, encode: e, decode: d } = spec
  return `typeof ${c} === 'function' ? (() => { const ser = new ${c}(); const deser = ${spec.sharedInstance ? 'ser' : `new ${c}()`}; return deser.${d.name}(ser.${e.name}(value)); })() : ${d.name}(${e.name}(value))`
}

/** Familiar node constructors live on the global object, so a solution's own declarations shadow them; appended after the solution so reported line numbers match the editor. */
const javascriptPrelude = 'globalThis.ListNode = function ListNode(val, next) { this.val = val === undefined ? 0 : val; this.next = next === undefined ? null : next; }; globalThis.TreeNode = function TreeNode(val, left, right) { this.val = val === undefined ? 0 : val; this.left = left === undefined ? null : left; this.right = right === undefined ? null : right; };'
/** LeetCode names the JavaScript class `_Node`; both names resolve to it unless the solution declares its own. */
function javascriptNodePrelude(spec: ProblemInterface): string {
  const definition = nodeFallback(spec, jsNodeKinds)
  return definition === '' ? '' : `\nglobalThis.Node = globalThis._Node = (() => {\n${definition}return _Node;\n})();`
}

/** Leading code that the driver needs before the solution; kept on the first line where the language allows it so reported line numbers match the editor. */
export function assembleProgram(language: HarnessLanguage, source: string, spec: ProblemInterface): string {
  if (language === 'python') return pythonProgram(source, spec)
  if (language === 'javascript') return source + '\n' + javascriptPrelude + javascriptNodePrelude(spec) + javascriptDriver(spec)
  if (language === 'cpp') return '#include <bits/stdc++.h>\nusing namespace std;\n#line 1\n' + source + cppDriver(spec)
  if (language === 'java') return 'import java.util.*;import java.util.function.*;import java.util.stream.*;' + source.replace(new RegExp(`\\bpublic(\\s+(?:final\\s+)?class\\s+${spec.kind === 'codec' ? `(?:Solution|${spec.className})` : 'Solution'}\\b)`), '$1') + javaDriver(spec)
  const prelude = 'package main; import (__manor_json "encoding/json"; __manor_bufio "bufio"; __manor_os "os"; __manor_reflect "reflect"; __manor_strings "strings"; __manor_strconv "strconv"; __manor_time "time")'
  const packageLine = /^\s*package\s+main\s*;?[ \t]*(\r?\n|$)/
  return (packageLine.test(source) ? source.replace(packageLine, prelude + '$1') : prelude + '\n' + source) + goDriver(spec)
}

export interface DriverCaseOutput { readonly index: number; readonly durationMs: number; readonly output: string | null; readonly stdout: string }
const marker = '\u001eMANOR '

/** Splits batched driver output into per-case answers; text before a case's marker is that case's own printed output. A missing marker means the process stopped before finishing that case. */
export function parseDriverOutput(stdout: string): DriverCaseOutput[] {
  const cases: DriverCaseOutput[] = []
  let rest = stdout
  while (true) {
    const at = rest.indexOf(marker)
    if (at < 0) break
    const end = rest.indexOf('\n', at)
    const line = rest.slice(at + marker.length, end < 0 ? undefined : end)
    const match = /^(\d+) (\d+) (.*)$/s.exec(line)
    if (match === null) throw new Error('Driver produced a malformed result marker')
    const index = Number(match[1])
    if (index !== cases.length) throw new Error('Driver results arrived out of order')
    cases.push({ index, durationMs: Number(match[2]), output: match[3] === '!' ? null : match[3], stdout: rest.slice(0, at) })
    rest = end < 0 ? '' : rest.slice(end + 1)
  }
  return cases
}
/** Output printed after the last finished case belongs to the case that was running when the process stopped. */
export function trailingDriverOutput(stdout: string): string {
  const at = stdout.lastIndexOf(marker)
  if (at < 0) return stdout
  const end = stdout.indexOf('\n', at)
  return end < 0 ? '' : stdout.slice(end + 1)
}
