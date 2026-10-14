/** The Python program: the solution runs from its own compiled source so tracebacks and syntax errors cite the editor's lines, and common modules are preloaded as on familiar judges. */
import { nodeKindOf, pyNodeKinds, type ProblemInterface } from './problemInterface.ts'
import { pythonNodeCode } from './problemNodeDrivers.ts'
import { driverMeta } from './problemDriverMeta.ts'
import { generatedKinds, isRecordKind, nodeDefinitions, recordDefinitions } from './problemKinds.ts'
import { nestedImplementations } from './problemProvided.ts'
import { interactorRuntime } from './problemInteractor.ts'

const nodeKindNames = "('RandomListNode', 'GraphNode', 'NaryNode', 'NextNode')"

/** Fallback definitions, so a solution that omits a provided class still runs; the solution's own definitions replace them. */
function fallbacks(spec: ProblemInterface): string {
  const meta = driverMeta(spec)
  const kind = nodeKindOf(spec)
  const parts = [kind === null || meta.table ? '' : pyNodeKinds[kind]]
  if (meta.table && Object.hasOwn(meta.kinds, 'NaryNode')) parts.push(pyNodeKinds.NaryNode)
  parts.push(...generatedKinds.filter(k => Object.hasOwn(meta.kinds, k)).map(k => nodeDefinitions(k).python))
  parts.push(...Object.keys(meta.records).filter(isRecordKind).map(r => recordDefinitions(r).python))
  if (meta.nested) parts.push(nestedImplementations.python)
  return parts.join('')
}

/** API stubs and the in-process interactor; a global API's methods become module functions. */
function apiCode(spec: ProblemInterface): string {
  if (spec.kind === 'codec' || !spec.apis?.length) return ''
  const stubs = spec.apis.map(api => api.global
    ? api.methods.map(m => `def ${m.name}(${m.params.map(p => p.name).join(', ')}):\n    return __manor_api(None, ${JSON.stringify(api.name)}, ${JSON.stringify(m.name)}, [${m.params.map(p => p.name).join(', ')}])\n`).join('')
    : `class ${api.name}:\n    def __init__(self, handle): self.__manor_handle = handle\n${api.methods.map(m => `    def ${m.name}(self${m.params.map(p => `, ${p.name}`).join('')}):\n        return globals()['__manor_api'](self.__manor_handle, ${JSON.stringify(api.name)}, ${JSON.stringify(m.name)}, [${m.params.map(p => p.name).join(', ')}])\n`).join('')}`).join('')
  return `__manor_ix = {'__name__': '__manor_interactor'}
exec(compile(${JSON.stringify(interactorRuntime + spec.interactor)}, 'interactor.py', 'exec'), __manor_ix)
__manor_ix_lock = __manor_threading.RLock()
__manor_ix_aborted = [None]
def __manor_api(handle, api, method, args):
    spec = __manor_apis[api][method]
    with __manor_ix_lock:
        if __manor_ix_aborted[0] is not None: raise __ManorAbort(__manor_ix_aborted[0])
        sent = __manor_json.loads(__manor_json.dumps([None if t == 'buffer' else __manor_encode(__manor_type(t), a) for t, a in zip(spec[0], args)]))
        try:
            reply = __manor_ix['call'](handle, method, sent)
        except __manor_ix['Abort'] as error:
            __manor_ix_aborted[0] = error.message
            raise __ManorAbort(error.message)
        value, writes = (reply.value, reply.writes) if isinstance(reply, __manor_ix['Reply']) else (reply, {})
        value = __manor_json.loads(__manor_json.dumps(value))
    for index, text in writes.items():
        buffer = args[int(index)]
        for i, ch in enumerate(text): buffer[i] = ch
    if spec[1] == 'void': return None
    if spec[1] in __manor_apis and not __manor_global_api(spec[1]): return None if value is None else globals()[spec[1]](value)
    return __manor_decode(__manor_type(spec[1]), value)
def __manor_global_api(name):
    return __manor_api_global.get(name, False)
def __manor_ix_start(values):
    __manor_ix_aborted[0] = None
    __manor_ix['start'](__manor_json.loads(__manor_json.dumps(values)))
def __manor_ix_finish(answer):
    finish = __manor_ix.get('finish')
    return __manor_json.loads(__manor_json.dumps(answer if finish is None else finish(answer)))
${stubs}`
}

export function pythonProgram(source: string, spec: ProblemInterface): string {
  const meta = driverMeta(spec)
  const apis = spec.kind === 'codec' ? [] : spec.apis ?? []
  const apiTable = Object.fromEntries(apis.map(api => [api.name, Object.fromEntries(api.methods.map(m => [m.name, [m.params.map(p => p.type), m.returns]]))]))
  return `import sys as __manor_sys, json as __manor_json, linecache as __manor_linecache, threading as __manor_threading, time as __manor_time
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
${fallbacks(spec)}${pythonNodeCode}class __ManorAbort(BaseException):
    pass
__manor_meta = __manor_json.loads(${JSON.stringify(JSON.stringify(meta))})
__manor_apis = __manor_json.loads(${JSON.stringify(JSON.stringify(apiTable))})
__manor_api_global = {${apis.map(api => `${JSON.stringify(api.name)}: ${api.global ? 'True' : 'False'}`).join(', ')}}
${apiCode(spec)}__manor_source = ${JSON.stringify(source)}
__manor_linecache.cache['solution.py'] = (len(__manor_source), None, __manor_source.splitlines(True), 'solution.py')
exec(compile(__manor_source, 'solution.py', 'exec'), globals())
__manor_kinds = __manor_meta['kinds']
__manor_nodes = []
__manor_in = {}
__manor_out = []
__manor_out_index = {}
def __manor_type(text):
    text = text.strip()
    if text.endswith('[]'): return ('seq', __manor_type(text[:-2]))
    if text.startswith('list<'): return ('seq', __manor_type(text[5:-1]))
    return (text,)
def __manor_scalar(kind, v):
    return float(v) if kind == 'double' else v
def __manor_load_table(rows):
    __manor_nodes.clear(); __manor_in.clear()
    for index, row in enumerate(rows):
        info = __manor_kinds[row[0]]; cls = globals()[info['cls']]
        node = cls.__new__(cls)
        for (name, _), value in zip(info['values'], row[1:]): setattr(node, name, value)
        __manor_nodes.append(node); __manor_in[id(node)] = index
    for node, row in zip(__manor_nodes, rows):
        info = __manor_kinds[row[0]]; at = 1 + len(info['values'])
        for name in info['links']: setattr(node, name, None if row[at] is None else __manor_nodes[row[at]]); at += 1
        for name in info['lists']: setattr(node, name, [__manor_nodes[i] for i in row[at]]); at += 1
def __manor_out_node(kind, v):
    if v is None: return None
    if id(v) in __manor_out_index: return __manor_out_index[id(v)][0]
    info = __manor_kinds[kind]; queue = [v]; __manor_out_index[id(v)] = (len(__manor_out), v); __manor_out.append(None); k = 0
    while k < len(queue):
        node = queue[k]; k += 1
        for x in [getattr(node, name, None) for name in info['links']] + [c for name in info['lists'] for c in (getattr(node, name, None) or [])]:
            if x is not None and id(x) not in __manor_out_index:
                if len(__manor_out) >= 1000000: raise RuntimeError('Returned structure is too large')
                __manor_out_index[id(x)] = (len(__manor_out), x); __manor_out.append(None); queue.append(x)
    for node in queue:
        row = [kind, __manor_in.get(id(node))]
        row += [str(getattr(node, name)) if t in ('char', 'string') else bool(getattr(node, name)) if t == 'bool' else int(getattr(node, name)) for name, t in info['values']]
        row += [None if getattr(node, name, None) is None else __manor_out_index[id(getattr(node, name))][0] for name in info['links']]
        row += [[__manor_out_index[id(c)][0] for c in (getattr(node, name, None) or [])] for name in info['lists']]
        __manor_out[__manor_out_index[id(node)][0]] = row
    return __manor_out_index[id(v)][0]
def __manor_decode(t, v):
    if t[0] == 'seq': return [__manor_decode(t[1], x) for x in v]
    if t[0] == 'double': return float(v)
    if t[0] in __manor_kinds: return None if v is None else __manor_nodes[v]
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
    if t[0] in __manor_meta['records']:
        cls = globals()[t[0]]; obj = cls.__new__(cls)
        for (name, _), value in zip(__manor_meta['records'][t[0]], v): setattr(obj, name, list(value) if isinstance(value, list) else value)
        return obj
    if t[0] == 'NestedInteger':
        if not isinstance(v, list): return NestedInteger(v)
        item = NestedInteger()
        for x in v: item.add(__manor_decode(t, x))
        return item
    if t[0] == 'buffer': return [''] * v
    return v
def __manor_encode(t, v):
    if t[0] == 'seq': return None if v is None else [__manor_encode(t[1], x) for x in v]
    if t[0] == 'double': return float(v)
    if t[0] in ('int', 'long'): return int(v)
    if t[0] == 'bool': return bool(v)
    if t[0] in __manor_kinds: return __manor_out_node(t[0], v)
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
    if t[0] in __manor_meta['records']:
        return None if v is None else [list(getattr(v, name)) if kind != 'int' else int(getattr(v, name)) for name, kind in __manor_meta['records'][t[0]]]
    if t[0] == 'NestedInteger':
        if v is None: return None
        return v.getInteger() if v.isInteger() else [__manor_encode(t, x) for x in v.getList() or []]
    return v
def __manor_json_text(value):
    return __manor_json.dumps(value, separators=(',', ':'), ensure_ascii=False, allow_nan=False)
def __manor_wrap(value):
    return {'n': list(__manor_out), 'v': value} if __manor_meta['wrap'] else value
def __manor_object(spec, t, v):
    if t == spec.get('className'):
        return globals()[t](*[__manor_decode(__manor_type(p['type']), a) for p, a in zip(spec['constructorParams'], v)])
    return __manor_decode(__manor_type(t), v)
def __manor_concurrent(spec, lines):
    ctor = __manor_json.loads(lines[0]); scripts = __manor_json.loads(lines[1])
    obj = globals()[spec['className']](*[__manor_decode(__manor_type(p['type']), a) for p, a in zip(spec['constructorParams'], ctor)])
    methods = {m['name']: m for m in spec['methods']}
    log = []; lock = __manor_threading.Lock(); errors = []
    def record(value):
        with lock: log.append(value)
    def callback(t, token):
        if t == 'callback<int>': return lambda number: record(int(number))
        return lambda: record(token)
    def run(script):
        try:
            for name, call in script:
                if name == '$sleep': __manor_time.sleep(call[0] / 1000); continue
                m = methods[name]
                args = [callback(p['type'], a) if p['type'].startswith('callback') else __manor_decode(__manor_type(p['type']), a) for p, a in zip(m['params'], call)]
                result = getattr(obj, name)(*args)
                if m['returns'] != 'void': record(__manor_encode(__manor_type(m['returns']), result))
        except BaseException as error:
            errors.append(error)
    workers = [__manor_threading.Thread(target=run, args=(script,), daemon=True) for script in scripts]
    for worker in workers:
        worker.start(); __manor_time.sleep(0.002)
    for worker in workers: worker.join()
    if errors: raise errors[0]
    return log
def __manor_case(spec, lines):
    __manor_inputs.clear(); __manor_out.clear(); __manor_out_index.clear()
    if __manor_meta['table']:
        __manor_load_table(__manor_json.loads(lines[0])); lines = lines[1:]
    if spec['kind'] == 'codec':
        encode, decode = spec['encode'], spec['decode']
        value = __manor_decode(__manor_type(encode['param']['type']), __manor_json.loads(lines[0]))
        ser = globals()[spec['className']]()
        deser = ser if spec['sharedInstance'] else globals()[spec['className']]()
        return __manor_encode(__manor_type(decode['returns']), getattr(deser, decode['name'])(getattr(ser, encode['name'])(value)))
    if spec.get('concurrency'): return __manor_concurrent(spec, lines)
    values = {name: __manor_json.loads(line) for name, line in zip(__manor_meta['inputs'], lines)}
    if __manor_meta['interactive']: __manor_ix_start(values)
    try:
        answer = __manor_answer(spec, values)
    except __ManorAbort as stop:
        return str(stop)
    return __manor_ix_finish(answer) if __manor_meta['interactive'] else answer
def __manor_answer(spec, values):
    if spec['kind'] == 'function':
        params = spec['params']
        args = [globals()[p['type']](p['name']) if p['type'] in __manor_apis else __manor_decode(__manor_type(p['type']), values[p['name']]) for p in params]
        result = getattr(Solution(), spec['name'])(*args)
        output = spec['output']
        if output['mode'] == 'return': return None if spec['returns'] == 'void' else __manor_wrap(__manor_encode(__manor_type(spec['returns']), result))
        index = [p['name'] for p in params].index(output['param'])
        if params[index]['type'] == 'buffer': return ''.join(str(c) for c in args[index][:max(0, result)])
        value = args[index] if output['mode'] == 'param' else args[index][:max(0, result)]
        return __manor_wrap(__manor_encode(__manor_type(params[index]['type']), value))
    ops = values['__ops']; calls = values['__calls']
    if len(ops) != len(calls) or not ops or ops[0] != spec['className']: raise ValueError('Operations must start with the class name and match the argument arrays')
    methods = {m['name']: m for m in spec['methods']}
    obj = globals()[spec['className']](*[__manor_object(spec, p['type'], a) for p, a in zip(spec['constructorParams'], calls[0])])
    out = [None]
    for op, call in zip(ops[1:], calls[1:]):
        m = methods.get(op)
        if m is None: raise ValueError('Unknown operation: ' + str(op))
        args = [__manor_object(spec, p['type'], a) for p, a in zip(m['params'], call)]
        result = getattr(obj, op)(*args)
        if m.get('output'):
            index = [p['name'] for p in m['params']].index(m['output']['param'])
            out.append(''.join(str(c) for c in args[index][:max(0, result)]))
        else:
            out.append(None if m['returns'] == 'void' else __manor_encode(__manor_type(m['returns']), result))
    return out
def __manor_main():
    import traceback
    spec = __manor_json.loads(${JSON.stringify(JSON.stringify(spec))})
    width = __manor_meta['width']
    lines = [line for line in __manor_sys.stdin.read().split('\\n') if line.strip() != '']
    if not lines or len(lines) % width != 0: raise ValueError('Each test case needs %d input lines, one JSON value per line; received %d lines' % (width, len(lines)))
    for index in range(len(lines) // width):
        started = __manor_time.perf_counter()
        try:
            text = __manor_json_text(__manor_case(spec, lines[index * width:(index + 1) * width]))
        except Exception:
            __manor_sys.stdout.flush(); error = __manor_sys.exc_info()[1]; frames = [f for f in traceback.extract_tb(error.__traceback__) if f.filename == 'solution.py']; __manor_sys.stderr.write(('Traceback (most recent call last):\\n' + ''.join(traceback.format_list(frames)) if frames else '') + ''.join(traceback.format_exception_only(type(error), error))); __manor_sys.stderr.flush()
            text = '!'
        __manor_sys.stdout.write('\\x1eMANOR %d %d %s\\n' % (index, round((__manor_time.perf_counter() - started) * 1000), text)); __manor_sys.stdout.flush()
    import resource
    __manor_sys.stdout.write('\\x1eMANOR-PEAK %d\\n' % resource.getrusage(resource.RUSAGE_SELF).ru_maxrss); __manor_sys.stdout.flush()
__manor_main()
`
}
