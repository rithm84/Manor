import SwiftUI

/// Renders a streamed `diagram` block — a single picture, or a step-through with controls when the
/// block contains `step` lines. Each primitive "draws itself in" the first time it appears — strokes
/// trace along their length, cells trace their outline then fill, text fades up — staggered in
/// document order so a whole array arriving in one line still cascades left → right.
struct DiagramView: View {
    let source: String
    let complete: Bool
    var maxWidth: CGFloat

    /// Never shrink below this — wider diagrams scroll horizontally instead of becoming unreadable.
    static let minScale: CGFloat = DiagramCanvas.minScale

    var body: some View {
        let frames = DiagramParser.frames(source, complete: complete)
        Group {
            if frames.count > 1 {
                SteppedDiagram(frames: frames, complete: complete, maxWidth: maxWidth)
            } else {
                SingleDiagram(doc: frames[0], maxWidth: maxWidth)
            }
        }
        .background(Paper().clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous)))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Theme.ink.opacity(0.09), lineWidth: 0.5))
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityLabel(frames.last?.caption ?? "Diagram")
    }
}

private struct SingleDiagram: View {
    let doc: DiagramDoc
    let maxWidth: CGFloat
    @State private var reveal = RevealClock()
    @Environment(\.diagramAnimation) private var animated

    var body: some View {
        let scene = DiagramLayout.layoutFrames([doc], maxWidth: maxWidth - DiagramCanvas.pad * 2, captions: true)[0]
        DiagramCanvas(scene: scene, previous: nil, changedAt: .distantPast, maxWidth: maxWidth, reveal: reveal, animated: animated)
    }
}

extension Notification.Name {
    /// Step every visible step-through by `object` (Int, ±1). Posted by ⌃⌥[ / ⌃⌥].
    static let alfredDiagramStep = Notification.Name("AlfredDiagramStep")
}

/// A step-through: one shared layout, a frame per `step`, back / next / play and the step's caption.
/// Moving between frames glides everything that persists (pointers, highlights) to its new place.
private struct SteppedDiagram: View {
    let frames: [DiagramDoc]
    let complete: Bool
    let maxWidth: CGFloat

    @State private var index: Int
    @State private var previous: Int?
    @State private var changedAt = Date.distantPast
    @State private var playing = false
    @State private var reveal = RevealClock()
    @Environment(\.diagramAnimation) private var animated

    static let playInterval: Duration = .milliseconds(1700)

    init(frames: [DiagramDoc], complete: Bool, maxWidth: CGFloat) {
        self.frames = frames
        self.complete = complete
        self.maxWidth = maxWidth
        // Debug renders (ALFRED_RENDER_MARKDOWN) can pick the frame to draw.
        let start = ProcessInfo.processInfo.environment["ALFRED_DIAGRAM_FRAME"].flatMap(Int.init) ?? 0
        _index = State(initialValue: start)
    }

    var body: some View {
        let scenes = DiagramLayout.layoutFrames(frames, maxWidth: maxWidth - DiagramCanvas.pad * 2)
        let i = min(index, scenes.count - 1)
        VStack(alignment: .leading, spacing: 0) {
            StepBar(index: i, count: scenes.count, streaming: !complete, caption: frames[i].caption, why: frames[i].why,
                    tag: frames[i].tag, playing: playing, go: { go(i + $0) }, togglePlay: togglePlay)
            DiagramCanvas(scene: scenes[i], previous: previous.flatMap { $0 < scenes.count && $0 != i ? scenes[$0] : nil },
                          changedAt: changedAt, maxWidth: maxWidth, reveal: reveal, animated: animated)
        }
        .onReceive(NotificationCenter.default.publisher(for: .alfredDiagramStep)) { note in
            playing = false
            go(i + ((note.object as? Int) ?? 1))
        }
        .task(id: playing) {
            while playing, !Task.isCancelled {
                try? await Task.sleep(for: Self.playInterval)
                guard playing, !Task.isCancelled else { return }
                if index < frames.count - 1 { go(index + 1) } else if complete { playing = false }
            }
        }
    }

    private func togglePlay() {
        if !playing && index >= frames.count - 1 { go(0) }
        playing.toggle()
    }

    private func go(_ k: Int) {
        let n = max(0, min(frames.count - 1, k))
        guard n != index else { return }
        previous = index
        changedAt = .now
        index = n
    }
}

private struct StepBar: View {
    let index: Int
    let count: Int
    let streaming: Bool
    let caption: String?
    var why: String?
    var tag: (text: String, color: DColor?)?
    let playing: Bool
    let go: (Int) -> Void
    let togglePlay: () -> Void

    var body: some View {
        // Controls first (like a stepper you drive), then what this step does.
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                pill("chevron.left", "Back", help: "Previous step (⌃⌥[)", disabled: index == 0) { go(-1) }
                pill("chevron.right", "Next", help: "Next step (⌃⌥])", disabled: index >= count - 1, trailingIcon: true) { go(1) }
                control(playing ? "pause.fill" : "play.fill", help: playing ? "Pause" : "Play all steps", disabled: count < 2) { togglePlay() }
                Text("Step \(index + 1) of \(count)\(streaming ? "…" : "")")
                    .font(.alfred(12, .medium))
                    .foregroundStyle(Theme.ink.opacity(0.55))
                    .monospacedDigit()
                    .padding(.leading, 4)
                if let tag {
                    let tint = tag.color.map(DiagramPainter.palette) ?? Theme.ink.opacity(0.7)
                    Text(tag.text.uppercased())
                        .font(.alfred(12, .semibold))
                        .tracking(0.4)
                        .foregroundStyle(tint)
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(Capsule().fill(tint.opacity(0.14)))
                        .overlay(Capsule().strokeBorder(tint.opacity(0.45), lineWidth: 0.75))
                }
                Spacer(minLength: 0)
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(MarkdownStyle.inline(caption ?? " ", size: 13.5))
                    .font(.alfred(13.5, .semibold))
                    .foregroundStyle(DiagramPainter.text)
                if let why {
                    Text(MarkdownStyle.inline(why, size: 12.5))
                        .font(.alfred(12.5))
                        .foregroundStyle(Theme.ink.opacity(0.62))
                }
            }
            .lineSpacing(2)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentTransition(.opacity)
            .animation(.easeOut(duration: 0.2), value: index)
        }
        .padding(.horizontal, 14)
        .padding(.top, 12)
        .padding(.bottom, 2)
    }

    private func pill(_ symbol: String, _ title: String, help: String, disabled: Bool, trailingIcon: Bool = false,
                      action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 4) {
                if !trailingIcon { Image(systemName: symbol).font(.system(size: 9, weight: .bold)) }
                Text(title).font(.alfred(12, .medium))
                if trailingIcon { Image(systemName: symbol).font(.system(size: 9, weight: .bold)) }
            }
            .foregroundStyle(Theme.ink)
            .padding(.horizontal, 10).frame(height: 26)
            .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Theme.ink.opacity(0.06)))
            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(Theme.ink.opacity(0.14), lineWidth: 0.75))
            .contentShape(RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .opacity(disabled ? 0.35 : 1)
        .help(help)
    }

    private func control(_ symbol: String, help: String, disabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 9.5, weight: .bold))
                .foregroundStyle(Theme.ink)
                .frame(width: 22, height: 22)
                .contentShape(Circle())
        }
        .buttonStyle(GhostButtonStyle(padding: .init(), radius: 11))
        .disabled(disabled)
        .opacity(disabled ? 0.3 : 1)
        .help(help)
    }
}

/// Draws one scene, tweening from `previous` (matching ids glide, new ones fade in, gone ones fade out).
struct DiagramCanvas: View {
    static let pad: CGFloat = 18
    static let minScale: CGFloat = 0.7
    static let tween: TimeInterval = 0.45

    let scene: DScene
    let previous: DScene?
    let changedAt: Date
    let maxWidth: CGFloat
    let reveal: RevealClock
    let animated: Bool

    /// Bumped when animations settle so the timeline pauses instead of redrawing at 60 fps forever.
    @State private var settled = 0

    var body: some View {
        let _ = settled
        let pad = Self.pad
        let fit = (maxWidth - pad * 2) / max(scene.size.width, 1)
        let scale = min(1, max(Self.minScale, fit))
        let size = CGSize(width: scene.size.width * scale + pad * 2, height: max(scene.size.height * scale + pad * 2, 44))
        // Panel spans the column like code blocks; the drawing is centered inside it.
        let inset = max(0, (maxWidth - size.width) / 2)
        let now = Date.now
        let _ = reveal.register(scene.items.map(\.id), at: animated ? now : .distantPast)
        let tweening = animated && previous != nil
        let busyUntil = max(reveal.busyUntil, tweening ? changedAt.addingTimeInterval(Self.tween) : .distantPast)
        let before = previous.map { Dictionary($0.items.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a }) } ?? [:]
        let ids = Set(scene.items.map(\.id))

        let canvas = TimelineView(.animation(minimumInterval: 1.0 / 60, paused: busyUntil < now)) { timeline in
            Canvas { ctx, _ in
                ctx.translateBy(x: pad + inset, y: pad)
                ctx.scaleBy(x: scale, y: scale)
                let raw = tweening ? min(1, max(0, timeline.date.timeIntervalSince(changedAt) / Self.tween)) : 1
                let t = 1 - pow(1 - raw, 3)
                if t < 1, let previous {
                    var fading = ctx
                    fading.opacity = 1 - t
                    for item in previous.items where !ids.contains(item.id) { DiagramPainter.draw(item, progress: 1, in: fading) }
                }
                for var item in scene.items {
                    let p = reveal.progress(item.id, at: timeline.date)
                    guard p > 0 else { continue }
                    var c = ctx
                    if t < 1 {
                        if let old = before[item.id] { item.shape = old.shape.lerp(to: item.shape, CGFloat(t)) } else { c.opacity = t }
                    }
                    DiagramPainter.draw(item, progress: p, in: c)
                }
            }
        }
        .frame(width: size.width + inset * 2, height: size.height)
        .task(id: busyUntil) {
            let wait = busyUntil.timeIntervalSinceNow
            guard wait > 0, wait < 30 else { return }
            try? await Task.sleep(for: .seconds(wait + 0.05))
            settled &+= 1
        }

        if size.width > maxWidth + 0.5 {
            ScrollView(.horizontal, showsIndicators: false) { canvas }
                .frame(width: maxWidth, height: size.height)
        } else {
            canvas
        }
    }
}

extension EnvironmentValues {
    /// False renders diagrams fully drawn (snapshots, revisiting older answers).
    @Entry var diagramAnimation = true
    /// The width answer content lays out in: the card's text column, or the embedding view's width.
    @Entry var alfredContentWidth: CGFloat = Theme.cardWidth - 40
}

/// Remembers when each primitive first appeared and staggers their entrances.
final class RevealClock {
    private var start: [String: Date] = [:]
    private var lastScheduled = Date.distantPast
    static let stagger: TimeInterval = 0.04
    static let duration: TimeInterval = 0.4

    func register(_ ids: [String], at now: Date) {
        for id in ids where start[id] == nil {
            if now == .distantPast { start[id] = now; continue }
            let t = max(now, lastScheduled.addingTimeInterval(Self.stagger))
            start[id] = t
            lastScheduled = t
        }
    }

    func progress(_ id: String, at now: Date) -> Double {
        guard let s = start[id] else { return 1 }
        let raw = now.timeIntervalSince(s) / Self.duration
        guard raw > 0 else { return 0 }
        guard raw < 1 else { return 1 }
        return 1 - pow(1 - raw, 3)  // ease-out cubic
    }

    /// When the last scheduled entrance finishes.
    var busyUntil: Date { lastScheduled.addingTimeInterval(Self.duration + 0.05) }
}

enum DiagramPainter {
    // MARK: Palette

    static func palette(_ c: DColor) -> Color {
        switch c {
        case .blue: Self.blue
        case .green: Self.green
        case .orange: Self.orange
        case .red: Self.red
        case .purple: Self.purple
        case .pink: Self.pink
        case .yellow: Self.yellow
        case .teal: Self.teal
        case .gray: Self.gray
        }
    }

    // Bright on the dark card; deeper on a light document so strokes and text keep their contrast.
    private static let blue = Color.adaptive(dark: (0.36, 0.60, 1.0), light: (0.16, 0.38, 0.82))
    private static let green = Color.adaptive(dark: (0.27, 0.85, 0.58), light: (0.08, 0.52, 0.32))
    private static let orange = Color.adaptive(dark: (1.0, 0.66, 0.24), light: (0.80, 0.42, 0.02))
    private static let red = Color.adaptive(dark: (1.0, 0.44, 0.44), light: (0.80, 0.20, 0.22))
    private static let purple = Color.adaptive(dark: (0.68, 0.58, 1.0), light: (0.46, 0.31, 0.72))
    private static let pink = Color.adaptive(dark: (0.98, 0.50, 0.78), light: (0.78, 0.22, 0.52))
    private static let yellow = Color.adaptive(dark: (0.99, 0.85, 0.36), light: (0.62, 0.48, 0.0))
    private static let teal = Color.adaptive(dark: (0.30, 0.80, 0.88), light: (0.05, 0.50, 0.58))
    private static let gray = Color.adaptive(dark: (0.64, 0.64, 0.64), light: (0.46, 0.45, 0.48))
    private static let darkInk = Color.adaptive(dark: (0.06, 0.06, 0.08), light: (1, 1, 1))

    /// Text on a solid chip: dark ink on light accents, white on deep ones.
    static func ink(on c: DColor) -> Color {
        switch c {
        case .green, .orange, .yellow, .teal, .pink: darkInk
        default: .white
        }
    }

    static let text = Theme.text

    static func textColor(_ tone: DItem.Tone) -> Color {
        switch tone {
        case .neutral: text
        case .muted: Theme.ink.opacity(0.56)
        case .faint: Theme.ink.opacity(0.34)
        case .accent(let c): palette(c).mix(with: Theme.ink, by: 0.38)
        }
    }

    static func strokeColor(_ tone: DItem.Tone) -> Color {
        switch tone {
        case .neutral: Theme.ink.opacity(0.5)
        case .muted: Theme.ink.opacity(0.30)
        case .faint: Theme.ink.opacity(0.13)
        case .accent(let c): palette(c).opacity(0.95)
        }
    }

    static func fillColor(_ tone: DItem.Tone) -> Color {
        switch tone {
        case .neutral: Theme.ink.opacity(0.12)
        case .muted: Theme.ink.opacity(0.32)
        case .faint: Theme.ink.opacity(0.055)
        case .accent(let c): palette(c).opacity(0.18)
        }
    }

    static func font(_ f: DItem.Font) -> Font {
        switch f {
        case .value: .alfredMono(13, .medium)
        case .small: .alfredMono(12, .medium)
        case .index: .alfredMono(DiagramLayout.minText)
        case .label: .alfredMono(DiagramLayout.minText, .medium)
        case .chip: .alfredMono(DiagramLayout.minText, .semibold)
        case .badge: .alfredMono(DiagramLayout.minText, .semibold)
        case .edge: .alfredMono(DiagramLayout.minText, .medium)
        case .caption: .alfred(12)
        case .title: .alfred(12.5, .semibold)
        case .sub: .alfred(DiagramLayout.minText, .medium)
        case .name: .alfred(12, .medium)
        case .code: .alfredMono(12)
        case .legend: .alfred(DiagramLayout.minText)
        case .calc: .alfredMono(15, .semibold)
        case .verdict: .alfred(12.5, .medium)
        }
    }

    // MARK: Draw

    static func draw(_ item: DItem, progress t: Double, in context: GraphicsContext) {
        var ctx = context
        if item.dimmed { ctx.opacity = 0.28 }
        if item.pending { ctx.opacity = 0.38 }
        switch item.shape {
        case .box(let r, let radius):
            drawFilled(Path(roundedRect: r, cornerRadius: radius, style: .continuous), bounds: r, item, t, &ctx)
        case .circle(let c, let radius):
            let r = CGRect(x: c.x - radius, y: c.y - radius, width: radius * 2, height: radius * 2)
            drawFilled(Path(ellipseIn: r), bounds: r, item, t, &ctx)
            if item.ring {
                var c2 = ctx
                c2.opacity *= t
                c2.stroke(Path(ellipseIn: r.insetBy(dx: -3.5, dy: -3.5)),
                          with: .color(item.accent.map { palette($0).opacity(0.7) } ?? palette(.green).opacity(0.75)), lineWidth: 1.2)
            }
        case .dot(let c, let radius):
            ctx.opacity *= t
            ctx.fill(Path(ellipseIn: CGRect(x: c.x - radius, y: c.y - radius, width: radius * 2, height: radius * 2)),
                     with: .color(item.fill.map { strokeColor($0) } ?? Theme.ink.opacity(0.4)))
        case .polyline(let pts):
            guard pts.count > 1 else { return }
            var path = Path()
            path.addLines(pts)
            drawLine(path, item, t, start: (pts[0], pts[1]), end: (pts[pts.count - 2], pts[pts.count - 1]), &ctx)
        case .curve(let a, let c, let b):
            var path = Path()
            path.move(to: a)
            path.addQuadCurve(to: b, control: c)
            drawLine(path, item, t, start: (c, a), end: (c, b), &ctx)
        case .cubic(let a, let c1, let c2, let b):
            var path = Path()
            path.move(to: a)
            path.addCurve(to: b, control1: c1, control2: c2)
            drawLine(path, item, t, start: (c1, a), end: (c2, b), &ctx)
        case .text(let s, let at, let anchor):
            ctx.opacity *= t
            ctx.translateBy(x: 0, y: (1 - t) * 3)
            let color: Color = {
                if case .accent(let c) = item.textTone, item.font == .chip || item.font == .badge { return ink(on: c) }
                return textColor(item.textTone)
            }()
            ctx.draw(ctx.resolve(Text(s).font(font(item.font)).foregroundStyle(color)), at: at, anchor: UnitPoint(x: anchor.x, y: anchor.y))
        case .textBlock(let s, let r):
            ctx.opacity *= t
            ctx.draw(ctx.resolve(Text(s).font(font(item.font)).foregroundStyle(textColor(item.textTone))), in: r)
        case .polygon(let pts):
            guard pts.count > 2 else { return }
            var path = Path()
            path.addLines(pts)
            path.closeSubpath()
            drawFilled(path, bounds: item.shape.bounds, item, t, &ctx)
        }
    }

    private static func drawFilled(_ path: Path, bounds r: CGRect, _ item: DItem, _ t: Double, _ ctx: inout GraphicsContext) {
        let fillIn = max(0, (t - 0.3) / 0.7)
        if let accent = item.accent {
            // State fill: a solid tint of the color (reads as "this node is in state X"), a softer border,
            // and only a faint glow when it's on a highlighted path.
            let base = palette(accent)
            var g = ctx
            g.opacity *= fillIn
            if item.glow { g.addFilter(.shadow(color: base.opacity(0.35), radius: 5)) }
            g.fill(path, with: .color(base.mix(with: Theme.surface, by: 0.62)))
            ctx.stroke(t < 1 ? path.trimmedPath(from: 0, to: t) : path, with: .color(base.opacity(0.75)), lineWidth: 1.2)
            drawFocus(path, bounds: r, item, t, &ctx)
            return
        }
        if item.solid, case .accent(let c) = item.fill {
            var g = ctx
            g.opacity *= fillIn
            let base = palette(c)
            g.addFilter(.shadow(color: base.opacity(0.35), radius: 4, y: 1))
            g.fill(path, with: .linearGradient(Gradient(colors: [base, base.opacity(0.86)]),
                                               startPoint: CGPoint(x: r.midX, y: r.minY), endPoint: CGPoint(x: r.midX, y: r.maxY)))
            return
        }
        if item.cell && item.pending {
            // Not reached yet: just a dashed outline.
            ctx.stroke(t < 1 ? path.trimmedPath(from: 0, to: t) : path, with: .color(Theme.ink.opacity(0.45)),
                       style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
            return
        }
        if item.cell, let tint = item.outline {
            // A pointer sits here: a faint tint of its color and a border in it.
            let base = palette(tint)
            var g = ctx
            g.opacity *= fillIn
            g.fill(path, with: .color(base.mix(with: Theme.surface, by: 0.82)))
            ctx.stroke(t < 1 ? path.trimmedPath(from: 0, to: t) : path, with: .color(base.opacity(0.9)), lineWidth: 1.8)
            drawFocus(path, bounds: r, item, t, &ctx)
            return
        }
        if item.cell {
            // Neutral node/cell: a quiet gray fill with a hairline border.
            var g = ctx
            g.opacity *= fillIn
            g.fill(path, with: .linearGradient(Gradient(colors: [Theme.ink.opacity(0.13), Theme.ink.opacity(0.08)]),
                                               startPoint: CGPoint(x: r.midX, y: r.minY), endPoint: CGPoint(x: r.midX, y: r.maxY)))
            ctx.stroke(t < 1 ? path.trimmedPath(from: 0, to: t) : path, with: .color(Theme.ink.opacity(0.20)), lineWidth: 1)
            drawFocus(path, bounds: r, item, t, &ctx)
            return
        }
        if let fill = item.fill {
            var g = ctx
            g.opacity *= fillIn
            if item.strongFill, case .accent(let c) = fill {
                g.fill(path, with: .linearGradient(Gradient(colors: [palette(c).opacity(0.5), palette(c).opacity(0.32)]),
                                                   startPoint: CGPoint(x: r.midX, y: r.minY), endPoint: CGPoint(x: r.midX, y: r.maxY)))
            } else {
                g.fill(path, with: .color(fillColor(fill)))
            }
        }
        if let stroke = item.stroke {
            ctx.stroke(t < 1 ? path.trimmedPath(from: 0, to: t) : path, with: .color(strokeColor(stroke)),
                       style: StrokeStyle(lineWidth: item.lineWidth, dash: item.dashed ? [4, 3] : []))
        }
    }

    /// The "acted on this step" ring: a bright outline just outside the shape.
    private static func drawFocus(_ path: Path, bounds r: CGRect, _ item: DItem, _ t: Double, _ ctx: inout GraphicsContext) {
        guard item.focus else { return }
        var g = ctx
        g.opacity *= t
        let ring: Path = {
            if case .circle(let c, let radius) = item.shape {
                return Path(ellipseIn: CGRect(x: c.x - radius - 3, y: c.y - radius - 3, width: (radius + 3) * 2, height: (radius + 3) * 2))
            }
            if case .box(_, let radius) = item.shape {
                return Path(roundedRect: r.insetBy(dx: -3, dy: -3), cornerRadius: radius + 3, style: .continuous)
            }
            return path
        }()
        g.stroke(ring, with: .color(Theme.ink.opacity(0.92)), lineWidth: 2)
    }

    private static func drawLine(_ path: Path, _ item: DItem, _ t: Double, start: (CGPoint, CGPoint), end: (CGPoint, CGPoint), _ ctx: inout GraphicsContext) {
        let tone = item.stroke ?? .muted
        let color = strokeColor(tone)
        var g = ctx
        if item.glow, case .accent(let c) = tone { g.addFilter(.shadow(color: palette(c).opacity(0.5), radius: 5)) }
        let style = StrokeStyle(lineWidth: item.lineWidth, lineCap: .round, lineJoin: .round, dash: item.dashed || item.pending ? [4, 3] : [])
        g.stroke(t < 1 ? path.trimmedPath(from: 0, to: t) : path, with: .color(color), style: style)
        guard t > 0.8 else { return }
        var h = ctx
        h.opacity *= (t - 0.8) / 0.2
        let size = 6 + item.lineWidth * 1.2
        if item.arrow { h.fill(arrowhead(from: end.0, to: end.1, size: size), with: .color(color)) }
        if item.arrowStart { h.fill(arrowhead(from: start.0, to: start.1, size: size), with: .color(color)) }
    }

    /// Slightly concave arrowhead pointing from `a` to `tip`.
    static func arrowhead(from a: CGPoint, to tip: CGPoint, size: CGFloat) -> Path {
        let angle = atan2(tip.y - a.y, tip.x - a.x)
        let spread = CGFloat.pi / 7.5
        let left = CGPoint(x: tip.x - size * cos(angle - spread), y: tip.y - size * sin(angle - spread))
        let right = CGPoint(x: tip.x - size * cos(angle + spread), y: tip.y - size * sin(angle + spread))
        let notch = CGPoint(x: tip.x - size * 0.62 * cos(angle), y: tip.y - size * 0.62 * sin(angle))
        var p = Path()
        p.move(to: tip)
        p.addLine(to: left)
        p.addLine(to: notch)
        p.addLine(to: right)
        p.closeSubpath()
        return p
    }
}

/// Faint dot grid on a slightly deeper panel — the "graph paper" the diagram is drawn on.
private struct Paper: View {
    var body: some View {
        Canvas { ctx, size in
            ctx.fill(Path(CGRect(origin: .zero, size: size)),
                     with: .linearGradient(Gradient(colors: [Theme.paperTop, Theme.paperBottom]),
                                           startPoint: .zero, endPoint: CGPoint(x: 0, y: size.height)))
            let step: CGFloat = 14
            var y: CGFloat = step / 2
            while y < size.height {
                var x: CGFloat = step / 2
                while x < size.width {
                    ctx.fill(Path(ellipseIn: CGRect(x: x - 0.6, y: y - 0.6, width: 1.2, height: 1.2)), with: .color(Theme.ink.opacity(0.065)))
                    x += step
                }
                y += step
            }
        }
    }
}

extension DItem.Shape {
    /// Interpolates toward `b` (same kind and point count); otherwise jumps to `b`. Text content switches
    /// to the target immediately while its position glides.
    func lerp(to b: DItem.Shape, _ t: CGFloat) -> DItem.Shape {
        func p(_ a: CGPoint, _ c: CGPoint) -> CGPoint { CGPoint(x: a.x + (c.x - a.x) * t, y: a.y + (c.y - a.y) * t) }
        func r(_ a: CGRect, _ c: CGRect) -> CGRect {
            CGRect(x: a.minX + (c.minX - a.minX) * t, y: a.minY + (c.minY - a.minY) * t,
                   width: a.width + (c.width - a.width) * t, height: a.height + (c.height - a.height) * t)
        }
        func f(_ a: CGFloat, _ c: CGFloat) -> CGFloat { a + (c - a) * t }
        switch (self, b) {
        case (.box(let r1, let a), .box(let r2, let c)): return .box(r(r1, r2), radius: f(a, c))
        case (.circle(let c1, let a), .circle(let c2, let c)): return .circle(center: p(c1, c2), radius: f(a, c))
        case (.polyline(let x), .polyline(let y)) where x.count == y.count: return .polyline(zip(x, y).map(p))
        case (.polygon(let x), .polygon(let y)) where x.count == y.count: return .polygon(zip(x, y).map(p))
        case (.curve(let a1, let c1, let b1), .curve(let a2, let c2, let b2)): return .curve(from: p(a1, a2), control: p(c1, c2), to: p(b1, b2))
        case (.cubic(let a1, let c1, let d1, let b1), .cubic(let a2, let c2, let d2, let b2)):
            return .cubic(from: p(a1, a2), c1: p(c1, c2), c2: p(d1, d2), to: p(b1, b2))
        case (.text(_, let a1, let n1), .text(let s, let a2, let n2)): return .text(s, at: p(a1, a2), anchor: p(n1, n2))
        case (.textBlock(_, let r1), .textBlock(let s, let r2)): return .textBlock(s, r(r1, r2))
        case (.dot(let c1, let a), .dot(let c2, let c)): return .dot(p(c1, c2), f(a, c))
        default: return b
        }
    }
}
