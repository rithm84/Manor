import CoreGraphics
import Foundation

/// Flowchart layout: layered top-down, orthogonal edges, loops routed around the side.
///
/// - Back edges (found by DFS in declaration order) are removed for layering, then drawn up a lane to
///   the right of the chart; forward edges that would cut through a node detour via a lane on the left.
/// - Each layer is placed at its parents' barycenter, so a straight chain stays a straight line and a
///   decision's two branches sit symmetrically under it.
/// - Decisions are diamonds and exit sideways toward an off-axis target, with the edge label at the exit.
extension DiagramLayout {
    static let flowLineH: CGFloat = 15
    static let flowRowGap: CGFloat = 42
    static let flowColGap: CGFloat = 30
    static let flowLaneGap: CGFloat = 14

    struct FlowNode {
        var id: String
        var lines: [String]
        var shape: DStructure.FlowShape
        var size: CGSize
        var center: CGPoint = .zero
        var rect: CGRect { CGRect(x: center.x - size.width / 2, y: center.y - size.height / 2, width: size.width, height: size.height) }
    }

    /// Greedy word wrap to `limit` characters; words longer than the limit are split.
    static func wrap(_ text: String, limit: Int) -> [String] {
        var lines: [String] = []
        var current = ""
        for word in text.split(separator: " ").map(String.init) {
            var w = word
            while w.count > limit {
                if !current.isEmpty { lines.append(current); current = "" }
                lines.append(String(w.prefix(limit)))
                w = String(w.dropFirst(limit))
            }
            if current.isEmpty { current = w } else if current.count + 1 + w.count <= limit { current += " " + w } else {
                lines.append(current)
                current = w
            }
        }
        if !current.isEmpty { lines.append(current) }
        return lines.isEmpty ? [""] : lines
    }

    static func flowNodes(_ s: DStructure) -> [String: FlowNode] {
        var out: [String: FlowNode] = [:]
        for id in s.nodes {
            let shape = s.nodeShapes[id] ?? .process
            let text = s.nodeLabels[id] ?? displayLabel(id)
            let lines = wrap(text, limit: shape == .decision ? 16 : 24)
            let tw = lines.map { monoWidth($0, size: 12) }.max() ?? 0
            let th = CGFloat(lines.count) * flowLineH
            let size: CGSize = switch shape {
            case .process: CGSize(width: max(tw + 24, 64), height: th + 16)
            case .terminal: CGSize(width: max(tw + 30, 64), height: th + 14)
            case .decision: CGSize(width: max(tw * 1.5 + 30, 88), height: th * 2 + 18)
            }
            out[id] = FlowNode(id: id, lines: lines, shape: shape, size: size)
        }
        return out
    }

    /// Edges that close a cycle (target is on the DFS stack), visiting nodes in declaration order.
    static func backEdges(_ s: DStructure) -> Set<Int> {
        var out: [String: [(Int, String)]] = [:]
        for (k, e) in s.edges.enumerated() { out[e.from, default: []].append((k, e.to)) }
        var state: [String: Int] = [:]   // 1 = on stack, 2 = done
        var back: Set<Int> = []
        func dfs(_ v: String) {
            state[v] = 1
            for (k, w) in out[v] ?? [] {
                switch state[w] {
                case 1: back.insert(k)
                case nil: dfs(w)
                default: break
                }
            }
            state[v] = 2
        }
        for v in s.nodes where state[v] == nil { dfs(v) }
        return back
    }

    static func flow(_ s: DStructure) -> Block {
        var b = Block()
        guard !s.nodes.isEmpty else { return b }
        var nodes = flowNodes(s)
        let back = backEdges(s)
        let forward = s.edges.enumerated().filter { !back.contains($0.offset) && $0.element.from != $0.element.to }

        // Layers: longest path over forward edges.
        var layer: [String: Int] = [:]
        var parents: [String: [String]] = [:]
        for (_, e) in forward { parents[e.to, default: []].append(e.from) }
        func depth(_ v: String, _ seen: Set<String> = []) -> Int {
            if let d = layer[v] { return d }
            let d = (parents[v] ?? []).filter { !seen.contains($0) }.map { depth($0, seen.union([v])) + 1 }.max() ?? 0
            layer[v] = d
            return d
        }
        for v in s.nodes { _ = depth(v) }
        let layerCount = (layer.values.max() ?? 0) + 1
        var rows = Array(repeating: [String](), count: layerCount)
        for v in s.nodes { rows[layer[v]!].append(v) }

        // Vertical placement: each layer as tall as its tallest node, centred within it.
        var top: [CGFloat] = []
        var y: CGFloat = 0
        for row in rows {
            top.append(y)
            y += (row.map { nodes[$0]!.size.height }.max() ?? 0) + flowRowGap
        }
        let height = { (li: Int) in rows[li].map { nodes[$0]!.size.height }.max() ?? 0 }

        // Horizontal placement: barycenter of already-placed parents, then push apart and recentre.
        // A decision's branches aim for its left / right corners so they leave the diamond cleanly.
        var children: [String: [String]] = [:]
        for (_, e) in forward where !(children[e.from] ?? []).contains(e.to) { children[e.from, default: []].append(e.to) }
        func aim(_ v: String, from p: String) -> CGFloat {
            let pn = nodes[p]!
            guard pn.shape == .decision, let kids = children[p], kids.count >= 2, let k = kids.firstIndex(of: v) else { return pn.center.x }
            let spread = kids.count == 2 ? [-1.0, 1.0] : (0..<kids.count).map { -1 + 2 * Double($0) / Double(kids.count - 1) }
            return pn.center.x + CGFloat(spread[k]) * pn.size.width / 2
        }
        for (li, row) in rows.enumerated() {
            let desired: [(String, CGFloat)] = row.map { v in
                let xs = (parents[v] ?? []).compactMap { p in layer[p]! < li ? aim(v, from: p) : nil }
                return (v, xs.isEmpty ? 0 : xs.reduce(0, +) / CGFloat(xs.count))
            }
            let ordered = desired.enumerated().sorted { ($0.element.1, $0.offset) < ($1.element.1, $1.offset) }.map(\.element)
            var xs: [CGFloat] = []
            for (k, (v, want)) in ordered.enumerated() {
                if k == 0 { xs.append(want); continue }
                let prev = nodes[ordered[k - 1].0]!, cur = nodes[v]!
                // Beside a diamond, leave room for its yes/no labels at the corners.
                let gap = prev.shape == .decision || cur.shape == .decision ? flowColGap + 34 : flowColGap
                xs.append(max(want, xs[k - 1] + (prev.size.width + cur.size.width) / 2 + gap))
            }
            let shift = zip(xs, ordered).map { $0 - $1.1 }.reduce(0, +) / CGFloat(max(1, xs.count))
            for (k, (v, _)) in ordered.enumerated() {
                nodes[v]!.center = CGPoint(x: xs[k] - shift, y: top[li] + height(li) / 2)
            }
            rows[li] = ordered.map(\.0)
        }

        let all = nodes.values.map(\.rect)
        let minX = all.map(\.minX).min()!, maxX = all.map(\.maxX).max()!
        let rightmost = { (v: String) in rows[layer[v]!].last == v }
        let leftmost = { (v: String) in rows[layer[v]!].first == v }
        let key = { (v: String) in "\(s.name).\(v)" }

        // Edge labels collected and placed after nodes so they can avoid each other.
        var labels: [(id: String, text: String, at: CGPoint, anchor: CGPoint, tone: DItem.Tone)] = []
        func addEdge(_ k: Int, _ e: DEdge, _ pts: [CGPoint]) {
            let tone: DItem.Tone = e.color.map { .accent($0) } ?? .muted
            var item = DItem(id: "\(s.name).e\(k)", shape: .polyline(pts), stroke: tone, lineWidth: e.color == nil ? 1.3 : 2, arrow: true)
            item.glow = e.color != nil
            b.addEdge(key(e.from), key(e.to), item)
        }

        // Lanes: inner lanes for shorter spans.
        var rightLanes = 0, leftLanes = 0
        var rightExitUsed: Set<String> = []
        var junctions: [String: Int] = [:]
        let backOrder = back.sorted { a, b in
            let sa = abs(layer[s.edges[a].from]! - layer[s.edges[a].to]!), sb = abs(layer[s.edges[b].from]! - layer[s.edges[b].to]!)
            return (sa, a) < (sb, b)
        }

        for (k, e) in forward {
            let u = nodes[e.from]!, v = nodes[e.to]!
            let U = u.rect, V = v.rect
            let lu = layer[e.from]!, lv = layer[e.to]!
            let gapBelowU = top[lu] + height(lu) + 14
            var pts: [CGPoint]
            var labelAt: (CGPoint, CGPoint)?

            // Would a vertical drop at V.midX cut through a node in an intermediate layer?
            let blocked = (lu + 1..<max(lu + 1, lv)).contains { li in
                rows[li].contains { w in nodes[w]!.rect.insetBy(dx: -6, dy: -6).minX < V.midX && nodes[w]!.rect.insetBy(dx: -6, dy: -6).maxX > V.midX }
            }
            if blocked {
                let lane = minX - 22 - CGFloat(leftLanes) * flowLaneGap
                leftLanes += 1
                let start = leftmost(e.from) ? [CGPoint(x: U.minX, y: U.midY)] : [CGPoint(x: U.midX, y: U.maxY), CGPoint(x: U.midX, y: gapBelowU)]
                let entryY = top[lv] - 14
                let end = leftmost(e.to) ? [CGPoint(x: lane, y: V.midY), CGPoint(x: V.minX - 1, y: V.midY)]
                    : [CGPoint(x: lane, y: entryY), CGPoint(x: V.midX - 10, y: entryY), CGPoint(x: V.midX - 10, y: V.minY - 1)]
                pts = start + [CGPoint(x: lane, y: start.last!.y)] + end
                labelAt = (CGPoint(x: lane - 6, y: (start.last!.y + end[0].y) / 2), CGPoint(x: 1, y: 0.5))
            } else if abs(U.midX - V.midX) < 2 {
                pts = [CGPoint(x: U.midX, y: U.maxY), CGPoint(x: V.midX, y: V.minY - 1)]
                labelAt = (CGPoint(x: U.midX + 7, y: U.maxY + 10), CGPoint(x: 0, y: 0.5))
            } else if u.shape == .decision && (V.midX <= U.minX + 8 || V.midX >= U.maxX - 8) {
                let dir: CGFloat = V.midX > U.midX ? 1 : -1
                if dir > 0 { rightExitUsed.insert(e.from) }
                let exit = CGPoint(x: dir > 0 ? U.maxX : U.minX, y: U.midY)
                pts = [exit, CGPoint(x: V.midX, y: U.midY), CGPoint(x: V.midX, y: V.minY - 1)]
                labelAt = (CGPoint(x: exit.x + 6 * dir, y: U.midY - 4), CGPoint(x: dir > 0 ? 0 : 1, y: 1))
            } else {
                pts = [CGPoint(x: U.midX, y: U.maxY), CGPoint(x: U.midX, y: gapBelowU), CGPoint(x: V.midX, y: gapBelowU), CGPoint(x: V.midX, y: V.minY - 1)]
                labelAt = (CGPoint(x: V.midX + 7, y: (gapBelowU + V.minY) / 2), CGPoint(x: 0, y: 0.5))
            }
            addEdge(k, e, pts)
            if let label = e.label, !label.isEmpty, let (at, anchor) = labelAt {
                labels.append(("\(s.name).el\(k)", label, at, anchor, e.color.map { .accent($0) } ?? .muted))
            }
        }

        for k in backOrder {
            let e = s.edges[k]
            let u = nodes[e.from]!, v = nodes[e.to]!
            let U = u.rect, V = v.rect
            let lane = maxX + 22 + CGFloat(rightLanes) * flowLaneGap
            rightLanes += 1
            let lu = layer[e.from]!, lv = layer[e.to]!
            let selfLoop = e.from == e.to
            let start: [CGPoint] = selfLoop || (rightmost(e.from) && !rightExitUsed.contains(e.from))
                ? [CGPoint(x: U.maxX, y: U.midY + (selfLoop ? 6 : 0))]
                : [CGPoint(x: U.midX, y: U.maxY), CGPoint(x: U.midX, y: top[lu] + height(lu) + 14)]
            // Loops rejoin the line that enters the target from above (a junction, like a hand-drawn
            // flowchart), so they never share a corner with the target's own exits.
            let j = junctions[e.to, default: 0]
            junctions[e.to] = j + 1
            let jy = top[lv] - 12 - CGFloat(j) * 7
            let hasEntry = forward.contains { $0.element.to == e.to }
            let end: [CGPoint] = selfLoop
                ? [CGPoint(x: lane, y: V.midY - 6), CGPoint(x: V.maxX + 1, y: V.midY - 6)]
                : hasEntry ? [CGPoint(x: lane, y: jy), CGPoint(x: V.midX + 1.5, y: jy)]
                           : [CGPoint(x: lane, y: jy), CGPoint(x: V.midX, y: jy), CGPoint(x: V.midX, y: V.minY - 1)]
            let pts = start + [CGPoint(x: lane, y: start.last!.y)] + end
            addEdge(k, e, pts)
            if let label = e.label, !label.isEmpty {
                labels.append(("\(s.name).el\(k)", label, CGPoint(x: lane + 6, y: (start.last!.y + end[0].y) / 2), CGPoint(x: 0, y: 0.5),
                               e.color.map { .accent($0) } ?? .muted))
            }
        }

        // Nodes.
        for id in s.nodes {
            guard let n = nodes[id] else { continue }
            let r = n.rect
            let shape: DItem.Shape = switch n.shape {
            case .process: .box(r, radius: 7)
            case .terminal: .box(r, radius: r.height / 2)
            case .decision: .polygon([CGPoint(x: r.midX, y: r.minY), CGPoint(x: r.maxX, y: r.midY),
                                      CGPoint(x: r.midX, y: r.maxY), CGPoint(x: r.minX, y: r.midY)])
            }
            var item = DItem(id: "\(s.name).n.\(id)", shape: shape, cell: true)
            if n.shape == .terminal { item.accent = nil }
            b.addShape([key(id)], item, anchor: r)
            let firstY = r.midY - CGFloat(n.lines.count - 1) * flowLineH / 2
            for (i, line) in n.lines.enumerated() {
                b.addText([key(id)], DItem(id: "\(s.name).v.\(id).\(i)", shape: .text(line, at: CGPoint(x: r.midX, y: firstY + CGFloat(i) * flowLineH),
                                                                                      anchor: CGPoint(x: 0.5, y: 0.5)), font: .small))
            }
        }

        // Edge labels as small chips, nudged along until they're clear of nodes and other labels.
        for l in labels {
            let w = monoWidth(l.text, size: 10.5) + 10
            var rect = CGRect(x: l.at.x - w * l.anchor.x, y: l.at.y - 16 * l.anchor.y, width: w, height: 16)
            for _ in 0..<6 where !b.isFree(rect.insetBy(dx: -1, dy: -1)) { rect = rect.offsetBy(dx: 0, dy: l.anchor.y == 1 ? -8 : 9) }
            b.add(DItem(id: l.id + "b", shape: .box(rect, radius: 5), fill: .faint, stroke: .faint, decor: true))
            b.add(DItem(id: l.id, shape: .text(l.text, at: CGPoint(x: rect.midX, y: rect.midY), anchor: CGPoint(x: 0.5, y: 0.5)),
                        font: .edge, textTone: l.tone))
        }

        b.labelY = (nodes.values.map(\.rect.minY).min() ?? 0) + 10
        b.topDown = true
        return b
    }
}
