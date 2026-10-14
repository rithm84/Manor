/** The Go driver: JSON codecs for every interface type, node tables, the interactor client, and concurrent thread scripts. */
import type { ClassInterface, HarnessType, NodeKind, ProblemInterface } from './problemInterface.ts'
import { goType, nodeKindOf, tracksInputs, typeOf, upperFirst, useSpec } from './problemInterface.ts'
import { goNodeCode } from './problemNodeDrivers.ts'
import { driverMeta } from './problemDriverMeta.ts'
import { goField, recordSchemas } from './problemKinds.ts'
import { nestedImplementations } from './problemProvided.ts'
import { interactorProgram } from './problemInteractor.ts'
import { codecInstances, decoderTypes, mangle, nodeEncoder } from './problemCompiledShared.ts'
function goDecoder(spec: ProblemInterface, t: HarnessType): string {
  const name = '__manor_d_' + mangle(t)
  const head = `func ${name}(v interface{}) ${goType(t)} {`
  const meta = driverMeta(spec)
  if (t.tag === 'node' && Object.hasOwn(meta.kinds, t.name)) return head + ` if v == nil { return nil }; return __manor_nodes[__manor_d_int(v)].(${goType(t)}) }`
  if (t.tag === 'record') return head + ` if v == nil { return nil }; l := v.([]interface{}); return &${t.name}{${recordSchemas[t.name].fields.map(([f, ft], i) => `${goField(f)}: __manor_d_${ft === 'int' ? 'int' : 'int_L'}(l[${i}])`).join(', ')}} }`
  if (t.tag === 'nested') return head + ' n := &NestedInteger{}; if l, ok := v.([]interface{}); ok { for _, x := range l { n.Add(*__manor_d_NestedInteger(x)) } } else { n.SetInteger(__manor_d_int(v)) }; return n }'
  if (t.tag === 'buffer') return head + ' return make([]byte, __manor_d_int(v)) }'
  if (t.tag === 'object') return spec.kind === 'class' && t.name === spec.className ? head + ` l := v.([]interface{}); return Constructor(${spec.constructorParams.map((p, i) => `__manor_d_${mangle(typeOf(p.type))}(l[${i}])`).join(', ')}) }` : ''
  if (t.tag === 'callback') return ''
  const number = (method: string, cast: string): string => ` n, err := v.(__manor_json.Number).${method}(); if err != nil { panic(err) }; return ${cast}(n) }`
  if (t.tag === 'scalar') return head + {
    int: number('Int64', 'int'), long: number('Int64', 'int64'), double: number('Float64', 'float64'),
    bool: ' return v.(bool) }', string: ' return v.(string) }', char: ' return v.(string)[0] }',
  }[t.name]
  if (t.tag === 'node' && t.name !== 'ListNode' && t.name !== 'TreeNode') return goNodeCode(t.name as NodeKind).decode
  if (t.tag === 'node' && t.name === 'ListNode') return head + ' l := v.([]interface{}); var head *ListNode; for i := len(l) - 1; i >= 0; i-- { head = &ListNode{Val: __manor_d_int(l[i]), Next: head} }; return head }'
  if (t.tag === 'node') return head + ' l := v.([]interface{}); if len(l) == 0 || l[0] == nil { return nil }; root := &TreeNode{Val: __manor_d_int(l[0])}; q := []*TreeNode{root}; i, k := 1, 0; for i < len(l) { node := q[k]; k++; if l[i] != nil { node.Left = &TreeNode{Val: __manor_d_int(l[i])}; q = append(q, node.Left) }; i++; if i < len(l) && l[i] != nil { node.Right = &TreeNode{Val: __manor_d_int(l[i])}; q = append(q, node.Right) }; i++ }; return root }'
  return head + ` l := v.([]interface{}); r := make(${goType(t)}, len(l)); for i, x := range l { r[i] = __manor_d_${mangle(t.item)}(x) }; return r }`
}
const goLibrary = (spec: ProblemInterface): string => `

func __manor_parse(text string) interface{} {
	d := __manor_json.NewDecoder(__manor_strings.NewReader(text)); d.UseNumber()
	var v interface{}
	if err := d.Decode(&v); err != nil { panic(err) }
	return v
}
func __manor_string(b *__manor_strings.Builder, s string) { raw, err := __manor_json.Marshal(s); if err != nil { panic(err) }; b.Write(raw) }
func __manor_enc(b *__manor_strings.Builder, v __manor_reflect.Value) {
	switch v.Kind() {
	case __manor_reflect.Invalid:
		b.WriteString("null")
	case __manor_reflect.Interface:
		if v.IsNil() { b.WriteString("null"); return }
		__manor_enc(b, v.Elem())
	case __manor_reflect.Ptr:
		name := v.Type().Elem().Name()
${goPointerEncoders(spec)}		if name == "ListNode" {
			b.WriteByte('['); n := 0
			for node := v; !node.IsNil(); node = node.Elem().FieldByName("Next") { if n > 0 { b.WriteByte(',') }; n++; if n > 1000000 { panic("Returned list does not terminate") }; b.WriteString(__manor_strconv.FormatInt(node.Elem().FieldByName("Val").Int(), 10)) }
			b.WriteByte(']'); return
		}
		if name == "TreeNode" {
			q := []__manor_reflect.Value{v}; out := []string{}
			for k := 0; k < len(q); k++ { node := q[k]; if node.IsNil() { out = append(out, "null"); continue }; out = append(out, __manor_strconv.FormatInt(node.Elem().FieldByName("Val").Int(), 10)); q = append(q, node.Elem().FieldByName("Left"), node.Elem().FieldByName("Right")) }
			for len(out) > 0 && out[len(out)-1] == "null" { out = out[:len(out)-1] }
			b.WriteString("[" + __manor_strings.Join(out, ",") + "]"); return
		}
${nodeKindOf(spec) === null || driverMeta(spec).table ? '' : '\t\tif name == "Node" { __manor_e_node(b, v.Interface().(*Node)); return }\n'}		if v.IsNil() { b.WriteString("null"); return }
		__manor_enc(b, v.Elem())
	case __manor_reflect.Slice, __manor_reflect.Array:
		b.WriteByte('[')
		for i := 0; i < v.Len(); i++ { if i > 0 { b.WriteByte(',') }; __manor_enc(b, v.Index(i)) }
		b.WriteByte(']')
	case __manor_reflect.Uint8:
		__manor_string(b, string([]byte{byte(v.Uint())}))
	case __manor_reflect.Int, __manor_reflect.Int8, __manor_reflect.Int16, __manor_reflect.Int32, __manor_reflect.Int64:
		b.WriteString(__manor_strconv.FormatInt(v.Int(), 10))
	case __manor_reflect.Uint, __manor_reflect.Uint16, __manor_reflect.Uint32, __manor_reflect.Uint64:
		b.WriteString(__manor_strconv.FormatUint(v.Uint(), 10))
	case __manor_reflect.Float32, __manor_reflect.Float64:
		b.WriteString(__manor_strconv.FormatFloat(v.Float(), 'g', -1, 64))
	case __manor_reflect.Bool:
		b.WriteString(__manor_strconv.FormatBool(v.Bool()))
	case __manor_reflect.String:
		__manor_string(b, v.String())
	default:
		panic("Unsupported return value kind: " + v.Kind().String())
	}
}
${decoderTypes(spec).map(t => goDecoder(spec, t)).filter(text => text !== '').join('\n')}
${driverMeta(spec).table ? goTable(spec) : nodeEncoder(spec, goNodeCode)}${goApis(spec)}${driverMeta(spec).nested ? nestedImplementations.go : ''}func __manor_fmt_value(v interface{}) string {
	if e, ok := v.(error); ok { return e.Error() }
	if text, ok := v.(string); ok { return text }
	var b __manor_strings.Builder
	__manor_enc(&b, __manor_reflect.ValueOf(v))
	return b.String()
}
func __manor_time_now() __manor_time.Time { return __manor_time.Now() }
func __manor_time_since(started __manor_time.Time) int64 { return __manor_time.Since(started).Milliseconds() }
func __manor_lines() []string {
	r := __manor_bufio.NewReaderSize(__manor_os.Stdin, 1<<20); out := []string{}
	for { line, err := r.ReadString('\\n'); if __manor_strings.TrimSpace(line) != "" { out = append(out, line) }; if err != nil { break } }
	return out
}
`


/** Encoders for pointer types the reflection encoder cannot print by itself: table nodes, records, and NestedInteger. */
function goPointerEncoders(spec: ProblemInterface): string {
  const meta = driverMeta(spec)
  const nodes = [...new Map(Object.entries(meta.kinds).map(([name, k]) => [k.cls, name])).entries()].map(([cls, name]) => `\t\tif name == ${JSON.stringify(cls)} { if v.IsNil() { b.WriteString("null"); return }; b.WriteString(__manor_strconv.Itoa(__manor_out_${name}(v.Interface().(*${cls})))); return }\n`)
  const records = Object.entries(meta.records).map(([name, fields]) => `\t\tif name == ${JSON.stringify(name)} { if v.IsNil() { b.WriteString("null"); return }; r := v.Interface().(*${name}); b.WriteByte('['); ${fields.map(([f], i) => `${i ? "b.WriteByte(','); " : ''}__manor_enc(b, __manor_reflect.ValueOf(r.${goField(f)})); `).join('')}b.WriteByte(']'); return }\n`)
  const nested = meta.nested ? '\t\tif name == "NestedInteger" { if v.IsNil() { b.WriteString("null"); return }; n := v.Interface().(*NestedInteger); if n.IsInteger() { b.WriteString(__manor_strconv.Itoa(n.GetInteger())) } else { b.WriteByte(\'[\'); for i, x := range n.GetList() { if i > 0 { b.WriteByte(\',\') }; __manor_enc(b, __manor_reflect.ValueOf(x)) }; b.WriteByte(\']\') }; return }\n' : ''
  return [...nodes, ...records, nested].join('')
}

/** Table-mode node storage, the input table loader, and each kind's output-row writer. */
function goTable(spec: ProblemInterface): string {
  const kinds = Object.entries(driverMeta(spec).kinds)
  const field = (k: { goLower: boolean }, name: string): string => goField(name, k.goLower)
  const out = kinds.map(([name, k]) => `func __manor_out_${name}(v *${k.cls}) int {
	if at, ok := __manor_out_index[v]; ok { return at }
	q := []*${k.cls}{v}; __manor_out_index[v] = len(__manor_out_rows); __manor_out_rows = append(__manor_out_rows, "")
	visit := func(x *${k.cls}) { if x == nil { return }; if _, ok := __manor_out_index[x]; ok { return }; if len(__manor_out_rows) >= 1000000 { panic("Returned structure is too large") }; __manor_out_index[x] = len(__manor_out_rows); __manor_out_rows = append(__manor_out_rows, ""); q = append(q, x) }
	for k := 0; k < len(q); k++ { n := q[k]; ${k.links.map(l => `visit(n.${field(k, l)}); `).join('')}${k.lists.map(l => `for _, x := range n.${field(k, l)} { visit(x) }; `).join('')}}
	for _, n := range q {
		var r __manor_strings.Builder; r.WriteString("[\\"${name}\\","); if in, ok := __manor_input_rows[n]; ok { r.WriteString(__manor_strconv.Itoa(in)) } else { r.WriteString("null") }
		${k.values.map(([f]) => `r.WriteByte(','); __manor_enc(&r, __manor_reflect.ValueOf(n.${field(k, f)})); `).join('')}${k.links.map(l => `r.WriteByte(','); if n.${field(k, l)} == nil { r.WriteString("null") } else { r.WriteString(__manor_strconv.Itoa(__manor_out_index[n.${field(k, l)}])) }; `).join('')}${k.lists.map(l => `r.WriteString(",["); for m, x := range n.${field(k, l)} { if m > 0 { r.WriteByte(',') }; r.WriteString(__manor_strconv.Itoa(__manor_out_index[x])) }; r.WriteByte(']'); `).join('')}r.WriteByte(']')
		__manor_out_rows[__manor_out_index[n]] = r.String()
	}
	return __manor_out_index[v]
}
`).join('')
  const create = kinds.map(([name, k]) => `\t\tif r[0] == ${JSON.stringify(name)} { n := &${k.cls}{}; ${k.values.map(([f, t], i) => `n.${field(k, f)} = __manor_d_${t}(r[${1 + i}]); `).join('')}__manor_nodes = append(__manor_nodes, n); __manor_input_rows[n] = i; continue }\n`).join('')
  const link = kinds.map(([name, k]) => `\t\tif r[0] == ${JSON.stringify(name)} { n := __manor_nodes[i].(*${k.cls}); at := ${1 + k.values.length}; ${k.links.map(l => `if r[at] != nil { n.${field(k, l)} = __manor_nodes[__manor_d_int(r[at])].(*${k.cls}) }; at++; `).join('')}${k.lists.map(l => `n.${field(k, l)} = []*${k.cls}{}; for _, x := range r[at].([]interface{}) { n.${field(k, l)} = append(n.${field(k, l)}, __manor_nodes[__manor_d_int(x)].(*${k.cls})) }; at++; `).join('')}_ = at }\n`).join('')
  return `var __manor_nodes []interface{}
var __manor_input_rows = map[interface{}]int{}
var __manor_out_rows []string
var __manor_out_index = map[interface{}]int{}
${out}func __manor_load_table(v interface{}) {
	rows := v.([]interface{}); __manor_nodes = nil; __manor_input_rows = map[interface{}]int{}; __manor_out_rows = nil; __manor_out_index = map[interface{}]int{}
	for i, row := range rows {
		r := row.([]interface{})
${create}		panic("Unknown node kind in the input table")
	}
	for i, row := range rows {
		r := row.([]interface{})
${link}	}
}
func __manor_wrap(value string) string { return "{\\"n\\":[" + __manor_strings.Join(__manor_out_rows, ",") + "],\\"v\\":" + value + "}" }
`
}

/** API stub types, global API functions, and the interactor client; calls hold one lock, so goroutines may share the APIs. */
function goApis(spec: ProblemInterface): string {
  if (spec.kind === 'codec' || !spec.apis?.length) return ''
  const stubs = spec.apis.map(api => {
    const methods = api.methods.map(m => {
      const returns = m.returns === 'void' ? '' : ' ' + goType(typeOf(m.returns))
      const head = api.global ? `func ${m.name}` : `func (this *${api.name}) ${upperFirst(m.name)}`
      const args = m.params.map((p, i) => `${i ? "__manor_a.WriteByte(','); " : ''}${typeOf(p.type).tag === 'buffer' ? '__manor_a.WriteString("null")' : `__manor_enc(&__manor_a, __manor_reflect.ValueOf(${p.name}))`}; `).join('')
      const writes = m.params.map((p, i) => typeOf(p.type).tag === 'buffer' ? `if __manor_index == ${i} { copy(${p.name}, []byte(__manor_text)) }; ` : '').join('')
      const target = m.returns === 'void' ? null : typeOf(m.returns)
      const result = target === null ? '' : target.tag === 'object' ? ` if __manor_r[0] == nil { return nil }; __manor_h, __manor_err := __manor_json.Marshal(__manor_r[0]); if __manor_err != nil { panic(__manor_err) }; return &${target.name}{__manor_handle: string(__manor_h)}` : ` return __manor_d_${mangle(target)}(__manor_r[0])`
      return `${head}(${m.params.map(p => `${p.name} ${goType(typeOf(p.type))}`).join(', ')})${returns} { var __manor_a __manor_strings.Builder; __manor_a.WriteByte('['); ${args}__manor_a.WriteByte(']'); __manor_r := __manor_ix_call(${api.global ? '"null"' : 'this.__manor_handle'}, ${JSON.stringify(m.name)}, __manor_a.String()); _ = __manor_r;${writes ? ` if len(__manor_r) > 1 { for _, __manor_w := range __manor_r[1].([]interface{}) { __manor_pair := __manor_w.([]interface{}); __manor_index := __manor_d_int(__manor_pair[0]); __manor_text := __manor_pair[1].(string); ${writes}} };` : ''}${result} }\n`
    }).join('')
    return api.global ? methods : `type ${api.name} struct { __manor_handle string }\n${methods}`
  }).join('')
  return `${stubs}type __manorAbort struct { message string }
var __manor_ix_to __manor_io.WriteCloser
var __manor_ix_from *__manor_bufio.Reader
var __manor_ix_lock __manor_sync.Mutex
var __manor_ix_aborted *string
func __manor_ix_start() {
	cmd := __manor_exec.Command("python3", "-I", "-c", ${JSON.stringify(interactorProgram(spec.interactor ?? ''))})
	cmd.Stderr = __manor_os.Stderr
	to, err := cmd.StdinPipe(); if err != nil { panic(err) }
	from, err := cmd.StdoutPipe(); if err != nil { panic(err) }
	if err := cmd.Start(); err != nil { panic(err) }
	__manor_ix_to = to; __manor_ix_from = __manor_bufio.NewReaderSize(from, 1<<16)
}
func __manor_ix_send(message string) string {
	if _, err := __manor_ix_to.Write([]byte(message + "\\n")); err != nil { panic("The interactor stopped") }
	line, err := __manor_ix_from.ReadString('\\n'); if err != nil { panic("The interactor stopped") }
	return __manor_strings.TrimRight(line, "\\n")
}
func __manor_ix_call(handle string, method string, args string) []interface{} {
	__manor_ix_lock.Lock(); defer __manor_ix_lock.Unlock()
	if __manor_ix_aborted != nil { panic(__manorAbort{*__manor_ix_aborted}) }
	reply := __manor_parse(__manor_ix_send("[\\"call\\"," + handle + ",\\"" + method + "\\"," + args + "]"))
	if text, ok := reply.(string); ok { __manor_ix_aborted = &text; panic(__manorAbort{text}) }
	return reply.([]interface{})
}
func __manor_ix_begin(values string) { __manor_ix_aborted = nil; __manor_ix_send("[\\"case\\"," + values + "]") }
func __manor_ix_finish(answer string) string { reply := __manor_ix_send("[\\"end\\"," + answer + "]"); return reply[1 : len(reply)-1] }
`
}

/** The import line Manor's driver needs, placed where the solution's `package main` was. */
export function goPrelude(spec: ProblemInterface): string {
  const meta = driverMeta(spec)
  const extra = [...(meta.interactive ? ['__manor_exec "os/exec"', '__manor_io "io"'] : []), ...(meta.interactive || meta.concurrent ? ['__manor_sync "sync"'] : [])]
  return `package main; import (__manor_json "encoding/json"; __manor_bufio "bufio"; __manor_os "os"; __manor_reflect "reflect"; __manor_strings "strings"; __manor_strconv "strconv"; __manor_syscall "syscall"; __manor_time "time"${extra.map(item => '; ' + item).join('')})`
}

function goConcurrent(spec: ClassInterface): string {
  const cases = spec.methods.map(m => {
    const args = m.params.map((p, i) => {
      const t = typeOf(p.type)
      if (t.tag === 'callback') return t.int ? `p${i} := func(x int) { record(__manor_strconv.Itoa(x)) }; ` : `t${i}, err := __manor_json.Marshal(c[${i}]); if err != nil { panic(err) }; p${i} := func() { record(string(t${i})) }; `
      return `p${i} := __manor_d_${mangle(t)}(c[${i}]); `
    }).join('')
    const call = `obj.${upperFirst(m.name)}(${m.params.map((_, i) => `p${i}`).join(', ')})`
    return `\t\t\t\tcase ${JSON.stringify(m.name)}:\n\t\t\t\t\t${args}${m.returns === 'void' ? call : `var r __manor_strings.Builder; __manor_enc(&r, __manor_reflect.ValueOf(${call})); record(r.String())`}\n`
  }).join('')
  const ctor = spec.constructorParams.map((p, i) => `__manor_d_${mangle(typeOf(p.type))}(ctor[${i}])`).join(', ')
  return `\tctor := __manor_parse(lines[0]).([]interface{})
	scripts := __manor_parse(lines[1]).([]interface{})
	_ = ctor
	obj := Constructor(${ctor})
	var lock __manor_sync.Mutex
	log := []string{}
	record := func(entry string) { lock.Lock(); log = append(log, entry); lock.Unlock() }
	var failure interface{}
	var group __manor_sync.WaitGroup
	finished := 0
	signal := __manor_sync.NewCond(&lock)
	for _, script := range scripts {
		group.Add(1)
		go func(steps []interface{}) {
			defer group.Done()
			defer func() { lock.Lock(); finished++; signal.Broadcast(); lock.Unlock() }()
			defer func() { if r := recover(); r != nil { lock.Lock(); if failure == nil { failure = r }; lock.Unlock() } }()
			for _, entry := range steps {
				step := entry.([]interface{}); name := step[0].(string); c := step[1].([]interface{})
				if name == "$sleep" { __manor_time.Sleep(__manor_time.Duration(__manor_d_int(c[0])) * __manor_time.Millisecond); continue }
				if name == "$join" { lock.Lock(); for finished < len(scripts)-1 { signal.Wait() }; lock.Unlock(); continue }
				switch name {
${cases}				default:
					panic("Unknown operation: " + name)
				}
			}
		}(script.([]interface{}))
		__manor_time.Sleep(2 * __manor_time.Millisecond)
	}
	group.Wait()
	if failure != nil { panic(failure) }
	out.WriteString("[" + __manor_strings.Join(log, ",") + "]")
`
}

export function goDriver(spec: ProblemInterface): string {
  useSpec(spec)
  const meta = driverMeta(spec)
  const width = meta.width
  const reset = tracksInputs(nodeKindOf(spec)) ? '\t__manor_inputs = map[*Node]bool{}\n' : ''
  const run = (body: string): string => `${goLibrary(spec)}func __manor_case(lines []string, out *__manor_strings.Builder) (failed bool) {\n\tdefer func() {\n\t\tif r := recover(); r != nil {\n\t\t\t__manor_os.Stdout.Sync()\n\t\t\t__manor_os.Stderr.WriteString("panic: " + __manor_fmt_value(r) + "\\n")\n\t\t\tfailed = true\n\t\t}\n\t}()\n${reset}${body}\treturn false\n}\n\nfunc main() {\n${meta.interactive ? '\t__manor_ix_start()\n' : ''}\tlines := __manor_lines()\n\tif len(lines) == 0 || len(lines)%${width} != 0 { panic("Each test case needs ${width} input lines, one JSON value per line; received " + __manor_strconv.Itoa(len(lines)) + " lines") }\n\tfor i := 0; i*${width} < len(lines); i++ {\n\t\tvar out __manor_strings.Builder\n\t\tstarted := __manor_time_now()\n\t\tfailed := __manor_case(lines[i*${width}:(i+1)*${width}], &out)\n\t\ttext := out.String()\n\t\tif failed { text = "!" }\n\t\t__manor_os.Stdout.WriteString("\\x1eMANOR " + __manor_strconv.Itoa(i) + " " + __manor_strconv.FormatInt(__manor_time_since(started), 10) + " " + text + "\\n")\n\t}\n\tvar usage __manor_syscall.Rusage\n\tif err := __manor_syscall.Getrusage(__manor_syscall.RUSAGE_SELF, &usage); err != nil { panic(err) }\n\t__manor_os.Stdout.WriteString("\\x1eMANOR-PEAK " + __manor_strconv.FormatInt(int64(usage.Maxrss), 10) + "\\n")\n\t__manor_os.Exit(0)\n}\n`
  if (spec.kind === 'codec') {
    const { ser, deser } = codecInstances(spec, 'Constructor()')
    return run(`\ta0 := __manor_d_${mangle(typeOf(spec.encode.param.type))}(__manor_parse(lines[0]))\n\tser := ${ser}\n${spec.sharedInstance ? '' : `\tdeser := ${deser}\n`}\t__manor_enc(out, __manor_reflect.ValueOf(${spec.sharedInstance ? 'ser' : 'deser'}.${spec.decode.name}(ser.${spec.encode.name}(a0))))\n`)
  }
  if (spec.kind === 'class' && spec.concurrency) return run(goConcurrent(spec))
  const offset = meta.table ? 1 : 0
  const line = (name: string): string => `__manor_parse(lines[${offset + meta.inputs.indexOf(name)}])`
  const table = meta.table ? '\t__manor_load_table(__manor_parse(lines[0]))\n' : ''
  const emit = (expression: string): string => meta.wrap ? `\t{ var v __manor_strings.Builder; __manor_enc(&v, __manor_reflect.ValueOf(${expression})); out.WriteString(__manor_wrap(v.String())) }\n` : `\t__manor_enc(out, __manor_reflect.ValueOf(${expression}))\n`
  let answer: string
  if (spec.kind === 'function') {
    const args = spec.params.map((p, i) => typeOf(p.type).tag === 'object' ? `\ta${i} := &${typeOf(p.type).tag === 'object' ? (typeOf(p.type) as { name: string }).name : ''}{__manor_handle: ${JSON.stringify(JSON.stringify(p.name))}}\n` : `\ta${i} := __manor_d_${mangle(typeOf(p.type))}(${line(p.name)})\n`).join('')
    const call = `${spec.name}(${spec.params.map((_, i) => `a${i}`).join(', ')})`
    const index = spec.output.mode === 'return' ? -1 : spec.params.findIndex(p => p.name === (spec.output as { param: string }).param)
    answer = args + (spec.output.mode === 'return' ? (spec.returns === 'void' ? `\t${call}\n\tout.WriteString("null")\n` : emit(call))
      : spec.output.mode === 'param' ? `\t${call}\n${emit(`a${index}`)}`
      : typeOf(spec.params[index].type).tag === 'buffer' ? `\tk := ${call}\n\tif k < 0 { k = 0 }\n\tif k > len(a${index}) { k = len(a${index}) }\n\t__manor_string(out, string(a${index}[:k]))\n`
      : `\tk := ${call}\n\tif k < 0 { k = 0 }\n\tif k > len(a${index}) { k = len(a${index}) }\n\t__manor_enc(out, __manor_reflect.ValueOf(a${index}[:k]))\n`)
  } else {
    const ctor = spec.constructorParams.map((p, i) => `__manor_d_${mangle(typeOf(p.type))}(calls[0].([]interface{})[${i}])`).join(', ')
    const cases = spec.methods.map(m => {
      const args = m.params.map((p, i) => `p${i} := __manor_d_${mangle(typeOf(p.type))}(c[${i}]); `).join('')
      const call = `obj.${upperFirst(m.name)}(${m.params.map((_, i) => `p${i}`).join(', ')})`
      const prefix = m.output === undefined ? -1 : m.params.findIndex(p => p.name === m.output!.param)
      const body = prefix >= 0 ? `k := ${call}; if k < 0 { k = 0 }; if k > len(p${prefix}) { k = len(p${prefix}) }; __manor_string(out, string(p${prefix}[:k]))` : m.returns === 'void' ? `${call}; out.WriteString("null")` : `__manor_enc(out, __manor_reflect.ValueOf(${call}))`
      return `\t\tcase ${JSON.stringify(m.name)}:\n\t\t\t${args}${body}\n`
    }).join('')
    answer = `\tops := __manor_parse(lines[0]).([]interface{})\n\tcalls := __manor_parse(lines[1]).([]interface{})\n\tif len(ops) != len(calls) || len(ops) == 0 || ops[0] != ${JSON.stringify(spec.className)} { panic("Operations must start with the class name and match the argument arrays") }\n\tobj := Constructor(${ctor})\n\tout.WriteString("[null")\n\tfor i := 1; i < len(ops); i++ {\n\t\tc := calls[i].([]interface{})\n\t\t_ = c\n\t\tout.WriteByte(',')\n\t\tswitch ops[i] {\n${cases}\t\tdefault:\n\t\t\tpanic("Unknown operation")\n\t\t}\n\t}\n\tout.WriteByte(']')\n`
  }
  if (!meta.interactive) return run(table + answer)
  const values = `"{" ${meta.inputs.map((name, i) => `+ ${JSON.stringify((i ? ',' : '') + JSON.stringify(name) + ':')} + __manor_strings.TrimSpace(lines[${i}]) `).join('')}+ "}"`
  return run(`\t__manor_ix_begin(${values})\n\tstopped := func() (stop *string) {\n\t\tdefer func() { if r := recover(); r != nil { if a, ok := r.(__manorAbort); ok { m := a.message; stop = &m; return }; panic(r) } }()\n${answer.replace(/^\t/gm, '\t\t')}\t\treturn nil\n\t}()\n\tif stopped != nil { out.Reset(); __manor_string(out, *stopped) } else { text := out.String(); out.Reset(); out.WriteString(__manor_ix_finish(text)) }\n`)
}
