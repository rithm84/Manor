import Charts
import SwiftUI

/// Renders a ```ui block natively as it streams. Renderer principles:
///  - incremental parsing (`GenUIStreamParser`): finished statements are parsed once, only the tail re-parses;
///  - no placeholders: things that haven't arrived yet are simply absent, never skeletons or holes;
///  - stable identity: each node is keyed by the statement that produced it, and node views are Equatable,
///    so a chunk that doesn't touch a node doesn't rebuild it — new nodes fade in, existing ones stay put;
///  - forgiving: unknown components still show the content they carry.
struct GenUIView: View {
    let source: String
    let complete: Bool
    var maxWidth: CGFloat
    var scale: CGFloat = 1

    @State private var stream = GenUIStreamParser()

    var body: some View {
        let program = stream.update(source, complete: complete)
        var evaluator = GenUIEvaluator(program)
        let root = evaluator.root()
        Group {
            if let root {
                GenUIValueView(value: root, scale: scale)
                    .frame(maxWidth: maxWidth, alignment: .leading)
                    .environment(\.alfredContentWidth, maxWidth)
            }
        }
        .animation(.easeOut(duration: 0.22), value: root)
    }
}

/// Any value in a component position: a node, an array of them, or plain text.
struct GenUIValueView: View, Equatable {
    let value: GenUIValue
    var scale: CGFloat = 1

    var body: some View {
        switch value {
        case .node(let n):
            GenUINodeView(node: n, scale: scale).equatable()
        case .array(let items):
            VStack(alignment: .leading, spacing: 10 * scale) {
                ForEach(Array(items.enumerated()), id: \.offset) { _, v in GenUIValueView(value: v, scale: scale).equatable() }
            }
        case .null, .object:
            EmptyView()
        default:
            GenUIText(text: value.text, size: 13.5 * scale)
        }
    }
}

/// Inline-Markdown text in Alfred's faces.
struct GenUIText: View {
    let text: String
    var size: CGFloat = 13.5
    var weight: Font.Weight = .regular
    var color: Color = Theme.text

    var body: some View {
        Text(MarkdownStyle.inline(text, size: size))
            .font(.alfred(size, weight))
            .foregroundStyle(color)
            .lineSpacing(size * 0.3)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// One component. Equatable on the evaluated node, so unchanged subtrees skip re-rendering while streaming.
struct GenUINodeView: View, Equatable {
    let node: GenUINode
    var scale: CGFloat = 1
    @Environment(\.alfredContentWidth) private var contentWidth

    static func == (a: Self, b: Self) -> Bool { a.node == b.node && a.scale == b.scale }

    private var s: CGFloat { scale }

    var body: some View {
        content
            .transition(.opacity.combined(with: .offset(y: 3)))
    }

    @ViewBuilder private var content: some View {
        switch node.name {
        // Layout
        case "Stack": stack
        case "Card": card
        case "Grid": grid
        case "Tabs": GenUITabs(items: node.array("items").compactMap(\.node), scale: s)
        case "Accordion": accordion
        case "Separator": Rectangle().fill(Theme.hairline).frame(height: 1).padding(.vertical, 2)
        // Text
        case "CardHeader":
            VStack(alignment: .leading, spacing: 2) {
                GenUIText(text: node.string("title") ?? "", size: 14.5 * s, weight: .semibold, color: Theme.ink)
                if let sub = node.string("subtitle") { GenUIText(text: sub, size: 12 * s, color: Theme.dim) }
            }
        case "TextContent": textContent
        case "Markdown": MarkdownView(text: node.string("text") ?? "", scale: s)
        case "Callout": callout
        case "List": list
        case "CodeBlock":
            CodeBlockView(language: node.string("language") ?? "", code: node.string("codeString") ?? "", scale: s, complete: true)
        case "Tag": GenUITag(text: node.string("text") ?? "", variant: node.string("variant"), scale: s)
        case "TagBlock": tagBlock
        // Data
        case "Table": GenUITable(columns: node.array("columns").compactMap(\.node), scale: s)
        case "KeyValue": keyValue
        case "Metric": metric
        case "Progress": progress
        case "Compare": compare
        case "Option": option(node)
        // Charts
        case "BarChart", "HorizontalBarChart", "LineChart", "AreaChart":
            GenUISeriesChart(node: node, scale: s)
        case "PieChart": GenUIPieChart(node: node, scale: s)
        case "ScatterChart": GenUIScatterChart(node: node, scale: s)
        // Process
        case "Steps": steps
        case "Diagram":
            DiagramView(source: node.string("source") ?? "", complete: true, maxWidth: contentWidth)
        // Pieces that only make sense inside a parent render as nothing on their own.
        case "Series", "Col", "TabItem", "AccordionItem", "StepsItem", "ScatterSeries", "Point":
            EmptyView()
        default:
            fallback
        }
    }

    // MARK: Layout

    private func gap(_ name: String?) -> CGFloat {
        switch name {
        case "none": 0
        case "xs": 4
        case "s": 8
        case "l": 18
        case "xl": 24
        default: 12
        }
    }

    @ViewBuilder private var stack: some View {
        let children = node.array("children")
        let g = gap(node.string("gap")) * s
        if node.string("direction") == "row" {
            HStack(alignment: .top, spacing: g) {
                ForEach(Array(children.enumerated()), id: \.offset) { _, c in
                    GenUIValueView(value: c, scale: s).equatable().frame(maxWidth: .infinity, alignment: .topLeading)
                }
            }
        } else {
            VStack(alignment: .leading, spacing: g) {
                ForEach(Array(children.enumerated()), id: \.offset) { _, c in GenUIValueView(value: c, scale: s).equatable() }
            }
        }
    }

    private var card: some View {
        let variant = node.string("variant") ?? "card"
        return VStack(alignment: .leading, spacing: 10 * s) {
            ForEach(Array(node.array("children").enumerated()), id: \.offset) { _, c in GenUIValueView(value: c, scale: s).equatable() }
        }
        .padding(variant == "clear" ? 0 : 14 * s)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            if variant != "clear" {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(Theme.ink.opacity(variant == "sunk" ? 0.025 : 0.045))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 0.5))
            }
        }
    }

    private var grid: some View {
        let n = max(1, min(4, Int(node.number("columns") ?? 2)))
        return LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10 * s, alignment: .top), count: n),
                         alignment: .leading, spacing: 10 * s) {
            ForEach(Array(node.array("children").enumerated()), id: \.offset) { _, c in GenUIValueView(value: c, scale: s).equatable() }
        }
    }

    private var accordion: some View {
        VStack(alignment: .leading, spacing: 6 * s) {
            ForEach(Array(node.array("items").compactMap(\.node).enumerated()), id: \.offset) { _, item in
                GenUIDisclosure(item: item, scale: s)
            }
        }
    }

    // MARK: Text

    private var textContent: some View {
        let size = node.string("size") ?? "default"
        let px: CGFloat = size.hasPrefix("large") ? 15 : (size.hasPrefix("small") ? 12 : 13.5)
        let heavy = size.hasSuffix("heavy")
        return GenUIText(text: node.string("text") ?? "", size: px * s, weight: heavy ? .semibold : .regular,
                      color: heavy ? Theme.ink : (size.hasPrefix("small") ? Theme.secondaryText : Theme.text))
    }

    private var callout: some View {
        let variant = node.string("variant") ?? "info"
        let tint = GenUIPalette.tone(variant)
        let icon = ["warning": "exclamationmark.triangle.fill", "error": "xmark.octagon.fill", "danger": "xmark.octagon.fill",
                    "success": "checkmark.seal.fill", "neutral": "text.bubble.fill"][variant] ?? "lightbulb.fill"
        return HStack(alignment: .top, spacing: 10 * s) {
            Image(systemName: icon).font(.system(size: 12 * s, weight: .semibold)).foregroundStyle(tint).padding(.top, 2)
            VStack(alignment: .leading, spacing: 3 * s) {
                GenUIText(text: node.string("title") ?? "", size: 13 * s, weight: .semibold, color: Theme.ink)
                if let d = node.string("description") { GenUIText(text: d, size: 12.5 * s, color: Theme.text) }
            }
        }
        .padding(12 * s)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(tint.opacity(0.10)))
        .overlay(alignment: .leading) {
            RoundedRectangle(cornerRadius: 1.5).fill(tint.opacity(0.85)).frame(width: 3).padding(.vertical, 8)
        }
    }

    private var list: some View {
        let ordered = node["ordered"].truthy
        return VStack(alignment: .leading, spacing: 5 * s) {
            ForEach(Array(node.array("items").enumerated()), id: \.offset) { k, item in
                HStack(alignment: .firstTextBaseline, spacing: 8 * s) {
                    Text(ordered ? "\(k + 1)." : "•")
                        .font(ordered ? .alfredMono(12.5 * s, .semibold) : .alfred(13 * s, .bold))
                        .foregroundStyle(ordered ? Theme.accent : Theme.dim)
                    if let n = item.node { GenUINodeView(node: n, scale: s).equatable() } else { GenUIText(text: item.text, size: 13.5 * s) }
                }
            }
        }
    }

    private var tagBlock: some View {
        GenUIFlow(spacing: 6 * s) {
            ForEach(Array(node.array("tags").enumerated()), id: \.offset) { _, t in
                if let n = t.node { GenUINodeView(node: n, scale: s).equatable() } else { GenUITag(text: t.text, variant: nil, scale: s) }
            }
        }
    }

    // MARK: Data

    private var keyValue: some View {
        let pairs = node.array("pairs").compactMap { p -> (String, GenUIValue)? in
            if case .array(let kv) = p, kv.count >= 2 { return (kv[0].text, kv[1]) }
            if case .object(let o) = p, o.count == 1, let (k, v) = o.first { return (k, v) }
            return nil
        }
        return Grid(alignment: .leading, horizontalSpacing: 14 * s, verticalSpacing: 6 * s) {
            ForEach(Array(pairs.enumerated()), id: \.offset) { _, kv in
                GridRow {
                    Text(MarkdownStyle.inline(kv.0, size: 12.5 * s)).font(.alfred(12.5 * s)).foregroundStyle(Theme.dim)
                    if let n = kv.1.node { GenUINodeView(node: n, scale: s).equatable() }
                    else { GenUIText(text: kv.1.text, size: 13 * s, weight: .medium, color: Theme.ink) }
                }
            }
        }
    }

    private var metric: some View {
        let trend = node.string("trend") ?? node["trend"].object?["direction"]?.string
        let tint: Color = trend == "up" ? GenUIPalette.tone("success") : (trend == "down" ? GenUIPalette.tone("danger") : Theme.dim)
        return VStack(alignment: .leading, spacing: 3 * s) {
            Text(node.string("label") ?? "").font(.alfred(12 * s, .medium)).foregroundStyle(Theme.dim)
            HStack(alignment: .firstTextBaseline, spacing: 6 * s) {
                Text(node["value"].text).font(.alfred(20 * s, .semibold)).foregroundStyle(Theme.ink)
                    .contentTransition(.numericText())
                if let trend, trend != "flat" {
                    Image(systemName: trend == "up" ? "arrow.up.right" : "arrow.down.right")
                        .font(.system(size: 11 * s, weight: .bold)).foregroundStyle(tint)
                }
            }
            if let sub = node.string("subtext") { Text(MarkdownStyle.inline(sub, size: 12 * s)).font(.alfred(12 * s)).foregroundStyle(Theme.secondaryText) }
        }
        .padding(12 * s)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Theme.ink.opacity(0.045)))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 0.5))
    }

    private var progress: some View {
        let value = node.number("value") ?? 0, maxV = max(node.number("max") ?? 100, 0.0001)
        let f = min(1, max(0, value / maxV))
        return VStack(alignment: .leading, spacing: 4 * s) {
            HStack {
                Text(node.string("label") ?? "").font(.alfred(12.5 * s)).foregroundStyle(Theme.text)
                Spacer()
                Text(GenUIValue.format(value) + (node.number("max") == nil ? "%" : " / " + GenUIValue.format(maxV)))
                    .font(.alfredMono(12 * s, .medium)).foregroundStyle(Theme.dim)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Theme.ink.opacity(0.08))
                    Capsule().fill(GenUIPalette.series[0]).frame(width: geo.size.width * f)
                }
            }
            .frame(height: 6 * s)
        }
    }

    private var compare: some View {
        HStack(alignment: .top, spacing: 10 * s) {
            ForEach(["left", "right"], id: \.self) { side in
                if let n = node[side].node { option(n).frame(maxWidth: .infinity, alignment: .topLeading) }
            }
        }
    }

    private func option(_ n: GenUINode) -> some View {
        VStack(alignment: .leading, spacing: 6 * s) {
            GenUIText(text: n.string("title") ?? "", size: 13.5 * s, weight: .semibold, color: Theme.ink)
            ForEach(Array(n.array("pros").enumerated()), id: \.offset) { _, p in mark("plus.circle.fill", GenUIPalette.tone("success"), p.text) }
            ForEach(Array(n.array("cons").enumerated()), id: \.offset) { _, c in mark("minus.circle.fill", GenUIPalette.tone("danger"), c.text) }
            if let v = n.string("verdict") { GenUIText(text: v, size: 12 * s, color: Theme.secondaryText).padding(.top, 2) }
        }
        .padding(12 * s)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Theme.ink.opacity(0.045)))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 0.5))
    }

    private func mark(_ symbol: String, _ tint: Color, _ text: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 6 * s) {
            Image(systemName: symbol).font(.system(size: 10 * s)).foregroundStyle(tint)
            GenUIText(text: text, size: 12.5 * s)
        }
    }

    // MARK: Process

    private var steps: some View {
        let items = node.array("items")
        return VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(items.enumerated()), id: \.offset) { k, item in
                HStack(alignment: .top, spacing: 10 * s) {
                    VStack(spacing: 0) {
                        Text("\(k + 1)")
                            .font(.alfredMono(12 * s, .semibold)).foregroundStyle(Theme.ink)
                            .frame(width: 20 * s, height: 20 * s)
                            .background(Circle().fill(Theme.accent.opacity(0.85)))
                        if k < items.count - 1 { Rectangle().fill(Theme.hairline).frame(width: 1.5).frame(maxHeight: .infinity) }
                    }
                    VStack(alignment: .leading, spacing: 2 * s) {
                        let n = item.node
                        GenUIText(text: n?.string("title") ?? item.text, size: 13 * s, weight: .semibold, color: Theme.ink)
                        if let d = n?.string("details") { GenUIText(text: d, size: 12.5 * s, color: Theme.text) }
                    }
                    .padding(.bottom, k < items.count - 1 ? 12 * s : 0)
                }
            }
        }
    }

    // MARK: Fallback

    /// Unknown component: show its text args as a heading line and render any nested content, so a new or
    /// misspelled name degrades into readable content instead of disappearing.
    private var fallback: some View {
        VStack(alignment: .leading, spacing: 8 * s) {
            let texts = node.args.compactMap { $0.string }.filter { !$0.isEmpty }
            if !texts.isEmpty { GenUIText(text: texts.joined(separator: " · "), size: 13.5 * s) }
            ForEach(Array(node.args.enumerated()), id: \.offset) { _, a in
                switch a {
                case .node, .array: GenUIValueView(value: a, scale: s).equatable()
                default: EmptyView()
                }
            }
        }
    }
}

extension GenUIValue {
    var object: [String: GenUIValue]? { if case .object(let o) = self { o } else { nil } }
}

// MARK: - Pieces with state

private struct GenUITabs: View {
    let items: [GenUINode]
    let scale: CGFloat
    @State private var selected = 0

    var body: some View {
        let s = scale
        VStack(alignment: .leading, spacing: 10 * s) {
            HStack(spacing: 4 * s) {
                ForEach(Array(items.enumerated()), id: \.offset) { k, item in
                    Button { withAnimation(Theme.snappy) { selected = k } } label: {
                        Text(item.string("trigger") ?? item.string("value") ?? "Tab \(k + 1)")
                            .font(.alfred(12 * s, .medium))
                            .foregroundStyle(k == selected ? Theme.ink : Theme.dim)
                            .padding(.horizontal, 10 * s).padding(.vertical, 5 * s)
                            .background(Capsule().fill(Theme.ink.opacity(k == selected ? 0.12 : 0)))
                            .contentShape(Capsule())
                    }
                    .buttonStyle(.plain)
                }
            }
            if items.indices.contains(selected) {
                VStack(alignment: .leading, spacing: 10 * s) {
                    ForEach(Array(items[selected].array("content").enumerated()), id: \.offset) { _, c in
                        GenUIValueView(value: c, scale: s).equatable()
                    }
                }
                .id(selected)
                .transition(.opacity)
            }
        }
    }
}

private struct GenUIDisclosure: View {
    let item: GenUINode
    let scale: CGFloat
    @State private var open: Bool?

    var body: some View {
        let s = scale
        let isOpen = open ?? item["open"].truthy
        VStack(alignment: .leading, spacing: 8 * s) {
            Button { withAnimation(Theme.snappy) { open = !isOpen } } label: {
                HStack(spacing: 6 * s) {
                    Image(systemName: "chevron.right").font(.system(size: 9 * s, weight: .bold)).foregroundStyle(Theme.dim)
                        .rotationEffect(.degrees(isOpen ? 90 : 0))
                    Text(MarkdownStyle.inline(item.string("title") ?? "", size: 13 * s)).font(.alfred(13 * s, .medium)).foregroundStyle(Theme.ink)
                    Spacer()
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if isOpen {
                VStack(alignment: .leading, spacing: 8 * s) {
                    ForEach(Array(item.array("content").enumerated()), id: \.offset) { _, c in GenUIValueView(value: c, scale: s).equatable() }
                }
                .padding(.leading, 15 * s)
                .transition(.opacity)
            }
        }
    }
}

// MARK: - Table

private struct GenUITable: View {
    let columns: [GenUINode]
    let scale: CGFloat

    var body: some View {
        let s = scale
        let data = columns.map { $0.array("data") }
        let rowCount = data.map(\.count).max() ?? 0
        let numeric = columns.enumerated().map { k, c in
            c.string("type") == "number" || (!data[k].isEmpty && data[k].allSatisfy { if case .number = $0 { true } else { $0 == .null } })
        }
        let grid = Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
                GridRow {
                    ForEach(columns.indices, id: \.self) { k in
                        Text(MarkdownStyle.inline(columns[k].string("label") ?? "", size: 12 * s))
                            .font(.alfred(12 * s, .semibold)).foregroundStyle(Theme.secondaryText)
                            .frame(maxWidth: .infinity, alignment: numeric[k] ? .trailing : .leading)
                            .padding(.horizontal, 10 * s).padding(.vertical, 7 * s)
                    }
                }
                .background(Theme.ink.opacity(0.06))
                ForEach(0..<rowCount, id: \.self) { r in
                    Divider().overlay(Theme.hairline).gridCellUnsizedAxes(.horizontal)
                    GridRow {
                        ForEach(columns.indices, id: \.self) { k in
                            let v = r < data[k].count ? data[k][r] : .null
                            Group {
                                if let n = v.node { GenUINodeView(node: n, scale: s).equatable() }
                                else {
                                    Text(MarkdownStyle.inline(v.text, size: 13 * s))
                                        .font(numeric[k] ? .alfredMono(12.5 * s) : .alfred(13 * s))
                                        .foregroundStyle(Theme.text)
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                            }
                            .frame(maxWidth: .infinity, alignment: numeric[k] ? .trailing : .leading)
                            .padding(.horizontal, 10 * s).padding(.vertical, 6 * s)
                        }
                    }
                    .transition(.opacity)
                }
            }
        ViewThatFits(in: .horizontal) {
            grid
            ScrollView(.horizontal, showsIndicators: false) { grid.fixedSize(horizontal: true, vertical: false) }
        }
        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Theme.ink.opacity(0.03)))
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 0.5))
    }
}

// MARK: - Small views

struct GenUITag: View {
    let text: String
    let variant: String?
    var scale: CGFloat = 1

    var body: some View {
        let tint = variant.map(GenUIPalette.tone) ?? Theme.dim
        Text(text)
            .font(.alfred(12 * scale, .medium))
            .foregroundStyle(variant == nil || variant == "neutral" ? Theme.text : tint)
            .padding(.horizontal, 8 * scale).padding(.vertical, 2.5 * scale)
            .background(Capsule().fill(tint.opacity(0.16)))
            .fixedSize()
    }
}

/// Wrapping row (tags).
struct GenUIFlow: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, row: CGFloat = 0, maxX: CGFloat = 0
        for v in subviews {
            let size = v.sizeThatFits(.unspecified)
            if x > 0 && x + size.width > width { x = 0; y += row + spacing; row = 0 }
            x += size.width + spacing
            row = max(row, size.height)
            maxX = max(maxX, x - spacing)
        }
        return CGSize(width: min(maxX, width), height: y + row)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, row: CGFloat = 0
        for v in subviews {
            let size = v.sizeThatFits(.unspecified)
            if x > bounds.minX && x + size.width > bounds.maxX { x = bounds.minX; y += row + spacing; row = 0 }
            v.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            row = max(row, size.height)
        }
    }
}

enum GenUIPalette {
    static let series: [Color] = [DColor.blue, .green, .orange, .purple, .teal, .pink, .yellow, .red].map(DiagramPainter.palette)

    static func tone(_ name: String) -> Color {
        switch name {
        case "success": DiagramPainter.palette(.green)
        case "warning": DiagramPainter.palette(.orange)
        case "error", "danger": DiagramPainter.palette(.red)
        case "info": DiagramPainter.palette(.blue)
        default: Theme.icon
        }
    }
}

// MARK: - Charts (Swift Charts)

private struct GenUIChartFrame<Content: View>: View {
    let scale: CGFloat
    let xLabel: String?
    let yLabel: String?
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 4 * scale) {
            if let yLabel { Text(yLabel).font(.alfred(12 * scale)).foregroundStyle(Theme.dim) }
            content
                .frame(height: 190 * scale)
                .chartLegend(position: .bottom, alignment: .leading)
            if let xLabel { Text(xLabel).font(.alfred(12 * scale)).foregroundStyle(Theme.dim).frame(maxWidth: .infinity) }
        }
        .padding(12 * scale)
        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Theme.ink.opacity(0.03)))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 0.5))
    }
}

private struct GenUIAxisStyle: ViewModifier {
    let scale: CGFloat
    func body(content: Content) -> some View {
        content
            .chartXAxis {
                AxisMarks { _ in
                    AxisGridLine().foregroundStyle(Theme.ink.opacity(0.06))
                    AxisValueLabel().font(.alfredMono(12 * scale)).foregroundStyle(Theme.ink.opacity(0.55))
                }
            }
            .chartYAxis {
                AxisMarks { _ in
                    AxisGridLine().foregroundStyle(Theme.ink.opacity(0.06))
                    AxisValueLabel().font(.alfredMono(12 * scale)).foregroundStyle(Theme.ink.opacity(0.55))
                }
            }
    }
}

private struct GenUIPoint: Identifiable {
    let id: String
    let label: String
    let series: String
    let value: Double
    let order: Int
}

private struct GenUISeriesChart: View {
    let node: GenUINode
    let scale: CGFloat

    var body: some View {
        let labels = node.array("labels").map(\.text)
        let series = node.array("series").compactMap(\.node)
        let names = series.map { $0.string("category") ?? "Series" }
        let points: [GenUIPoint] = series.enumerated().flatMap { k, sr in
            sr.array("values").enumerated().compactMap { i, v -> GenUIPoint? in
                guard i < labels.count, let n = v.number else { return nil }
                return GenUIPoint(id: "\(k)-\(i)", label: labels[i], series: names[k], value: n, order: i)
            }
        }
        let stacked = node.string("variant") == "stacked"
        let showLegend = series.count > 1
        GenUIChartFrame(scale: scale, xLabel: node.string("xLabel"), yLabel: node.string("yLabel")) {
            Chart(points) { p in
                switch node.name {
                case "HorizontalBarChart":
                    BarMark(x: .value("Value", p.value), y: .value("Label", p.label))
                        .foregroundStyle(by: .value("Series", p.series))
                        .position(by: .value("Series", stacked ? "" : p.series))
                        .cornerRadius(3)
                case "LineChart":
                    LineMark(x: .value("Label", p.label), y: .value("Value", p.value))
                        .foregroundStyle(by: .value("Series", p.series))
                        .interpolationMethod(.monotone)
                        .lineStyle(StrokeStyle(lineWidth: 2))
                    PointMark(x: .value("Label", p.label), y: .value("Value", p.value))
                        .foregroundStyle(by: .value("Series", p.series))
                        .symbolSize(18)
                case "AreaChart":
                    AreaMark(x: .value("Label", p.label), y: .value("Value", p.value), stacking: stacked ? .standard : .unstacked)
                        .foregroundStyle(by: .value("Series", p.series))
                        .opacity(0.45)
                        .interpolationMethod(.monotone)
                default:
                    BarMark(x: .value("Label", p.label), y: .value("Value", p.value))
                        .foregroundStyle(by: .value("Series", p.series))
                        .position(by: .value("Series", stacked ? "" : p.series))
                        .cornerRadius(3)
                }
            }
            .chartXScale(domain: node.name == "HorizontalBarChart" ? .automatic : .automatic)
            .chartForegroundStyleScale(domain: names, range: Array(GenUIPalette.series.prefix(max(1, names.count))))
            .chartLegend(showLegend ? .visible : .hidden)
            .modifier(GenUIAxisStyle(scale: scale))
        }
    }
}

private struct GenUIPieChart: View {
    let node: GenUINode
    let scale: CGFloat

    var body: some View {
        let labels = node.array("labels").map(\.text)
        let values = node.array("values").compactMap(\.number)
        let slices = zip(labels, values).enumerated().map { k, lv in GenUIPoint(id: "\(k)", label: lv.0, series: lv.0, value: lv.1, order: k) }
        let donut = node.string("variant") == "donut"
        GenUIChartFrame(scale: scale, xLabel: nil, yLabel: nil) {
            Chart(slices) { p in
                SectorMark(angle: .value("Value", p.value), innerRadius: .ratio(donut ? 0.58 : 0), angularInset: 1.2)
                    .foregroundStyle(by: .value("Label", p.label))
                    .cornerRadius(3)
            }
            .chartForegroundStyleScale(domain: slices.map(\.label), range: Array(GenUIPalette.series.prefix(max(1, slices.count))))
            .chartLegend(position: .trailing, alignment: .center)
        }
    }
}

private struct GenUIScatterChart: View {
    let node: GenUINode
    let scale: CGFloat

    private struct XY: Identifiable { let id: String; let series: String; let x: Double; let y: Double }

    var body: some View {
        let sets = node.array("datasets").compactMap(\.node)
        let names = sets.map { $0.string("name") ?? "Points" }
        let pts: [XY] = sets.enumerated().flatMap { k, ds in
            ds.array("points").enumerated().compactMap { i, p -> XY? in
                if let n = p.node, let x = n.number("x"), let y = n.number("y") { return XY(id: "\(k)-\(i)", series: names[k], x: x, y: y) }
                if case .array(let a) = p, a.count >= 2, let x = a[0].number, let y = a[1].number { return XY(id: "\(k)-\(i)", series: names[k], x: x, y: y) }
                return nil
            }
        }
        GenUIChartFrame(scale: scale, xLabel: node.string("xLabel"), yLabel: node.string("yLabel")) {
            Chart(pts) { p in
                PointMark(x: .value("X", p.x), y: .value("Y", p.y))
                    .foregroundStyle(by: .value("Series", p.series))
                    .symbolSize(30)
            }
            .chartForegroundStyleScale(domain: names, range: Array(GenUIPalette.series.prefix(max(1, names.count))))
            .chartLegend(names.count > 1 ? .visible : .hidden)
            .modifier(GenUIAxisStyle(scale: scale))
        }
    }
}
