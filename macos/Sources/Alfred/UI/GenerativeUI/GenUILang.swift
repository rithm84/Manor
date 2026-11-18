import Foundation

// Alfred's generative-UI language: a compact, streaming-first way for the model to describe charts, tables,
// and cards, rendered natively. The language:
//
//   root = Card([header, chart])          one statement per line: name = expression
//   header = CardHeader("Revenue", "6 mo")  components: positional args in the library's prop order
//   chart = BarChart(labels, [s1])         names can be used before they're defined (hoisting)
//   labels = ["Jan", "Feb"]                strings, numbers, true/false/null, [arrays], {objects}
//   s1 = Series("Revenue", [12, 15])       data.field plucks a field from every element of an array
//   total = @Sum(s1.values)                @functions, + - * / % == != < > && || ! ?: operators
//
// Interactive parts of the spec ($state, Query/Mutation, actions) are not needed for answers and are
// parsed but ignored. Parsing never fails: unknown tokens are skipped, and a half-streamed program is
// closed implicitly (open strings and brackets end at the buffer's end), so the UI builds up live.

// MARK: - Values

indirect enum GenUIValue: Equatable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case null
    case array([GenUIValue])
    case object([String: GenUIValue])
    case node(GenUINode)

    var string: String? {
        switch self {
        case .string(let s): s
        case .number(let n): GenUIValue.format(n)
        case .bool(let b): b ? "true" : "false"
        default: nil
        }
    }

    var number: Double? {
        switch self {
        case .number(let n): n
        case .string(let s): Double(s.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: ""))
        case .bool(let b): b ? 1 : 0
        default: nil
        }
    }

    var array: [GenUIValue]? { if case .array(let a) = self { a } else { nil } }
    var node: GenUINode? { if case .node(let n) = self { n } else { nil } }
    var isNull: Bool { self == .null }

    var truthy: Bool {
        switch self {
        case .null: false
        case .bool(let b): b
        case .number(let n): n != 0 && !n.isNaN
        case .string(let s): !s.isEmpty
        default: true
        }
    }

    /// Display text for any scalar; arrays join with ", ".
    var text: String {
        switch self {
        case .array(let a): a.map(\.text).joined(separator: ", ")
        case .null: ""
        case .object, .node: ""
        default: string ?? ""
        }
    }

    static func format(_ n: Double) -> String {
        if n.isNaN || n.isInfinite { return "0" }
        if n == n.rounded(), abs(n) < 1e15 { return String(Int64(n)) }
        var s = String(format: "%.6g", n)
        if s.contains("e") { s = String(n) }
        return s
    }
}

/// A component instance: its name, positional args, and those args mapped onto the library's prop names.
struct GenUINode: Equatable {
    var name: String
    var args: [GenUIValue]
    var props: [String: GenUIValue]
    /// Stable identity: the statement that produced it plus its position inside that statement
    /// (`chart`, `root.0[2]`). Unchanged nodes keep their id across chunks, so views don't rebuild.
    var id: String = ""

    subscript(_ prop: String) -> GenUIValue { props[prop] ?? .null }
    func string(_ prop: String) -> String? { self[prop].string.flatMap { $0.isEmpty ? nil : $0 } }
    func number(_ prop: String) -> Double? { self[prop].number }
    func array(_ prop: String) -> [GenUIValue] {
        switch self[prop] {
        case .array(let a): a
        case .null: []
        case let v: [v]
        }
    }
}

// MARK: - Lexer

enum GenUIToken: Equatable {
    case ident(String)          // names, Component names, true/false/null
    case state(String)          // $name
    case function(String)       // @Name
    case string(String)
    case number(Double)
    case punct(String)
    case newline
}

enum GenUILexer {
    static func tokens(_ source: String) -> [GenUIToken] {
        let chars = Array(source)
        var out: [GenUIToken] = []
        var i = 0
        func peek(_ k: Int = 0) -> Character? { i + k < chars.count ? chars[i + k] : nil }
        func isValue(_ t: GenUIToken?) -> Bool {
            switch t {
            case .ident, .state, .string, .number: true
            case .punct(let p): p == ")" || p == "]"
            default: false
            }
        }

        while i < chars.count {
            let c = chars[i]
            if c == "\n" { out.append(.newline); i += 1; continue }
            if c == " " || c == "\t" || c == "\r" { i += 1; continue }
            // Comments: // or # to end of line.
            if c == "#" || (c == "/" && peek(1) == "/") {
                while i < chars.count, chars[i] != "\n" { i += 1 }
                continue
            }
            if c == "\"" || c == "'" {
                let quote = c
                var s = ""
                i += 1
                while i < chars.count, chars[i] != quote {
                    if chars[i] == "\\", i + 1 < chars.count {
                        let e = chars[i + 1]
                        switch e {
                        case "n": s.append("\n")
                        case "t": s.append("\t")
                        case "u" where quote == "\"" && i + 5 < chars.count:
                            let hex = String(chars[(i + 2)...(i + 5)])
                            if let v = UInt32(hex, radix: 16), let u = Unicode.Scalar(v) { s.unicodeScalars.append(u); i += 4 } else { s.append("u") }
                        default: s.append(e)
                        }
                        i += 2
                        continue
                    }
                    s.append(chars[i])
                    i += 1
                }
                i += 1   // closing quote (or past the end: implicitly closed)
                out.append(.string(s))
                continue
            }
            let negative = c == "-" && (peek(1)?.isNumber ?? false) && !isValue(out.last)
            if c.isNumber || negative {
                var s = String(c)
                i += 1
                while let d = peek(), d.isNumber { s.append(d); i += 1 }
                if peek() == ".", let d = peek(1), d.isNumber {
                    s.append("."); i += 1
                    while let d = peek(), d.isNumber { s.append(d); i += 1 }
                }
                if let e = peek(), e == "e" || e == "E" {
                    var exp = "e"; var j = i + 1
                    if j < chars.count, chars[j] == "+" || chars[j] == "-" { exp.append(chars[j]); j += 1 }
                    var digits = ""
                    while j < chars.count, chars[j].isNumber { digits.append(chars[j]); j += 1 }
                    if !digits.isEmpty { s += exp + digits; i = j }
                }
                out.append(.number(Double(s) ?? 0))
                continue
            }
            if c.isLetter || c == "_" || c == "$" || c == "@" {
                var s = ""
                let prefix = c == "$" || c == "@" ? c : nil
                if prefix != nil { i += 1 }
                while let d = peek(), d.isLetter || d.isNumber || d == "_" { s.append(d); i += 1 }
                switch prefix {
                case "$": out.append(.state(s))
                case "@": out.append(.function(s))
                default: out.append(.ident(s))
                }
                continue
            }
            let two = peek(1).map { String([c, $0]) } ?? ""
            if ["==", "!=", ">=", "<=", "&&", "||"].contains(two) { out.append(.punct(two)); i += 2; continue }
            if "=()[]{},:.?+-*/%<>!".contains(c) { out.append(.punct(String(c))); i += 1; continue }
            if c == "&" { out.append(.punct("&&")); i += 1; continue }
            if c == "|" { out.append(.punct("||")); i += 1; continue }
            i += 1   // anything else is skipped; lexing never fails
        }
        return out
    }
}

// MARK: - Parser

indirect enum GenUIExpr: Equatable {
    case literal(GenUIValue)
    case array([GenUIExpr])
    case object([(String, GenUIExpr)])
    case ref(String)
    case call(String, [GenUIExpr])        // Component(...)
    case function(String, [GenUIExpr])    // @Fn(...)
    case member(GenUIExpr, String)
    case index(GenUIExpr, GenUIExpr)
    case unary(String, GenUIExpr)
    case binary(String, GenUIExpr, GenUIExpr)
    case ternary(GenUIExpr, GenUIExpr, GenUIExpr)

    static func == (a: GenUIExpr, b: GenUIExpr) -> Bool { String(describing: a) == String(describing: b) }
}

struct GenUIProgram {
    var statements: [String: GenUIExpr] = [:]
    var order: [String] = []
}

/// Recursive-descent parser over the token stream. Statements end at a newline outside brackets; a
/// statement still open when the tokens run out is closed implicitly (streaming).
struct GenUIParser {
    private var t: [GenUIToken]
    private var i = 0

    init(_ tokens: [GenUIToken]) { t = tokens }

    static func parse(_ source: String) -> GenUIProgram {
        var p = GenUIParser(GenUILexer.tokens(GenUISource.program(from: source)))
        return p.program()
    }

    /// Parses already-extracted program text (no fence handling).
    static func parseProgram(_ text: String) -> GenUIProgram {
        var p = GenUIParser(GenUILexer.tokens(text))
        return p.program()
    }

    private func peek(_ k: Int = 0) -> GenUIToken? { i + k < t.count ? t[i + k] : nil }
    private mutating func next() -> GenUIToken? { defer { i += 1 }; return peek() }
    private func isPunct(_ p: String, _ k: Int = 0) -> Bool { peek(k) == .punct(p) }
    private mutating func eat(_ p: String) -> Bool { if isPunct(p) { i += 1; return true }; return false }
    private mutating func skipNewlines() { while peek() == .newline { i += 1 } }

    mutating func program() -> GenUIProgram {
        var prog = GenUIProgram()
        while i < t.count {
            skipNewlines()
            guard let head = peek() else { break }
            // statement := (ident | $state) "=" expression
            let name: String?
            switch head {
            case .ident(let n): name = n
            case .state(let n): name = "$" + n
            default: name = nil
            }
            if let name, isPunct("=", 1), !isPunct("=", 2) {
                i += 2
                let expr = expression(depth: 0)
                if prog.statements[name] == nil { prog.order.append(name) }
                prog.statements[name] = expr
            }
            // Skip whatever is left of this line (malformed statements are dropped, not fatal).
            while let tok = peek(), tok != .newline { i += 1 }
        }
        return prog
    }

    /// `depth` > 0 inside brackets, where newlines are whitespace.
    private mutating func expression(depth: Int) -> GenUIExpr { ternary(depth) }

    private mutating func ws(_ depth: Int) { if depth > 0 { skipNewlines() } }

    private mutating func ternary(_ d: Int) -> GenUIExpr {
        let cond = binary(0, d)
        ws(d)
        // A `?` may also start the next line at depth 0 (multi-line ternary).
        if isPunct("?") || (peek() == .newline && isPunct("?", 1)) {
            if peek() == .newline { i += 1 }
            i += 1; skipNewlines()
            let a = ternary(d + 1)
            skipNewlines()
            _ = eat(":"); skipNewlines()
            let b = ternary(d)
            return .ternary(cond, a, b)
        }
        return cond
    }

    private static let levels: [[String]] = [["||"], ["&&"], ["==", "!="], [">", "<", ">=", "<="], ["+", "-"], ["*", "/", "%"]]

    private mutating func binary(_ level: Int, _ d: Int) -> GenUIExpr {
        guard level < Self.levels.count else { return unary(d) }
        var lhs = binary(level + 1, d)
        while true {
            ws(d)
            guard case .punct(let op)? = peek(), Self.levels[level].contains(op) else { break }
            i += 1; ws(d)
            lhs = .binary(op, lhs, binary(level + 1, d))
        }
        return lhs
    }

    private mutating func unary(_ d: Int) -> GenUIExpr {
        if isPunct("!") { i += 1; return .unary("!", unary(d)) }
        if isPunct("-") { i += 1; return .unary("-", unary(d)) }
        return postfix(d)
    }

    private mutating func postfix(_ d: Int) -> GenUIExpr {
        var e = primary(d)
        while true {
            if isPunct(".") {
                i += 1
                switch next() {
                case .ident(let f)?: e = .member(e, f)
                case .number(let n)?: e = .member(e, GenUIValue.format(n))
                case .string(let s)?: e = .member(e, s)
                default: return e
                }
            } else if isPunct("[") {
                i += 1; skipNewlines()
                let idx = expression(depth: d + 1)
                skipNewlines(); _ = eat("]")
                e = .index(e, idx)
            } else { return e }
        }
    }

    private mutating func arguments(_ close: String, _ d: Int) -> [GenUIExpr] {
        var args: [GenUIExpr] = []
        while true {
            skipNewlines()
            if peek() == nil { return args }            // streaming: implicitly closed
            if eat(close) { return args }
            if eat(",") { continue }
            let start = i
            args.append(expression(depth: d + 1))
            if i == start { i += 1 }                    // unparseable token: skip it
        }
    }

    private mutating func primary(_ d: Int) -> GenUIExpr {
        guard let tok = peek() else { return .literal(.null) }
        switch tok {
        case .string(let s): i += 1; return .literal(.string(s))
        case .number(let n): i += 1; return .literal(.number(n))
        case .state(let n): i += 1; return .ref("$" + n)
        case .function(let f):
            i += 1
            guard eat("(") else { return .literal(.null) }
            return .function(f, arguments(")", d))
        case .ident(let name):
            i += 1
            switch name {
            case "true": return .literal(.bool(true))
            case "false": return .literal(.bool(false))
            case "null": return .literal(.null)
            default: break
            }
            if isPunct("(") {
                i += 1
                return .call(name, arguments(")", d))
            }
            return .ref(name)
        case .punct("["):
            i += 1
            return .array(arguments("]", d))
        case .punct("{"):
            i += 1
            var entries: [(String, GenUIExpr)] = []
            while true {
                skipNewlines()
                guard let k = peek() else { break }
                if eat("}") { break }
                if eat(",") { continue }
                let key: String
                switch k {
                case .ident(let s), .string(let s), .state(let s): key = s
                case .number(let n): key = GenUIValue.format(n)
                default: key = "?"
                }
                i += 1; skipNewlines()
                guard eat(":") else { continue }
                skipNewlines()
                entries.append((key, expression(depth: d + 1)))
            }
            return .object(entries)
        case .punct("("):
            i += 1; skipNewlines()
            let e = expression(depth: d + 1)
            skipNewlines(); _ = eat(")")
            return e
        default:
            i += 1
            return .literal(.null)
        }
    }
}

/// Pulls the program out of Markdown fences.
enum GenUISource {
    static func program(from text: String) -> String {
        let lines = text.components(separatedBy: "\n")
        guard lines.contains(where: { $0.trimmingCharacters(in: .whitespaces).hasPrefix("```") }) else {
            return lines.joined(separator: "\n")
        }
        var out: [String] = []
        var inside = false
        var skip = false
        for line in lines {
            let t = line.trimmingCharacters(in: .whitespaces)
            if t.hasPrefix("```") {
                if inside { inside = false; continue }
                inside = true
                let tag = t.dropFirst(3).trimmingCharacters(in: .whitespaces)
                skip = tag.hasSuffix("-js")
                continue
            }
            if inside && !skip { out.append(line) }
        }
        return out.joined(separator: "\n")
    }
}

// MARK: - Evaluation

/// Evaluates a program against a component library: resolves references (hoisted, cycle-safe), plucks,
/// operators and @functions, and maps component args onto prop names.
struct GenUIEvaluator {
    let program: GenUIProgram
    let library: GenUILibrary
    private var visiting: Set<String> = []
    /// Where we are, for node ids: the statement being evaluated plus arg/element positions.
    private var path: [String] = []

    init(_ program: GenUIProgram, library: GenUILibrary = .alfred) {
        self.program = program
        self.library = library
    }

    /// The tree to render: `root`, else the first statement that is a component (newest wins on ties).
    mutating func root() -> GenUIValue? {
        if program.statements["root"] != nil {
            let v = resolve("root")
            return v.isNull ? nil : v
        }
        for name in program.order where !name.hasPrefix("$") {
            if case .call = program.statements[name] {
                let v = resolve(name)
                if v.node != nil { return v }
            }
        }
        return nil
    }

    mutating func resolve(_ name: String) -> GenUIValue {
        guard let expr = program.statements[name], !visiting.contains(name) else { return .null }
        visiting.insert(name)
        let saved = path
        path = [name]
        defer { visiting.remove(name); path = saved }
        return eval(expr)
    }

    mutating func eval(_ e: GenUIExpr) -> GenUIValue {
        switch e {
        case .literal(let v): return v
        case .array(let items):
            // Unresolved references and nulls produced by them drop out of arrays.
            return .array(items.enumerated().compactMap { k, item in
                if case .ref(let n) = item, program.statements[n] == nil { return nil }
                path.append("[\(k)]")
                defer { path.removeLast() }
                return eval(item)
            })
        case .object(let entries):
            var o: [String: GenUIValue] = [:]
            for (k, v) in entries { o[k] = eval(v) }
            return .object(o)
        case .ref(let name):
            return resolve(name)
        case .call(let name, let args):
            let id = path.joined()
            let values = args.enumerated().map { k, a in
                path.append(".\(k)")
                defer { path.removeLast() }
                return eval(a)
            }
            var node = library.node(name, values)
            node.id = id
            return .node(node)
        case .function(let name, let args):
            return function(name, args.map { eval($0) })
        case .member(let base, let field):
            return member(eval(base), field)
        case .index(let base, let idx):
            let b = eval(base), k = eval(idx)
            if case .array(let a) = b, let n = k.number { let j = Int(n); return a.indices.contains(j) ? a[j] : .null }
            if let key = k.string { return member(b, key) }
            return .null
        case .unary(let op, let x):
            let v = eval(x)
            return op == "!" ? .bool(!v.truthy) : .number(-(v.number ?? 0))
        case .binary(let op, let a, let b):
            let l = eval(a)
            if op == "&&" { return l.truthy ? eval(b) : l }
            if op == "||" { return l.truthy ? l : eval(b) }
            let r = eval(b)
            return binary(op, l, r)
        case .ternary(let c, let a, let b):
            return eval(c).truthy ? eval(a) : eval(b)
        }
    }

    private func member(_ v: GenUIValue, _ field: String) -> GenUIValue {
        switch v {
        case .object(let o): return o[field] ?? .null
        case .node(let n): return n.props[field] ?? .null
        case .array(let a):
            if let i = Int(field), field.allSatisfy(\.isNumber) { return a.indices.contains(i) ? a[i] : .null }
            if field == "length" { return .number(Double(a.count)) }
            return .array(a.map { member($0, field) })   // pluck
        case .string(let s): return field == "length" ? .number(Double(s.count)) : .null
        default: return .null
        }
    }

    private func binary(_ op: String, _ l: GenUIValue, _ r: GenUIValue) -> GenUIValue {
        let a = l.number ?? 0, b = r.number ?? 0
        switch op {
        case "+":
            if case .string = l { return .string(l.text + r.text) }
            if case .string = r { return .string(l.text + r.text) }
            return .number(a + b)
        case "-": return .number(a - b)
        case "*": return .number(a * b)
        case "/": return .number(b == 0 ? 0 : a / b)
        case "%": return .number(b == 0 ? 0 : a.truncatingRemainder(dividingBy: b))
        case "==": return .bool(loosely(l, r))
        case "!=": return .bool(!loosely(l, r))
        case ">": return .bool(a > b)
        case "<": return .bool(a < b)
        case ">=": return .bool(a >= b)
        case "<=": return .bool(a <= b)
        default: return .null
        }
    }

    private func loosely(_ l: GenUIValue, _ r: GenUIValue) -> Bool {
        if l == r { return true }
        if let a = l.number, let b = r.number, !(l.isNull || r.isNull) { return a == b }
        return false
    }

    private func numbers(_ v: [GenUIValue]) -> [Double] {
        v.flatMap { x -> [Double] in
            if case .array(let a) = x { return a.compactMap(\.number) }
            return x.number.map { [$0] } ?? []
        }
    }

    private func function(_ name: String, _ args: [GenUIValue]) -> GenUIValue {
        let xs = numbers(args.isEmpty ? [] : [args[0]])
        switch name.lowercased() {
        case "count": return .number(Double(args.first?.array?.count ?? 0))
        case "sum": return .number(xs.reduce(0, +))
        case "avg": return .number(xs.isEmpty ? 0 : xs.reduce(0, +) / Double(xs.count))
        case "min": return .number(xs.min() ?? 0)
        case "max": return .number(xs.max() ?? 0)
        case "round":
            let digits = args.count > 1 ? (args[1].number ?? 0) : 0
            let p = pow(10, digits)
            return .number(((args.first?.number ?? 0) * p).rounded() / p)
        case "abs": return .number(abs(args.first?.number ?? 0))
        case "floor": return .number((args.first?.number ?? 0).rounded(.down))
        case "ceil": return .number((args.first?.number ?? 0).rounded(.up))
        case "first": return args.first?.array?.first ?? .null
        case "last": return args.first?.array?.last ?? .null
        case "sort":
            guard let a = args.first?.array else { return .null }
            let key = args.count > 1 ? args[1].string : nil
            let desc = args.count > 2 && (args[2].string == "desc" || args[2] == .bool(true))
            let sorted = a.sorted { lhs, rhs in
                let x = key.map { member(lhs, $0) } ?? lhs, y = key.map { member(rhs, $0) } ?? rhs
                if let p = x.number, let q = y.number { return desc ? p > q : p < q }
                return desc ? x.text > y.text : x.text < y.text
            }
            return .array(sorted)
        case "each":
            // @Each(items, template): template is a component whose args may reference `item` — not
            // supported statically, so return the items themselves.
            return args.first ?? .null
        default:
            return .null
        }
    }
}

// MARK: - Streaming

/// Incremental parser with these streaming rules:
///  1. Completed statements (ended by a newline outside brackets/strings, not continued by a `?` line) are
///     parsed once and cached behind a watermark.
///  2. Only the pending tail is re-parsed on each chunk, with implicit closing.
///  3. A pending statement never overwrites a completed one of the same name.
///  4. If the text no longer extends the completed prefix, the cache is discarded (reconciliation).
///  5. When the host ends the stream, the tail is finalized — the result equals a batch parse.
final class GenUIStreamParser {
    private var cleaned = ""
    private var completedEnd = 0            // offset (in UTF-16 units of `cleaned`) of the watermark
    private var completed = GenUIProgram()

    /// Feed the full text so far; returns the program to render.
    func update(_ text: String, complete: Bool) -> GenUIProgram {
        let next = GenUISource.program(from: text)
        let prefix = (cleaned as NSString).substring(to: min(completedEnd, (cleaned as NSString).length))
        if !next.hasPrefix(prefix) {
            completedEnd = 0
            completed = GenUIProgram()
        }
        cleaned = next
        scanCompleted()

        let ns = cleaned as NSString
        let tail = ns.substring(from: min(completedEnd, ns.length))
        let pending = GenUIParser.parseProgram(tail)
        var program = completed
        for name in pending.order {
            guard let expr = pending.statements[name] else { continue }
            // Rule 3: an implicitly closed pending statement doesn't replace a completed one — unless the
            // stream has ended, where a final redefinition wins (rule 7).
            if program.statements[name] != nil && !complete { continue }
            if program.statements[name] == nil { program.order.append(name) }
            program.statements[name] = expr
        }
        if complete {
            completed = program
            completedEnd = ns.length
        }
        return program
    }

    /// Advances the watermark over every statement whose ending newline has arrived.
    private func scanCompleted() {
        let chars = Array((cleaned as NSString).substring(from: min(completedEnd, (cleaned as NSString).length)).utf16)
        var depth = 0, ternary = 0
        var quote: UInt16? = nil
        var escape = false
        var stmtStart = 0
        var i = 0
        let nl: UInt16 = 10, bs: UInt16 = 92, dq: UInt16 = 34, sq: UInt16 = 39
        func isSpace(_ c: UInt16) -> Bool { c == 32 || c == 9 || c == 13 || c == 10 }
        while i < chars.count {
            let c = chars[i]
            if escape { escape = false; i += 1; continue }
            if let q = quote {
                if c == bs { escape = true } else if c == q { quote = nil }
                i += 1; continue
            }
            switch c {
            case dq, sq: quote = c
            case 40, 91, 123: depth += 1                         // ( [ {
            case 41, 93, 125: depth = max(0, depth - 1)          // ) ] }
            case 63 where depth == 0: ternary += 1               // ?
            case 58 where depth == 0 && ternary > 0: ternary -= 1 // :
            case nl where depth == 0 && ternary == 0:
                // The statement ends here unless the next non-blank line starts with `?` (ternary).
                var j = i + 1
                while j < chars.count, isSpace(chars[j]) { j += 1 }
                if j >= chars.count { return finish(chars, stmtStart, i) }      // can't tell yet: stay pending
                if chars[j] == 63 { break }
                commit(chars, stmtStart, i)
                stmtStart = i + 1
            default: break
            }
            i += 1
        }
    }

    private func finish(_ chars: [UInt16], _ start: Int, _ end: Int) {
        // Trailing newline(s) with nothing after them: the statement is complete only if it's non-empty
        // and the next chunk can't turn it into a ternary — treat as complete (a `?` line is rare).
        commit(chars, start, end)
    }

    private func commit(_ chars: [UInt16], _ start: Int, _ end: Int) {
        guard end >= start else { return }
        let text = String(utf16CodeUnits: Array(chars[start..<end]), count: end - start)
        let prog = GenUIParser.parseProgram(text)
        for name in prog.order {
            if completed.statements[name] == nil { completed.order.append(name) }
            completed.statements[name] = prog.statements[name]
        }
        completedEnd += end - start + 1
    }
}
