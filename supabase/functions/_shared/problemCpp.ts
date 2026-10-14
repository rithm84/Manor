/** The C++ driver: JSON codecs for every interface type, node tables, the interactor client, and concurrent thread scripts. */
import type { ClassInterface, CodecInterface, HarnessMethod, ProblemInterface } from './problemInterface.ts'
import { cppType, nodeKindOf, tracksInputs, typeOf, usesNode, useSpec } from './problemInterface.ts'
import { cppNodeCode } from './problemNodeDrivers.ts'
import { driverMeta } from './problemDriverMeta.ts'
import { isRecordKind, recordSchemas } from './problemKinds.ts'
import { nestedImplementations } from './problemProvided.ts'
import { interactorProgram } from './problemInteractor.ts'

/** Separate instances unless the problem shares one, as LeetCode calls each codec. */
function codecInstances(spec: CodecInterface, create: string): { readonly ser: string; readonly deser: string } { return { ser: create, deser: spec.sharedInstance ? 'ser' : create } }

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

/** A C++ string literal for arbitrary text; UTF-8 bytes pass through and control characters become octal escapes. */
function cppString(text: string): string {
  let out = '"'
  for (const ch of text) {
    const code = ch.codePointAt(0)!
    if (ch === '"' || ch === '\\') out += '\\' + ch
    else if (ch === '\n') out += '\\n'
    else if (code < 0x20 || code === 0x7f) out += '\\' + code.toString(8).padStart(3, '0')
    else if (ch === '?') out += '\\?'
    else out += ch
  }
  return out + '"'
}

/** Declarations the solution sees before its first line: the provided NestedInteger, the API classes, and the global API functions. */
export function cppPrelude(spec: ProblemInterface): string {
  useSpec(spec)
  const meta = driverMeta(spec)
  const parts = [meta.nested ? nestedImplementations.cpp : '']
  if (spec.kind !== 'codec' && spec.apis?.length) {
    parts.push('#include <unistd.h>\n#include <csignal>\nstruct __ManorAbort { std::string message; };\n')
    for (const api of spec.apis) {
      const signature = (m: HarnessMethod): string => `${m.returns === 'void' ? 'void' : cppType(typeOf(m.returns))} ${m.name}(${m.params.map(p => `${cppType(typeOf(p.type))} ${p.name}`).join(', ')})`
      if (api.global) parts.push(api.methods.map(m => `${signature(m)};\n`).join(''))
      else parts.push(`class ${api.name} {\npublic:\n    std::string __manor_handle;\n    explicit ${api.name}(std::string handle) : __manor_handle(std::move(handle)) {}\n${api.methods.map(m => `    ${signature(m)};\n`).join('')}};\n`)
    }
  }
  return parts.join('')
}

/** Table-mode codecs: input nodes come from the case's table, and returned nodes print as output rows. */
function cppTable(spec: ProblemInterface): string {
  const meta = driverMeta(spec)
  if (!meta.table) return ''
  const kinds = Object.entries(meta.kinds)
  const decoders = kinds.map(([, k]) => `inline void dec(const J& j, ${k.cls}*& v) { v = j.t == 0 ? nullptr : static_cast<${k.cls}*>(nodes.at(std::stoul(j.s))); }\ninline size_t out_node(${k.cls}* v);\ninline void enc(std::string& o, ${k.cls}* v) { if (v == nullptr) o += "null"; else o += std::to_string(out_node(v)); }\n`).join('')
  const outNodes = kinds.map(([name, k]) => `inline size_t out_node(${k.cls}* v) {
  auto found = out_index.find(v); if (found != out_index.end()) return found->second;
  std::vector<${k.cls}*> q{v}; out_index[v] = out_rows.size(); out_rows.emplace_back();
  auto visit = [&](${k.cls}* x) { if (x != nullptr && !out_index.count(x)) { if (out_rows.size() >= 1000000) throw std::runtime_error("Returned structure is too large"); out_index[x] = out_rows.size(); out_rows.emplace_back(); q.push_back(x); } };
  for (size_t k = 0; k < q.size(); k++) { ${k.cls}* n = q[k]; ${k.links.map(l => `visit(n->${l}); `).join('')}${k.lists.map(l => `for (${k.cls}* x : n->${l}) visit(x); `).join('')}}
  for (${k.cls}* n : q) {
    std::string r = "[\\"${name}\\","; auto in = input_rows.find(n); r += in == input_rows.end() ? "null" : std::to_string(in->second);
    ${k.values.map(([v]) => `r += ','; enc(r, n->${v}); `).join('')}${k.links.map(l => `r += ','; r += n->${l} == nullptr ? std::string("null") : std::to_string(out_index[n->${l}]); `).join('')}${k.lists.map(l => `r += ",["; for (size_t m = 0; m < n->${l}.size(); m++) { if (m) r += ','; r += std::to_string(out_index[n->${l}[m]]); } r += ']'; `).join('')}r += ']';
    out_rows[out_index[n]] = r;
  }
  return out_index[v];
}
`).join('')
  const create = kinds.map(([name, k]) => `    if (r.a.at(0).s == "${name}") { ${k.cls}* n = new ${k.cls}(); ${k.values.map(([v], i) => `dec(r.a.at(${1 + i}), n->${v}); `).join('')}nodes.push_back(n); input_rows[n] = i; continue; }\n`).join('')
  const link = kinds.map(([name, k]) => `    if (r.a.at(0).s == "${name}") { ${k.cls}* n = static_cast<${k.cls}*>(nodes[i]); size_t at = ${1 + k.values.length}; ${k.links.map(l => `dec(r.a.at(at++), n->${l}); `).join('')}${k.lists.map(l => `n->${l}.clear(); for (const J& x : r.a.at(at++).a) { ${k.cls}* c = nullptr; dec(x, c); n->${l}.push_back(c); } `).join('')}(void)at; }\n`).join('')
  return `static std::vector<void*> nodes; static std::unordered_map<const void*, size_t> input_rows;
static std::vector<std::string> out_rows; static std::unordered_map<const void*, size_t> out_index;
${decoders}${outNodes}inline void load_table(const J& rows) {
  nodes.clear(); input_rows.clear(); out_rows.clear(); out_index.clear();
  for (size_t i = 0; i < rows.a.size(); i++) {
    const J& r = rows.a[i];
${create}    throw std::runtime_error("Unknown node kind in the input table");
  }
  for (size_t i = 0; i < rows.a.size(); i++) {
    const J& r = rows.a[i];
${link}  }
}
inline std::string wrap(const std::string& value) { std::string o = "{\\"n\\":["; for (size_t k = 0; k < out_rows.size(); k++) { if (k) o += ','; o += out_rows[k]; } return o + "],\\"v\\":" + value + "}"; }
`
}

/** Record, NestedInteger, and raw JSON codecs. */
function cppValues(spec: ProblemInterface): string {
  const meta = driverMeta(spec)
  const records = Object.entries(meta.records).map(([name, fields]) => {
    const pointer = isRecordKind(name) && recordSchemas[name].cppPointer
    const at = pointer ? '->' : '.'
    return pointer
      ? `inline void dec(const J& j, ${name}*& v) { if (j.t == 0) { v = nullptr; return; } v = new ${name}(); ${fields.map(([f], i) => `dec(j.a.at(${i}), v->${f}); `).join('')}}\ninline void enc(std::string& o, ${name}* v) { if (v == nullptr) { o += "null"; return; } o += '['; ${fields.map(([f], i) => `${i ? "o += ','; " : ''}enc(o, v${at}${f}); `).join('')}o += ']'; }\n`
      : `inline void dec(const J& j, ${name}& v) { ${fields.map(([f], i) => `dec(j.a.at(${i}), v.${f}); `).join('')}}\ninline void enc(std::string& o, const ${name}& v) { o += '['; ${fields.map(([f], i) => `${i ? "o += ','; " : ''}enc(o, v.${f}); `).join('')}o += ']'; }\n`
  }).join('')
  const nested = meta.nested ? 'inline void dec(const J& j, ::NestedInteger& v) { if (j.t != 4) { v = ::NestedInteger((int)std::stoll(j.s)); return; } v = ::NestedInteger(); for (const J& x : j.a) { ::NestedInteger c; dec(x, c); v.add(c); } }\ninline void enc(std::string& o, const ::NestedInteger& v) { if (v.isInteger()) { enc(o, v.getInteger()); return; } o += \'[\'; const auto& items = v.getList(); for (size_t k = 0; k < items.size(); k++) { if (k) o += \',\'; enc(o, items[k]); } o += \']\'; }\n' : ''
  return 'inline void raw(std::string& o, const J& j) { if (j.t == 0) o += "null"; else if (j.t == 1) o += j.b ? "true" : "false"; else if (j.t == 2) o += j.s; else if (j.t == 3) enc(o, j.s); else { o += \'[\'; for (size_t k = 0; k < j.a.size(); k++) { if (k) o += \',\'; raw(o, j.a[k]); } o += \']\'; } }\n' + records + nested
}

/** The interactor client and each API method's definition; calls hold one lock, so threads may share the APIs. */
function cppApis(spec: ProblemInterface): string {
  if (spec.kind === 'codec' || !spec.apis?.length) return ''
  const definitions = spec.apis.flatMap(api => api.methods.map(m => {
    const returns = m.returns === 'void' ? 'void' : cppType(typeOf(m.returns))
    const head = `${returns} ${api.global ? '' : `${api.name}::`}${m.name}(${m.params.map(p => `${cppType(typeOf(p.type))} ${p.name}`).join(', ')})`
    const args = m.params.map((p, i) => `${i ? '__a += \',\'; ' : ''}${typeOf(p.type).tag === 'buffer' ? '__a += "null";' : `__manor::enc(__a, ${p.name});`} `).join('')
    const writes = m.params.map((p, i) => typeOf(p.type).tag === 'buffer' ? `if (__i == ${i}) std::memcpy(${p.name}, __t.data(), __t.size()); ` : '').join('')
    const target = m.returns === 'void' ? null : typeOf(m.returns)
    const result = target === null ? '' : target.tag === 'object'
      ? (() => { const pointer = cppType(target).endsWith('*'); const make = `${target.name}(__h)`; return ` if (__r.a.at(0).t == 0) return ${pointer ? 'nullptr' : `${target.name}("null")`}; std::string __h; __manor::raw(__h, __r.a.at(0)); return ${pointer ? 'new ' : ''}${make};` })()
      : ` ${returns} __v{}; __manor::dec(__r.a.at(0), __v); return __v;`
    return `${head} { std::string __a = "["; ${args}__a += ']'; __manor::J __r = __manor_ix::call(${api.global ? '"null"' : '__manor_handle'}, ${JSON.stringify(m.name)}, __a);${writes ? ` if (__r.a.size() > 1) for (const __manor::J& __w : __r.a[1].a) { size_t __i = std::stoul(__w.a.at(0).s); const std::string& __t = __w.a.at(1).s; ${writes}}` : ''}${result} }\n`
  })).join('')
  return `namespace __manor_ix {
static FILE* to = nullptr; static FILE* from = nullptr; static std::mutex lock; static std::string aborted; static bool stopped = false;
inline void start() {
  std::signal(SIGPIPE, SIG_IGN);
  int a[2], b[2]; if (pipe(a) != 0 || pipe(b) != 0) throw std::runtime_error("The interactor could not start");
  pid_t pid = fork(); if (pid < 0) throw std::runtime_error("The interactor could not start");
  if (pid == 0) { dup2(a[0], 0); dup2(b[1], 1); close(a[0]); close(a[1]); close(b[0]); close(b[1]); execlp("python3", "python3", "-I", "-c", ${cppString(interactorProgram(spec.interactor ?? ''))}, (char*)nullptr); _exit(127); }
  close(a[0]); close(b[1]); to = fdopen(a[1], "w"); from = fdopen(b[0], "r");
}
inline std::string send(const std::string& message) {
  std::fputs(message.c_str(), to); std::fputc('\\n', to); std::fflush(to);
  std::string line; int c; while ((c = std::fgetc(from)) != EOF && c != '\\n') line += (char)c;
  if (c == EOF) throw std::runtime_error("The interactor stopped");
  return line;
}
inline __manor::J call(const std::string& handle, const char* method, const std::string& args) {
  std::lock_guard<std::mutex> guard(lock);
  if (stopped) throw __ManorAbort{aborted};
  __manor::J r = __manor::parse(send("[\\"call\\"," + handle + ",\\"" + method + "\\"," + args + "]"));
  if (r.t == 3) { stopped = true; aborted = r.s; throw __ManorAbort{aborted}; }
  return r;
}
inline void begin(const std::string& values) { stopped = false; aborted.clear(); send("[\\"case\\"," + values + "]"); }
inline std::string finish(const std::string& answer) { std::string reply = send("[\\"end\\"," + answer + "]"); return reply.substr(1, reply.size() - 2); }
}
${definitions}`
}

/** Declares one solution argument from JSON; buffers get storage, and an argument of the class itself is constructed from its constructor arguments. */
function cppArgument(spec: ProblemInterface, name: string, type: string, source: string, handle = name): string {
  const t = typeOf(type)
  if (t.tag === 'buffer') return `std::vector<char> ${name}_storage(std::stoul((${source}).s) + 1, '\\0'); char* ${name} = ${name}_storage.data();`
  if (t.tag === 'object' && spec.kind === 'class' && t.name === spec.className) {
    const ctor = spec.constructorParams.map((p, i) => `${cppType(typeOf(p.type))} ${name}_${i}{}; __manor::dec((${source}).a.at(${i}), ${name}_${i}); `).join('')
    return `${ctor}${t.name} ${name}(${spec.constructorParams.map((_, i) => `${name}_${i}`).join(', ')});`
  }
  if (t.tag === 'object') return cppType(t).endsWith('*') ? `${t.name}* ${name} = new ${t.name}(${cppString(JSON.stringify(handle))});` : `${t.name} ${name}(${cppString(JSON.stringify(handle))});`
  return `${cppType(t)} ${name}{}; __manor::dec(${source}, ${name});`
}

function cppMain(width: number, body: string, start: string): string {
  return `int main() {\n${start}  std::vector<std::string> __lines; std::string __line;\n  while (std::getline(std::cin, __line)) if (__line.find_first_not_of(" \\t\\r") != std::string::npos) __lines.push_back(__line);\n  if (__lines.empty() || __lines.size() % ${width} != 0) { std::cerr << "Each test case needs ${width} input lines, one JSON value per line; received " << __lines.size() << " lines\\n"; return 1; }\n  for (size_t __i = 0; __i * ${width} < __lines.size(); __i++) {\n    auto __t0 = std::chrono::steady_clock::now();\n    std::string __o;\n    auto __L = [&](size_t k) -> const std::string& { return __lines[__i * ${width} + k]; };\n    try {\n      [&]() {\n${body}      }();\n    } catch (const std::exception& __e) { std::cout.flush(); std::cerr << __e.what() << "\\n"; __o = "!"; }\n    catch (...) { std::cout.flush(); std::cerr << "Unknown exception\\n"; __o = "!"; }\n    long long __ms = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - __t0).count();\n    std::cout << "\\x1eMANOR " << __i << ' ' << __ms << ' ' << __o << '\\n' << std::flush;\n  }\n  struct rusage __usage; getrusage(RUSAGE_SELF, &__usage);\n  std::cout << "\\x1eMANOR-PEAK " << __usage.ru_maxrss << '\\n' << std::flush;\n  return 0;\n}\n`
}

/** Concurrent classes: each thread runs its script of method calls, and callbacks append to one shared log under a lock. */
function cppConcurrent(spec: ClassInterface): string {
  const branches = spec.methods.map(m => {
    const args = m.params.map((p, i) => {
      const t = typeOf(p.type)
      if (t.tag === 'callback') return t.int ? `std::function<void(int)> __p${i} = [&record](int x) { record(std::to_string(x)); }; ` : `std::string __t${i}; __manor::raw(__t${i}, __c.a.at(${i})); std::function<void()> __p${i} = [&record, __t${i}]() { record(__t${i}); }; `
      return `${cppType(t)} __p${i}{}; __manor::dec(__c.a.at(${i}), __p${i}); `
    }).join('')
    const call = `__obj->${m.name}(${m.params.map((_, i) => `__p${i}`).join(', ')})`
    return `            else if (__name == ${JSON.stringify(m.name)}) { ${args}${m.returns === 'void' ? `${call};` : `auto __r = ${call}; std::string __s; __manor::enc(__s, __r); record(__s);`} }\n`
  }).join('')
  const ctor = spec.constructorParams.map((p, i) => `        ${cppType(typeOf(p.type))} __k${i}{}; __manor::dec(__ctor.a.at(${i}), __k${i});\n`).join('')
  return `        __manor::J __ctor = __manor::parse(__L(0)), __scripts = __manor::parse(__L(1));\n${ctor}        ${spec.className}* __obj = new ${spec.className}(${spec.constructorParams.map((_, i) => `__k${i}`).join(', ')});
        std::mutex __logLock, __failLock, __doneLock; std::condition_variable __doneSignal; size_t __done = 0; std::vector<std::string> __log; std::exception_ptr __failure;
        auto record = [&](const std::string& entry) { std::lock_guard<std::mutex> g(__logLock); __log.push_back(entry); };
        std::vector<std::thread> __workers;
        for (const __manor::J& __script : __scripts.a) {
          __workers.emplace_back([&, __steps = &__script]() {
            try {
              for (const __manor::J& __step : __steps->a) {
                const std::string& __name = __step.a.at(0).s; const __manor::J& __c = __step.a.at(1);
                if (__name == "$sleep") { std::this_thread::sleep_for(std::chrono::milliseconds(std::stoll(__c.a.at(0).s))); continue; }
                if (__name == "$join") { std::unique_lock<std::mutex> l(__doneLock); __doneSignal.wait(l, [&] { return __done + 1 >= __scripts.a.size(); }); continue; }
                if (false) {}
${branches}                else throw std::runtime_error("Unknown operation: " + __name);
              }
            } catch (...) { std::lock_guard<std::mutex> g(__failLock); if (!__failure) __failure = std::current_exception(); }
            { std::lock_guard<std::mutex> g(__doneLock); __done++; } __doneSignal.notify_all();
          });
          std::this_thread::sleep_for(std::chrono::milliseconds(2));
        }
        for (std::thread& __worker : __workers) __worker.join();
        if (__failure) std::rethrow_exception(__failure);
        __o = "["; for (size_t __k = 0; __k < __log.size(); __k++) { if (__k) __o += ','; __o += __log[__k]; } __o += ']';
`
}

export function cppDriver(spec: ProblemInterface): string {
  useSpec(spec)
  const meta = driverMeta(spec)
  const kind = nodeKindOf(spec)
  const plain = !meta.table
  const library = cppLibrary
    .replace('@NODE_DECODERS@', ['template <class T> void dec(const J& j, std::vector<T>& v);\ntemplate <class T> void enc(std::string& o, const std::vector<T>& v);', plain && usesNode(spec, 'ListNode') ? cppListNode.decode : '', plain && usesNode(spec, 'TreeNode') ? cppTreeNode.decode : '', kind === null || !plain ? '' : cppNodeCode(kind).decode].join('\n'))
    .replace('@NODE_ENCODERS@', [plain && usesNode(spec, 'ListNode') ? cppListNode.encode : '', plain && usesNode(spec, 'TreeNode') ? cppTreeNode.encode : '', kind === null || !plain ? '' : cppNodeCode(kind).encode, cppValues(spec), cppTable(spec)].join('\n'))
  const tail = (body: string): string => `\n${library}\n${cppApis(spec)}${cppMain(meta.width, body, meta.interactive ? '  __manor_ix::start();\n' : '')}`
  const reset = tracksInputs(kind) ? '        __manor::inputs.clear();\n' : ''
  if (spec.kind === 'codec') {
    const { ser, deser } = codecInstances(spec, `new ${spec.className}()`)
    return tail(`${reset}        ${cppArgument(spec, '__a0', spec.encode.param.type, '__manor::parse(__L(0))')}\n        ${spec.className}* ser = ${ser}; ${spec.className}* deser = ${deser};\n        auto __e = ser->${spec.encode.name}(__a0);\n        auto __r = deser->${spec.decode.name}(__e);\n        __manor::enc(__o, __r);\n`)
  }
  if (spec.kind === 'class' && spec.concurrency) return tail(cppConcurrent(spec))
  const offset = meta.table ? 1 : 0
  const line = (name: string): string => `__manor::parse(__L(${offset + meta.inputs.indexOf(name)}))`
  const table = meta.table ? '        __manor::load_table(__manor::parse(__L(0)));\n' : ''
  const wrap = (expression: string): string => meta.wrap ? `__o = __manor::wrap(${expression});` : `__o = ${expression};`
  let answer: string
  if (spec.kind === 'function') {
    const args = spec.params.map((p, i) => `        ${cppArgument(spec, `__a${i}`, p.type, typeOf(p.type).tag === 'object' ? '' : line(p.name), p.name)}\n`).join('')
    const call = `__s.${spec.name}(${spec.params.map((_, i) => `__a${i}`).join(', ')})`
    const index = spec.output.mode === 'return' ? -1 : spec.params.findIndex(p => p.name === (spec.output as { param: string }).param)
    const emit = spec.output.mode === 'return' ? (spec.returns === 'void' ? `        ${call};\n        __o = "null";\n` : `        auto __r = ${call};\n        { std::string __v; __manor::enc(__v, __r); ${wrap('__v')} }\n`)
      : spec.output.mode === 'param' ? `        ${call};\n        { std::string __v; __manor::enc(__v, __a${index}); ${wrap('__v')} }\n`
      : typeOf(spec.params[index].type).tag === 'buffer' ? `        long long __k = ${call};\n        __k = std::max(0LL, std::min<long long>(__k, (long long)__a${index}_storage.size() - 1));\n        __manor::enc(__o, std::string(__a${index}, (size_t)__k));\n`
      : `        long long __k = ${call};\n        __k = std::max(0LL, std::min<long long>(__k, (long long)__a${index}.size()));\n        ${cppType(typeOf(spec.params[index].type))} __p(__a${index}.begin(), __a${index}.begin() + __k);\n        __manor::enc(__o, __p);\n`
    answer = `${args}        Solution __s;\n${emit}`
  } else {
    const branches = spec.methods.map(m => {
      const args = m.params.map((p, i) => `${cppArgument(spec, `__p${i}`, p.type, `__c.a.at(${i})`)} `).join('')
      const call = `__obj->${m.name}(${m.params.map((_, i) => `__p${i}`).join(', ')})`
      const prefix = m.output === undefined ? -1 : m.params.findIndex(p => p.name === m.output!.param)
      const emit = prefix >= 0 ? `long long __k = ${call}; __k = std::max(0LL, std::min<long long>(__k, (long long)__p${prefix}_storage.size() - 1)); __manor::enc(__o, std::string(__p${prefix}, (size_t)__k));` : m.returns === 'void' ? `${call}; __o += "null";` : `auto __r = ${call}; __manor::enc(__o, __r);`
      return `          else if (__op == ${JSON.stringify(m.name)}) { ${args}${emit} }\n`
    }).join('')
    const ctorArgs = spec.constructorParams.map((p, i) => `        ${cppArgument(spec, `__k${i}`, p.type, `__calls.a.at(0).a.at(${i})`)}\n`).join('')
    answer = `        __manor::J __ops = __manor::parse(__L(0)), __calls = __manor::parse(__L(1));\n        if (__ops.a.size() != __calls.a.size() || __ops.a.empty() || __ops.a[0].s != ${JSON.stringify(spec.className)}) throw std::runtime_error("Operations must start with the class name and match the argument arrays");\n${ctorArgs}        ${spec.className}* __obj = new ${spec.className}(${spec.constructorParams.map((_, i) => `__k${i}`).join(', ')});\n        __o = "[null";\n        for (size_t __j = 1; __j < __ops.a.size(); __j++) {\n          const std::string& __op = __ops.a[__j].s; const __manor::J& __c = __calls.a[__j]; __o += ',';\n          if (false) {}\n${branches}          else throw std::runtime_error("Unknown operation: " + __op);\n        }\n        __o += ']';\n`
  }
  if (!meta.interactive) return tail(`${reset}${table}${answer}`)
  const values = `std::string("{") ${meta.inputs.map((name, i) => `+ ${cppString((i ? ',' : '') + JSON.stringify(name) + ':')} + __L(${i}) `).join('')}+ "}"`
  return tail(`${reset}        __manor_ix::begin(${values});\n        bool __stopped = false;\n        try {\n          [&]() {\n${answer}          }();\n        } catch (const __ManorAbort& __a) { __o.clear(); __manor::enc(__o, __a.message); __stopped = true; }\n        if (!__stopped) __o = __manor_ix::finish(__o);\n`)
}
