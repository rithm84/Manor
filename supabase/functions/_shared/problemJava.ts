/** The Java driver: JSON codecs for every interface type, node tables, the interactor client, and concurrent thread scripts. */
import type { ClassInterface, HarnessType, NodeKind, ProblemInterface } from './problemInterface.ts'
import { javaType, nodeKindOf, tracksInputs, typeOf, usesNode, useSpec } from './problemInterface.ts'
import { javaNodeCode } from './problemNodeDrivers.ts'
import { driverMeta } from './problemDriverMeta.ts'
import { recordSchemas } from './problemKinds.ts'
import { interactorProgram } from './problemInteractor.ts'
import { nestedImplementations } from './problemProvided.ts'
import { codecInstances, decoderTypes, mangle, nodeEncoder } from './problemCompiledShared.ts'

function javaDecoder(spec: ProblemInterface, t: HarnessType): string {
  const name = 'd_' + mangle(t)
  const head = `  static ${javaType(t)} ${name}(Object o) {`
  const meta = driverMeta(spec)
  if (t.tag === 'node' && Object.hasOwn(meta.kinds, t.name)) return head + ` return o == null ? null : (${javaType(t)}) nodes.get(d_int(o)); }`
  if (t.tag === 'record') return head + ` if (o == null) return null; java.util.List<Object> l = (java.util.List<Object>) o; ${t.name} v = new ${t.name}(); ${recordSchemas[t.name].fields.map(([f, ft], i) => `v.${f} = d_${ft === 'int' ? 'int' : 'int_L'}(l.get(${i})); `).join('')}return v; }`
  if (t.tag === 'nested') return head + ' if (!(o instanceof java.util.List)) return new NestedInteger(d_int(o)); NestedInteger v = new NestedInteger(); for (Object x : (java.util.List<Object>) o) v.add(d_NestedInteger(x)); return v; }'
  if (t.tag === 'buffer') return head + ' return new char[d_int(o)]; }'
  if (t.tag === 'object') return spec.kind === 'class' && t.name === spec.className ? head + ` java.util.List<Object> l = (java.util.List<Object>) o; return new ${t.name}(${spec.constructorParams.map((p, i) => `d_${mangle(typeOf(p.type))}(l.get(${i}))`).join(', ')}); }` : ''
  if (t.tag === 'callback') return ''
  if (t.tag === 'scalar') return head + {
    int: ' return Integer.parseInt(((__ManorNumber) o).text); }', long: ' return Long.parseLong(((__ManorNumber) o).text); }', double: ' return Double.parseDouble(((__ManorNumber) o).text); }',
    bool: ' return (Boolean) o; }', string: ' return (String) o; }', char: ' return ((String) o).charAt(0); }',
  }[t.name]
  if (t.tag === 'node' && t.name !== 'ListNode' && t.name !== 'TreeNode') return javaNodeCode(t.name as NodeKind).decode
  if (t.tag === 'node' && t.name === 'ListNode') return head + ' java.util.List<Object> l = (java.util.List<Object>) o; ListNode head = null; for (int i = l.size() - 1; i >= 0; i--) head = new ListNode(d_int(l.get(i)), head); return head; }'
  if (t.tag === 'node') return head + ' java.util.List<Object> l = (java.util.List<Object>) o; if (l.isEmpty() || l.get(0) == null) return null; TreeNode root = new TreeNode(d_int(l.get(0))); java.util.ArrayList<TreeNode> q = new java.util.ArrayList<>(); q.add(root); int i = 1, k = 0; while (i < l.size()) { TreeNode node = q.get(k++); if (l.get(i) != null) { node.left = new TreeNode(d_int(l.get(i))); q.add(node.left); } i++; if (i < l.size() && l.get(i) != null) { node.right = new TreeNode(d_int(l.get(i))); q.add(node.right); } i++; } return root; }'
  const item = 'd_' + mangle(t.item)
  if (t.tag === 'list') return head + ` java.util.List<Object> l = (java.util.List<Object>) o; ${javaType(t)} r = new java.util.ArrayList<>(); for (Object x : l) r.add(${item}(x)); return r; }`
  const element = javaType(t.item)
  const create = 'new ' + element.replace(/^([^[]+)/, '$1[l.size()]')
  return head + ` java.util.List<Object> l = (java.util.List<Object>) o; ${javaType(t)} r = ${create}; for (int i = 0; i < r.length; i++) r[i] = ${item}(l.get(i)); return r; }`
}
/** Node types print through typed encoders so a null answer reads as an empty structure. */
function javaEmit(type: string, expression: string, table = false): string {
  const t = typeOf(type)
  if (t.tag === 'node' && !table) return t.name === 'ListNode' || t.name === 'TreeNode' ? `encNode(out, ${expression})` : `e_${t.name}(out, ${expression})`
  return `enc(out, ${expression})`
}
const javaLibrary = (spec: ProblemInterface): string => `
final class __ManorNumber { final String text; __ManorNumber(String text) { this.text = text; } }
@SuppressWarnings("unchecked")
public class Main {
  static String src; static int at;
  static void ws() { while (at < src.length() && Character.isWhitespace(src.charAt(at))) at++; }
  static Object parse(String text) { src = text; at = 0; Object value = value(); ws(); if (at != src.length()) throw new IllegalArgumentException("Trailing characters after JSON value"); return value; }
  static Object value() {
    ws(); char c = src.charAt(at);
    if (c == '[') { at++; java.util.ArrayList<Object> out = new java.util.ArrayList<>(); ws(); if (src.charAt(at) == ']') { at++; return out; } while (true) { out.add(value()); ws(); char d = src.charAt(at++); if (d == ',') continue; if (d == ']') return out; throw new IllegalArgumentException("Malformed JSON array"); } }
    if (c == '"') { at++; StringBuilder b = new StringBuilder(); while (src.charAt(at) != '"') { char d = src.charAt(at++); if (d != '\\\\') { b.append(d); continue; } char e = src.charAt(at++); switch (e) { case 'n': b.append('\\n'); break; case 't': b.append('\\t'); break; case 'r': b.append('\\r'); break; case 'b': b.append('\\b'); break; case 'f': b.append('\\f'); break; case 'u': b.append((char) Integer.parseInt(src.substring(at, at + 4), 16)); at += 4; break; default: b.append(e); } } at++; return b.toString(); }
    if (src.startsWith("true", at)) { at += 4; return Boolean.TRUE; }
    if (src.startsWith("false", at)) { at += 5; return Boolean.FALSE; }
    if (src.startsWith("null", at)) { at += 4; return null; }
    int start = at; while (at < src.length() && "+-.eE0123456789".indexOf(src.charAt(at)) >= 0) at++;
    if (start == at) throw new IllegalArgumentException("Malformed JSON value");
    return new __ManorNumber(src.substring(start, at));
  }
  static void str(StringBuilder b, String s) { b.append('"'); for (int i = 0; i < s.length(); i++) { char c = s.charAt(i); if (c == '"') b.append("\\\\\\""); else if (c == '\\\\') b.append("\\\\\\\\"); else if (c == '\\n') b.append("\\\\n"); else if (c == '\\t') b.append("\\\\t"); else if (c == '\\r') b.append("\\\\r"); else if (c < 0x20) b.append(String.format("\\\\u%04x", (int) c)); else b.append(c); } b.append('"'); }
  static void encNode(StringBuilder b, Object v) { if (v == null) b.append("[]"); else enc(b, v); }
  static void enc(StringBuilder b, Object v) {
    if (v == null) { b.append("null"); return; }
    if (v instanceof Double || v instanceof Float) { double d = ((Number) v).doubleValue(); if (Double.isNaN(d) || Double.isInfinite(d)) throw new IllegalStateException("Returned a non-finite number"); b.append(Double.toString(d)); return; }
    if (v instanceof Number || v instanceof Boolean) { b.append(v.toString()); return; }
    if (v instanceof Character) { str(b, v.toString()); return; }
    if (v instanceof String) { str(b, (String) v); return; }
    if (v instanceof java.util.Collection) { b.append('['); boolean first = true; for (Object x : (java.util.Collection<Object>) v) { if (!first) b.append(','); first = false; enc(b, x); } b.append(']'); return; }
    if (v.getClass().isArray()) { b.append('['); int n = java.lang.reflect.Array.getLength(v); for (int i = 0; i < n; i++) { if (i > 0) b.append(','); enc(b, java.lang.reflect.Array.get(v, i)); } b.append(']'); return; }
${usesNode(spec, 'ListNode') && !driverMeta(spec).table ? '    if (v instanceof ListNode) { b.append(\'[\'); ListNode node = (ListNode) v; int n = 0; while (node != null) { if (n++ > 0) b.append(\',\'); if (n > 1000000) throw new IllegalStateException("Returned list does not terminate"); b.append(node.val); node = node.next; } b.append(\']\'); return; }\n' : ''}${usesNode(spec, 'TreeNode') && !driverMeta(spec).table ? '    if (v instanceof TreeNode) { java.util.ArrayList<TreeNode> q = new java.util.ArrayList<>(); q.add((TreeNode) v); java.util.ArrayList<String> out = new java.util.ArrayList<>(); for (int k = 0; k < q.size(); k++) { TreeNode node = q.get(k); if (node == null) { out.add("null"); continue; } out.add(Integer.toString(node.val)); q.add(node.left); q.add(node.right); } while (!out.isEmpty() && out.get(out.size() - 1).equals("null")) out.remove(out.size() - 1); b.append(\'[\').append(String.join(",", out)).append(\']\'); return; }\n' : ''}${javaExtraEncoders(spec)}    throw new IllegalStateException("Unsupported return value: " + v.getClass().getName());
  }
${javaDecoderTypes(spec).map(t => javaDecoder(spec, t)).filter(text => text !== '').join('\n')}
${driverMeta(spec).table ? javaTable(spec) : nodeEncoder(spec, javaNodeCode)}  static java.util.List<String> lines() throws java.io.IOException { java.io.BufferedReader r = new java.io.BufferedReader(new java.io.InputStreamReader(System.in, java.nio.charset.StandardCharsets.UTF_8)); java.util.ArrayList<String> out = new java.util.ArrayList<>(); String line; while ((line = r.readLine()) != null) if (!line.isBlank()) out.add(line); return out; }
`


/** A Java string literal for arbitrary text. */
function javaString(text: string): string { return JSON.stringify(text).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029') }

function javaDecoderTypes(spec: ProblemInterface): HarnessType[] { return decoderTypes(spec) }

/** Encoder branches for table nodes, records, NestedInteger, and parsed JSON numbers. */
function javaExtraEncoders(spec: ProblemInterface): string {
  const meta = driverMeta(spec)
  const kinds = Object.values(meta.kinds).map(k => k.cls)
  return [
    '    if (v instanceof __ManorNumber) { b.append(((__ManorNumber) v).text); return; }\n',
    ...[...new Set(kinds)].map(cls => `    if (v instanceof ${cls}) { b.append(outNode((${cls}) v)); return; }\n`),
    ...Object.entries(meta.records).map(([name, fields]) => `    if (v instanceof ${name}) { ${name} r = (${name}) v; b.append('['); ${fields.map(([f], i) => `${i ? "b.append(','); " : ''}enc(b, r.${f}); `).join('')}b.append(']'); return; }\n`),
    meta.nested ? '    if (v instanceof NestedInteger) { NestedInteger n = (NestedInteger) v; if (n.isInteger()) b.append(n.getInteger()); else enc(b, n.getList()); return; }\n' : '',
  ].join('')
}

/** Table-mode node storage, the input table loader, and each kind's output-row writer. */
function javaTable(spec: ProblemInterface): string {
  const kinds = Object.entries(driverMeta(spec).kinds)
  const out = kinds.map(([name, k]) => `  static int outNode(${k.cls} v) {
    Integer found = outIndex.get(v); if (found != null) return found;
    java.util.ArrayList<${k.cls}> q = new java.util.ArrayList<>(); q.add(v); outIndex.put(v, outRows.size()); outRows.add(null);
    for (int k = 0; k < q.size(); k++) { ${k.cls} n = q.get(k); java.util.ArrayList<${k.cls}> next = new java.util.ArrayList<>(); ${k.links.map(l => `next.add(n.${l}); `).join('')}${k.lists.map(l => `if (n.${l} != null) next.addAll(n.${l}); `).join('')}for (${k.cls} x : next) if (x != null && !outIndex.containsKey(x)) { if (outRows.size() >= 1000000) throw new IllegalStateException("Returned structure is too large"); outIndex.put(x, outRows.size()); outRows.add(null); q.add(x); } }
    for (${k.cls} n : q) { StringBuilder r = new StringBuilder("[\\"${name}\\","); Integer in = inputRows.get(n); r.append(in == null ? "null" : in.toString()); ${k.values.map(([f]) => `r.append(','); enc(r, n.${f}); `).join('')}${k.links.map(l => `r.append(','); r.append(n.${l} == null ? "null" : outIndex.get(n.${l}).toString()); `).join('')}${k.lists.map(l => `r.append(",["); if (n.${l} != null) for (int m = 0; m < n.${l}.size(); m++) { if (m > 0) r.append(','); r.append(outIndex.get(n.${l}.get(m))); } r.append(']'); `).join('')}r.append(']'); outRows.set(outIndex.get(n), r.toString()); }
    return outIndex.get(v);
  }
`).join('')
  const create = kinds.map(([name, k]) => `      if (${javaString(name)}.equals(r.get(0))) { ${k.cls} n = new ${k.cls}(); ${k.values.map(([f, t], i) => `n.${f} = d_${t === 'bool' ? 'bool' : t}(r.get(${1 + i})); `).join('')}nodes.add(n); inputRows.put(n, i); continue; }\n`).join('')
  const link = kinds.map(([name, k]) => `      if (${javaString(name)}.equals(r.get(0))) { ${k.cls} n = (${k.cls}) nodes.get(i); int at = ${1 + k.values.length}; ${k.links.map(l => `n.${l} = r.get(at) == null ? null : (${k.cls}) nodes.get(d_int(r.get(at))); at++; `).join('')}${k.lists.map(l => `n.${l} = new java.util.ArrayList<>(); for (Object x : (java.util.List<Object>) r.get(at)) n.${l}.add((${k.cls}) nodes.get(d_int(x))); at++; `).join('')}}\n`).join('')
  return `  static java.util.ArrayList<Object> nodes = new java.util.ArrayList<>(); static java.util.IdentityHashMap<Object, Integer> inputRows = new java.util.IdentityHashMap<>();
  static java.util.ArrayList<String> outRows = new java.util.ArrayList<>(); static java.util.IdentityHashMap<Object, Integer> outIndex = new java.util.IdentityHashMap<>();
${out}  static void loadTable(Object o) {
    java.util.List<Object> rows = (java.util.List<Object>) o; nodes.clear(); inputRows.clear(); outRows.clear(); outIndex.clear();
    for (int i = 0; i < rows.size(); i++) {
      java.util.List<Object> r = (java.util.List<Object>) rows.get(i);
${create}      throw new IllegalArgumentException("Unknown node kind in the input table");
    }
    for (int i = 0; i < rows.size(); i++) {
      java.util.List<Object> r = (java.util.List<Object>) rows.get(i);
${link}    }
  }
  static String wrap(String value) { return "{\\"n\\":[" + String.join(",", outRows) + "],\\"v\\":" + value + "}"; }
`
}

/** API stub classes, the global API base class, and the interactor client; calls hold one lock, so threads may share the APIs. */
function javaApis(spec: ProblemInterface): string {
  if (spec.kind === 'codec' || !spec.apis?.length) return ''
  const classes = spec.apis.map(api => {
    const methods = api.methods.map(m => {
      const returns = m.returns === 'void' ? 'void' : javaType(typeOf(m.returns))
      const args = m.params.map((p, i) => `${i ? "a.append(','); " : ''}${typeOf(p.type).tag === 'buffer' ? 'a.append("null");' : `Main.enc(a, ${p.name});`} `).join('')
      const writes = m.params.map((p, i) => typeOf(p.type).tag === 'buffer' ? `if (index == ${i}) text.getChars(0, text.length(), ${p.name}, 0); ` : '').join('')
      const target = m.returns === 'void' ? null : typeOf(m.returns)
      const result = target === null ? '' : target.tag === 'object' ? ` if (r.get(0) == null) return null; StringBuilder h = new StringBuilder(); Main.enc(h, r.get(0)); return new ${target.name}(h.toString());` : ` return Main.d_${mangle(target)}(r.get(0));`
      return `  public ${returns} ${m.name}(${m.params.map(p => `${javaType(typeOf(p.type))} ${p.name}`).join(', ')}) { StringBuilder a = new StringBuilder("["); ${args}a.append(']'); java.util.List<Object> r = __ManorIx.call(${api.global ? '"null"' : '__manor_handle'}, ${javaString(m.name)}, a.toString());${writes ? ` if (r.size() > 1) for (Object w : (java.util.List<Object>) r.get(1)) { java.util.List<Object> pair = (java.util.List<Object>) w; int index = Main.d_int(pair.get(0)); String text = (String) pair.get(1); ${writes}}` : ''}${result} }\n`
    }).join('')
    return api.global ? `class ${api.name} {\n${methods}}\n` : `class ${api.name} {\n  final String __manor_handle;\n  ${api.name}(String handle) { __manor_handle = handle; }\n${methods}}\n`
  }).join('')
  return `${classes}final class __ManorAbort extends Error { __ManorAbort(String message) { super(message, null, false, false); } }
@SuppressWarnings("unchecked")
final class __ManorIx {
  static java.io.BufferedWriter to; static java.io.BufferedReader from; static String aborted = null;
  static void start() throws java.io.IOException {
    Process p = new ProcessBuilder("python3", "-I", "-c", ${javaString(interactorProgram(spec.interactor ?? ''))}).redirectError(ProcessBuilder.Redirect.INHERIT).start();
    to = new java.io.BufferedWriter(new java.io.OutputStreamWriter(p.getOutputStream(), java.nio.charset.StandardCharsets.UTF_8));
    from = new java.io.BufferedReader(new java.io.InputStreamReader(p.getInputStream(), java.nio.charset.StandardCharsets.UTF_8));
  }
  static synchronized String send(String message) { try { to.write(message); to.write('\\n'); to.flush(); String line = from.readLine(); if (line == null) throw new IllegalStateException("The interactor stopped"); return line; } catch (java.io.IOException e) { throw new IllegalStateException("The interactor stopped", e); } }
  static synchronized java.util.List<Object> call(String handle, String method, String args) {
    if (aborted != null) throw new __ManorAbort(aborted);
    Object r = Main.parse(send("[\\"call\\"," + handle + "," + ${javaString('"')} + method + ${javaString('",')} + args + "]"));
    if (r instanceof String) { aborted = (String) r; throw new __ManorAbort(aborted); }
    return (java.util.List<Object>) r;
  }
  static void begin(String values) { aborted = null; send("[\\"case\\"," + values + "]"); }
  static String finish(String answer) { String reply = send("[\\"end\\"," + answer + "]"); return reply.substring(1, reply.length() - 1); }
}
`
}

/** Declares one solution argument; an API object is a stub with its parameter name as handle. */
function javaArgument(spec: ProblemInterface, name: string, type: string, source: string, handle = name): string {
  const t = typeOf(type)
  if (t.tag === 'object' && !(spec.kind === 'class' && t.name === spec.className)) return `${t.name} ${name} = new ${t.name}(${javaString(JSON.stringify(handle))});`
  return `${javaType(t)} ${name} = d_${mangle(t)}(${source});`
}

function javaConcurrent(spec: ClassInterface): string {
  const cases = spec.methods.map(m => {
    const args = m.params.map((p, i) => {
      const t = typeOf(p.type)
      if (t.tag === 'callback') return t.int ? `IntConsumer p${i} = x -> record.accept(Integer.toString(x)); ` : `StringBuilder t${i} = new StringBuilder(); enc(t${i}, c.get(${i})); String s${i} = t${i}.toString(); Runnable p${i} = () -> record.accept(s${i}); `
      return `${javaType(t)} p${i} = d_${mangle(t)}(c.get(${i})); `
    }).join('')
    const call = `obj.${m.name}(${m.params.map((_, i) => `p${i}`).join(', ')})`
    return `                  case ${javaString(m.name)}: { ${args}${m.returns === 'void' ? `${call};` : `StringBuilder r = new StringBuilder(); enc(r, ${call}); record.accept(r.toString());`} break; }\n`
  }).join('')
  const ctor = spec.constructorParams.map((p, i) => `d_${mangle(typeOf(p.type))}(ctorArgs.get(${i}))`).join(', ')
  return `        java.util.List<Object> ctorArgs = (java.util.List<Object>) parse(lines.get(base)), scripts = (java.util.List<Object>) parse(lines.get(base + 1));
        final ${spec.className} obj = new ${spec.className}(${ctor});
        final java.util.List<String> log = java.util.Collections.synchronizedList(new java.util.ArrayList<>());
        final java.util.function.Consumer<String> record = log::add;
        final Throwable[] failure = new Throwable[1];
        final int[] done = new int[1];
        final int total = scripts.size();
        java.util.ArrayList<Thread> workers = new java.util.ArrayList<>();
        for (Object script : scripts) {
          Thread worker = new Thread(() -> {
            try {
              for (Object stepObject : (java.util.List<Object>) script) {
                java.util.List<Object> step = (java.util.List<Object>) stepObject; String name = (String) step.get(0); java.util.List<Object> c = (java.util.List<Object>) step.get(1);
                if (name.equals("$sleep")) { Thread.sleep(Long.parseLong(((__ManorNumber) c.get(0)).text)); continue; }
                if (name.equals("$join")) { synchronized (done) { while (done[0] < total - 1) done.wait(); } continue; }
                switch (name) {
${cases}                  default: throw new IllegalArgumentException("Unknown operation: " + name);
                }
              }
            } catch (Throwable error) { synchronized (failure) { if (failure[0] == null) failure[0] = error; } }
            synchronized (done) { done[0]++; done.notifyAll(); }
          });
          workers.add(worker); worker.start(); Thread.sleep(2);
        }
        for (Thread worker : workers) worker.join();
        if (failure[0] != null) throw failure[0];
        out.append('[').append(String.join(",", log)).append(']');
`
}

export function javaDriver(spec: ProblemInterface): string {
  useSpec(spec)
  const meta = driverMeta(spec)
  const width = meta.width
  const head = `${javaLibrary(spec)}  public static void main(String[] args) throws Exception {\n${meta.interactive ? '    __ManorIx.start();\n' : ''}    java.util.List<String> lines = lines();\n    if (lines.isEmpty() || lines.size() % ${width} != 0) throw new IllegalArgumentException("Each test case needs ${width} input lines, one JSON value per line; received " + lines.size() + " lines");\n    java.io.PrintStream stdout = System.out;\n    for (int i = 0; i * ${width} < lines.size(); i++) {\n      long started = System.nanoTime();\n      StringBuilder out = new StringBuilder();\n      try {\n        final int base = i * ${width};\n`
  const reset = tracksInputs(nodeKindOf(spec)) ? '        inputs.clear();\n' : ''
  const tail = `      } catch (Throwable error) { System.out.flush(); error.printStackTrace(); System.err.flush(); out = new StringBuilder("!"); }\n      stdout.print("\\u001eMANOR " + i + " " + ((System.nanoTime() - started) / 1000000) + " " + out + "\\n");\n      stdout.flush();\n    }\n    java.nio.file.Path status = java.nio.file.Paths.get("/proc/self/status");\n    if (java.nio.file.Files.exists(status)) for (String line : java.nio.file.Files.readAllLines(status)) if (line.startsWith("VmHWM:")) stdout.print("\\u001eMANOR-PEAK " + line.replaceAll("[^0-9]", "") + "\\n");\n    stdout.flush();\n    System.exit(0);\n  }\n}\n${javaApis(spec)}${meta.nested ? nestedImplementations.java : ''}`
  if (spec.kind === 'codec') {
    const t = typeOf(spec.encode.param.type)
    const { ser, deser } = codecInstances(spec, `new ${spec.className}()`)
    return head + reset + `        ${javaType(t)} a0 = d_${mangle(t)}(parse(lines.get(base)));\n        ${spec.className} ser = ${ser}, deser = ${deser};\n        ${javaEmit(spec.decode.returns, `deser.${spec.decode.name}(ser.${spec.encode.name}(a0))`)};\n` + tail
  }
  if (spec.kind === 'class' && spec.concurrency) return head + javaConcurrent(spec) + tail
  const offset = meta.table ? 1 : 0
  const line = (name: string): string => `parse(lines.get(base + ${offset + meta.inputs.indexOf(name)}))`
  const table = meta.table ? '        loadTable(parse(lines.get(base)));\n' : ''
  const emitWrapped = (type: string, expression: string): string => meta.wrap ? `{ StringBuilder v = new StringBuilder(); enc(v, ${expression}); out.append(wrap(v.toString())); }` : javaEmit(type, expression, meta.table) + ';'
  let answer: string
  if (spec.kind === 'function') {
    const args = spec.params.map((p, i) => `        ${javaArgument(spec, `a${i}`, p.type, line(p.name), p.name)}\n`).join('')
    const call = `new Solution().${spec.name}(${spec.params.map((_, i) => `a${i}`).join(', ')})`
    const index = spec.output.mode === 'return' ? -1 : spec.params.findIndex(p => p.name === (spec.output as { param: string }).param)
    const emit = spec.output.mode === 'return' ? (spec.returns === 'void' ? `        ${call};\n        out.append("null");\n` : `        ${emitWrapped(spec.returns, call)}\n`)
      : spec.output.mode === 'param' ? `        ${call};\n        ${emitWrapped(spec.params[index].type, `a${index}`)}\n`
      : typeOf(spec.params[index].type).tag === 'buffer' ? `        int k = Math.max(0, Math.min(${call}, a${index}.length));\n        str(out, new String(a${index}, 0, k));\n`
      : `        int k = Math.max(0, Math.min(${call}, java.lang.reflect.Array.getLength(a${index})));\n        enc(out, java.util.Arrays.copyOfRange(a${index}, 0, k));\n`
    answer = args + emit
  } else {
    const ctor = spec.constructorParams.map((p, i) => `d_${mangle(typeOf(p.type))}(((java.util.List<Object>) calls.get(0)).get(${i}))`).join(', ')
    const cases = spec.methods.map(m => {
      const args = m.params.map((p, i) => `${javaType(typeOf(p.type))} p${i} = d_${mangle(typeOf(p.type))}(c.get(${i})); `).join('')
      const call = `obj.${m.name}(${m.params.map((_, i) => `p${i}`).join(', ')})`
      const prefix = m.output === undefined ? -1 : m.params.findIndex(p => p.name === m.output!.param)
      const emit = prefix >= 0 ? `int k = Math.max(0, Math.min(${call}, p${prefix}.length)); str(out, new String(p${prefix}, 0, k));` : m.returns === 'void' ? `${call}; out.append("null");` : `${javaEmit(m.returns, call)};`
      return `            case ${javaString(m.name)}: { ${args}${emit} break; }\n`
    }).join('')
    answer = `        java.util.List<Object> ops = (java.util.List<Object>) parse(lines.get(base)), calls = (java.util.List<Object>) parse(lines.get(base + 1));\n        if (ops.size() != calls.size() || ops.isEmpty() || !${javaString(spec.className)}.equals(ops.get(0))) throw new IllegalArgumentException("Operations must start with the class name and match the argument arrays");\n        ${spec.className} obj = new ${spec.className}(${ctor});\n        out.append("[null");\n        for (int j = 1; j < ops.size(); j++) {\n          java.util.List<Object> c = (java.util.List<Object>) calls.get(j);\n          out.append(',');\n          switch ((String) ops.get(j)) {\n${cases}            default: throw new IllegalArgumentException("Unknown operation: " + ops.get(j));\n          }\n        }\n        out.append(']');\n`
  }
  if (!meta.interactive) return head + reset + table + answer + tail
  const values = `"{" ${meta.inputs.map((name, i) => `+ ${javaString((i ? ',' : '') + JSON.stringify(name) + ':')} + lines.get(base + ${i}) `).join('')}+ "}"`
  return head + reset + `        __ManorIx.begin(${values});\n        boolean stopped = false;\n        try {\n${answer}        } catch (__ManorAbort stop) { out = new StringBuilder(); str(out, stop.getMessage()); stopped = true; }\n        if (!stopped) out = new StringBuilder(__ManorIx.finish(out.toString()));\n` + tail
}
