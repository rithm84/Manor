/** The JavaScript driver: appended after the solution so reported line numbers match the editor. */
import { jsNodeKinds, nodeKindOf, type ProblemInterface } from './problemInterface.ts'
import { javascriptNodeCode } from './problemNodeDrivers.ts'
import { driverMeta } from './problemDriverMeta.ts'
import { generatedKinds, isRecordKind, nodeDefinitions, recordDefinitions } from './problemKinds.ts'
import { nestedImplementations } from './problemProvided.ts'
import { interactorProgram } from './problemInteractor.ts'

/** LeetCode's JavaScript codecs are two top-level functions; a solution that defines the codec class instead is called through instances. */
function javascriptCodecCall(spec: ProblemInterface): string {
  if (spec.kind !== 'codec') return 'null'
  const { className: c, encode: e, decode: d } = spec
  return `typeof ${c} === 'function' ? (() => { const ser = new ${c}(); const deser = ${spec.sharedInstance ? 'ser' : `new ${c}()`}; return deser.${d.name}(ser.${e.name}(value)); })() : ${d.name}(${e.name}(value))`
}

/** Familiar node constructors live on the global object, so a solution's own declarations shadow them. */
const javascriptPrelude = 'globalThis.ListNode = function ListNode(val, next) { this.val = val === undefined ? 0 : val; this.next = next === undefined ? null : next; }; globalThis.TreeNode = function TreeNode(val, left, right) { this.val = val === undefined ? 0 : val; this.left = left === undefined ? null : left; this.right = right === undefined ? null : right; };'

/** Fallback classes for the provided and Node types; LeetCode names the JavaScript `Node` class `_Node`, and both names resolve to it. */
function javascriptFallbacks(spec: ProblemInterface): string {
  const meta = driverMeta(spec)
  const kind = nodeKindOf(spec)
  const parts: string[] = []
  const define = (name: string, definition: string): void => { parts.push(`\nglobalThis.${name === '_Node' ? 'Node = globalThis._Node' : name} = (() => {\n${definition}return ${name};\n})();`) }
  if (!meta.table && kind !== null) define('_Node', jsNodeKinds[kind])
  for (const [k, info] of Object.entries(meta.kinds)) {
    if (k === 'ListNode' || k === 'TreeNode') continue
    define(info.js, k === 'NaryNode' ? jsNodeKinds.NaryNode : nodeDefinitions(k as typeof generatedKinds[number]).javascript)
  }
  for (const r of Object.keys(meta.records).filter(isRecordKind)) define(r, recordDefinitions(r).javascript)
  if (meta.nested) define('NestedInteger', nestedImplementations.javascript)
  if (spec.kind !== 'codec') for (const api of spec.apis ?? []) {
    if (api.global) for (const m of api.methods) parts.push(`\nglobalThis.${m.name} = function(${m.params.map(p => p.name).join(', ')}) { return globalThis.__manorApi(null, ${JSON.stringify(api.name)}, ${JSON.stringify(m.name)}, [${m.params.map(p => p.name).join(', ')}]); };`)
    else parts.push(`\nglobalThis.${api.name} = class ${api.name} { constructor(handle) { Object.defineProperty(this, '__manorHandle', { value: handle }); }${api.methods.map(m => ` ${m.name}(${m.params.map(p => p.name).join(', ')}) { return globalThis.__manorApi(this.__manorHandle, ${JSON.stringify(api.name)}, ${JSON.stringify(m.name)}, [${m.params.map(p => p.name).join(', ')}]); }`).join('')} };`)
  }
  return parts.join('')
}

/** Resolves each class the driver builds: the solution's own declaration when it has one, else the global fallback. */
function classLookup(spec: ProblemInterface): string {
  const meta = driverMeta(spec)
  const entries = [...Object.entries(meta.kinds).map(([kind, info]) => [kind, info.js]), ...Object.keys(meta.records).map(r => [r, r])]
  return `{ ${entries.map(([key, name]) => `${JSON.stringify(key)}: () => (typeof ${name} === 'function' ? ${name} : globalThis.${name})`).join(', ')} }`
}

function interactorClient(spec: ProblemInterface): string {
  if (spec.kind === 'codec' || !spec.apis?.length) return '  const __ix = null;\n'
  return `  const __ix = (() => {
    const fs = require('fs'), cp = require('child_process'), os = require('os'), path = require('path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manor-'));
    const into = path.join(dir, 'in'), from = path.join(dir, 'out');
    cp.execFileSync('mkfifo', [into, from]);
    const child = cp.spawn('python3', ['-I', '-c', ${JSON.stringify(interactorProgram(spec.interactor ?? ''))}, into, from], { stdio: ['ignore', 'ignore', 'inherit'] });
    child.unref();
    const write = fs.openSync(into, 'w'), read = fs.openSync(from, 'r');
    fs.rmSync(dir, { recursive: true, force: true });
    let pending = Buffer.alloc(0); const chunk = Buffer.alloc(65536);
    const send = message => {
      fs.writeSync(write, JSON.stringify(message) + '\\n');
      let end;
      while ((end = pending.indexOf(10)) < 0) { const n = fs.readSync(read, chunk, 0, chunk.length, null); if (n === 0) throw new Error('The interactor stopped'); pending = Buffer.concat([pending, chunk.subarray(0, n)]); }
      const line = pending.subarray(0, end).toString('utf8'); pending = pending.subarray(end + 1);
      return JSON.parse(line);
    };
    return { send, close: () => fs.closeSync(write) };
  })();
  let __aborted = null;
  globalThis.__manorApi = (handle, api, method, args) => {
    const [params, returns] = __apis[api][method];
    if (__aborted !== null) throw { __manorAbort: __aborted };
    const reply = __ix.send(['call', handle, method, args.map((a, i) => params[i] === 'buffer' ? null : __encode(__type(params[i]), a))]);
    if (!Array.isArray(reply)) { __aborted = reply; throw { __manorAbort: __aborted }; }
    if (reply.length > 1) for (const [index, text] of reply[1]) Array.from(text).forEach((ch, i) => { args[index][i] = ch; });
    if (returns === 'void') return undefined;
    if (Object.hasOwn(__apis, returns)) return reply[0] === null ? null : new globalThis[returns](reply[0]);
    return __decode(__type(returns), reply[0]);
  };
`
}

export function javascriptDriver(spec: ProblemInterface): string {
  const meta = driverMeta(spec)
  const apis = spec.kind === 'codec' ? [] : spec.apis ?? []
  const apiTable = Object.fromEntries(apis.map(api => [api.name, Object.fromEntries(api.methods.map(m => [m.name, [m.params.map(p => p.type), m.returns]]))]))
  return `

;(() => {
  const __spec = ${JSON.stringify(spec)};
  const __meta = ${JSON.stringify(meta)};
  const __apis = ${JSON.stringify(apiTable)};
  const __classes = ${classLookup(spec)};
  const __type = text => text.endsWith('[]') ? ['seq', __type(text.slice(0, -2))] : text.startsWith('list<') ? ['seq', __type(text.slice(5, -1))] : [text];
  const __nodeKinds = ['RandomListNode', 'GraphNode', 'NaryNode', 'NextNode'];${javascriptNodeCode}
  let __nodes = [], __in = new Map(), __out = [], __outIndex = new Map();
  const __loadTable = rows => {
    __nodes = rows.map(row => { const info = __meta.kinds[row[0]]; const node = Object.create(__classes[row[0]]().prototype); info.values.forEach(([name], i) => { node[name] = row[1 + i]; }); return node; });
    __in = new Map(__nodes.map((node, i) => [node, i]));
    rows.forEach((row, i) => { const info = __meta.kinds[row[0]]; let at = 1 + info.values.length; for (const name of info.links) { __nodes[i][name] = row[at] === null ? null : __nodes[row[at]]; at++; } for (const name of info.lists) { __nodes[i][name] = row[at].map(j => __nodes[j]); at++; } });
  };
  const __outNode = (kind, v) => {
    if (v === null || v === undefined) return null;
    if (__outIndex.has(v)) return __outIndex.get(v);
    const info = __meta.kinds[kind]; const queue = [v]; __outIndex.set(v, __out.length); __out.push(null);
    for (let k = 0; k < queue.length; k++) {
      const node = queue[k];
      for (const x of [...info.links.map(name => node[name] ?? null), ...info.lists.flatMap(name => node[name] ?? [])]) if (x !== null && !__outIndex.has(x)) { if (__out.length >= 1000000) throw new Error('Returned structure is too large'); __outIndex.set(x, __out.length); __out.push(null); queue.push(x); }
    }
    for (const node of queue) __out[__outIndex.get(node)] = [kind, __in.has(node) ? __in.get(node) : null, ...info.values.map(([name, t]) => t === 'bool' ? Boolean(node[name]) : t === 'int' ? Number(node[name]) : String(node[name])), ...info.links.map(name => (node[name] ?? null) === null ? null : __outIndex.get(node[name])), ...info.lists.map(name => (node[name] ?? []).map(c => __outIndex.get(c)))];
    return __outIndex.get(v);
  };
  const __decode = (t, v) => {
    if (t[0] === 'seq') return v.map(x => __decode(t[1], x));
    if (Object.hasOwn(__meta.kinds, t[0])) return v === null ? null : __nodes[v];
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
    if (Object.hasOwn(__meta.records, t[0])) { const obj = Object.create(__classes[t[0]]().prototype); __meta.records[t[0]].forEach(([name], i) => { obj[name] = Array.isArray(v[i]) ? [...v[i]] : v[i]; }); return obj; }
    if (t[0] === 'NestedInteger') { if (!Array.isArray(v)) return new NestedInteger(v); const item = new NestedInteger(); for (const x of v) item.add(__decode(t, x)); return item; }
    if (t[0] === 'buffer') return new Array(v).fill('');
    if (__spec.kind === 'class' && t[0] === __spec.className) return new ${spec.kind === 'class' ? spec.className : 'Object'}(...__spec.constructorParams.map((p, i) => __decode(__type(p.type), v[i])));
    return v;
  };
  const __encode = (t, v) => {
    if (t[0] === 'seq') return v === null || v === undefined ? null : Array.from(v, x => __encode(t[1], x));
    if (t[0] === 'bool') return Boolean(v);
    if (Object.hasOwn(__meta.kinds, t[0])) return __outNode(t[0], v);
    if (__nodeKinds.includes(t[0])) return __nodeEncode(t[0], v);
    if (t[0] === 'ListNode') { const out = []; while (v !== null && v !== undefined) { out.push(v.val); v = v.next; if (out.length > 1000000) throw new Error('Returned list does not terminate'); } return out; }
    if (t[0] === 'TreeNode') {
      const out = []; const queue = [v]; let k = 0;
      while (k < queue.length) { const node = queue[k++]; if (node === null || node === undefined) { out.push(null); continue; } out.push(node.val); queue.push(node.left ?? null, node.right ?? null); }
      while (out.length > 0 && out[out.length - 1] === null) out.pop();
      return out;
    }
    if (Object.hasOwn(__meta.records, t[0])) return v === null || v === undefined ? null : __meta.records[t[0]].map(([name, kind]) => kind === 'int' ? Number(v[name]) : Array.from(v[name]));
    if (t[0] === 'NestedInteger') return v === null || v === undefined ? null : v.isInteger() ? v.getInteger() : (v.getList() ?? []).map(x => __encode(t, x));
    if (v === undefined) return null;
    return v;
  };
${interactorClient(spec)}  const __wrap = value => __meta.wrap ? { n: __out, v: value } : value;
  const __answer = values => {
    if (__spec.kind === 'codec') {
      const value = __decode(__type(__spec.encode.param.type), values.__value);
      return __encode(__type(__spec.decode.returns), ${javascriptCodecCall(spec)});
    }
    if (__spec.kind === 'function') {
      const args = __spec.params.map(p => Object.hasOwn(__apis, p.type) ? new globalThis[p.type](p.name) : __decode(__type(p.type), values[p.name]));
      const result = ${spec.kind === 'function' ? spec.name : 'null'}(...args);
      const output = __spec.output;
      if (output.mode === 'return') return __spec.returns === 'void' ? null : __wrap(__encode(__type(__spec.returns), result));
      const index = __spec.params.findIndex(p => p.name === output.param);
      if (__spec.params[index].type === 'buffer') return args[index].slice(0, Math.max(0, result)).join('');
      return __wrap(__encode(__type(__spec.params[index].type), output.mode === 'param' ? args[index] : args[index].slice(0, Math.max(0, result))));
    }
    const ops = values.__ops; const calls = values.__calls;
    if (ops.length !== calls.length || ops.length === 0 || ops[0] !== __spec.className) throw new Error('Operations must start with the class name and match the argument arrays');
    const methods = new Map(__spec.methods.map(m => [m.name, m]));
    const obj = new ${spec.kind === 'class' ? spec.className : 'Object'}(...__spec.constructorParams.map((p, i) => __decode(__type(p.type), calls[0][i])));
    const out = [null];
    for (let i = 1; i < ops.length; i++) {
      const m = methods.get(ops[i]);
      if (m === undefined) throw new Error('Unknown operation: ' + ops[i]);
      const args = m.params.map((p, j) => __decode(__type(p.type), calls[i][j]));
      const result = obj[m.name](...args);
      if (m.output) { const index = m.params.findIndex(p => p.name === m.output.param); out.push(args[index].slice(0, Math.max(0, result)).join('')); }
      else out.push(m.returns === 'void' ? null : __encode(__type(m.returns), result));
    }
    return out;
  };
  const runCase = lines => {
    __inputs.clear(); __out = []; __outIndex = new Map();
    if (__meta.table) { __loadTable(JSON.parse(lines[0])); lines = lines.slice(1); }
    const values = Object.fromEntries(__meta.inputs.map((name, i) => [name, JSON.parse(lines[i])]));
    if (!__meta.interactive) return __answer(values);
    __aborted = null; __ix.send(['case', values]);
    let answer;
    try { answer = __answer(values); }
    catch (error) { if (error && typeof error === 'object' && '__manorAbort' in error) return error.__manorAbort; throw error; }
    return __ix.send(['end', answer])[0];
  };
  const width = __meta.width;
  const lines = require('fs').readFileSync(0, 'utf8').split('\\n').filter(line => line.trim() !== '');
  if (lines.length === 0 || lines.length % width !== 0) throw new Error(\`Each test case needs \${width} input lines, one JSON value per line; received \${lines.length} lines\`);
  const write = text => require('fs').writeSync(1, text);
  for (let index = 0; index < lines.length / width; index++) {
    const started = performance.now();
    let text;
    try { text = JSON.stringify(runCase(lines.slice(index * width, (index + 1) * width))); if (text === undefined) text = 'null'; }
    catch (error) { const stack = error && error.stack ? String(error.stack).split('\\n') : [String(error)]; const cut = stack.findIndex(line => line.includes('at runCase') || line.includes('at __answer')); process.stderr.write((cut > 0 ? stack.slice(0, cut) : stack).join('\\n') + '\\n'); text = '!'; }
    write('\\x1eMANOR ' + index + ' ' + Math.round(performance.now() - started) + ' ' + text + '\\n');
  }
  write('\\x1eMANOR-PEAK ' + process.resourceUsage().maxRSS + '\\n');
  if (__ix !== null) __ix.close();
})();
`
}

export function javascriptProgram(source: string, spec: ProblemInterface): string {
  return source + '\n' + javascriptPrelude + javascriptFallbacks(spec) + javascriptDriver(spec)
}
