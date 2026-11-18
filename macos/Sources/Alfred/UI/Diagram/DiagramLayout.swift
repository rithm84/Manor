import CoreGraphics
import Foundation

/// A laid-out diagram: positioned primitives in draw order. Pure value types → testable, cheap to
/// rebuild on every streamed line.
struct DScene {
    var items: [DItem] = []
    var size: CGSize = .zero
}

struct DItem {
    enum Shape {
        case box(CGRect, radius: CGFloat)
        case circle(center: CGPoint, radius: CGFloat)
        case polyline([CGPoint])
        case curve(from: CGPoint, control: CGPoint, to: CGPoint)
        case cubic(from: CGPoint, c1: CGPoint, c2: CGPoint, to: CGPoint)
        case text(String, at: CGPoint, anchor: CGPoint)   // anchor in unit space (0.5, 0.5 = centered)
        case textBlock(String, CGRect)
        case dot(CGPoint, CGFloat)
        /// Closed polygon (flowchart decision diamonds).
        case polygon([CGPoint])
    }

    enum Font: Equatable { case value, small, index, label, chip, caption, title, edge, badge, sub, name, code, legend, calc, verdict }
    enum Tone: Equatable { case neutral, muted, faint, accent(DColor) }

    let id: String
    var shape: Shape
    var fill: Tone?
    var stroke: Tone?
    var lineWidth: CGFloat = 1
    var arrow = false
    var arrowStart = false
    var dashed = false
    /// Solid accent fill (pointer chips, badges) rather than a translucent tint.
    var solid = false
    /// Raised cell styling (top-lit gradient + hairline) when not highlighted.
    var cell = false
    var font: Font = .value
    var textTone: Tone = .neutral
    /// Highlight color applied to cells/nodes/bars.
    var accent: DColor?
    var dimmed = false
    var glow = false
    /// Second ring (trie end-of-word).
    var ring = false
    /// Translucent fill drawn at ~40 % (water) instead of the light tint.
    var strongFill = false
    /// Decorative stroke that intentionally sits on its own shape (list separators, paths under cells).
    var decor = false
    /// Ring: the element acted on this step.
    var focus = false
    /// Border tint from a pointer sitting on this cell (L → blue border, R → orange…).
    var outline: DColor?
    /// Not reached yet: faint, dashed.
    var pending = false
}

enum DiagramLayout {
    // Metrics (pt). Tuned for a ~500 pt wide answer column.
    static let cellH: CGFloat = 34
    static let cellGap: CGFloat = 5
    static let minCellW: CGFloat = 34
    static let nodeR: CGFloat = 17
    static let blockGap: CGFloat = 28
    /// Same-row arcs: floor depth of the shallowest arc below the cells, and the step between nested arcs.
    static let arcBase: CGFloat = 22, arcStep: CGFloat = 20
    static let gutterPad: CGFloat = 14

    static func monoWidth(_ s: String, size: CGFloat) -> CGFloat { CGFloat(s.count) * size * 0.6 }
    static func sansWidth(_ s: String, size: CGFloat) -> CGFloat { CGFloat(s.count) * size * 0.55 }

    static let linearKinds: Set<DStructure.Kind> = [.array, .string, .list, .queue, .set, .bars]
    static let nodeKinds: Set<DStructure.Kind> = [.tree, .heap, .trie, .graph, .flow]

    // MARK: - Entry

    /// - Parameter maxWidth: column width available for text (captions wrap to it).
    static func layout(_ doc: DiagramDoc, maxWidth: CGFloat = 480) -> DScene {
        layoutFrames([doc], maxWidth: maxWidth, captions: true)[0]
    }

    /// Lays out every frame of a step-through with one shared placement: each structure sits at the same
    /// spot in every frame (room reserved for the tallest annotations any frame adds), and all scenes share
    /// one size — so stepping moves pointers and highlights, never the structures themselves.
    /// - Parameter captions: draw `caption` inside the scene (step-throughs show it beside the controls).
    static func layoutFrames(_ docs: [DiagramDoc], maxWidth: CGFloat = 480, captions: Bool = false) -> [DScene] {
        let docs = docs.map(normalizeIndexBase)
        guard !docs.isEmpty else { return [] }

        // Node state lines: per frame, plus the longest per structure across frames (stable node size).
        func subs(_ doc: DiagramDoc, _ name: String) -> [String: String] {
            var out: [String: String] = [:]
            for case .sub(let ref, let text) in doc.annotations where ref.structureName == name { for k in ref.keys { out[k] = text } }
            return out
        }
        var subChars: [String: Int] = [:]
        for doc in docs {
            for case .sub(let ref, let text) in doc.annotations {
                subChars[ref.structureName] = max(subChars[ref.structureName] ?? 0, text.count)
            }
        }

        // Per frame: each structure's block with that frame's local annotations.
        typealias Laid = (s: DStructure, block: Block, bounds: CGRect, arcs: Int)
        let laid: [[Laid]] = docs.map { doc in
            doc.structures.compactMap { s in
                let local = doc.annotations.filter { $0.localStructure == s.name }
                let arrowsHere = doc.annotations.contains {
                    switch $0 {
                    case .arrow(let a, let b, _, _, _): a.structureName == s.name || b.structureName == s.name
                    case .path(let refs, _), .edges(let refs, _): refs.first?.structureName == s.name
                    case .mark(let ref, _): s.kind == .grid && ref.structureName == s.name
                    default: false
                    }
                }
                var block = layoutStructure(s, roomy: arrowsHere, subs: subs(doc, s.name), subChars: subChars[s.name] ?? 0)
                applyAnnotations(local, structure: s, block: &block)
                let all = block.underlay + block.items
                guard !all.isEmpty else { return nil }
                let arcs = doc.annotations.filter {
                    if case .arrow(let a, let b, _, _, _) = $0 { a.structureName == s.name && b.structureName == s.name } else { false }
                }.count
                return (s, block, all.reduce(CGRect.null) { $0.union($1.shape.bounds) }.standardized, arcs)
            }
        }

        // Shared placement: structure order of first appearance, union extents across frames.
        var order: [String] = []
        var extent: [String: (minX: CGFloat, minY: CGFloat, maxY: CGFloat, arcRoom: CGFloat)] = [:]
        for frame in laid {
            for l in frame {
                if !order.contains(l.s.name) { order.append(l.s.name) }
                let room: CGFloat = l.arcs > 0 && linearKinds.contains(l.s.kind) ? 26 + arcBase + CGFloat(l.arcs - 1) * arcStep + 10 : 0
                let e = extent[l.s.name] ?? (.infinity, .infinity, -.infinity, 0)
                extent[l.s.name] = (min(e.minX, l.bounds.minX), min(e.minY, l.bounds.minY), max(e.maxY, l.bounds.maxY), max(e.arcRoom, room))
            }
        }
        let titles = docs.flatMap(\.structures).filter(showsName).map { sansWidth($0.title, size: 12) + 6 }
        // Short names ("nums", "dp") sit in a left gutter; descriptive labels ("queue (front on the left)") go
        // above their structure instead, so they don't push everything sideways in a narrow column.
        let stackedLabels = (titles.max() ?? 0) > 72
        let gutterW = !stackedLabels && (titles.max() ?? 0) > 0 ? titles.max()! + gutterPad : 0
        let titled = docs.contains { !($0.title ?? "").isEmpty }
        var offset: [String: CGPoint] = [:]
        var y: CGFloat = titled ? 28 : 0
        var labelTop: [String: CGFloat] = [:]
        let labeled = Set(docs.flatMap(\.structures).filter(showsName).map(\.name))
        for name in order {
            let e = extent[name]!
            if stackedLabels && labeled.contains(name) { labelTop[name] = y; y += 22 }
            offset[name] = CGPoint(x: gutterW - min(e.minX, 0), y: y - e.minY)
            y += (e.maxY - e.minY) + blockGap + e.arcRoom
        }

        // Code panel and legend sit at one place for every frame (sized for the largest).
        let panels = Panels(top: y - blockGap + 10, codeLines: docs.map { codeRows($0.code, width: maxWidth).count }.max() ?? 0,
                            codeWidth: docs.flatMap { codeRows($0.code, width: maxWidth) }.map { monoWidth($0.code + ($0.live ?? ""), size: 12) }.max() ?? 0,
                            legend: docs.max(by: { $0.legend.count < $1.legend.count })?.legend ?? [],
                            hasCalc: docs.contains { $0.calc != nil },
                            calcVerdict: docs.contains { $0.calc?.verdict != nil },
                            varRows: docs.map { varRows($0.vars, width: maxWidth) }.max() ?? 0)
        var scenes = zip(docs, laid).map { doc, frame in
            emit(doc, frame.map { ($0.s, $0.block) }, offset: offset, maxWidth: maxWidth, caption: captions, panels: panels,
                 labelTop: labelTop)
        }

        // One canvas for all frames.
        var ext = scenes.reduce(CGRect.null) { acc, sc in sc.items.reduce(acc) { $0.union($1.shape.bounds) } }
        if ext.isNull { ext = .zero }
        let dx = max(0, -ext.minX), dy = max(0, -ext.minY)
        let size = CGSize(width: max(ext.maxX + dx, 40), height: max(ext.maxY + dy, 20))
        for k in scenes.indices {
            if dx > 0 || dy > 0 { scenes[k].items = scenes[k].items.map { var i = $0; i.shape = i.shape.offset(dx, dy); return i } }
            scenes[k].size = size
        }
        return scenes
    }

    struct Panels {
        var top: CGFloat
        var codeLines: Int
        var codeWidth: CGFloat
        var legend: [DLegendItem]
        var hasCalc = false
        var calcVerdict = false
        var varRows = 0
    }

    /// Linear structures always carry their name; trees/graphs only when given a label (no stray "T").
    static func showsName(_ s: DStructure) -> Bool {
        guard s.name != "_", s.kind != .flow else { return false }
        return s.label != nil || !nodeKinds.contains(s.kind)
    }

    /// One frame's primitives at the shared placement.
    private static func emit(_ doc: DiagramDoc, _ blocks: [(DStructure, Block)], offset: [String: CGPoint],
                             maxWidth: CGFloat, caption: Bool, panels: Panels? = nil, labelTop: [String: CGFloat] = [:]) -> DScene {
        var scene = DScene()
        var anchors: [String: CGRect] = [:]

        if let title = doc.title, !title.isEmpty {
            scene.items.append(DItem(id: "title", shape: .text(title, at: .zero, anchor: .zero), font: .title))
        }
        for (s, block) in blocks {
            guard let o = offset[s.name] else { continue }
            for var item in block.underlay + block.items {
                item.shape = item.shape.offset(o.x, o.y)
                scene.items.append(item)
            }
            for (k, r) in block.anchors { anchors[k] = r.offsetBy(dx: o.x, dy: o.y) }
            if showsName(s) {
                let at = labelTop[s.name].map { CGPoint(x: 0, y: $0) } ?? CGPoint(x: 0, y: block.labelY + o.y)
                scene.items.append(DItem(id: "name.\(s.name)", shape: .text(s.title, at: at, anchor: CGPoint(x: 0, y: labelTop[s.name] == nil ? 0.5 : 0)),
                                         font: .name, textTone: .muted))
            }
        }
        // Arrows: same-row arcs for linear structures, otherwise curved connectors (also across structures).
        // Same-row arcs are nested U shapes: each gets its own depth (shortest span closest to the cells), so
        // arcs converging on one cell never cross and every label pill sits alone on its own arc's floor.
        var slotOf: [Int: (index: Int, total: Int)] = [:]
        var byTarget: [String: [(n: Int, span: CGFloat)]] = [:]
        var levelOf: [Int: Int] = [:]
        var sameRow: [String: [(n: Int, span: CGFloat)]] = [:]
        for (n, a) in doc.annotations.enumerated() {
            if case .arrow(let from, let to, _, _, _) = a, let r1 = anchors[from.key], let r2 = anchors[to.key] {
                byTarget[to.key, default: []].append((n, r2.midX - r1.midX))
                if from.structureName == to.structureName, abs(r1.maxY - r2.maxY) < 1,  // same row (bars share a baseline)
                   let kind = doc.structure(named: from.structureName)?.kind, linearKinds.contains(kind) {
                    sameRow[from.structureName, default: []].append((n, abs(r2.midX - r1.midX)))
                }
            }
        }
        for (_, list) in byTarget {
            // The longer arc from the left lands outermost-right, from the right outermost-left.
            for (k, item) in list.sorted(by: { $0.span < $1.span }).enumerated() { slotOf[item.n] = (k, list.count) }
        }
        var sourceColor: [String: DColor] = [:]
        for a in doc.annotations {
            switch a {
            case .highlight(let ref, let c), .state(let ref, let c): if let c { for k in ref.keys { sourceColor[k] = c } }
            default: break
            }
        }
        for (_, list) in sameRow {
            for (k, item) in list.sorted(by: { ($0.span, $0.n) < ($1.span, $1.n) }).enumerated() { levelOf[item.n] = k }
        }
        for (n, a) in doc.annotations.enumerated() {
            guard case .arrow(let from, let to, let label, let color, let double) = a,
                  let r1 = anchors[from.key], let r2 = anchors[to.key] else { continue }
            // An uncolored arrow carries its source's color (blue neighbours feed the cell with blue arrows).
            let resolved = color ?? sourceColor[from.key] ?? .orange
            let tone = DItem.Tone.accent(resolved)
            if let level = levelOf[n] {
                let baseY = max(r1.maxY, r2.maxY) + 26  // below the index row
                let slot = slotOf[n] ?? (0, 1)
                let spread = (CGFloat(slot.index) - CGFloat(slot.total - 1) / 2) * 12
                let p1 = CGPoint(x: r1.midX + (slot.total > 1 ? -spread * 0.3 : 0), y: baseY), p2 = CGPoint(x: r2.midX + spread, y: baseY)
                let depth = arcBase + CGFloat(level) * arcStep
                // A cubic with both handles straight below its ends: a rounded U whose floor is at `depth`.
                let ctrlY = baseY + depth / 0.75
                scene.items.append(DItem(id: "arrow.\(n)", shape: .cubic(from: p1, c1: CGPoint(x: p1.x, y: ctrlY), c2: CGPoint(x: p2.x, y: ctrlY), to: p2),
                                         stroke: tone, lineWidth: 1.6, arrow: true, arrowStart: double))
                if let label {
                    let floor = CGPoint(x: (p1.x + p2.x) / 2, y: baseY + depth)
                    let w = monoWidth(label, size: 11) + 12
                    var pill = DItem(id: "arrow.\(n).pill", shape: .box(CGRect(x: floor.x - w / 2, y: floor.y - 8, width: w, height: 16), radius: 8))
                    pill.accent = resolved  // opaque tint, so the arc doesn't show through the label
                    scene.items.append(pill)
                    scene.items.append(DItem(id: "arrow.\(n).label", shape: .text(label, at: floor, anchor: CGPoint(x: 0.5, y: 0.5)),
                                             font: .edge, textTone: tone))
                }
            } else {
                var (p1, p2) = edgePoints(r1, r2)
                let gap = hypot(p2.x - p1.x, p2.y - p1.y)
                if gap < 8 {
                    p1 = CGPoint(x: r1.midX + (r2.midX - r1.midX) * 0.18, y: r1.midY + (r2.midY - r1.midY) * 0.18)
                    scene.items.append(DItem(id: "arrow.\(n).dot", shape: .dot(p1, 2.2), fill: tone))
                }
                let bendOut: CGFloat = gap < 60 ? 0 : 18
                let mid = CGPoint(x: (p1.x + p2.x) / 2 + bendOut, y: (p1.y + p2.y) / 2)
                scene.items.append(DItem(id: "arrow.\(n)", shape: .curve(from: p1, control: mid, to: p2), stroke: tone, lineWidth: 1.6,
                                         arrow: true, arrowStart: double))
                if let label {
                    scene.items.append(DItem(id: "arrow.\(n).label", shape: .text(label, at: CGPoint(x: mid.x + 5, y: mid.y), anchor: CGPoint(x: 0, y: 0.5)),
                                             font: .edge, textTone: tone))
                }
            }
        }

        if let panels { addPanels(doc, panels, maxWidth: maxWidth, into: &scene) }

        if caption, let text = doc.caption, !text.isEmpty {
            var ext = scene.items.reduce(CGRect.null) { $0.union($1.shape.bounds) }
            if ext.isNull { ext = .zero }
            let natural = sansWidth(text, size: 12) + 4
            let width = min(max(ext.maxX, natural), maxWidth)
            let lines = max(1, Int(ceil(natural / width)))
            let rect = CGRect(x: 0, y: ext.maxY + 16, width: width, height: CGFloat(lines) * 17)
            scene.items.append(DItem(id: "caption", shape: .textBlock(text, rect), font: .caption, textTone: .muted))
        }
        return scene
    }

    /// Code panel rows: each line split at "←" into code and its live value; a line too wide for the column
    /// puts its live value on a row of its own, indented under it.
    static func codeRows(_ lines: [String], width: CGFloat) -> [(code: String, live: String?)] {
        lines.flatMap { line -> [(code: String, live: String?)] in
            guard let cut = line.firstIndex(of: "←") else { return [(line, nil)] }
            let code = String(line[..<cut]), live = String(line[cut...])
            if monoWidth(line, size: 12) + 28 <= width { return [(code, live)] }
            let indent = String(code.prefix { $0 == " " }) + "    "
            return [(code.trimmingCharacters(in: .whitespaces), nil), (indent, live)]
        }
    }

    static func varRows(_ vars: [DVar], width: CGFloat) -> Int {
        guard !vars.isEmpty else { return 0 }
        var x: CGFloat = 0, rows = 1
        for v in vars {
            let w = monoWidth(v.value.isEmpty ? v.name : "\(v.name) = \(v.value)", size: 12) + 30
            if x > 0 && x + w > width { x = 0; rows += 1 }
            x += w + 8
        }
        return rows
    }

    /// The code panel (what runs this step) and the color legend, under the structures.
    private static func addPanels(_ doc: DiagramDoc, _ p: Panels, maxWidth: CGFloat, into scene: inout DScene) {
        var ext = scene.items.reduce(CGRect.null) { $0.union($1.shape.bounds) }
        if ext.isNull { ext = .zero }
        var y = max(p.top, ext.maxY + 14)
        let width = min(maxWidth, max(ext.maxX, p.codeWidth + 28, 240))
        // Computed comparison: a big colored equation and its verdict (two pointers, binary search, intervals…).
        if p.hasCalc {
            let h: CGFloat = p.calcVerdict ? 58 : 38
            scene.items.append(DItem(id: "calc.box", shape: .box(CGRect(x: 0, y: y, width: width, height: h), radius: 9), fill: .faint, stroke: .faint))
            if let calc = doc.calc {
                var x: CGFloat = 14
                for (k, seg) in calc.segments.enumerated() where !seg.text.isEmpty {
                    scene.items.append(DItem(id: "calc.\(k)", shape: .text(seg.text, at: CGPoint(x: x, y: y + 19), anchor: CGPoint(x: 0, y: 0.5)),
                                             font: .calc, textTone: seg.color.map { .accent($0) } ?? .neutral))
                    x += monoWidth(seg.text, size: 15)
                }
                if let v = calc.verdict {
                    scene.items.append(DItem(id: "calc.v", shape: .text(v, at: CGPoint(x: 14, y: y + 42), anchor: CGPoint(x: 0, y: 0.5)),
                                             font: .verdict, textTone: calc.verdictColor.map { .accent($0) } ?? .muted))
                }
            }
            y += h + 10
        }
        // Variable chips: ● name = value, dot in the variable's (pointer's) color.
        if p.varRows > 0 {
            var x: CGFloat = 0, row = 0
            for (k, v) in doc.vars.enumerated() {
                let text = v.value.isEmpty ? v.name : "\(v.name) = \(v.value)"
                let w = monoWidth(text, size: 12) + 30
                if x > 0 && x + w > maxWidth { x = 0; row += 1 }   // same wrap as `varRows`, which reserved the space
                let rect = CGRect(x: x, y: y + CGFloat(row) * 30, width: w, height: 24)
                scene.items.append(DItem(id: "var.b\(k)", shape: .box(rect, radius: 12), fill: .faint, stroke: .faint))
                scene.items.append(DItem(id: "var.d\(k)", shape: .dot(CGPoint(x: rect.minX + 12, y: rect.midY), 3.5),
                                         fill: v.color.map { .accent($0) } ?? .muted))
                scene.items.append(DItem(id: "var.t\(k)", shape: .text(text, at: CGPoint(x: rect.minX + 21, y: rect.midY), anchor: CGPoint(x: 0, y: 0.5)),
                                         font: .code, textTone: v.color.map { .accent($0) } ?? .neutral))
                x += w + 8
            }
            y += CGFloat(p.varRows) * 30 + 6
        }
        if p.codeLines > 0 {
            let h = CGFloat(p.codeLines) * 17 + 18
            // A step without code keeps the panel's space (nothing below jumps) but draws no empty box.
            if !doc.code.isEmpty { scene.items.append(DItem(id: "code.box", shape: .box(CGRect(x: 0, y: y, width: width, height: h), radius: 9), fill: .faint, stroke: .faint)) }
            // `s = arr[L] + arr[R]  ← s = 12`: the live value after ← in yellow, like a debugger.
            for (k, row) in codeRows(doc.code, width: maxWidth).enumerated() {
                let at = CGPoint(x: 14, y: y + 9 + CGFloat(k) * 17 + 8.5)
                if !row.code.isEmpty {
                    scene.items.append(DItem(id: "code.\(k)", shape: .text(row.code, at: at, anchor: CGPoint(x: 0, y: 0.5)), font: .code, textTone: .neutral))
                }
                if let live = row.live {
                    scene.items.append(DItem(id: "code.\(k).live", shape: .text(live, at: CGPoint(x: at.x + monoWidth(row.code, size: 12), y: at.y),
                                                                             anchor: CGPoint(x: 0, y: 0.5)), font: .code, textTone: .accent(.yellow)))
                }
            }
            y += h + 14
        }
        if !p.legend.isEmpty {
            var x: CGFloat = 0
            for (k, item) in p.legend.enumerated() {
                let w = 12 + 7 + CGFloat(item.text.count) * 11.5 * 0.5
                if x > 0 && x + w > width { x = 0; y += 22 }
                let sw = CGRect(x: x, y: y + 3, width: 12, height: 12)
                var swatch = DItem(id: "legend.s\(k)", shape: .box(sw, radius: 3.5), fill: item.ring ? nil : .faint,
                                   stroke: item.ring ? .neutral : .muted, lineWidth: item.ring ? 1.6 : 0.75)
                if let c = item.color { swatch.accent = c }
                scene.items.append(swatch)
                scene.items.append(DItem(id: "legend.t\(k)", shape: .text(item.text, at: CGPoint(x: x + 19, y: y + 9), anchor: CGPoint(x: 0, y: 0.5)),
                                         font: .legend, textTone: .muted))
                x += w + 16
            }
        }
    }

    /// Models sometimes count from 1 (`link L[4] -> L[2]` on a 4-node list). If a linear structure is
    /// referenced one past its end and never at index 0, shift all of its refs down by one rather than
    /// silently dropping the out-of-range ones.
    static func normalizeIndexBase(_ doc: DiagramDoc) -> DiagramDoc {
        var oneBased: Set<String> = []
        for s in doc.structures where [.array, .string, .list, .queue, .stack, .set, .bars].contains(s.kind) {
            let indices = doc.annotations.flatMap(\.refs).filter { $0.structureName == s.name }.flatMap { ref -> [Int] in
                switch ref {
                case .index(_, let i): [i]
                case .range(_, let a, let b): [a, b]
                default: []
                }
            }
            if indices.contains(s.values.count), !indices.contains(0), indices.allSatisfy({ $0 >= 1 && $0 <= s.values.count }) {
                oneBased.insert(s.name)
            }
        }
        guard !oneBased.isEmpty else { return doc }
        func fix(_ r: DRef) -> DRef {
            guard oneBased.contains(r.structureName) else { return r }
            switch r {
            case .index(let n, let i): return .index(n, i - 1)
            case .range(let n, let a, let b): return .range(n, a - 1, b - 1)
            default: return r
            }
        }
        var out = doc
        out.annotations = doc.annotations.map { a in
            switch a {
            case .pointer(let l, let t, let c, let below): .pointer(label: l, target: fix(t), color: c, below: below)
            case .highlight(let r, let c): .highlight(fix(r), c)
            case .dim(let r): .dim(fix(r))
            case .window(let r, let l, let c): .window(fix(r), label: l, color: c)
            case .arrow(let x, let y, let l, let c, let d): .arrow(fix(x), fix(y), label: l, color: c, double: d)
            case .mark(let r, let t): .mark(fix(r), t)
            case .path(let rs, let c): .path(rs.map(fix), c)
            case .edges(let rs, let c): .edges(rs.map(fix), c)
            case .water(let r, let lv, let c): .water(fix(r), level: lv, color: c)
            case .rect(let r, let h, let l, let c): .rect(fix(r), height: h, label: l, color: c)
            case .sub(let r, let t): .sub(fix(r), t)
            case .focus(let r): .focus(fix(r))
            case .state(let r, let c): .state(fix(r), c)
            case .pending(let r): .pending(fix(r))
            case .discard(let r): .discard(fix(r))
            }
        }
        return out
    }

    // MARK: - Block

    struct Block {
        var underlay: [DItem] = []           // drawn first (window bands)
        var items: [DItem] = []
        var anchors: [String: CGRect] = [:]
        var shapes: [String: [Int]] = [:]    // key → cell/node/bar items (highlight, dim)
        var texts: [String: [Int]] = [:]     // key → value text items (dim)
        var edges: [String: [Int]] = [:]     // "a|b" (node keys, both orders) → edge items (path)
        var parent: [String: String] = [:]   // node key → parent node key (trees: root paths)
        var labelY: CGFloat = 0
        var vertical = false
        /// Node layout reads top-down (trees): badges go beside nodes, not above.
        var topDown = false
        var hasIndices = false
        var bar: (base: CGFloat, unit: CGFloat)?

        var bounds: CGRect { (underlay + items).reduce(CGRect.null) { $0.union($1.shape.bounds) }.standardized }

        mutating func add(_ item: DItem) { items.append(item) }

        /// Nothing solid, textual or line-like occupies `rect` (used to place badges without clashes).
        func isFree(_ rect: CGRect) -> Bool {
            for item in items {
                if let f = DiagramAudit.solidFrame(item) ?? DiagramAudit.textFrame(item), f.intersects(rect) { return false }
                if DiagramAudit.samples(item.shape).contains(where: { rect.contains($0) }) { return false }
            }
            return true
        }

        mutating func addShape(_ keys: [String], _ item: DItem, anchor: CGRect? = nil) {
            for k in keys {
                shapes[k, default: []].append(items.count)
                if let anchor, anchors[k] == nil { anchors[k] = anchor }
            }
            items.append(item)
        }

        mutating func addText(_ keys: [String], _ item: DItem) {
            for k in keys { texts[k, default: []].append(items.count) }
            items.append(item)
        }

        mutating func addEdge(_ a: String, _ b: String, _ item: DItem) {
            edges["\(a)|\(b)", default: []].append(items.count)
            edges["\(b)|\(a)", default: []].append(items.count)
            items.append(item)
        }
    }

    /// Per-node state lines for tree/graph nodes: `subs` (anchor key → text) for this frame, `subChars` the longest
    /// across all frames so nodes keep one size while stepping.
    static func layoutStructure(_ s: DStructure, roomy: Bool = false, subs: [String: String] = [:], subChars: Int = 0) -> Block {
        if subChars > 0 || s.showDepths {
            switch s.kind {
            case .tree: return tree(s, subs: subs, subChars: subChars)
            case .graph: return graph(s, subs: subs, subChars: subChars)
            default: break
            }
        }
        return switch s.kind {
        case .array, .string, .set, .queue: linear(s)
        case .stack: stack(s)
        case .list: list(s)
        case .tree: tree(s)
        case .heap: heap(s)
        case .trie: trie(s)
        case .grid: grid(s, gap: roomy ? 16 : 3)
        case .map: map(s)
        case .bars: bars(s)
        case .intervals: intervals(s)
        case .graph: graph(s)
        case .flow: flow(s)
        }
    }

    private static func cellWidth(_ values: [String?]) -> CGFloat {
        max(minCellW, (values.map { monoWidth($0 ?? "∅", size: 13) }.max() ?? 0) + 20)
    }

    private static func valueText(_ id: String, _ v: String?, at p: CGPoint, font: DItem.Font = .value) -> DItem {
        DItem(id: id, shape: .text(v ?? "∅", at: p, anchor: CGPoint(x: 0.5, y: 0.5)), font: font, textTone: v == nil ? .muted : .neutral)
    }

    // MARK: Linear

    private static func linear(_ s: DStructure) -> Block {
        var b = Block()
        let w = cellWidth(s.values)
        let pill = s.kind == .set
        for (i, v) in s.values.enumerated() {
            let r = CGRect(x: CGFloat(i) * (w + cellGap), y: 0, width: w, height: cellH)
            var keys = ["\(s.name)[\(i)]"]
            if let v, s.kind != .set, b.anchors["\(s.name).\(v)"] == nil { keys.append("\(s.name).\(v)") }
            b.addShape(keys, DItem(id: "\(s.name).c\(i)", shape: .box(r, radius: pill ? cellH / 2 : 8), cell: true), anchor: r)
            b.addText(keys, valueText("\(s.name).v\(i)", v, at: CGPoint(x: r.midX, y: r.midY)))
            if s.kind == .array || s.kind == .string {
                b.add(DItem(id: "\(s.name).i\(i)", shape: .text("\(i)", at: CGPoint(x: r.midX, y: r.maxY + 11), anchor: CGPoint(x: 0.5, y: 0.5)),
                            font: .index, textTone: .faint))
                b.hasIndices = true
            }
        }
        if s.kind == .queue, !s.values.isEmpty {
            let first = b.anchors["\(s.name)[0]"]!, last = b.anchors["\(s.name)[\(s.values.count - 1)]"]!
            b.add(DItem(id: "\(s.name).front", shape: .text("front", at: CGPoint(x: first.midX, y: first.maxY + 11), anchor: CGPoint(x: 0.5, y: 0.5)), font: .index, textTone: .faint))
            if s.values.count > 1 {
                b.add(DItem(id: "\(s.name).back", shape: .text("back", at: CGPoint(x: last.midX, y: last.maxY + 11), anchor: CGPoint(x: 0.5, y: 0.5)), font: .index, textTone: .faint))
            }
            b.hasIndices = true
        }
        if s.values.isEmpty {
            let r = CGRect(x: 0, y: 0, width: 52, height: cellH)
            b.add(DItem(id: "\(s.name).empty", shape: .box(r, radius: 8), stroke: .faint, dashed: true))
            b.add(DItem(id: "\(s.name).emptyv", shape: .text("empty", at: CGPoint(x: r.midX, y: r.midY), anchor: CGPoint(x: 0.5, y: 0.5)), font: .index, textTone: .muted))
        }
        b.labelY = cellH / 2
        return b
    }

    private static func stack(_ s: DStructure) -> Block {
        var b = Block()
        b.vertical = true
        let w = cellWidth(s.values) + 8
        let h: CGFloat = 30
        let n = s.values.count
        let height = CGFloat(max(n, 1)) * (h + 4) + 8
        b.add(DItem(id: "\(s.name).well", shape: .polyline([CGPoint(x: 0, y: -4), CGPoint(x: 0, y: height), CGPoint(x: w + 12, y: height), CGPoint(x: w + 12, y: -4)]),
                    stroke: .muted, lineWidth: 1.25))
        for (i, v) in s.values.enumerated() {  // bottom → top
            let row = n - 1 - i
            let r = CGRect(x: 6, y: CGFloat(row) * (h + 4) + 4, width: w, height: h)
            b.addShape(["\(s.name)[\(i)]"], DItem(id: "\(s.name).c\(i)", shape: .box(r, radius: 6), cell: true), anchor: r)
            b.addText(["\(s.name)[\(i)]"], valueText("\(s.name).v\(i)", v, at: CGPoint(x: r.midX, y: r.midY)))
        }
        if n > 0 {
            b.add(DItem(id: "\(s.name).top", shape: .text("top", at: CGPoint(x: w + 22, y: 4 + h / 2), anchor: CGPoint(x: 0, y: 0.5)), font: .index, textTone: .faint))
        }
        b.labelY = 4 + h / 2
        return b
    }

    private static func list(_ s: DStructure) -> Block {
        var b = Block()
        var x: CGFloat = 0
        let gap: CGFloat = 32
        var rects: [CGRect] = []
        for (i, v) in s.values.enumerated() {
            var keys = ["\(s.name)[\(i)]"]
            if let v, b.anchors["\(s.name).\(v)"] == nil { keys.append("\(s.name).\(v)") }
            guard let v else {
                let r = CGRect(x: x, y: 5, width: 28, height: cellH - 10)
                b.addShape(keys, DItem(id: "\(s.name).null\(i)", shape: .box(r, radius: 6), stroke: .faint, dashed: true), anchor: r)
                b.addText(keys, valueText("\(s.name).nv\(i)", nil, at: CGPoint(x: r.midX, y: r.midY), font: .small))
                rects.append(r)
                x = r.maxX + gap
                continue
            }
            let w = max(42, monoWidth(v, size: 13) + 24) + 12
            let r = CGRect(x: x, y: 0, width: w, height: cellH)
            b.addShape(keys, DItem(id: "\(s.name).c\(i)", shape: .box(r, radius: 9), cell: true), anchor: r)
            b.addText(keys, valueText("\(s.name).v\(i)", v, at: CGPoint(x: r.minX + (w - 12) / 2, y: r.midY)))
            b.add(DItem(id: "\(s.name).sep\(i)", shape: .polyline([CGPoint(x: r.maxX - 12, y: r.minY + 7), CGPoint(x: r.maxX - 12, y: r.maxY - 7)]), stroke: .faint, decor: true))
            b.add(DItem(id: "\(s.name).dot\(i)", shape: .dot(CGPoint(x: r.maxX - 6, y: r.midY), 2), fill: .muted))
            rects.append(r)
            x = r.maxX + gap
        }
        for (i, link) in s.links.enumerated() where i + 1 < rects.count {
            let a = rects[i], c = rects[i + 1]
            let forward = link == "->" || link == "<->"
            let backward = link == "<-" || link == "<->"
            if forward {
                let y = link == "<->" ? a.midY - 5 : a.midY
                let start = s.values[i] == nil ? a.maxX + 3 : a.maxX - 6
                b.add(DItem(id: "\(s.name).f\(i)", shape: .polyline([CGPoint(x: start, y: y), CGPoint(x: c.minX - 3, y: y)]), stroke: .muted, lineWidth: 1.3, arrow: true))
            }
            if backward {
                let y = link == "<->" ? a.midY + 5 : a.midY
                b.add(DItem(id: "\(s.name).b\(i)", shape: .polyline([CGPoint(x: c.minX - 2, y: y), CGPoint(x: a.maxX + 3, y: y)]), stroke: .muted, lineWidth: 1.3, arrow: true))
            }
        }
        b.labelY = cellH / 2
        return b
    }

    // MARK: Trees

    private struct TreeNode { var key: String; var label: String; var children: [Int]; var depth: Int }

    /// Places nodes: in-order for binary trees, tidy (leaves left→right, parents centered) for n-ary.
    private static func placeTree(_ nodes: [TreeNode], root: Int, binary: Bool, nodeW: CGFloat, dy: CGFloat) -> [Int: CGPoint] {
        var pos: [Int: CGPoint] = [:]
        let dx = max(42, nodeW + 10)
        if binary {
            var k = 0
            func walk(_ n: Int) {
                let ch = nodes[n].children
                if let l = ch.first, l >= 0 { walk(l) }
                pos[n] = CGPoint(x: CGFloat(k) * dx + nodeW / 2, y: CGFloat(nodes[n].depth) * dy + nodeR)
                k += 1
                if ch.count > 1, ch[1] >= 0 { walk(ch[1]) }
            }
            walk(root)
        } else {
            var nextLeaf: CGFloat = 0
            func walk(_ n: Int) -> CGFloat {
                let ch = nodes[n].children.filter { $0 >= 0 }
                let x: CGFloat
                if ch.isEmpty {
                    x = nextLeaf * dx + nodeW / 2
                    nextLeaf += 1
                } else {
                    let xs = ch.map(walk)
                    x = (xs.first! + xs.last!) / 2
                }
                pos[n] = CGPoint(x: x, y: CGFloat(nodes[n].depth) * dy + nodeR)
                return x
            }
            _ = walk(root)
        }
        return pos
    }

    /// Draws a placed tree: smooth edges first, then nodes. `-1` children are absent slots.
    private static func drawTree(_ s: DStructure, _ nodes: [TreeNode], _ pos: [Int: CGPoint], nodeW: CGFloat, radius: CGFloat,
                                 extraKeys: (Int) -> [String], subs: [String: String] = [:], into b: inout Block) {
        let boxed = nodeW > radius * 2 + 1
        func rect(_ c: CGPoint) -> CGRect { CGRect(x: c.x - nodeW / 2, y: c.y - radius, width: nodeW, height: radius * 2) }
        for (n, node) in nodes.enumerated() {
            guard let p = pos[n] else { continue }
            for c in node.children where c >= 0 {
                guard let q = pos[c] else { continue }
                // Straight edges, boundary to boundary.
                let (from, to) = boxed ? edgePoints(rect(p), rect(q)) : edgePoints(circle: p, q, r1: radius, r2: radius)
                b.addEdge(node.key, nodes[c].key,
                          DItem(id: "\(s.name).e\(n)-\(c)", shape: .polyline([from, to]), stroke: .muted, lineWidth: 1.4))
                b.parent[nodes[c].key] = node.key
            }
        }
        for (n, node) in nodes.enumerated() {
            guard let c = pos[n] else { continue }
            let r = rect(c)
            let shape: DItem.Shape = boxed ? .box(r, radius: min(radius, 11)) : .circle(center: c, radius: radius)
            let keys = [node.key] + extraKeys(n)
            b.addShape(keys, DItem(id: "\(s.name).n\(n)", shape: shape, cell: true), anchor: r)
            let sub = keys.lazy.compactMap { subs[$0] }.first
            b.addText(keys, valueText("\(s.name).v\(n)", node.label, at: CGPoint(x: c.x, y: sub == nil ? c.y : c.y - 7),
                                      font: radius < nodeR ? .small : .value))
            if let sub {
                b.addText(keys, DItem(id: "\(s.name).sub\(n)", shape: .text(sub, at: CGPoint(x: c.x, y: c.y + 9), anchor: CGPoint(x: 0.5, y: 0.5)),
                                      font: .sub, textTone: .muted))
            }
        }
    }

    /// LeetCode-style level-order deserialization.
    private static func levelOrderTree(_ s: DStructure) -> (nodes: [TreeNode], index: [Int: Int]) {
        var nodes: [TreeNode] = []
        var byPosition: [Int: Int] = [:]   // position in values → node index
        guard let first = s.values.first, let rootLabel = first else { return ([], [:]) }
        nodes.append(TreeNode(key: "\(s.name).\(rootLabel)", label: rootLabel, children: [-1, -1], depth: 0))
        byPosition[0] = 0
        var queue = [0]
        var i = 1
        var seen: Set<String> = [rootLabel]
        while !queue.isEmpty, i < s.values.count {
            let parent = queue.removeFirst()
            for side in 0..<2 where i < s.values.count {
                if let label = s.values[i] {
                    let key = seen.insert(label).inserted ? "\(s.name).\(label)" : "\(s.name).#\(i)"
                    nodes.append(TreeNode(key: key, label: label, children: [-1, -1], depth: nodes[parent].depth + 1))
                    nodes[parent].children[side] = nodes.count - 1
                    byPosition[i] = nodes.count - 1
                    queue.append(nodes.count - 1)
                }
                i += 1
            }
        }
        return (nodes, byPosition)
    }

    private static func tree(_ s: DStructure, subs: [String: String] = [:], subChars: Int = 0) -> Block {
        var b = Block()
        let (nodes, byPosition) = levelOrderTree(s)
        guard !nodes.isEmpty else { return b }
        var nodeW = max(nodeR * 2, (nodes.map { monoWidth($0.label, size: 13) }.max() ?? 0) + 16)
        var radius = nodeR
        if subChars > 0 {
            nodeW = max(nodeW, sansWidth(String(repeating: "m", count: subChars), size: 11) + 22, 58)
            radius = 23
        }
        let pos = placeTree(nodes, root: 0, binary: true, nodeW: nodeW, dy: subChars > 0 ? 74 : 62)
        let positionOf = Dictionary(uniqueKeysWithValues: byPosition.map { ($1, $0) })
        drawTree(s, nodes, pos, nodeW: nodeW, radius: radius, extraKeys: { ["\(s.name)[\(positionOf[$0]!)]"] }, subs: subs, into: &b)
        if s.showDepths { addDepthLabels(nodes, pos, nodeW: nodeW, into: &b) }
        b.labelY = radius
        return b
    }

    /// "depth k" beside each level of a tree.
    private static func addDepthLabels(_ nodes: [TreeNode], _ pos: [Int: CGPoint], nodeW: CGFloat, into b: inout Block) {
        guard let minX = pos.values.map(\.x).min() else { return }
        var seen: Set<Int> = []
        for (n, node) in nodes.enumerated() where node.depth >= 0 && !seen.contains(node.depth) {
            guard let p = pos[n] else { continue }
            seen.insert(node.depth)
            b.add(DItem(id: "depth.\(node.depth)", shape: .text("depth \(node.depth)", at: CGPoint(x: minX - nodeW / 2 - 22, y: p.y),
                                                                anchor: CGPoint(x: 1, y: 0.5)), font: .name, textTone: .muted))
        }
    }

    /// Heap: the tree view plus its backing array, linked — `H[i]` highlights both.
    private static func heap(_ s: DStructure) -> Block {
        var b = tree(s)
        guard !s.values.isEmpty else { return b }
        let treeBounds = b.bounds
        let top = treeBounds.maxY + 26
        let w = cellWidth(s.values)
        let totalW = CGFloat(s.values.count) * (w + cellGap) - cellGap
        let x0 = treeBounds.minX + max(0, (treeBounds.width - totalW) / 2)
        for (i, v) in s.values.enumerated() {
            let r = CGRect(x: x0 + CGFloat(i) * (w + cellGap), y: top, width: w, height: cellH - 4)
            let key = "\(s.name)[\(i)]"
            b.shapes[key, default: []].append(b.items.count)
            b.anchors["\(s.name).a[\(i)]"] = r
            b.items.append(DItem(id: "\(s.name).a\(i)", shape: .box(r, radius: 7), cell: true))
            b.texts[key, default: []].append(b.items.count)
            b.items.append(valueText("\(s.name).av\(i)", v, at: CGPoint(x: r.midX, y: r.midY), font: .small))
            b.add(DItem(id: "\(s.name).ai\(i)", shape: .text("\(i)", at: CGPoint(x: r.midX, y: r.maxY + 10), anchor: CGPoint(x: 0.5, y: 0.5)),
                        font: .index, textTone: .faint))
        }
        return b
    }

    private static func trie(_ s: DStructure) -> Block {
        var b = Block()
        var nodes = [TreeNode(key: "\(s.name).^", label: "", children: [], depth: 0)]
        var terminal: Set<Int> = []
        var byPrefix: [String: Int] = [:]
        for word in s.values.compactMap({ $0 }) {
            var cur = 0
            var prefix = ""
            for ch in word {
                prefix.append(ch)
                if let next = byPrefix[prefix] { cur = next; continue }
                nodes.append(TreeNode(key: "\(s.name).\(prefix)", label: String(ch), children: [], depth: nodes[cur].depth + 1))
                nodes[cur].children.append(nodes.count - 1)
                byPrefix[prefix] = nodes.count - 1
                cur = nodes.count - 1
            }
            terminal.insert(cur)
        }
        let r: CGFloat = 14
        let pos = placeTree(nodes, root: 0, binary: false, nodeW: r * 2, dy: 50)
        drawTree(s, nodes, pos, nodeW: r * 2, radius: r, extraKeys: { _ in [] }, into: &b)
        // Root as a small hub; end-of-word nodes get a second ring.
        if let idx = b.shapes["\(s.name).^"]?.first, let c = pos[0] {
            b.items[idx].shape = .circle(center: c, radius: 5)
            b.items[idx].fill = .muted
            b.items[idx].cell = false
        }
        for t in terminal where t != 0 {
            if let idx = b.shapes[nodes[t].key]?.first { b.items[idx].ring = true }
        }
        b.labelY = r
        return b
    }

    // MARK: Grid / map

    private static func grid(_ s: DStructure, gap: CGFloat) -> Block {
        var b = Block()
        let all = s.grid.flatMap { $0 }
        let w = max(30, (all.map { monoWidth($0, size: 12.5) }.max() ?? 0) + 14)
        let h: CGFloat = 28
        let rowLabelW = s.rowLabels.map { monoWidth($0, size: 11) }.max() ?? 0
        let x0 = rowLabelW > 0 ? rowLabelW + 10 : 0
        let y0: CGFloat = s.colLabels.isEmpty ? 0 : 18
        for (c, label) in s.colLabels.enumerated() {
            b.add(DItem(id: "\(s.name).col\(c)", shape: .text(label, at: CGPoint(x: x0 + CGFloat(c) * (w + gap) + w / 2, y: 7), anchor: CGPoint(x: 0.5, y: 0.5)),
                        font: .index, textTone: .muted))
        }
        for (r, label) in s.rowLabels.enumerated() {
            b.add(DItem(id: "\(s.name).row\(r)", shape: .text(label, at: CGPoint(x: x0 - 8, y: y0 + CGFloat(r) * (h + gap) + h / 2), anchor: CGPoint(x: 1, y: 0.5)),
                        font: .index, textTone: .muted))
        }
        for (r, row) in s.grid.enumerated() {
            for (c, v) in row.enumerated() {
                let rect = CGRect(x: x0 + CGFloat(c) * (w + gap), y: y0 + CGFloat(r) * (h + gap), width: w, height: h)
                let key = "\(s.name)[\(r)][\(c)]"
                b.addShape([key], DItem(id: "\(s.name).c\(r).\(c)", shape: .box(rect, radius: 5), cell: true), anchor: rect)
                b.addText([key], valueText("\(s.name).v\(r).\(c)", v, at: CGPoint(x: rect.midX, y: rect.midY), font: .small))
            }
        }
        b.labelY = y0 + h / 2
        return b
    }

    private static func map(_ s: DStructure) -> Block {
        var b = Block()
        let kw = max(34, (s.entries.map { monoWidth($0.key, size: 12.5) }.max() ?? 0) + 18)
        let vw = max(34, (s.entries.map { monoWidth($0.value, size: 12.5) }.max() ?? 0) + 18)
        let h: CGFloat = 28
        for (i, e) in s.entries.enumerated() {
            let y = CGFloat(i) * (h + 4)
            let kr = CGRect(x: 0, y: y, width: kw, height: h)
            let vr = CGRect(x: kw + 26, y: y, width: vw, height: h)
            let keys = ["\(s.name)[\(i)]", "\(s.name).\(e.key)"]
            b.addShape(keys, DItem(id: "\(s.name).k\(i)", shape: .box(kr, radius: 6), cell: true), anchor: kr)
            b.addText(keys, valueText("\(s.name).kv\(i)", e.key, at: CGPoint(x: kr.midX, y: kr.midY), font: .small))
            b.add(DItem(id: "\(s.name).a\(i)", shape: .polyline([CGPoint(x: kr.maxX + 5, y: kr.midY), CGPoint(x: vr.minX - 5, y: vr.midY)]),
                        stroke: .faint, arrow: true))
            b.addShape(keys, DItem(id: "\(s.name).v\(i)", shape: .box(vr, radius: 6), fill: .faint, stroke: .faint))
            var t = valueText("\(s.name).vv\(i)", e.value, at: CGPoint(x: vr.midX, y: vr.midY), font: .small)
            t.textTone = .muted
            b.addText(keys, t)
        }
        b.labelY = h / 2
        return b
    }

    // MARK: Bars / intervals

    private static func bars(_ s: DStructure) -> Block {
        var b = Block()
        let values = s.values.map { Double($0 ?? "") ?? 0 }
        let maxV = max(values.max() ?? 1, 1)
        let unit = 96 / CGFloat(maxV)
        let w = max(24, (s.values.map { monoWidth($0 ?? "", size: 11) }.max() ?? 0) + 10)
        let gap: CGFloat = 6
        let base: CGFloat = 96 + 20
        b.bar = (base, unit)
        let width = CGFloat(values.count) * (w + gap) - gap
        b.add(DItem(id: "\(s.name).axis", shape: .polyline([CGPoint(x: -4, y: base), CGPoint(x: width + 4, y: base)]), stroke: .muted))
        for (i, v) in values.enumerated() {
            let h = max(2, CGFloat(v) * unit)
            let r = CGRect(x: CGFloat(i) * (w + gap), y: base - h, width: w, height: h)
            let key = "\(s.name)[\(i)]"
            b.addShape([key], DItem(id: "\(s.name).b\(i)", shape: .box(r, radius: min(5, w / 4)), cell: true),
                       anchor: CGRect(x: r.minX, y: r.minY - 18, width: w, height: h + 18))
            b.addText([key], DItem(id: "\(s.name).bv\(i)", shape: .text(s.values[i] ?? "0", at: CGPoint(x: r.midX, y: r.minY - 9), anchor: CGPoint(x: 0.5, y: 0.5)),
                                   font: .edge, textTone: .neutral))
            b.add(DItem(id: "\(s.name).bi\(i)", shape: .text("\(i)", at: CGPoint(x: r.midX, y: base + 11), anchor: CGPoint(x: 0.5, y: 0.5)), font: .index, textTone: .faint))
        }
        b.hasIndices = true
        b.labelY = base - 12
        return b
    }

    private static func intervals(_ s: DStructure) -> Block {
        var b = Block()
        let spans = s.grid.map { (Double($0[0]) ?? 0, Double($0[1]) ?? 0) }
        guard let lo = spans.map({ min($0.0, $0.1) }).min(), let hi = spans.map({ max($0.0, $0.1) }).max() else { return b }
        let span = max(hi - lo, 1)
        let unit = min(40, 400 / CGFloat(span))
        let x: (Double) -> CGFloat = { CGFloat($0 - lo) * unit }
        let step = niceStep(span)
        b.add(DItem(id: "\(s.name).axis", shape: .polyline([CGPoint(x: -4, y: 6), CGPoint(x: x(hi) + 4, y: 6)]), stroke: .muted))
        var t = (lo / step).rounded(.down) * step
        var k = 0
        while t <= hi + 1e-9 {
            if t >= lo - 1e-9 {
                b.add(DItem(id: "\(s.name).t\(k)", shape: .polyline([CGPoint(x: x(t), y: 3), CGPoint(x: x(t), y: 9)]), stroke: .muted))
                b.add(DItem(id: "\(s.name).tl\(k)", shape: .text(trimNumber(t), at: CGPoint(x: x(t), y: -5), anchor: CGPoint(x: 0.5, y: 0.5)), font: .index, textTone: .faint))
            }
            t += step; k += 1
        }
        for (i, (a, c)) in spans.enumerated() {
            let y = 22 + CGFloat(i) * 24
            let r = CGRect(x: x(min(a, c)), y: y, width: max(8, abs(x(c) - x(a))), height: 16)
            let key = "\(s.name)[\(i)]"
            b.addShape([key], DItem(id: "\(s.name).r\(i)", shape: .box(r, radius: 8), cell: true), anchor: r)
            b.addText([key], DItem(id: "\(s.name).rl\(i)", shape: .text("\(trimNumber(a))–\(trimNumber(c))", at: CGPoint(x: r.maxX + 6, y: r.midY), anchor: CGPoint(x: 0, y: 0.5)),
                                   font: .edge, textTone: .muted))
        }
        b.labelY = 30
        return b
    }

    /// `f2#b` → "f2" (suffix only disambiguates repeated labels).
    static func displayLabel(_ s: String) -> String {
        guard let hash = s.firstIndex(of: "#"), hash != s.startIndex else { return s }
        return String(s[..<hash])
    }

    static func niceStep(_ span: Double) -> Double {
        let raw = span / 8
        let mag = pow(10, floor(log10(max(raw, 1e-9))))
        for m in [1.0, 2, 5, 10] where raw <= m * mag { return max(1, m * mag) }
        return max(1, 10 * mag)
    }

    static func trimNumber(_ v: Double) -> String {
        v == v.rounded() ? String(Int(v)) : String(format: "%.1f", v)
    }

    // MARK: Graph

    private static func graph(_ s: DStructure, subs: [String: String] = [:], subChars: Int = 0) -> Block {
        var b = Block()
        let n = s.nodes.count
        guard n > 0 else { return b }
        // With per-node state lines, nodes become two-line rounded boxes (half-height `rh`).
        let rh: CGFloat = subChars > 0 ? 23 : nodeR
        var nodeW = max(rh * 2, (s.nodes.map { monoWidth(displayLabel($0), size: 13) }.max() ?? 0) + 16)
        if subChars > 0 { nodeW = max(nodeW, sansWidth(String(repeating: "m", count: subChars), size: 11) + 22, 62) }
        var pos: [String: CGPoint] = [:]
        var layerOf: [String: Int] = [:]
        var vertical = false

        let forest = treeShape(s)
        let layers = s.directed ? topoLayers(s) : nil
        if s.orientation == .circle || (forest == nil && layers == nil) {
            if n <= 2 {
                for (k, node) in s.nodes.enumerated() { pos[node] = CGPoint(x: CGFloat(k) * 110 + nodeW / 2, y: rh) }
            } else {
                pos = ringLayout(s, nodeW: nodeW)
            }
        } else if let forest, s.orientation != .right {
            // Trees / recursion trees read top-down.
            vertical = true
            var nodes: [TreeNode] = []
            var idx: [String: Int] = [:]
            for name in s.nodes { idx[name] = nodes.count; nodes.append(TreeNode(key: "\(s.name).\(name)", label: name, children: [], depth: 0)) }
            for (p, kids) in forest.children { nodes[idx[p]!].children = kids.compactMap { idx[$0] } }
            var queue = forest.roots.compactMap { idx[$0] }
            while !queue.isEmpty {
                let cur = queue.removeFirst()
                for c in nodes[cur].children { nodes[c].depth = nodes[cur].depth + 1; queue.append(c) }
            }
            // Multiple roots: lay out under a virtual root one level up.
            nodes.append(TreeNode(key: "_", label: "", children: forest.roots.compactMap { idx[$0] }, depth: -1))
            let placed = placeTree(nodes, root: nodes.count - 1, binary: false, nodeW: nodeW, dy: 64)
            for (k, node) in nodes.enumerated() where node.key != "_" {
                if let p = placed[k] { pos[node.label] = p }
            }
        } else if let layers {
            let down = s.orientation == .down
            vertical = down
            let cross = CGFloat(layers.map(\.count).max() ?? 1)
            let along = max(86, nodeW + 46)
            for (li, layer) in layers.enumerated() {
                let offset = (cross - CGFloat(layer.count)) / 2
                for (k, node) in layer.enumerated() {
                    let c = offset + CGFloat(k)
                    pos[node] = down ? CGPoint(x: c * max(70, nodeW + 26) + nodeW / 2, y: CGFloat(li) * 70 + rh)
                                     : CGPoint(x: CGFloat(li) * along + nodeW / 2, y: c * 74 + rh + 24)
                    layerOf[node] = li
                }
            }
        }

        let pairs = Set(s.edges.map { "\($0.from)->\($0.to)" })
        var skipCount = 0
        for (k, e) in s.edges.enumerated() {
            guard let a = pos[e.from], let c = pos[e.to], e.from != e.to else { continue }
            let tone: DItem.Tone = e.color.map { .accent($0) } ?? .muted
            let reverse = pairs.contains("\(e.to)->\(e.from)") && e.directed
            let ra = CGRect(x: a.x - nodeW / 2, y: a.y - rh, width: nodeW, height: rh * 2)
            let rc = CGRect(x: c.x - nodeW / 2, y: c.y - rh, width: nodeW, height: rh * 2)
            let (p1, p2) = nodeW > rh * 2 + 1 ? edgePoints(ra, rc)
                : edgePoints(circle: a, c, r1: rh + 1, r2: rh + (e.directed ? 3 : 1))
            let mid = CGPoint(x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2)
            let len = max(1, hypot(p2.x - p1.x, p2.y - p1.y))
            let normal = CGPoint(x: -(p2.y - p1.y) / len, y: (p2.x - p1.x) / len)
            var bend: CGFloat = reverse ? 16 : 0
            if let la = layerOf[e.from], let lb = layerOf[e.to], abs(lb - la) > 1, abs(vertical ? a.x - c.x : a.y - c.y) < 1 {
                skipCount += 1
                bend = CGFloat(skipCount % 2 == 0 ? 1 : -1) * 2 * (rh + 30 + CGFloat(abs(lb - la) - 2) * 12)
            }
            let ctrl = CGPoint(x: mid.x + normal.x * bend, y: mid.y + normal.y * bend)
            var item: DItem
            if vertical && bend == 0 && abs(a.y - c.y) > 1 {
                item = DItem(id: "\(s.name).e\(k)", shape: .polyline([p1, p2]), stroke: tone, lineWidth: e.color == nil ? 1.4 : 2, arrow: e.directed)
            } else {
                item = DItem(id: "\(s.name).e\(k)", shape: .curve(from: p1, control: ctrl, to: p2), stroke: tone,
                             lineWidth: e.color == nil ? 1.3 : 2, arrow: e.directed)
            }
            if e.color != nil { item.glow = true }
            b.addEdge("\(s.name).\(e.from)", "\(s.name).\(e.to)", item)
            if let label = e.label, !label.isEmpty {
                let apex = CGPoint(x: (p1.x + 2 * ctrl.x + p2.x) / 4, y: (p1.y + 2 * ctrl.y + p2.y) / 4)
                var side: CGFloat = bend == 0 ? (normal.y <= 0 ? 1 : -1) : (bend > 0 ? 1 : -1)
                if bend == 0 && abs(normal.y) < 0.2 { side = normal.x >= 0 ? 1 : -1 }
                let lp = CGPoint(x: apex.x + normal.x * 11 * side, y: apex.y + normal.y * 11 * side)
                let w = monoWidth(label, size: 10.5) + 10
                b.add(DItem(id: "\(s.name).el\(k)", shape: .box(CGRect(x: lp.x - w / 2, y: lp.y - 8, width: w, height: 16), radius: 5), fill: .faint, stroke: .faint))
                b.add(DItem(id: "\(s.name).elt\(k)", shape: .text(label, at: lp, anchor: CGPoint(x: 0.5, y: 0.5)), font: .edge,
                            textTone: e.color.map { .accent($0) } ?? .muted))
            }
        }
        if let forest {
            for (p, kids) in forest.children { for c in kids { b.parent["\(s.name).\(c)"] = "\(s.name).\(p)" } }
        }
        for node in s.nodes {
            guard let c = pos[node] else { continue }
            let r = CGRect(x: c.x - nodeW / 2, y: c.y - rh, width: nodeW, height: rh * 2)
            let shape: DItem.Shape = nodeW > rh * 2 + 1 ? .box(r, radius: subChars > 0 ? 11 : rh) : .circle(center: c, radius: rh)
            let key = "\(s.name).\(node)"
            b.addShape([key], DItem(id: "\(s.name).n.\(node)", shape: shape, cell: true), anchor: r)
            let sub = subs[key]
            b.addText([key], valueText("\(s.name).v.\(node)", displayLabel(node), at: CGPoint(x: c.x, y: sub == nil ? c.y : c.y - 7)))
            if let sub {
                b.addText([key], DItem(id: "\(s.name).sub.\(node)", shape: .text(sub, at: CGPoint(x: c.x, y: c.y + 9), anchor: CGPoint(x: 0.5, y: 0.5)),
                                       font: .sub, textTone: .muted))
            }
        }
        b.labelY = pos.values.map(\.y).min() ?? rh
        b.topDown = vertical
        return b
    }

    /// Circular layout for cyclic graphs: the 2-core sits on a ring in DFS order (adjacent nodes stay
    /// adjacent, so a plain cycle never self-crosses); tree branches hang outward from their attachment.
    static func ringLayout(_ s: DStructure, nodeW: CGFloat) -> [String: CGPoint] {
        var adj: [String: [String]] = [:]
        for e in s.edges where e.from != e.to {
            adj[e.from, default: []].append(e.to)
            adj[e.to, default: []].append(e.from)
        }
        // Peel leaves to find the core.
        var degree = Dictionary(uniqueKeysWithValues: s.nodes.map { ($0, Set(adj[$0] ?? []).count) })
        var removed: Set<String> = []
        var queue = s.nodes.filter { degree[$0]! <= 1 }
        while !queue.isEmpty {
            let v = queue.removeFirst()
            guard !removed.contains(v) else { continue }
            removed.insert(v)
            for w in Set(adj[v] ?? []) where !removed.contains(w) {
                degree[w]! -= 1
                if degree[w]! <= 1 { queue.append(w) }
            }
        }
        var core = s.nodes.filter { !removed.contains($0) }
        if core.count < 3 { core = s.nodes; removed = [] }
        // DFS order around the core.
        var order: [String] = []
        var seen: Set<String> = []
        func dfs(_ v: String) {
            seen.insert(v); order.append(v)
            for w in adj[v] ?? [] where !seen.contains(w) && !removed.contains(w) { dfs(w) }
        }
        for v in core where !seen.contains(v) { dfs(v) }

        let radius = max(68, CGFloat(order.count) * (nodeW + 28) / (2 * .pi))
        var pos: [String: CGPoint] = [:]
        var angle: [String: CGFloat] = [:]
        for (k, v) in order.enumerated() {
            let a = -CGFloat.pi / 2 + CGFloat(k) / CGFloat(order.count) * 2 * .pi
            angle[v] = a
            pos[v] = CGPoint(x: cos(a) * radius, y: sin(a) * radius)
        }
        // Branches: BFS outward from placed nodes, fanning around the parent's outward direction.
        var frontier = order
        while !frontier.isEmpty {
            var next: [String] = []
            for v in frontier {
                let kids = (adj[v] ?? []).filter { pos[$0] == nil }
                for (i, w) in kids.enumerated() {
                    let a = (angle[v] ?? 0) + (CGFloat(i) - CGFloat(kids.count - 1) / 2) * 0.55
                    angle[w] = a
                    pos[w] = CGPoint(x: pos[v]!.x + cos(a) * (nodeW + 44), y: pos[v]!.y + sin(a) * (nodeW + 44))
                    next.append(w)
                }
            }
            frontier = next
        }
        for v in s.nodes where pos[v] == nil { pos[v] = CGPoint(x: radius * 1.6, y: CGFloat(pos.count) * 44) }
        let minX = pos.values.map(\.x).min()!, minY = pos.values.map(\.y).min()!
        return pos.mapValues { CGPoint(x: $0.x - minX + nodeW / 2, y: $0.y - minY + nodeR) }
    }

    /// If the graph is a forest (directed: indegree ≤ 1, acyclic; undirected: acyclic), its roots and children.
    static func treeShape(_ s: DStructure) -> (roots: [String], children: [String: [String]])? {
        guard !s.nodes.isEmpty, !s.edges.isEmpty else { return nil }
        var children: [String: [String]] = [:]
        if s.directed {
            var indegree: [String: Int] = [:]
            for e in s.edges {
                indegree[e.to, default: 0] += 1
                children[e.from, default: []].append(e.to)
            }
            guard topoLayers(s) != nil else { return nil }
            if indegree.values.allSatisfy({ $0 <= 1 }) {
                return (s.nodes.filter { indegree[$0, default: 0] == 0 }, children)
            }
            // Parent pointers (union-find, `child -> parent`): every node has at most one outgoing edge.
            var outdegree: [String: Int] = [:]
            var reversed: [String: [String]] = [:]
            for e in s.edges {
                outdegree[e.from, default: 0] += 1
                reversed[e.to, default: []].append(e.from)
            }
            guard outdegree.values.allSatisfy({ $0 <= 1 }) else { return nil }
            return (s.nodes.filter { outdegree[$0, default: 0] == 0 }, reversed)
        }
        // Undirected: acyclic iff edges = nodes - components; build BFS trees.
        var adj: [String: [String]] = [:]
        for e in s.edges { adj[e.from, default: []].append(e.to); adj[e.to, default: []].append(e.from) }
        var seen: Set<String> = []
        var roots: [String] = []
        for start in s.nodes where !seen.contains(start) {
            roots.append(start)
            seen.insert(start)
            var queue = [start]
            while !queue.isEmpty {
                let cur = queue.removeFirst()
                for nb in adj[cur] ?? [] where !seen.contains(nb) {
                    seen.insert(nb)
                    children[cur, default: []].append(nb)
                    queue.append(nb)
                }
            }
        }
        guard s.edges.count == s.nodes.count - roots.count else { return nil }
        return (roots, children)
    }

    /// Longest-path layering for DAGs; nil if there is a cycle.
    static func topoLayers(_ s: DStructure) -> [[String]]? {
        var indegree = Dictionary(uniqueKeysWithValues: s.nodes.map { ($0, 0) })
        var out: [String: [String]] = [:]
        for e in s.edges where e.from != e.to {
            out[e.from, default: []].append(e.to)
            indegree[e.to, default: 0] += 1
        }
        var level: [String: Int] = [:]
        var ready = s.nodes.filter { indegree[$0] == 0 }
        ready.forEach { level[$0] = 0 }
        var seen = 0
        while !ready.isEmpty {
            let n = ready.removeFirst()
            seen += 1
            for m in out[n] ?? [] {
                level[m] = max(level[m] ?? 0, (level[n] ?? 0) + 1)
                indegree[m]! -= 1
                if indegree[m] == 0 { ready.append(m) }
            }
        }
        guard seen == s.nodes.count else { return nil }
        let depth = (level.values.max() ?? 0) + 1
        var layers = Array(repeating: [String](), count: depth)
        for n in s.nodes { layers[level[n] ?? 0].append(n) }
        return layers
    }

    // MARK: - Annotations (local to one structure)

    static func applyAnnotations(_ annotations: [DAnnotation], structure s: DStructure, block b: inout Block) {
        var pointerStack: [String: Int] = [:]
        var chips: [CGRect] = []   // pointer chips placed so far (neighbours must not overlap)
        // Pointers placed `below` own the first rows under the structure; windows/marks stack after them.
        var belowCounts: [String: Int] = [:]
        for a in annotations { if case .pointer(_, let ref, _, true) = a { belowCounts[ref.key, default: 0] += 1 } }
        var belowRow = belowCounts.values.max() ?? 0
        let isNodeLike = nodeKinds.contains(s.kind)
        let isGrid = s.kind == .grid

        func chip(_ id: String, _ label: String, _ rect: CGRect, _ tone: DItem.Tone) {
            b.add(DItem(id: id, shape: .box(rect, radius: rect.height / 2), fill: tone, solid: true))
            b.add(DItem(id: id + "t", shape: .text(label, at: CGPoint(x: rect.midX, y: rect.midY), anchor: CGPoint(x: 0.5, y: 0.5)), font: .chip, textTone: tone))
        }

        for (n, a) in annotations.enumerated() {
            switch a {
            case .highlight(let ref, let color):
                // State fill: the node/cell takes the color, and its text a lighter tint of it.
                for key in ref.keys {
                    for i in b.shapes[key] ?? [] { b.items[i].accent = color ?? .blue }
                    for i in b.texts[key] ?? [] where b.items[i].font != .index { b.items[i].textTone = .accent(color ?? .blue) }
                }
            case .focus(let ref):
                for key in ref.keys {
                    for i in b.shapes[key] ?? [] { b.items[i].focus = true }
                }
            case .pending(let ref):
                // A cell this step colors or points at is reached, whatever an earlier `pending` said.
                for key in ref.keys where !(b.shapes[key] ?? []).contains(where: { b.items[$0].accent != nil || b.items[$0].outline != nil }) {
                    for i in (b.shapes[key] ?? []) + (b.texts[key] ?? []) { b.items[i].pending = true }
                }
                // Edges into pending nodes fade too (the shape of what's coming, not what's done).
                for key in ref.keys {
                    for (pair, idx) in b.edges where pair.hasSuffix("|" + key) { for i in idx { b.items[i].pending = true } }
                }
            case .discard(let ref):
                for key in ref.keys {
                    for i in (b.shapes[key] ?? []) + (b.texts[key] ?? []) { b.items[i].dimmed = true }
                    guard let r = b.anchors[key] else { continue }
                    let badge = CGRect(x: r.maxX - 9, y: r.minY - 7, width: 16, height: 16)
                    b.add(DItem(id: "\(s.name).x\(n).\(key)", shape: .circle(center: CGPoint(x: badge.midX, y: badge.midY), radius: 8),
                                fill: .accent(.red), solid: true))
                    b.add(DItem(id: "\(s.name).xt\(n).\(key)", shape: .text("✕", at: CGPoint(x: badge.midX, y: badge.midY), anchor: CGPoint(x: 0.5, y: 0.5)),
                                font: .badge, textTone: .accent(.red)))
                }
            case .state(let ref, let color):
                guard let color else { continue }   // cleared
                for key in ref.keys {
                    for i in b.shapes[key] ?? [] where b.items[i].accent == nil { b.items[i].accent = color }
                    for i in b.texts[key] ?? [] where b.items[i].font != .index { b.items[i].textTone = .accent(color) }
                }
            case .sub(let ref, let text):
                // Inside tree/graph nodes (handled at layout); elsewhere a small note under the element.
                guard !isNodeLike, let key = ref.keys.first, let r = b.anchors[key] else { continue }
                let y = r.maxY + (b.hasIndices ? 22 : 8)
                b.add(DItem(id: "\(s.name).sub\(n).\(key)", shape: .text(text, at: CGPoint(x: r.midX, y: y), anchor: CGPoint(x: 0.5, y: 0)),
                            font: .sub, textTone: .muted))
            case .dim(let ref):
                for key in ref.keys {
                    for i in (b.shapes[key] ?? []) + (b.texts[key] ?? []) { b.items[i].dimmed = true }
                }
            case .pointer(let label, let ref, let color, let below):
                guard let key = ref.keys.first, let r = b.anchors[key] else { continue }
                let tone = DItem.Tone.accent(color ?? .blue)
                // The cell a pointer sits on takes the pointer's color as its border.
                for i in b.shapes[key] ?? [] where b.items[i].outline == nil { b.items[i].outline = color ?? .blue }
                let w = monoWidth(label, size: 10.5) + 14
                let slot = "\(key)\(below)"
                let level = pointerStack[slot, default: 0]
                pointerStack[slot] = level + 1
                if b.vertical || s.kind == .intervals {
                    let rect = CGRect(x: r.minX - 20 - w - CGFloat(level) * (w + 4), y: r.midY - 9, width: w, height: 18)
                    chip("\(s.name).p\(n)", label, rect, tone)
                    b.add(DItem(id: "\(s.name).pl\(n)", shape: .polyline([CGPoint(x: rect.maxX + 2, y: rect.midY), CGPoint(x: r.minX - 3, y: r.midY)]), stroke: tone, lineWidth: 1.3, arrow: true))
                } else {
                    // Chips on neighbouring cells: nudge sideways (keeping the chip over its own cell), else
                    // stack one row further out with its own stem.
                    func at(_ lv: Int) -> CGRect {
                        below ? CGRect(x: r.midX - w / 2, y: r.maxY + (b.hasIndices ? 24 : 12) + CGFloat(lv) * 22, width: w, height: 18)
                              : CGRect(x: r.midX - w / 2, y: r.minY - 30 - CGFloat(lv) * 22, width: w, height: 18)
                    }
                    var lv = level
                    var rect = at(lv)
                    for _ in 0..<8 {
                        guard let hit = chips.first(where: { $0.insetBy(dx: -2, dy: -1).intersects(rect) }) else { break }
                        let dir: CGFloat = rect.midX >= hit.midX ? 1 : -1
                        let need = dir > 0 ? hit.maxX + 4 - rect.minX : rect.maxX - (hit.minX - 4)
                        let nudged = rect.offsetBy(dx: dir * need, dy: 0)
                        if abs(nudged.midX - r.midX) <= w / 2 - 6 { rect = nudged } else { lv += 1; rect = at(lv) }
                    }
                    chips.append(rect)
                    chip("\(s.name).p\(n)", label, rect, tone)
                    if level == 0 {
                        let stem = below ? [CGPoint(x: r.midX, y: rect.minY - 1), CGPoint(x: r.midX, y: r.maxY + (b.hasIndices ? 18 : 3))]
                                         : [CGPoint(x: r.midX, y: rect.maxY + 1), CGPoint(x: r.midX, y: r.minY - 3)]
                        b.add(DItem(id: "\(s.name).pl\(n)", shape: .polyline(stem), stroke: tone, lineWidth: 1.3, arrow: true))
                    }
                }
            case .window(let ref, let label, let color):
                let rects = ref.keys.compactMap { k in b.shapes[k]?.first.map { b.items[$0].shape.bounds } }
                guard let first = rects.min(by: { $0.minX < $1.minX }), let last = rects.max(by: { $0.maxX < $1.maxX }) else { continue }
                let tone = DItem.Tone.accent(color ?? .orange)
                let top = rects.map(\.minY).min()!, bottom = rects.map(\.maxY).max()!
                let band = CGRect(x: first.minX - 4, y: top - 4, width: last.maxX - first.minX + 8, height: bottom - top + 8)
                b.underlay.append(DItem(id: "\(s.name).wb\(n)", shape: .box(band, radius: 10), fill: tone, stroke: tone, lineWidth: 0.75, dashed: true))
                let y = bottom + (b.hasIndices ? 24 : 10) + CGFloat(belowRow) * 24
                belowRow += 1
                b.add(DItem(id: "\(s.name).w\(n)", shape: .polyline([CGPoint(x: first.minX + 2, y: y - 5), CGPoint(x: first.minX + 2, y: y), CGPoint(x: last.maxX - 2, y: y), CGPoint(x: last.maxX - 2, y: y - 5)]),
                            stroke: tone, lineWidth: 1.5))
                if let label {
                    b.add(DItem(id: "\(s.name).wl\(n)", shape: .text(label, at: CGPoint(x: (first.minX + last.maxX) / 2, y: y + 10), anchor: CGPoint(x: 0.5, y: 0.5)), font: .edge, textTone: tone))
                }
            case .mark(let ref, let text):
                for key in ref.keys {
                    guard let r = b.anchors[key] else { continue }
                    if (isNodeLike || isGrid) && text.count > 4 {
                        // Longer notes: a callout with a dotted leader — right of the node (past the row for
                        // grids); for nodes, left / below / above when the right side is taken.
                        let rowEnd = isGrid ? (b.items.compactMap { $0.cell ? $0.shape.bounds : nil }
                            .filter { abs($0.midY - r.midY) < 1 }.map(\.maxX).max() ?? r.maxX) : r.maxX
                        let tw = monoWidth(text, size: 10.5)
                        typealias Callout = (lead: [CGPoint]?, at: CGPoint, anchor: CGPoint)
                        var options: [Callout] = [([CGPoint(x: r.maxX + 3, y: r.midY), CGPoint(x: rowEnd + 8, y: r.midY)],
                                                   CGPoint(x: rowEnd + 12, y: r.midY), CGPoint(x: 0, y: 0.5))]
                        if !isGrid {
                            options += [([CGPoint(x: r.minX - 3, y: r.midY), CGPoint(x: r.minX - 8, y: r.midY)], CGPoint(x: r.minX - 12, y: r.midY), CGPoint(x: 1, y: 0.5)),
                                        (nil, CGPoint(x: r.midX, y: r.maxY + 6), CGPoint(x: 0.5, y: 0)),
                                        (nil, CGPoint(x: r.midX, y: r.minY - 6), CGPoint(x: 0.5, y: 1))]
                        }
                        let frame = { (o: Callout) in CGRect(x: o.at.x - tw * o.anchor.x, y: o.at.y - 12 * o.anchor.y, width: tw, height: 12) }
                        let pick = options.first { b.isFree(frame($0).insetBy(dx: -3, dy: -2)) } ?? options[0]
                        if let lead = pick.lead {
                            b.add(DItem(id: "\(s.name).ml\(n).\(key)", shape: .polyline(lead), stroke: .accent(.purple), lineWidth: 1, dashed: true))
                        }
                        b.add(DItem(id: "\(s.name).m\(n).\(key)", shape: .text(text, at: pick.at, anchor: pick.anchor),
                                    font: .edge, textTone: .accent(.purple)))
                    } else if isNodeLike || isGrid {
                        // Badge on the upper-right (distances, visit order, dp values).
                        let w = max(16, monoWidth(text, size: 9.5) + 9)
                        let topDown = b.topDown || s.kind == .tree || s.kind == .heap || s.kind == .trie
                        let candidates: [CGPoint] = isGrid ? [CGPoint(x: r.maxX - 3, y: r.minY - 4)]
                            : (topDown ? [CGPoint(x: r.maxX + w / 2 + 3, y: r.midY), CGPoint(x: r.minX - w / 2 - 3, y: r.midY),
                                          CGPoint(x: r.midX, y: r.maxY + 11), CGPoint(x: r.maxX + w / 2 - 2, y: r.minY - 6)]
                                       : [CGPoint(x: r.midX, y: r.minY - 11), CGPoint(x: r.midX, y: r.maxY + 11),
                                          CGPoint(x: r.maxX + w / 2 + 3, y: r.midY), CGPoint(x: r.minX - w / 2 - 3, y: r.midY)])
                        let rects = candidates.map { CGRect(x: $0.x - w / 2, y: $0.y - 8, width: w, height: 16) }
                        let rect = rects.first(where: { b.isFree($0.insetBy(dx: -2, dy: -2)) }) ?? rects[0]
                        b.add(DItem(id: "\(s.name).m\(n).\(key)", shape: .box(rect, radius: 8), fill: .accent(.purple), solid: true))
                        b.add(DItem(id: "\(s.name).mt\(n).\(key)", shape: .text(text, at: CGPoint(x: rect.midX, y: rect.midY), anchor: CGPoint(x: 0.5, y: 0.5)),
                                    font: .badge, textTone: .accent(.purple)))
                    } else {
                        let y = r.maxY + (b.hasIndices ? 24 : 10) + CGFloat(belowRow) * 24
                        b.add(DItem(id: "\(s.name).m\(n).\(key)", shape: .text(text, at: CGPoint(x: r.midX, y: y), anchor: CGPoint(x: 0.5, y: 0)), font: .edge, textTone: .muted))
                    }
                }
            case .path(var refs, let color):
                let c = color ?? .green
                if isGrid {
                    let keys = refs.flatMap(\.keys)
                    let rects = keys.compactMap { b.anchors[$0] }
                    guard rects.count > 1 else { continue }
                    for key in keys { for i in b.shapes[key] ?? [] { b.items[i].accent = c; b.items[i].glow = true } }
                    for (k, (r1, r2)) in zip(rects, rects.dropFirst()).enumerated() {
                        let (p1, p2) = edgePoints(r1.insetBy(dx: 1, dy: 1), r2.insetBy(dx: 1, dy: 1))
                        b.add(DItem(id: "\(s.name).path\(n).\(k)", shape: .polyline([p1, p2]), stroke: .accent(c), lineWidth: 1.8, arrow: true))
                    }
                    continue
                }
                // A single node in a tree: root → node.
                if refs.count == 1, let key = refs.first?.keys.first, b.parent[key] != nil {
                    var chain = [key]
                    while let p = b.parent[chain[0]] { chain.insert(p, at: 0) }
                    refs = chain.map { .node(s.name, String($0.dropFirst(s.name.count + 1))) }
                }
                let keys = refs.flatMap(\.keys)
                for key in keys { for i in b.shapes[key] ?? [] { b.items[i].accent = c; b.items[i].glow = true } }
                for (k1, k2) in zip(keys, keys.dropFirst()) {
                    for i in b.edges["\(k1)|\(k2)"] ?? [] {
                        b.items[i].stroke = .accent(c)
                        b.items[i].lineWidth = 2.4
                        b.items[i].glow = true
                    }
                }
            case .water(let ref, let level, let color):
                guard let bar = b.bar else { continue }
                for key in ref.keys {
                    guard let idx = b.shapes[key]?.first, case .box(let r, _) = b.items[idx].shape else { continue }
                    let top = bar.base - CGFloat(level) * bar.unit
                    guard top < r.minY - 0.5 else { continue }
                    let wr = CGRect(x: r.minX, y: top, width: r.width, height: r.minY - top)
                    var water = DItem(id: "\(s.name).water\(n).\(key)", shape: .box(wr, radius: 2), fill: .accent(color ?? .teal))
                    water.strongFill = true
                    b.add(water)
                }
            case .rect(let ref, let height, let label, let color):
                guard let bar = b.bar else { continue }
                let rects = ref.keys.compactMap { k in b.shapes[k]?.first.map { b.items[$0].shape.bounds } }
                guard let first = rects.min(by: { $0.minX < $1.minX }), let last = rects.max(by: { $0.maxX < $1.maxX }) else { continue }
                let top = bar.base - CGFloat(height) * bar.unit
                let area = CGRect(x: first.minX - 2, y: top, width: last.maxX - first.minX + 4, height: bar.base - top)
                let tone = DItem.Tone.accent(color ?? .green)
                b.underlay.append(DItem(id: "\(s.name).rect\(n)", shape: .box(area, radius: 3), fill: tone, stroke: tone, lineWidth: 1.5, dashed: true))
                if let label {
                    let y = bar.base + 26 + CGFloat(belowRow) * 24
                    belowRow += 1
                    b.add(DItem(id: "\(s.name).rectb\(n)", shape: .polyline([CGPoint(x: area.minX + 2, y: y - 5), CGPoint(x: area.minX + 2, y: y), CGPoint(x: area.maxX - 2, y: y), CGPoint(x: area.maxX - 2, y: y - 5)]),
                                stroke: tone, lineWidth: 1.5))
                    b.add(DItem(id: "\(s.name).rectl\(n)", shape: .text(label, at: CGPoint(x: area.midX, y: y + 10), anchor: CGPoint(x: 0.5, y: 0.5)), font: .edge, textTone: tone))
                }
            case .edges(let refs, let color):
                let keys = refs.flatMap(\.keys)
                for (k1, k2) in zip(keys, keys.dropFirst()) {
                    for i in b.edges["\(k1)|\(k2)"] ?? [] {
                        b.items[i].stroke = .accent(color ?? .green)
                        b.items[i].lineWidth = 2.2
                    }
                }
            case .arrow:
                break  // drawn globally
            }
        }
    }

    // MARK: - Geometry

    static func edgePoints(circle a: CGPoint, _ b: CGPoint, r1: CGFloat, r2: CGFloat) -> (CGPoint, CGPoint) {
        let d = max(0.001, hypot(b.x - a.x, b.y - a.y))
        let ux = (b.x - a.x) / d, uy = (b.y - a.y) / d
        return (CGPoint(x: a.x + ux * r1, y: a.y + uy * r1), CGPoint(x: b.x - ux * r2, y: b.y - uy * r2))
    }

    /// Points on the borders of two rects, along the line between their centers.
    static func edgePoints(_ a: CGRect, _ b: CGRect) -> (CGPoint, CGPoint) {
        func clip(_ r: CGRect, toward p: CGPoint) -> CGPoint {
            let c = CGPoint(x: r.midX, y: r.midY)
            let dx = p.x - c.x, dy = p.y - c.y
            guard dx != 0 || dy != 0 else { return c }
            let sx = dx == 0 ? .infinity : (r.width / 2 + 3) / abs(dx)
            let sy = dy == 0 ? .infinity : (r.height / 2 + 3) / abs(dy)
            let s = min(sx, sy)
            return CGPoint(x: c.x + dx * s, y: c.y + dy * s)
        }
        let ca = CGPoint(x: a.midX, y: a.midY), cb = CGPoint(x: b.midX, y: b.midY)
        return (clip(a, toward: cb), clip(b, toward: ca))
    }
}

// MARK: - Helpers

extension DRef {
    /// Anchor keys this ref covers.
    var keys: [String] {
        switch self {
        case .index(let n, let i): ["\(n)[\(i)]"]
        case .range(let n, let a, let b): (a...b).map { "\(n)[\($0)]" }
        case .cell(let n, let r, let c): ["\(n)[\(r)][\(c)]"]
        case .cellRange(let n, let r1, let r2, let c1, let c2): (r1...r2).flatMap { r in (c1...c2).map { "\(n)[\(r)][\($0)]" } }
        case .node(let n, let label): ["\(n).\(label)"]
        }
    }
    var key: String { keys.first ?? "" }
}

extension DItem.Shape {
    func offset(_ dx: CGFloat, _ dy: CGFloat) -> DItem.Shape {
        func p(_ q: CGPoint) -> CGPoint { CGPoint(x: q.x + dx, y: q.y + dy) }
        switch self {
        case .box(let r, let rad): return .box(r.offsetBy(dx: dx, dy: dy), radius: rad)
        case .circle(let c, let r): return .circle(center: p(c), radius: r)
        case .polyline(let pts): return .polyline(pts.map(p))
        case .curve(let a, let c, let b): return .curve(from: p(a), control: p(c), to: p(b))
        case .cubic(let a, let c1, let c2, let b): return .cubic(from: p(a), c1: p(c1), c2: p(c2), to: p(b))
        case .text(let s, let at, let anchor): return .text(s, at: p(at), anchor: anchor)
        case .textBlock(let s, let r): return .textBlock(s, r.offsetBy(dx: dx, dy: dy))
        case .dot(let c, let r): return .dot(p(c), r)
        case .polygon(let pts): return .polygon(pts.map(p))
        }
    }

    var bounds: CGRect {
        func box(_ pts: [CGPoint]) -> CGRect {
            let xs = pts.map(\.x), ys = pts.map(\.y)
            return CGRect(x: xs.min() ?? 0, y: ys.min() ?? 0, width: (xs.max() ?? 0) - (xs.min() ?? 0), height: (ys.max() ?? 0) - (ys.min() ?? 0))
        }
        switch self {
        case .box(let r, _): return r
        case .circle(let c, let r): return CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2)
        case .polyline(let pts): return box(pts)
        case .curve(let a, let c, let b): return box([a, CGPoint(x: (a.x + 2 * c.x + b.x) / 4, y: (a.y + 2 * c.y + b.y) / 4), b])
        case .cubic(let a, let c1, let c2, let b):
            return box([a, CGPoint(x: (a.x + 3 * c1.x + 3 * c2.x + b.x) / 8, y: (a.y + 3 * c1.y + 3 * c2.y + b.y) / 8), b])
        case .text(let s, let at, let anchor):
            let w = DiagramLayout.monoWidth(s, size: 11), h: CGFloat = 14
            return CGRect(x: at.x - w * anchor.x, y: at.y - h * anchor.y, width: w, height: h)
        case .textBlock(_, let r): return r
        case .dot(let c, let r): return CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2)
        case .polygon(let pts): return box(pts)
        }
    }
}
