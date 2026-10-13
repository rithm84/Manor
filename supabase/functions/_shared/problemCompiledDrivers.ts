/** Hidden drivers for compiled languages. Each parses JSON input lines into the declared types, calls the solution, and prints JSON. */
import type { CodecInterface, HarnessType, NodeKind, ProblemInterface } from './problemInterface.ts'
import { cppType, nodeKindOf, tracksInputs, typeOf, typeTexts, upperFirst, usesNode, javaType, goType } from './problemInterface.ts'
import { cppNodeCode, goNodeCode, javaNodeCode } from './problemNodeDrivers.ts'

function interfaceTypes(spec: ProblemInterface): HarnessType[] {
  const all: HarnessType[] = []
  const add = (t: HarnessType): void => { if (t.tag === 'array' || t.tag === 'list') add(t.item); all.push(t) }
  typeTexts(spec).forEach(text => add(typeOf(text)))
  return all
}
function mangle(t: HarnessType): string { return t.tag === 'array' ? mangle(t.item) + '_A' : t.tag === 'list' ? mangle(t.item) + '_L' : t.name }
function uniqueTypes(spec: ProblemInterface): HarnessType[] {
  const seen = new Map<string, HarnessType>()
  for (const t of interfaceTypes(spec)) if (!seen.has(mangle(t))) seen.set(mangle(t), t)
  return [...seen.values()]
}
function inputCount(spec: ProblemInterface): number { return spec.kind === 'function' ? spec.params.length : spec.kind === 'codec' ? 1 : 2 }
function nodeEncoder(spec: ProblemInterface, code: (kind: NodeKind) => { readonly encode: string }): string { const kind = nodeKindOf(spec); return kind === null ? '' : code(kind).encode + '\n' }
/** Separate instances unless the problem shares one, as LeetCode calls each codec. */
function codecInstances(spec: CodecInterface, create: string): { readonly ser: string; readonly deser: string } { return { ser: create, deser: spec.sharedInstance ? 'ser' : create } }

// ---------- C++ ----------
const cppLibrary = `
#include <sys/resource.h>
namespace __manor {
struct J { int t = 0; bool b = false; std::string s; std::vector<J> a; };
struct Parser {
  const std::string& x; size_t i = 0;
  void ws() { while (i < x.size() && std::isspace((unsigned char)x[i])) i++; }
  static void utf8(std::string& out, unsigned code) {
    if (code < 0x80) out += (char)code;
    else if (code < 0x800) { out += (char)(0xC0 | (code >> 6)); out += (char)(0x80 | (code & 0x3F)); }
    else if (code < 0x10000) { out += (char)(0xE0 | (code >> 12)); out += (char)(0x80 | ((code >> 6) & 0x3F)); out += (char)(0x80 | (code & 0x3F)); }
    else { out += (char)(0xF0 | (code >> 18)); out += (char)(0x80 | ((code >> 12) & 0x3F)); out += (char)(0x80 | ((code >> 6) & 0x3F)); out += (char)(0x80 | (code & 0x3F)); }
  }
  J parse() {
    ws(); J j;
    if (i >= x.size()) throw std::runtime_error("Unexpected end of JSON input");
    char c = x[i];
    if (c == '[') {
      i++; j.t = 4; ws();
      if (i < x.size() && x[i] == ']') { i++; return j; }
      while (true) { j.a.push_back(parse()); ws(); if (i < x.size() && x[i] == ',') { i++; continue; } if (i < x.size() && x[i] == ']') { i++; break; } throw std::runtime_error("Malformed JSON array"); }
      return j;
    }
    if (c == '"') {
      j.t = 3; i++;
      while (i < x.size() && x[i] != '"') {
        if (x[i] != '\\\\') { j.s += x[i++]; continue; }
        char e = x[++i]; i++;
        if (e == 'n') j.s += '\\n'; else if (e == 't') j.s += '\\t'; else if (e == 'r') j.s += '\\r'; else if (e == 'b') j.s += '\\b'; else if (e == 'f') j.s += '\\f';
        else if (e == 'u') {
          unsigned code = (unsigned)std::stoul(x.substr(i, 4), nullptr, 16); i += 4;
          if (code >= 0xD800 && code < 0xDC00 && i + 6 <= x.size() && x[i] == '\\\\' && x[i + 1] == 'u') { unsigned low = (unsigned)std::stoul(x.substr(i + 2, 4), nullptr, 16); i += 6; code = 0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00); }
          utf8(j.s, code);
        } else j.s += e;
      }
      i++; return j;
    }
    if (x.compare(i, 4, "true") == 0) { i += 4; j.t = 1; j.b = true; return j; }
    if (x.compare(i, 5, "false") == 0) { i += 5; j.t = 1; return j; }
    if (x.compare(i, 4, "null") == 0) { i += 4; return j; }
    size_t start = i;
    while (i < x.size() && (std::isdigit((unsigned char)x[i]) || x[i] == '-' || x[i] == '+' || x[i] == '.' || x[i] == 'e' || x[i] == 'E')) i++;
    if (start == i) throw std::runtime_error("Malformed JSON value");
    j.t = 2; j.s = x.substr(start, i - start); return j;
  }
};
inline J parse(const std::string& text) { Parser p{text}; J j = p.parse(); p.ws(); if (p.i != text.size()) throw std::runtime_error("Trailing characters after JSON value"); return j; }
inline void dec(const J& j, int& v) { v = (int)std::stoll(j.s); }
inline void dec(const J& j, long long& v) { v = std::stoll(j.s); }
inline void dec(const J& j, double& v) { v = std::stod(j.s); }
inline void dec(const J& j, bool& v) { v = j.b; }
inline void dec(const J& j, std::string& v) { v = j.s; }
inline void dec(const J& j, char& v) { v = j.s.empty() ? '\\0' : j.s[0]; }
inline void dec(const J& j, std::vector<bool>& v) { v.assign(j.a.size(), false); for (size_t k = 0; k < j.a.size(); k++) v[k] = j.a[k].b; }
@NODE_DECODERS@
template <class T> void dec(const J& j, std::vector<T>& v) { v.clear(); v.resize(j.a.size()); for (size_t k = 0; k < j.a.size(); k++) dec(j.a[k], v[k]); }
inline void enc(std::string& o, int v) { o += std::to_string(v); }
inline void enc(std::string& o, long long v) { o += std::to_string(v); }
inline void enc(std::string& o, long v) { o += std::to_string(v); }
inline void enc(std::string& o, unsigned v) { o += std::to_string(v); }
inline void enc(std::string& o, unsigned long v) { o += std::to_string(v); }
inline void enc(std::string& o, unsigned long long v) { o += std::to_string(v); }
inline void enc(std::string& o, double v) {
  if (!std::isfinite(v)) throw std::runtime_error("Returned a non-finite number");
  char buffer[64];
  for (int precision = 15; precision <= 17; precision++) { std::snprintf(buffer, sizeof buffer, "%.*g", precision, v); if (std::strtod(buffer, nullptr) == v) break; }
  o += buffer;
}
inline void enc(std::string& o, float v) { enc(o, (double)v); }
inline void enc(std::string& o, bool v) { o += v ? "true" : "false"; }
inline void enc(std::string& o, const std::string& v) {
  o += '"';
  for (unsigned char c : v) {
    if (c == '"') o += "\\\\\\""; else if (c == '\\\\') o += "\\\\\\\\"; else if (c == '\\n') o += "\\\\n"; else if (c == '\\t') o += "\\\\t"; else if (c == '\\r') o += "\\\\r";
    else if (c < 0x20) { char buffer[8]; std::snprintf(buffer, sizeof buffer, "\\\\u%04x", c); o += buffer; }
    else o += (char)c;
  }
  o += '"';
}
inline void enc(std::string& o, const char* v) { enc(o, std::string(v)); }
inline void enc(std::string& o, char v) { enc(o, std::string(1, v)); }
inline void enc(std::string& o, const std::vector<bool>& v) { o += '['; for (size_t k = 0; k < v.size(); k++) { if (k) o += ','; enc(o, (bool)v[k]); } o += ']'; }
@NODE_ENCODERS@
template <class T> void enc(std::string& o, const std::vector<T>& v) { o += '['; for (size_t k = 0; k < v.size(); k++) { if (k) o += ','; enc(o, v[k]); } o += ']'; }
}
`
const cppListNode = {
  decode: 'inline void dec(const J& j, ListNode*& v) { v = nullptr; for (size_t k = j.a.size(); k-- > 0;) v = new ListNode(std::stoi(j.a[k].s), v); }',
  encode: 'inline void enc(std::string& o, ListNode* v) { o += \'[\'; size_t n = 0; while (v != nullptr) { if (n++) o += \',\'; if (n > 1000000) throw std::runtime_error("Returned list does not terminate"); o += std::to_string(v->val); v = v->next; } o += \']\'; }',
}
const cppTreeNode = {
  decode: 'inline void dec(const J& j, TreeNode*& v) { v = nullptr; if (j.a.empty() || j.a[0].t == 0) return; v = new TreeNode(std::stoi(j.a[0].s)); std::vector<TreeNode*> q{v}; size_t i = 1, k = 0; while (i < j.a.size()) { TreeNode* node = q[k++]; if (j.a[i].t != 0) { node->left = new TreeNode(std::stoi(j.a[i].s)); q.push_back(node->left); } i++; if (i < j.a.size() && j.a[i].t != 0) { node->right = new TreeNode(std::stoi(j.a[i].s)); q.push_back(node->right); } i++; } }',
  encode: 'inline void enc(std::string& o, TreeNode* v) { std::vector<TreeNode*> q{v}; std::vector<std::string> out; for (size_t k = 0; k < q.size(); k++) { TreeNode* node = q[k]; if (node == nullptr) { out.push_back("null"); continue; } out.push_back(std::to_string(node->val)); q.push_back(node->left); q.push_back(node->right); if (q.size() > 2000000) throw std::runtime_error("Returned tree is too large"); } while (!out.empty() && out.back() == "null") out.pop_back(); o += \'[\'; for (size_t k = 0; k < out.size(); k++) { if (k) o += \',\'; o += out[k]; } o += \']\'; }',
}

function cppMain(width: number, body: string): string {
  return `int main() {\n  std::vector<std::string> __lines; std::string __line;\n  while (std::getline(std::cin, __line)) if (__line.find_first_not_of(" \\t\\r") != std::string::npos) __lines.push_back(__line);\n  if (__lines.empty() || __lines.size() % ${width} != 0) { std::cerr << "Each test case needs ${width} input lines, one JSON value per line; received " << __lines.size() << " lines\\n"; return 1; }\n  for (size_t __i = 0; __i * ${width} < __lines.size(); __i++) {\n    auto __t0 = std::chrono::steady_clock::now();\n    std::string __o;\n    try {\n      [&]() {\n${body}      }();\n    } catch (const std::exception& __e) { std::cout.flush(); std::cerr << __e.what() << "\\n"; __o = "!"; }\n    catch (...) { std::cout.flush(); std::cerr << "Unknown exception\\n"; __o = "!"; }\n    long long __ms = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - __t0).count();\n    std::cout << "\\x1eMANOR " << __i << ' ' << __ms << ' ' << __o << '\\n' << std::flush;\n  }\n  struct rusage __usage; getrusage(RUSAGE_SELF, &__usage);\n  std::cout << "\\x1eMANOR-PEAK " << __usage.ru_maxrss << '\\n' << std::flush;\n  return 0;\n}\n`
}

export function cppDriver(spec: ProblemInterface): string {
  const kind = nodeKindOf(spec)
  const library = cppLibrary
    .replace('@NODE_DECODERS@', [usesNode(spec, 'ListNode') ? cppListNode.decode : '', usesNode(spec, 'TreeNode') ? cppTreeNode.decode : '', kind === null ? '' : cppNodeCode(kind).decode].join('\n'))
    .replace('@NODE_ENCODERS@', [usesNode(spec, 'ListNode') ? cppListNode.encode : '', usesNode(spec, 'TreeNode') ? cppTreeNode.encode : '', kind === null ? '' : cppNodeCode(kind).encode].join('\n'))
  const declare = (name: string, type: string, source: string): string => `${cppType(typeOf(type))} ${name}{}; __manor::dec(${source}, ${name});`
  const reset = tracksInputs(kind) ? '        __manor::inputs.clear();\n' : ''
  if (spec.kind === 'codec') {
    const { ser, deser } = codecInstances(spec, `new ${spec.className}()`)
    return `\n${library}\n${cppMain(1, `${reset}        ${declare('__a0', spec.encode.param.type, '__manor::parse(__lines[__i])')}\n        ${spec.className}* ser = ${ser}; ${spec.className}* deser = ${deser};\n        auto __e = ser->${spec.encode.name}(__a0);\n        auto __r = deser->${spec.decode.name}(__e);\n        __manor::enc(__o, __r);\n`)}`
  }
  if (spec.kind === 'function') {
    const width = spec.params.length
    const args = spec.params.map((p, i) => `        ${declare(`__a${i}`, p.type, `__manor::parse(__lines[__i * ${width} + ${i}])`)}\n`).join('')
    const call = `__s.${spec.name}(${spec.params.map((_, i) => `__a${i}`).join(', ')})`
    const index = spec.output.mode === 'return' ? -1 : spec.params.findIndex(p => p.name === (spec.output as { param: string }).param)
    const emit = spec.output.mode === 'return' ? `        auto __r = ${call};\n        __manor::enc(__o, __r);\n`
      : spec.output.mode === 'param' ? `        ${call};\n        __manor::enc(__o, __a${index});\n`
      : `        long long __k = ${call};\n        __k = std::max(0LL, std::min<long long>(__k, (long long)__a${index}.size()));\n        ${cppType(typeOf(spec.params[index].type))} __p(__a${index}.begin(), __a${index}.begin() + __k);\n        __manor::enc(__o, __p);\n`
    return `\n${library}\n${cppMain(width, `${reset}${args}        Solution __s;\n${emit}`)}`
  }
  const branches = spec.methods.map(m => {
    const args = m.params.map((p, i) => `${declare(`__p${i}`, p.type, `__c.a.at(${i})`)} `).join('')
    const call = `__obj->${m.name}(${m.params.map((_, i) => `__p${i}`).join(', ')})`
    return `          else if (__op == ${JSON.stringify(m.name)}) { ${args}${m.returns === 'void' ? `${call}; __o += "null";` : `auto __r = ${call}; __manor::enc(__o, __r);`} }\n`
  }).join('')
  const ctorArgs = spec.constructorParams.map((p, i) => `        ${declare(`__k${i}`, p.type, `__calls.a.at(0).a.at(${i})`)}\n`).join('')
  const body = `${reset}        __manor::J __ops = __manor::parse(__lines[__i * 2]), __calls = __manor::parse(__lines[__i * 2 + 1]);\n        if (__ops.a.size() != __calls.a.size() || __ops.a.empty() || __ops.a[0].s != ${JSON.stringify(spec.className)}) throw std::runtime_error("Operations must start with the class name and match the argument arrays");\n${ctorArgs}        ${spec.className}* __obj = new ${spec.className}(${spec.constructorParams.map((_, i) => `__k${i}`).join(', ')});\n        __o = "[null";\n        for (size_t __j = 1; __j < __ops.a.size(); __j++) {\n          const std::string& __op = __ops.a[__j].s; const __manor::J& __c = __calls.a[__j]; __o += ',';\n          if (false) {}\n${branches}          else throw std::runtime_error("Unknown operation: " + __op);\n        }\n        __o += ']';\n`
  return `\n${library}\n${cppMain(2, body)}`
}

// ---------- Java ----------
function javaDecoder(t: HarnessType): string {
  const name = 'd_' + mangle(t)
  const head = `  static ${javaType(t)} ${name}(Object o) {`
  if (t.tag === 'scalar') return head + {
    int: ' return Integer.parseInt(((__ManorNumber) o).text); }', long: ' return Long.parseLong(((__ManorNumber) o).text); }', double: ' return Double.parseDouble(((__ManorNumber) o).text); }',
    bool: ' return (Boolean) o; }', string: ' return (String) o; }', char: ' return ((String) o).charAt(0); }',
  }[t.name]
  if (t.tag === 'node' && t.name !== 'ListNode' && t.name !== 'TreeNode') return javaNodeCode(t.name).decode
  if (t.tag === 'node' && t.name === 'ListNode') return head + ' java.util.List<Object> l = (java.util.List<Object>) o; ListNode head = null; for (int i = l.size() - 1; i >= 0; i--) head = new ListNode(d_int(l.get(i)), head); return head; }'
  if (t.tag === 'node') return head + ' java.util.List<Object> l = (java.util.List<Object>) o; if (l.isEmpty() || l.get(0) == null) return null; TreeNode root = new TreeNode(d_int(l.get(0))); java.util.ArrayList<TreeNode> q = new java.util.ArrayList<>(); q.add(root); int i = 1, k = 0; while (i < l.size()) { TreeNode node = q.get(k++); if (l.get(i) != null) { node.left = new TreeNode(d_int(l.get(i))); q.add(node.left); } i++; if (i < l.size() && l.get(i) != null) { node.right = new TreeNode(d_int(l.get(i))); q.add(node.right); } i++; } return root; }'
  const item = 'd_' + mangle(t.item)
  if (t.tag === 'list') return head + ` java.util.List<Object> l = (java.util.List<Object>) o; ${javaType(t)} r = new java.util.ArrayList<>(); for (Object x : l) r.add(${item}(x)); return r; }`
  const element = javaType(t.item)
  const create = 'new ' + element.replace(/^([^[]+)/, '$1[l.size()]')
  return head + ` java.util.List<Object> l = (java.util.List<Object>) o; ${javaType(t)} r = ${create}; for (int i = 0; i < r.length; i++) r[i] = ${item}(l.get(i)); return r; }`
}
/** Node types print through typed encoders so a null answer reads as an empty structure. */
function javaEmit(type: string, expression: string): string {
  const t = typeOf(type)
  if (t.tag === 'node') return t.name === 'ListNode' || t.name === 'TreeNode' ? `encNode(out, ${expression})` : `e_${t.name}(out, ${expression})`
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
${usesNode(spec, 'ListNode') ? '    if (v instanceof ListNode) { b.append(\'[\'); ListNode node = (ListNode) v; int n = 0; while (node != null) { if (n++ > 0) b.append(\',\'); if (n > 1000000) throw new IllegalStateException("Returned list does not terminate"); b.append(node.val); node = node.next; } b.append(\']\'); return; }\n' : ''}${usesNode(spec, 'TreeNode') ? '    if (v instanceof TreeNode) { java.util.ArrayList<TreeNode> q = new java.util.ArrayList<>(); q.add((TreeNode) v); java.util.ArrayList<String> out = new java.util.ArrayList<>(); for (int k = 0; k < q.size(); k++) { TreeNode node = q.get(k); if (node == null) { out.add("null"); continue; } out.add(Integer.toString(node.val)); q.add(node.left); q.add(node.right); } while (!out.isEmpty() && out.get(out.size() - 1).equals("null")) out.remove(out.size() - 1); b.append(\'[\').append(String.join(",", out)).append(\']\'); return; }\n' : ''}    throw new IllegalStateException("Unsupported return value: " + v.getClass().getName());
  }
${[...new Set(['int', ...uniqueTypes(spec).map(mangle)])].map(key => javaDecoder(key === 'int' ? { tag: 'scalar', name: 'int' } : uniqueTypes(spec).find(t => mangle(t) === key)!)).join('\n')}
${nodeEncoder(spec, javaNodeCode)}  static java.util.List<String> lines() throws java.io.IOException { java.io.BufferedReader r = new java.io.BufferedReader(new java.io.InputStreamReader(System.in, java.nio.charset.StandardCharsets.UTF_8)); java.util.ArrayList<String> out = new java.util.ArrayList<>(); String line; while ((line = r.readLine()) != null) if (!line.isBlank()) out.add(line); return out; }
`

export function javaDriver(spec: ProblemInterface): string {
  const width = inputCount(spec)
  const head = `${javaLibrary(spec)}  public static void main(String[] args) throws Exception {\n    java.util.List<String> lines = lines();\n    if (lines.isEmpty() || lines.size() % ${width} != 0) throw new IllegalArgumentException("Each test case needs ${width} input lines, one JSON value per line; received " + lines.size() + " lines");\n    java.io.PrintStream stdout = System.out;\n    for (int i = 0; i * ${width} < lines.size(); i++) {\n      long started = System.nanoTime();\n      StringBuilder out = new StringBuilder();\n      try {\n        final int base = i * ${width};\n`
  const reset = tracksInputs(nodeKindOf(spec)) ? '        inputs.clear();\n' : ''
  const tail = `      } catch (Throwable error) { System.out.flush(); error.printStackTrace(); System.err.flush(); out = new StringBuilder("!"); }\n      stdout.print("\\u001eMANOR " + i + " " + ((System.nanoTime() - started) / 1000000) + " " + out + "\\n");\n      stdout.flush();\n    }\n    java.nio.file.Path status = java.nio.file.Paths.get("/proc/self/status");\n    if (java.nio.file.Files.exists(status)) for (String line : java.nio.file.Files.readAllLines(status)) if (line.startsWith("VmHWM:")) stdout.print("\\u001eMANOR-PEAK " + line.replaceAll("[^0-9]", "") + "\\n");\n    stdout.flush();\n  }\n}\n`
  if (spec.kind === 'codec') {
    const t = typeOf(spec.encode.param.type)
    const { ser, deser } = codecInstances(spec, `new ${spec.className}()`)
    return head + reset + `        ${javaType(t)} a0 = d_${mangle(t)}(parse(lines.get(base)));\n        ${spec.className} ser = ${ser}, deser = ${deser};\n        ${javaEmit(spec.decode.returns, `deser.${spec.decode.name}(ser.${spec.encode.name}(a0))`)};\n` + tail
  }
  if (spec.kind === 'function') {
    const args = spec.params.map((p, i) => `        ${javaType(typeOf(p.type))} a${i} = d_${mangle(typeOf(p.type))}(parse(lines.get(base + ${i})));\n`).join('')
    const call = `new Solution().${spec.name}(${spec.params.map((_, i) => `a${i}`).join(', ')})`
    const index = spec.output.mode === 'return' ? -1 : spec.params.findIndex(p => p.name === (spec.output as { param: string }).param)
    const emit = spec.output.mode === 'return' ? `        ${javaEmit(spec.returns, call)};\n` : spec.output.mode === 'param' ? `        ${call};\n        ${javaEmit(spec.params[index].type, `a${index}`)};\n`
      : `        int k = Math.max(0, Math.min(${call}, java.lang.reflect.Array.getLength(a${index})));\n        enc(out, java.util.Arrays.copyOfRange(a${index}, 0, k));\n`
    return head + reset + args + emit + tail
  }
  const ctor = spec.constructorParams.map((p, i) => `d_${mangle(typeOf(p.type))}(((java.util.List<Object>) calls.get(0)).get(${i}))`).join(', ')
  const cases = spec.methods.map(m => {
    const args = m.params.map((p, i) => `d_${mangle(typeOf(p.type))}(c.get(${i}))`).join(', ')
    return m.returns === 'void' ? `            case ${JSON.stringify(m.name)}: obj.${m.name}(${args}); out.append("null"); break;\n` : `            case ${JSON.stringify(m.name)}: ${javaEmit(m.returns, `obj.${m.name}(${args})`)}; break;\n`
  }).join('')
  return head + reset + `        java.util.List<Object> ops = (java.util.List<Object>) parse(lines.get(base)), calls = (java.util.List<Object>) parse(lines.get(base + 1));\n        if (ops.size() != calls.size() || ops.isEmpty() || !${JSON.stringify(spec.className)}.equals(ops.get(0))) throw new IllegalArgumentException("Operations must start with the class name and match the argument arrays");\n        ${spec.className} obj = new ${spec.className}(${ctor});\n        out.append("[null");\n        for (int j = 1; j < ops.size(); j++) {\n          java.util.List<Object> c = (java.util.List<Object>) calls.get(j);\n          out.append(',');\n          switch ((String) ops.get(j)) {\n${cases}            default: throw new IllegalArgumentException("Unknown operation: " + ops.get(j));\n          }\n        }\n        out.append(']');\n` + tail
}

// ---------- Go ----------
function goDecoder(t: HarnessType): string {
  const name = '__manor_d_' + mangle(t)
  const head = `func ${name}(v interface{}) ${goType(t)} {`
  const number = (method: string, cast: string): string => ` n, err := v.(__manor_json.Number).${method}(); if err != nil { panic(err) }; return ${cast}(n) }`
  if (t.tag === 'scalar') return head + {
    int: number('Int64', 'int'), long: number('Int64', 'int64'), double: number('Float64', 'float64'),
    bool: ' return v.(bool) }', string: ' return v.(string) }', char: ' return v.(string)[0] }',
  }[t.name]
  if (t.tag === 'node' && t.name !== 'ListNode' && t.name !== 'TreeNode') return goNodeCode(t.name).decode
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
		if name == "ListNode" {
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
${nodeKindOf(spec) === null ? '' : '\t\tif name == "Node" { __manor_e_node(b, v.Interface().(*Node)); return }\n'}		if v.IsNil() { b.WriteString("null"); return }
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
${[...new Set(['int', ...uniqueTypes(spec).map(mangle)])].map(key => goDecoder(key === 'int' ? { tag: 'scalar', name: 'int' } : uniqueTypes(spec).find(t => mangle(t) === key)!)).join('\n')}
${nodeEncoder(spec, goNodeCode)}func __manor_fmt_value(v interface{}) string {
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

export function goDriver(spec: ProblemInterface): string {
  const width = inputCount(spec)
  const reset = tracksInputs(nodeKindOf(spec)) ? '\t__manor_inputs = map[*Node]bool{}\n' : ''
  const run = (body: string): string => `${goLibrary(spec)}func __manor_case(lines []string, out *__manor_strings.Builder) (failed bool) {\n\tdefer func() {\n\t\tif r := recover(); r != nil {\n\t\t\t__manor_os.Stdout.Sync()\n\t\t\t__manor_os.Stderr.WriteString("panic: " + __manor_fmt_value(r) + "\\n")\n\t\t\tfailed = true\n\t\t}\n\t}()\n${reset}${body}\treturn false\n}\n\nfunc main() {\n\tlines := __manor_lines()\n\tif len(lines) == 0 || len(lines)%${width} != 0 { panic("Each test case needs ${width} input lines, one JSON value per line; received " + __manor_strconv.Itoa(len(lines)) + " lines") }\n\tfor i := 0; i*${width} < len(lines); i++ {\n\t\tvar out __manor_strings.Builder\n\t\tstarted := __manor_time_now()\n\t\tfailed := __manor_case(lines[i*${width}:(i+1)*${width}], &out)\n\t\ttext := out.String()\n\t\tif failed { text = "!" }\n\t\t__manor_os.Stdout.WriteString("\\x1eMANOR " + __manor_strconv.Itoa(i) + " " + __manor_strconv.FormatInt(__manor_time_since(started), 10) + " " + text + "\\n")\n\t}\n\tvar usage __manor_syscall.Rusage\n\tif err := __manor_syscall.Getrusage(__manor_syscall.RUSAGE_SELF, &usage); err != nil { panic(err) }\n\t__manor_os.Stdout.WriteString("\\x1eMANOR-PEAK " + __manor_strconv.FormatInt(int64(usage.Maxrss), 10) + "\\n")\n}\n`
  if (spec.kind === 'codec') {
    const { ser, deser } = codecInstances(spec, 'Constructor()')
    return run(`\ta0 := __manor_d_${mangle(typeOf(spec.encode.param.type))}(__manor_parse(lines[0]))\n\tser := ${ser}\n${spec.sharedInstance ? '' : `\tdeser := ${deser}\n`}\t__manor_enc(out, __manor_reflect.ValueOf(${spec.sharedInstance ? 'ser' : 'deser'}.${spec.decode.name}(ser.${spec.encode.name}(a0))))\n`)
  }
  if (spec.kind === 'function') {
    const args = spec.params.map((p, i) => `\ta${i} := __manor_d_${mangle(typeOf(p.type))}(__manor_parse(lines[${i}]))\n`).join('')
    const call = `${spec.name}(${spec.params.map((_, i) => `a${i}`).join(', ')})`
    const index = spec.output.mode === 'return' ? -1 : spec.params.findIndex(p => p.name === (spec.output as { param: string }).param)
    const emit = spec.output.mode === 'return' ? `\t__manor_enc(out, __manor_reflect.ValueOf(${call}))\n` : spec.output.mode === 'param' ? `\t${call}\n\t__manor_enc(out, __manor_reflect.ValueOf(a${index}))\n`
      : `\tk := ${call}\n\tif k < 0 { k = 0 }\n\tif k > len(a${index}) { k = len(a${index}) }\n\t__manor_enc(out, __manor_reflect.ValueOf(a${index}[:k]))\n`
    return run(args + emit)
  }
  const ctor = spec.constructorParams.map((p, i) => `__manor_d_${mangle(typeOf(p.type))}(calls[0].([]interface{})[${i}])`).join(', ')
  const cases = spec.methods.map(m => {
    const args = m.params.map((p, i) => `__manor_d_${mangle(typeOf(p.type))}(c[${i}])`).join(', ')
    return m.returns === 'void' ? `\t\tcase ${JSON.stringify(m.name)}:\n\t\t\tobj.${upperFirst(m.name)}(${args})\n\t\t\tout.WriteString("null")\n` : `\t\tcase ${JSON.stringify(m.name)}:\n\t\t\t__manor_enc(out, __manor_reflect.ValueOf(obj.${upperFirst(m.name)}(${args})))\n`
  }).join('')
  return run(`\tops := __manor_parse(lines[0]).([]interface{})\n\tcalls := __manor_parse(lines[1]).([]interface{})\n\tif len(ops) != len(calls) || len(ops) == 0 || ops[0] != ${JSON.stringify(spec.className)} { panic("Operations must start with the class name and match the argument arrays") }\n\tobj := Constructor(${ctor})\n\tout.WriteString("[null")\n\tfor i := 1; i < len(ops); i++ {\n\t\tc := calls[i].([]interface{})\n\t\t_ = c\n\t\tout.WriteByte(',')\n\t\tswitch ops[i] {\n${cases}\t\tdefault:\n\t\t\tpanic("Unknown operation")\n\t\t}\n\t}\n\tout.WriteByte(']')\n`)
}
