import CoreGraphics
import Foundation

/// Geometry-level readability check for laid-out diagrams. Used by tests over the whole DSA corpus so
/// layout regressions (labels on top of nodes, edges through nodes, overlapping chips) can't ship.
extension DItem {
    /// Badges intentionally overlap the corner of the node they annotate.
    var isBadge: Bool { solid && (id.contains(".m") || id.contains(".x")) }
}

enum DiagramAudit {
    struct Collision: CustomStringConvertible {
        var a: String
        var b: String
        var kind: String
        var description: String { "\(kind): \(a) × \(b)" }
    }

    static func fontSize(_ f: DItem.Font) -> (size: CGFloat, mono: Bool) {
        switch f {
        case .value: (13, true)
        case .small: (12, true)
        case .index, .badge: (9.5, true)
        case .label, .chip, .edge: (10.5, true)
        case .caption, .legend: (12, false)
        case .title: (12.5, false)
        case .sub: (11, false)
        case .name: (12, false)
        case .code: (12, true)
        case .calc: (15, true)
        case .verdict: (12.5, false)
        }
    }

    /// Tight frame of a text item using its real font metrics.
    static func textFrame(_ item: DItem) -> CGRect? {
        switch item.shape {
        case .text(let s, let at, let anchor):
            let (size, mono) = fontSize(item.font)
            let w = CGFloat(s.count) * size * (mono ? 0.6 : 0.52)
            let h = size * 1.15
            return CGRect(x: at.x - w * anchor.x, y: at.y - h * anchor.y, width: w, height: h)
        case .textBlock(_, let r):
            return r
        default:
            return nil
        }
    }

    /// Solid things text must not sit on: cells, nodes, bars, chips.
    static func solidFrame(_ item: DItem) -> CGRect? {
        guard item.cell || item.solid else { return nil }
        switch item.shape {
        case .box(let r, _): return r
        case .circle(let c, let r): return CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2).insetBy(dx: r * 0.15, dy: r * 0.15)
        case .polygon:  // diamond: the inscribed rectangle is what must stay clear
            let r = item.shape.bounds
            return r.insetBy(dx: r.width / 4, dy: r.height / 4)
        default: return nil
        }
    }

    static func samples(_ shape: DItem.Shape) -> [CGPoint] {
        func lerp(_ a: CGPoint, _ b: CGPoint, _ t: CGFloat) -> CGPoint { CGPoint(x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t) }
        let ts = stride(from: 0.12, through: 0.88, by: 0.04).map { CGFloat($0) }
        switch shape {
        case .polyline(let pts):
            guard pts.count > 1 else { return [] }
            return zip(pts, pts.dropFirst()).flatMap { a, b in ts.map { lerp(a, b, $0) } }
        case .curve(let a, let c, let b):
            return ts.map { t in lerp(lerp(a, c, t), lerp(c, b, t), t) }
        case .cubic(let a, let c1, let c2, let b):
            return ts.map { t in
                let ab = lerp(a, c1, t), bc = lerp(c1, c2, t), cd = lerp(c2, b, t)
                return lerp(lerp(ab, bc, t), lerp(bc, cd, t), t)
            }
        default:
            return []
        }
    }

    /// Every frame of a diagram source (step-throughs share one placement), tagged with its step.
    static func collisions(source: String) -> [Collision] {
        let frames = DiagramParser.frames(source)
        let scenes = frames.count == 1 ? [DiagramLayout.layout(frames[0])] : DiagramLayout.layoutFrames(frames)
        return scenes.enumerated().flatMap { k, scene in
            collisions(in: scene).map { scenes.count > 1 ? Collision(a: $0.a, b: $0.b, kind: "step \(k + 1) \($0.kind)") : $0 }
        }
    }

    static func collisions(in scene: DScene) -> [Collision] {
        var out: [Collision] = []
        let texts = scene.items.compactMap { item in textFrame(item).map { (item, $0) } }
        let solids = scene.items.compactMap { item in solidFrame(item).map { (item, $0) } }

        // 1. Text on text.
        for i in texts.indices {
            for j in texts.indices where j > i {
                if texts[i].1.insetBy(dx: 1, dy: 1).intersects(texts[j].1.insetBy(dx: 1, dy: 1)) {
                    out.append(Collision(a: texts[i].0.id, b: texts[j].0.id, kind: "text/text"))
                }
            }
        }
        // 2. Text on a solid it doesn't belong to (values/chip text inside their own cell are fine).
        for (t, tf) in texts where t.font != .badge {
            for (s, sf) in solids where tf.insetBy(dx: 1, dy: 1).intersects(sf) {
                let center = CGPoint(x: tf.midX, y: tf.midY)
                // A diamond's own text may extend past its inscribed rect but stays inside the diamond's box.
                let owner = { if case .polygon = s.shape { return s.shape.bounds } else { return sf } }()
                let fonts: [DItem.Font] = s.id.hasSuffix(".pill") ? [.edge] : [.value, .small, .chip, .sub]
                let ownsIt = sf.contains(center) && fonts.contains(t.font) && owner.insetBy(dx: -1, dy: -1).contains(tf)
                if !ownsIt { out.append(Collision(a: t.id, b: s.id, kind: "text/shape")) }
            }
        }
        // 3. Solids overlapping each other (badges may sit on a node's corner).
        for i in solids.indices {
            for j in solids.indices where j > i {
                let (a, af) = solids[i], (b, bf) = solids[j]
                if a.isBadge || b.isBadge { continue }
                if af.insetBy(dx: 1, dy: 1).intersects(bf.insetBy(dx: 1, dy: 1)) {
                    out.append(Collision(a: a.id, b: b.id, kind: "shape/shape"))
                }
            }
        }
        // 4. Lines cutting through nodes/cells or labels (endpoints excluded by sampling 12–88 %).
        for line in scene.items where !line.decor {
            let pts = samples(line.shape)
            guard !pts.isEmpty else { continue }
            for (s, sf) in solids where !s.id.hasPrefix(line.id + ".") && pts.contains(where: { sf.insetBy(dx: 2, dy: 2).contains($0) }) {
                out.append(Collision(a: line.id, b: s.id, kind: "line/shape"))
            }
            for (t, tf) in texts where [.value, .edge, .chip, .label].contains(t.font) && !t.id.hasPrefix(line.id) {
                if pts.contains(where: { tf.insetBy(dx: 1, dy: 1).contains($0) }) {
                    out.append(Collision(a: line.id, b: t.id, kind: "line/text"))
                }
            }
        }
        return out
    }
}
