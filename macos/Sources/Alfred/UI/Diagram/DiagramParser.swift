import Foundation

// Alfred Diagram DSL — a tiny, line-oriented language for data-structure diagrams that a model can
// stream token by token. Every complete line is independently meaningful, so the diagram builds up
// live while the answer streams. Unknown or malformed lines are ignored, never fatal.
//
// Structures
//   array nums = [2, 7, 11, 15]        string s = "abcba"          set seen = [2, 7]
//   stack S = [1, 2, 3]  (bottom→top)  queue Q = [4, 5]
//   list L = 1 -> 2 -> 3 -> null       list R = 1 <- 2  3 -> 4      (per-link direction; <-> doubly linked)
//   tree T = [4, 2, 7, 1, 3, null, 9]  heap H = [1, 3, 2, 7]        (level order; heap also draws its array)
//   trie W = [cat, car, dog]
//   grid dp = [[0, 1], [1, 2]]         rows dp = [a, b]            cols dp = [x, y]
//   map M = {2: 0, 7: 1}
//   bars h = [0, 1, 0, 2, 1, 0, 3]     (histogram: monotonic stack, rain water, largest rectangle)
//   intervals I = [[1, 3], [2, 6], [8, 10]]
//   graph G [down|right|circle] [undirected]      edge G A -> B 5      edge G B -- C
//   (repeat a label with a #suffix to make distinct nodes: f2#a, f2#b both display "f2")
//   flow F                              (flowchart: control flow of code, laid out top-down)
//   node F.init "lo = 0, hi = n - 1"    decision F.check "lo <= hi?"    start F.s "Start"    end F.done "return mid"
//   edge F check -> mid "yes"           edge F mid -> check "lo = mid + 1"   (back edges route around the side)
//
// Step-through
//   step "i = 0: 2 + 15 > 9, move j left"   Starts a frame. Lines before the first step are shared by every
//   frame. Structures declared or changed in a step carry into later steps; annotations (pointers,
//   highlights, marks…) belong only to the step they are written in.
//
// Annotations
//   pointer i -> nums[0] green [below]   highlight nums[1..2] orange     dim nums[0..1]
//   window nums[1..3] "sum = 20"         arrow nums[0] -> nums[3] "x"    arrow a[0] <-> a[3] "swap"
//   mark nums[2] "target"   (on tree/graph/trie nodes: a badge, e.g. distances / visit order)
//   path T.8 -> T.3 -> T.6 green         path G.A -> G.C -> G.D          path dp[0][0] -> dp[2][2]
//   path W.car  (root → node)            water h[1..5] 2                 rect h[2..3] 5 "area 10"
//   link L[2] -> L[0] "cycle"            caption "…"                     title "…"
//   sub G.A "dist 4"   (second line inside a tree/graph node: per-node state)   focus G.A  (ring: "this step")
//   state G.A purple   (a node's state color; like `sub`, it persists across steps until changed; `state G.A none`)
//   state G.A pending  (not reached yet: faint + dashed — show the whole structure from the first frame)
//   discard a[0]       (ruled out this step: faded with a red ✕)
//   why "…"            (the reason under a step's caption)        tag "too small" orange  (status pill on the step)
//   vars L=0 blue, R=5 orange, s=12                               (variable chips; color = the pointer's color)
//   calc "{blue:1} + {orange:11} = 12 < {yellow:14}" "too small → move L right" blue   (computed comparison)
//   legend green "waiting" purple "done" gray "not seen" ring "popped this step"   (color key under the diagram)
//   code "node = stack.pop()   ← 4"      (monospace panel: the line(s) running this step; after ← = live value, yellow)
//   stack S "stack (top on the right)" = [1, 3]   (a quoted label after the name replaces the name label;
//   trees/graphs only show a label when given one)     tree T depths = [...]  (depth labels per level)
//
// Refs: name[i]  name[a..b]  name[r][c]  name[r1..r2][c1..c2]  name.label

struct DiagramDoc: Equatable {
    var structures: [DStructure] = []
    var annotations: [DAnnotation] = []
    var title: String?
    var caption: String?
    /// Color key drawn under the diagram.
    var legend: [DLegendItem] = []
    /// Code panel lines (what runs this step).
    var code: [String] = []
    /// Step-through extras: the reason under the caption, and a status pill.
    var why: String?
    var tag: (text: String, color: DColor?)?
    /// Variable chips and a computed comparison line, under the structures.
    var vars: [DVar] = []
    var calc: DCalc?

    static func == (a: DiagramDoc, b: DiagramDoc) -> Bool {
        a.structures == b.structures && a.annotations == b.annotations && a.title == b.title && a.caption == b.caption
            && a.legend == b.legend && a.code == b.code && a.why == b.why && a.tag?.text == b.tag?.text
            && a.tag?.color == b.tag?.color && a.vars == b.vars && a.calc == b.calc
    }

    func structure(named name: String) -> DStructure? { structures.first { $0.name == name } }
}

struct DVar: Equatable {
    var name: String
    var value: String
    var color: DColor?
}

/// An equation with colored segments (`{blue:1} + {orange:11} = 12`) and a verdict line.
struct DCalc: Equatable {
    var segments: [(text: String, color: DColor?)]
    var verdict: String?
    var verdictColor: DColor?

    static func == (a: DCalc, b: DCalc) -> Bool {
        a.verdict == b.verdict && a.verdictColor == b.verdictColor && a.segments.map(\.text) == b.segments.map(\.text)
            && a.segments.map(\.color) == b.segments.map(\.color)
    }

    static func segments(_ s: String) -> [(text: String, color: DColor?)] {
        var out: [(String, DColor?)] = []
        var rest = Substring(s)
        while let open = rest.firstIndex(of: "{") {
            if open > rest.startIndex { out.append((String(rest[..<open]), nil)) }
            guard let close = rest[open...].firstIndex(of: "}") else { out.append((String(rest[open...]), nil)); return out }
            let inner = rest[rest.index(after: open)..<close]
            if let colon = inner.firstIndex(of: ":"), let c = DColor.parse(String(inner[..<colon])) {
                out.append((String(inner[inner.index(after: colon)...]), c))
            } else {
                out.append((String(inner), nil))
            }
            rest = rest[rest.index(after: close)...]
        }
        if !rest.isEmpty { out.append((String(rest), nil)) }
        return out
    }
}

struct DLegendItem: Equatable {
    /// nil + ring = the focus ring; nil without ring = neutral.
    var color: DColor?
    var ring = false
    var text: String
}

struct DStructure: Equatable {
    enum Kind: String, CaseIterable {
        case array, string, set, list, stack, queue, tree, heap, trie, grid, map, bars, intervals, graph, flow
    }
    /// Flowchart node shapes.
    enum FlowShape: String { case process, decision, terminal }
    enum Orientation: String { case auto, down, right, circle }

    var kind: Kind
    var name: String
    var values: [String?] = []          // nil = null
    var links: [String] = []            // list: "->", "<-", "<->", "" (no link) between values[i] and values[i+1]
    var grid: [[String]] = []
    var rowLabels: [String] = []
    var colLabels: [String] = []
    var entries: [Pair] = []
    var nodes: [String] = []
    var edges: [DEdge] = []
    var directed = true
    var orientation: Orientation = .auto
    /// Flow nodes: display text and shape by node id.
    var nodeLabels: [String: String] = [:]
    var nodeShapes: [String: FlowShape] = [:]
    /// Human label shown beside / above the structure ("queue (front on the left)").
    var label: String?
    /// Trees: show "depth k" beside each level.
    var showDepths = false

    struct Pair: Equatable {
        var key: String
        var value: String
    }

    /// Display name: the given label, else `pass_1` → "pass 1".
    var title: String { label ?? name.replacingOccurrences(of: "_", with: " ") }
}

struct DEdge: Equatable {
    var from: String
    var to: String
    var label: String?
    var directed: Bool
    var color: DColor?
}

enum DRef: Equatable {
    case index(String, Int)
    case range(String, Int, Int)
    case cell(String, Int, Int)
    case cellRange(String, Int, Int, Int, Int)  // rows r1...r2, cols c1...c2
    case node(String, String)

    var structureName: String {
        switch self {
        case .index(let n, _), .range(let n, _, _), .cell(let n, _, _), .cellRange(let n, _, _, _, _), .node(let n, _): n
        }
    }
}

enum DAnnotation: Equatable {
    case pointer(label: String, target: DRef, color: DColor?, below: Bool)
    case highlight(DRef, DColor?)
    case dim(DRef)
    case window(DRef, label: String?, color: DColor?)
    case arrow(DRef, DRef, label: String?, color: DColor?, double: Bool)
    case mark(DRef, String)
    case path([DRef], DColor?)
    /// Like `path`, but colors only the edges (e.g. "edges examined this step") and leaves node states alone.
    case edges([DRef], DColor?)
    case water(DRef, level: Double, color: DColor?)
    case rect(DRef, height: Double, label: String?, color: DColor?)
    /// Second text line inside a node (per-node state: "dist 4", "in: 0", "(rob 7, skip 3)").
    case sub(DRef, String)
    /// Ring around the element acted on this step.
    case focus(DRef)
    /// Persistent state color (carries across steps until changed). nil color clears it.
    case state(DRef, DColor?)
    /// Not reached yet: faint + dashed (persistent like `state`).
    case pending(DRef)
    /// Ruled out this step: faded, red ✕.
    case discard(DRef)

    var refs: [DRef] {
        switch self {
        case .pointer(_, let r, _, _), .highlight(let r, _), .dim(let r), .window(let r, _, _), .mark(let r, _),
             .water(let r, _, _), .rect(let r, _, _, _), .sub(let r, _), .focus(let r), .state(let r, _),
             .pending(let r), .discard(let r): [r]
        case .arrow(let a, let b, _, _, _): [a, b]
        case .path(let rs, _), .edges(let rs, _): rs
        }
    }

    /// Structure the annotation is drawn within, or nil when it spans structures (drawn globally).
    var localStructure: String? {
        switch self {
        case .pointer(_, let r, _, _), .highlight(let r, _), .dim(let r), .window(let r, _, _), .mark(let r, _),
             .water(let r, _, _), .rect(let r, _, _, _), .sub(let r, _), .focus(let r), .state(let r, _),
             .pending(let r), .discard(let r):
            return r.structureName
        case .path(let refs, _), .edges(let refs, _):
            let names = Set(refs.map(\.structureName))
            return names.count == 1 ? names.first : nil
        case .arrow:
            return nil
        }
    }
}

enum DColor: String, CaseIterable {
    case blue, green, orange, red, purple, pink, yellow, teal, gray
    static func parse(_ s: String) -> DColor? {
        switch s.lowercased() {
        case "grey": .gray
        case "amber": .orange
        case "cyan": .teal
        default: DColor(rawValue: s.lowercased())
        }
    }
}

enum DiagramParser {
    /// Parses the DSL. While streaming (`complete == false`) a trailing partial line is held back.
    /// For a step-through diagram this is the final frame; use `frames` to get every step.
    static func parse(_ source: String, complete: Bool = true) -> DiagramDoc {
        frames(source, complete: complete).last ?? DiagramDoc()
    }

    /// Every frame of a diagram: one for a plain diagram, one per `step` for a step-through.
    static func frames(_ source: String, complete: Bool = true) -> [DiagramDoc] {
        var lines = source.components(separatedBy: "\n")
        if !complete, !source.hasSuffix("\n") { lines.removeLast() }

        var base = DiagramDoc()
        var steps: [(caption: String?, lines: [String])] = []
        for raw in lines {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.isEmpty || line.hasPrefix("#") || line.hasPrefix("//") { continue }
            let (keyword, rest) = splitFirstWord(line)
            if ["step", "frame"].contains(keyword.lowercased()) {
                steps.append((stepCaption(rest), []))
            } else if steps.isEmpty {
                apply(line, to: &base)
            } else {
                steps[steps.count - 1].lines.append(line)
            }
        }
        guard !steps.isEmpty else { return [base] }

        var frames: [DiagramDoc] = []
        var structures = base.structures
        // `sub` and `state` describe a node's state, so they persist from step to step until changed.
        var carried: [(key: String, ann: DAnnotation)] = []
        func persistKey(_ a: DAnnotation) -> String? {
            switch a {
            case .sub(let r, _): "sub:" + r.key
            case .state(let r, _), .pending(let r): "state:" + r.key
            default: nil
            }
        }
        func carry(_ anns: [DAnnotation]) {
            for a in anns {
                guard let k = persistKey(a) else { continue }
                carried.removeAll { $0.key == k }
                carried.append((k, a))
            }
        }
        carry(base.annotations)
        for step in steps {
            var frame = DiagramDoc(structures: structures, annotations: base.annotations, title: base.title,
                                   caption: step.caption ?? base.caption, legend: base.legend, code: [])
            frame.vars = base.vars
            for line in step.lines { apply(line, to: &frame) }
            if frame.code.isEmpty { frame.code = base.code }   // per-step code replaces the shared one
            carry(Array(frame.annotations.dropFirst(base.annotations.count)))
            frame.annotations = frame.annotations.filter { persistKey($0) == nil } + carried.map(\.ann)
            structures = frame.structures   // structural changes persist; annotations don't
            frames.append(frame)
        }
        return frames
    }

    /// `step "text"`, `step 2 "text"`, `step 2: text` → "text".
    private static func stepCaption(_ rest: String) -> String? {
        let (_, quoted) = extractQuoted(rest)
        if let quoted { return quoted }
        var t = rest.trimmingCharacters(in: .whitespaces)
        t = String(t.drop { $0.isNumber || $0 == ":" || $0 == "." || $0 == ")" }).trimmingCharacters(in: .whitespaces)
        return t.isEmpty ? nil : unquote(t)
    }

    // MARK: - Statements

    private static let kindAliases: [String: DStructure.Kind] = [
        "matrix": .grid, "table": .grid, "linkedlist": .list, "hashmap": .map, "dict": .map, "histogram": .bars,
        "deque": .queue, "bst": .tree, "minheap": .heap, "maxheap": .heap, "chars": .string, "flowchart": .flow,
    ]

    private static func apply(_ line: String, to doc: inout DiagramDoc) {
        let (keyword, rest) = splitFirstWord(line)
        let kw = keyword.lowercased()

        if let kind = DStructure.Kind(rawValue: kw) ?? kindAliases[kw] {
            declare(kind, rest, &doc)
            return
        }
        switch kw {
        case "rows", "cols":
            guard let (name, literal) = splitAssignment(rest), let i = doc.structures.firstIndex(where: { $0.name == name }) else { return }
            let labels = parseList(literal).map { $0 ?? "∅" }
            if kw == "rows" { doc.structures[i].rowLabels = labels } else { doc.structures[i].colLabels = labels }
        case "nodes":
            guard let (name, literal) = splitAssignment(rest) else { return }
            let i = ensureGraph(name, &doc)
            for n in parseList(literal).compactMap({ $0 }) where !doc.structures[i].nodes.contains(n) {
                doc.structures[i].nodes.append(n)
            }
        case "edge":
            let (name, edgeText) = splitFirstWord(rest)
            addEdge(graph: name, edgeText, &doc)
        case "node", "process", "box", "decision", "diamond", "condition", "start", "end", "stop", "terminal":
            addFlowNode(kw, rest, &doc)
        case "pointer", "ptr":
            var (body, color) = trailingColor(rest)
            var below = false
            if body.lowercased().hasSuffix(" below") { below = true; body = String(body.dropLast(6)) }
            if color == nil { (body, color) = trailingColor(body) }
            guard let arrow = body.range(of: "->") else { return }
            let label = unquote(String(body[..<arrow.lowerBound]).trimmingCharacters(in: .whitespaces))
            let target = String(body[arrow.upperBound...]).trimmingCharacters(in: .whitespaces)
            guard !label.isEmpty, let ref = parseRef(target) else { return }
            doc.annotations.append(.pointer(label: label, target: ref, color: color, below: below))
        case "highlight", "hl", "color":
            let (body, color) = trailingColor(rest)
            for part in splitRefs(body) {
                if let ref = parseRef(part) { doc.annotations.append(.highlight(ref, color ?? .blue)) }
            }
        case "dim", "visited", "eliminate", "fade":
            for part in splitRefs(rest) {
                if let ref = parseRef(part) { doc.annotations.append(.dim(ref)) }
            }
        case "window", "range", "span":
            let (body, color) = trailingColor(rest)
            let (refText, label) = extractQuoted(body)
            guard let ref = parseRef(refText) else { return }
            doc.annotations.append(.window(ref, label: label, color: color))
        case "arrow", "link", "swap":
            let (body, color) = trailingColor(rest)
            let (refsText, quoted) = extractQuoted(body)
            let double = kw == "swap" || refsText.contains("<->")
            let parts = refsText.components(separatedBy: double && refsText.contains("<->") ? "<->" : "->")
            guard parts.count == 2, let a = parseRef(parts[0]), let b = parseRef(parts[1]) else { return }
            doc.annotations.append(.arrow(a, b, label: quoted ?? (kw == "swap" ? "swap" : nil), color: color, double: double))
        case "path", "route", "walk":
            let (body, color) = trailingColor(rest)
            let refs = body.components(separatedBy: "->").compactMap { parseRef($0) }
            guard !refs.isEmpty else { return }
            doc.annotations.append(.path(refs, color))
        case "edges", "examine", "relax":
            let (body, color) = trailingColor(rest)
            let refs = body.components(separatedBy: "->").compactMap { parseRef($0) }
            guard refs.count > 1 else { return }
            doc.annotations.append(.edges(refs, color))
        case "mark", "note", "label", "badge":
            let (refText, text) = extractQuoted(rest)
            if let ref = parseRef(refText), let text {
                doc.annotations.append(.mark(ref, text))
            } else {
                // Unquoted: `mark G.A 0`
                let words = rest.split(separator: " ").map(String.init)
                guard words.count >= 2, let ref = parseRef(words[0]) else { return }
                doc.annotations.append(.mark(ref, words[1...].joined(separator: " ")))
            }
        case "water", "fill":
            let (body, color) = trailingColor(rest)
            let words = body.split(separator: " ").map(String.init)
            guard words.count >= 2, let ref = parseRef(words[0]), let level = Double(words[1]) else { return }
            doc.annotations.append(.water(ref, level: level, color: color))
        case "rect", "area":
            let (body, color) = trailingColor(rest)
            let (head, label) = extractQuoted(body)
            let words = head.split(separator: " ").map(String.init)
            guard words.count >= 2, let ref = parseRef(words[0]), let height = Double(words[1]) else { return }
            doc.annotations.append(.rect(ref, height: height, label: label, color: color))
        case "sub", "detail", "subtitle":
            let (refText, text) = extractQuoted(rest)
            if let ref = parseRef(refText.trimmingCharacters(in: .whitespaces)), let text { doc.annotations.append(.sub(ref, text)) }
        case "state", "status":
            let words = rest.split(separator: " ").map(String.init)
            guard let last = words.last else { return }
            let color = DColor.parse(last)
            let clears = ["none", "clear", "reset", "neutral"].contains(last.lowercased())
            let pending = ["pending", "ghost", "later", "future", "unvisited"].contains(last.lowercased())
            guard color != nil || clears || pending else { return }
            for part in splitRefs(words.dropLast().joined(separator: " ")) {
                if let ref = parseRef(part) { doc.annotations.append(pending ? .pending(ref) : .state(ref, color)) }
            }
        case "pending", "ghost":
            for part in splitRefs(rest) { if let ref = parseRef(part) { doc.annotations.append(.pending(ref)) } }
        case "discard", "drop", "rule-out", "eliminate-step":
            for part in splitRefs(rest) { if let ref = parseRef(part) { doc.annotations.append(.discard(ref)) } }
        case "why", "because", "reason":
            doc.why = unquote(rest)
        case "tag", "status", "verdict":
            let (body, color) = trailingColor(rest)
            doc.tag = (unquote(body), color)
        case "vars", "var", "variables":
            for item in splitTopLevel(rest, separator: ",") {
                let (body, color) = trailingColor(item)
                let parts = body.split(separator: "=", maxSplits: 1).map { $0.trimmingCharacters(in: .whitespaces) }
                guard let name = parts.first, !name.isEmpty else { continue }
                doc.vars.append(DVar(name: unquote(name), value: parts.count > 1 ? unquote(parts[1]) : "", color: color))
            }
        case "calc", "compare", "equation":
            let (body, color) = trailingColor(rest)
            let quoted = quotedStrings(body)
            guard let eq = quoted.first else { return }
            doc.calc = DCalc(segments: DCalc.segments(eq), verdict: quoted.dropFirst().first, verdictColor: color)
        case "focus", "current", "ring":
            for part in splitRefs(rest) {
                if let ref = parseRef(part) { doc.annotations.append(.focus(ref)) }
            }
        case "legend", "key":
            doc.legend += legendItems(rest)
        case "code":
            let text = unquote(rest).replacingOccurrences(of: "\\n", with: "\n")
            doc.code += text.components(separatedBy: "\n")
        case "caption":
            doc.caption = unquote(rest)
        case "title":
            doc.title = unquote(rest)
        default:
            // Shorthand graph edge: `G: A -> B 5`
            if let colon = line.firstIndex(of: ":"), line.contains("->") || line.contains("--") {
                addEdge(graph: String(line[..<colon]).trimmingCharacters(in: .whitespaces),
                        String(line[line.index(after: colon)...]), &doc)
            }
        }
    }

    private static func declare(_ kind: DStructure.Kind, _ rest: String, _ doc: inout DiagramDoc) {
        var head = rest
        var literal = ""
        // The first `=` outside quotes: a label may itself contain one ("ans[i] = days to wait").
        var quoted = false
        let eqIndex = rest.indices.first { i in
            if rest[i] == "\"" { quoted.toggle() }
            return !quoted && rest[i] == "="
        }
        if let eq = eqIndex {
            head = String(rest[..<eq])
            literal = String(rest[rest.index(after: eq)...]).trimmingCharacters(in: .whitespaces)
        }
        // `stack S "stack (top on the right)" = …`: a quoted label after the name.
        let (unlabeled, label) = extractQuoted(head)
        head = unlabeled
        var words = head.split(separator: " ").map(String.init)
        var s = DStructure(kind: kind, name: "_")
        s.label = label
        if let d = words.firstIndex(where: { $0.lowercased() == "depths" }), words.count > 1 {
            s.showDepths = true
            words.remove(at: d)
        }
        if kind == .graph || kind == .flow {
            for w in words {
                switch w.lowercased() {
                case "undirected": s.directed = false
                case "down", "tree", "vertical", "td": s.orientation = .down
                case "right", "lr", "horizontal": s.orientation = .right
                case "circle", "ring", "cycle": s.orientation = .circle
                default: continue
                }
            }
            words.removeAll { ["undirected", "directed", "down", "tree", "vertical", "td", "right", "lr", "horizontal", "circle", "ring", "cycle"].contains($0.lowercased()) }
        }
        s.name = words.first.map(unquote) ?? "_"

        switch kind {
        case .string:
            s.values = Array(unquote(literal)).map { String($0) }
        case .grid:
            s.grid = parseGrid(literal)
        case .intervals:
            s.grid = parseGrid(literal).filter { $0.count >= 2 }
        case .map:
            s.entries = parseMap(literal)
        case .graph, .flow:
            break
        case .list:
            (s.values, s.links) = parseLinkedList(literal)
        case .trie:
            s.values = parseList(literal).compactMap { $0 }.map { Optional($0) }
        default:
            s.values = parseList(literal)
        }
        // Redeclaration replaces (graphs keep edges declared earlier); a label or depths flag carries over.
        if let i = doc.structures.firstIndex(where: { $0.name == s.name }) {
            if kind == .graph || kind == .flow {
                doc.structures[i].directed = s.directed; doc.structures[i].orientation = s.orientation
                if let label { doc.structures[i].label = label }
                return
            }
            if s.label == nil { s.label = doc.structures[i].label }
            s.showDepths = s.showDepths || doc.structures[i].showDepths
            doc.structures[i] = s
        } else {
            doc.structures.append(s)
        }
    }

    @discardableResult
    private static func ensureGraph(_ name: String, _ doc: inout DiagramDoc, kind: DStructure.Kind = .graph) -> Int {
        if let i = doc.structures.firstIndex(where: { $0.name == name && ($0.kind == .graph || $0.kind == .flow) }) { return i }
        doc.structures.append(DStructure(kind: kind, name: name))
        return doc.structures.count - 1
    }

    /// `node F.id "label" [decision|start|end]`, or the shape as the keyword: `decision F.check "lo <= hi?"`.
    private static func addFlowNode(_ keyword: String, _ rest: String, _ doc: inout DiagramDoc) {
        let (head, quoted) = extractQuoted(rest)
        var words = head.split(separator: " ").map(String.init)
        guard !words.isEmpty, case .node(let name, let id)? = parseRef(words.removeFirst()) else { return }
        // Text after the closing quote can name the shape too: `node F.x "…" decision`.
        var tail: [String] = words
        if quoted != nil, let close = rest.lastIndex(where: { $0 == "\"" || $0 == "'" }) {
            tail += rest[rest.index(after: close)...].split(separator: " ").map(String.init)
        }
        func shape(_ w: String) -> DStructure.FlowShape? {
            switch w.lowercased() {
            case "decision", "diamond", "condition", "if", "check": .decision
            case "start", "end", "stop", "terminal", "return", "done": .terminal
            case "process", "box", "action": .process
            default: nil
            }
        }
        let kind = shape(keyword) ?? tail.lazy.compactMap(shape).first ?? .process
        let i = ensureGraph(name, &doc, kind: .flow)
        if !doc.structures[i].nodes.contains(id) { doc.structures[i].nodes.append(id) }
        doc.structures[i].nodeLabels[id] = quoted ?? doc.structures[i].nodeLabels[id]
        doc.structures[i].nodeShapes[id] = kind
    }

    private static func addEdge(graph name: String, _ text: String, _ doc: inout DiagramDoc) {
        let (body, color) = trailingColor(text)
        let directed = body.contains("->")
        let parts = body.components(separatedBy: directed ? "->" : "--")
        guard parts.count == 2 else { return }
        // `edge F F.a -> F.b` is accepted too: strip the structure prefix.
        func local(_ s: String) -> String { s.hasPrefix(name + ".") ? String(s.dropFirst(name.count + 1)) : s }
        let from = local(unquote(parts[0].trimmingCharacters(in: .whitespaces)))
        let (toPart, quotedLabel) = extractQuoted(parts[1])
        let toWords = toPart.split(separator: " ").map(String.init)
        guard let to = toWords.first.map({ local(unquote($0)) }), !from.isEmpty, !to.isEmpty else { return }
        let label = quotedLabel ?? (toWords.count > 1 ? toWords[1...].joined(separator: " ") : nil)

        let i = ensureGraph(name, &doc)
        for n in [from, to] where !doc.structures[i].nodes.contains(n) { doc.structures[i].nodes.append(n) }
        if !directed && doc.structures[i].kind == .graph { doc.structures[i].directed = false }
        doc.structures[i].edges.append(DEdge(from: from, to: to, label: label, directed: directed, color: color))
    }

    /// Every "quoted" string in order.
    private static func quotedStrings(_ s: String) -> [String] {
        var out: [String] = []
        var rest = Substring(s)
        while let open = rest.firstIndex(where: { $0 == "\"" || $0 == "'" }) {
            let q = rest[open]
            let after = rest.index(after: open)
            let close = rest[after...].firstIndex(of: q) ?? rest.endIndex
            out.append(String(rest[after..<close]))
            rest = close < rest.endIndex ? rest[rest.index(after: close)...] : ""
        }
        return out
    }

    /// `green "waiting" purple "done" ring "this step"` → legend entries.
    private static func legendItems(_ s: String) -> [DLegendItem] {
        var items: [DLegendItem] = []
        var rest = Substring(s)
        while true {
            rest = rest.drop { $0 == " " || $0 == "," }
            guard !rest.isEmpty else { break }
            let word = String(rest.prefix { $0 != " " && $0 != "\"" && $0 != "'" })
            rest = rest.dropFirst(word.count).drop { $0 == " " }
            guard let q = rest.first, q == "\"" || q == "'" else {
                if word.isEmpty { break }
                continue
            }
            rest = rest.dropFirst()
            let text = String(rest.prefix { $0 != q })
            rest = rest.dropFirst(text.count + 1)
            let w = word.lowercased()
            items.append(DLegendItem(color: DColor.parse(w), ring: ["ring", "focus", "current", "outline"].contains(w), text: text))
        }
        return items
    }

    // MARK: - Refs

    static func parseRef(_ text: String) -> DRef? {
        let t = text.trimmingCharacters(in: .whitespaces)
        guard let first = t.first, first.isLetter || first == "_" else { return nil }
        let name = String(t.prefix { $0.isLetter || $0.isNumber || $0 == "_" })
        var rest = t.dropFirst(name.count)

        if rest.hasPrefix(".") || rest.hasPrefix("(") {
            let label = rest.dropFirst().trimmingCharacters(in: CharacterSet(charactersIn: ") "))
            return label.isEmpty ? nil : .node(name, unquote(label))
        }
        var indices: [String] = []
        while rest.hasPrefix("["), let close = rest.firstIndex(of: "]") {
            indices.append(String(rest[rest.index(after: rest.startIndex)..<close]).trimmingCharacters(in: .whitespaces))
            rest = rest[rest.index(after: close)...]
        }
        if indices.count == 2 {
            let rows = parseIndexRange(indices[0]), cols = parseIndexRange(indices[1])
            guard let rows, let cols else { return nil }
            if rows.0 == rows.1 && cols.0 == cols.1 { return .cell(name, rows.0, cols.0) }
            return .cellRange(name, rows.0, rows.1, cols.0, cols.1)
        }
        guard indices.count == 1, let (a, b) = parseIndexRange(indices[0]) else { return nil }
        return a == b && !indices[0].contains(where: { "-:.".contains($0) }) ? .index(name, a) : (a == b ? .index(name, a) : .range(name, a, b))
    }

    private static func parseIndexRange(_ idx: String) -> (Int, Int)? {
        if let n = Int(idx) { return (n, n) }
        for sep in ["..", ":", "-"] {
            let parts = idx.components(separatedBy: sep)
            if parts.count == 2, let a = Int(parts[0].trimmingCharacters(in: .whitespaces)),
               let b = Int(parts[1].trimmingCharacters(in: .whitespaces)) {
                return (min(a, b), max(a, b))
            }
        }
        return nil
    }

    // MARK: - Literals

    static func parseList(_ literal: String) -> [String?] {
        var s = literal.trimmingCharacters(in: .whitespaces)
        let items: [String]
        if s.hasPrefix("[") {
            if s.hasSuffix("]") { s = String(s.dropFirst().dropLast()) } else { s = String(s.dropFirst()) }
            items = splitTopLevel(s, separator: ",")
        } else if s.contains("->") {
            items = s.components(separatedBy: "->")
        } else {
            items = s.contains(",") ? splitTopLevel(s, separator: ",") : s.split(separator: " ").map(String.init)
        }
        return items.map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.map { item in
            ["null", "none", "nil", "∅"].contains(item.lowercased()) ? nil : unquote(item)
        }
    }

    /// `1 -> 2 <- 3 <-> 4 -> null`, or `[1, 2, 3]` (all forward).
    static func parseLinkedList(_ literal: String) -> ([String?], [String]) {
        let s = literal.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("[") {
            let values = parseList(s)
            return (values, Array(repeating: "->", count: max(0, values.count - 1)))
        }
        var values: [String?] = []
        var links: [String] = []
        var token = ""
        var chars = Array(s)
        chars.append(" ")
        var i = 0
        func flushToken() {
            let t = token.trimmingCharacters(in: .whitespaces)
            token = ""
            guard !t.isEmpty else { return }
            if values.count > links.count { links.append("") }  // two values with no link between
            values.append(["null", "none", "nil", "∅"].contains(t.lowercased()) ? nil : unquote(t))
        }
        while i < chars.count {
            let rest = String(chars[i..<min(i + 3, chars.count)])
            if rest.hasPrefix("<->") { flushToken(); links.append("<->"); i += 3; continue }
            if rest.hasPrefix("->") { flushToken(); links.append("->"); i += 2; continue }
            if rest.hasPrefix("<-") { flushToken(); links.append("<-"); i += 2; continue }
            if chars[i] == " " || chars[i] == "," { flushToken(); i += 1; continue }
            token.append(chars[i])
            i += 1
        }
        flushToken()
        while links.count >= values.count, !links.isEmpty { links.removeLast() }
        return (values, links)
    }

    static func parseGrid(_ literal: String) -> [[String]] {
        var s = literal.trimmingCharacters(in: .whitespaces)
        guard s.hasPrefix("[") else { return [] }
        s.removeFirst()
        if s.hasSuffix("]") { s.removeLast() }
        return splitTopLevel(s, separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { $0.hasPrefix("[") }
            .map { parseList($0).map { $0 ?? "∅" } }
    }

    static func parseMap(_ literal: String) -> [DStructure.Pair] {
        var s = literal.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("{") { s.removeFirst() }
        if s.hasSuffix("}") { s.removeLast() }
        return splitTopLevel(s, separator: ",").compactMap { pair in
            let parts = splitTopLevel(pair, separator: ":")
            guard parts.count >= 2 else { return nil }
            let key = unquote(parts[0].trimmingCharacters(in: .whitespaces))
            let value = unquote(parts[1...].joined(separator: ":").trimmingCharacters(in: .whitespaces))
            return key.isEmpty ? nil : DStructure.Pair(key: key, value: value)
        }
    }

    /// Splits on `separator` outside of brackets, braces and quotes.
    static func splitTopLevel(_ s: String, separator: Character) -> [String] {
        var parts: [String] = []
        var current = ""
        var depth = 0
        var quote: Character?
        for ch in s {
            if let q = quote {
                current.append(ch)
                if ch == q { quote = nil }
                continue
            }
            switch ch {
            case "\"", "'": quote = ch; current.append(ch)
            case "[", "{", "(": depth += 1; current.append(ch)
            case "]", "}", ")": depth -= 1; current.append(ch)
            case separator where depth == 0: parts.append(current); current = ""
            default: current.append(ch)
            }
        }
        if !current.trimmingCharacters(in: .whitespaces).isEmpty { parts.append(current) }
        return parts
    }

    /// Ref lists separated by commas or spaces (`a[1], a[3]`, `T[1] T[2]`, `G.A G.B`); spaces and commas inside
    /// brackets stay part of the ref (`dp[0..1][2..3]`, `a[1, 2]`).
    private static func splitRefs(_ s: String) -> [String] {
        var out: [String] = []
        var cur = ""
        var depth = 0
        for ch in s {
            switch ch {
            case "[": depth += 1; cur.append(ch)
            case "]": depth = max(0, depth - 1); cur.append(ch)
            // `where` binds only to the last pattern of a case, so each separator carries its own.
            case " " where depth == 0, "," where depth == 0, "\t" where depth == 0:
                if !cur.isEmpty { out.append(cur); cur = "" }
            default: cur.append(ch)
            }
        }
        if !cur.isEmpty { out.append(cur) }
        return out
    }

    // MARK: - Helpers

    private static func splitFirstWord(_ s: String) -> (String, String) {
        let t = s.trimmingCharacters(in: .whitespaces)
        guard let space = t.firstIndex(where: { $0 == " " || $0 == "\t" }) else { return (t, "") }
        return (String(t[..<space]), String(t[t.index(after: space)...]).trimmingCharacters(in: .whitespaces))
    }

    private static func splitAssignment(_ s: String) -> (String, String)? {
        guard let eq = s.firstIndex(of: "=") else { return nil }
        return (String(s[..<eq]).trimmingCharacters(in: .whitespaces), String(s[s.index(after: eq)...]))
    }

    /// Strips a trailing color word (`… green`).
    private static func trailingColor(_ s: String) -> (String, DColor?) {
        let t = s.trimmingCharacters(in: .whitespaces)
        guard let space = t.lastIndex(of: " ") else { return (t, nil) }
        let word = String(t[t.index(after: space)...])
        if let color = DColor.parse(word) { return (String(t[..<space]).trimmingCharacters(in: .whitespaces), color) }
        return (t, nil)
    }

    /// Pulls the first "quoted" string out of `s`.
    private static func extractQuoted(_ s: String) -> (String, String?) {
        // A quote only opens a string at the start of a token (so `f2'` stays a plain label).
        guard let open = s.indices.first(where: { i in
            (s[i] == "\"" || s[i] == "'") && (i == s.startIndex || s[s.index(before: i)].isWhitespace)
        }) else { return (s, nil) }
        let q = s[open]
        let after = s.index(after: open)
        let close = s[after...].firstIndex(of: q) ?? s.endIndex
        let label = String(s[after..<close])
        return (String(s[..<open]), label.isEmpty ? nil : label)
    }

    static func unquote(_ s: String) -> String {
        let t = s.trimmingCharacters(in: .whitespaces)
        if t.count >= 2, let f = t.first, f == "\"" || f == "'", t.last == f { return String(t.dropFirst().dropLast()) }
        if let f = t.first, f == "\"" || f == "'" { return String(t.dropFirst()) }  // streaming: unterminated
        return t
    }
}
