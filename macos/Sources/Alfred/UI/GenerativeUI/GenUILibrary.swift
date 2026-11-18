import Foundation

/// The component library: names, positional props and descriptions. It maps a call's args onto props
/// for the renderer and generates the model's instructions from the same definitions, so the prompt can never
/// drift from what the renderer understands.
struct GenUILibrary {
    struct Prop {
        let name: String
        let type: String
        let optional: Bool
    }

    struct Component {
        let name: String
        let props: [Prop]
        let description: String
        var aliases: [String] = []

        var signature: String {
            let params = props.map { "\($0.name)\($0.optional ? "?" : ""): \($0.type)" }.joined(separator: ", ")
            return "\(name)(\(params)) — \(description)"
        }
    }

    let groups: [(title: String, components: [Component])]
    private let byName: [String: Component]

    init(groups: [(title: String, components: [Component])]) {
        self.groups = groups
        var map: [String: Component] = [:]
        for c in groups.flatMap(\.components) {
            map[c.name] = c
            for a in c.aliases { map[a] = c }
        }
        byName = map
    }

    func spec(_ name: String) -> Component? { byName[name] }

    /// Maps positional args onto prop names. A single `{…}` object argument is accepted as named props
    /// too. Unknown components keep their args (the renderer shows whatever content they carry).
    func node(_ name: String, _ args: [GenUIValue]) -> GenUINode {
        guard let c = byName[name] else { return GenUINode(name: name, args: args, props: [:]) }
        var props: [String: GenUIValue] = [:]
        if args.count == 1, case .object(let o) = args[0], c.props.first?.type.hasPrefix("{") != true,
           o.keys.contains(where: { k in c.props.contains { $0.name == k } }) {
            props = o
        } else {
            for (p, v) in zip(c.props, args) where !v.isNull { props[p.name] = v }
        }
        return GenUINode(name: c.name, args: args, props: props)
    }

    /// One line per component, grouped — the "Components" section of the prompt.
    var promptCatalog: String {
        groups.map { g in
            "\(g.title):\n" + g.components.map { "  " + $0.signature }.joined(separator: "\n")
        }.joined(separator: "\n")
    }
}

extension GenUILibrary {
    private typealias C = Component
    private typealias P = Prop

    private static let gap = "\"none\" | \"xs\" | \"s\" | \"m\" | \"l\" | \"xl\""
    private static let tone = "\"neutral\" | \"info\" | \"success\" | \"warning\" | \"danger\""
    private static let axes: [Prop] = [
        P(name: "variant", type: "\"grouped\" | \"stacked\"", optional: true),
        P(name: "xLabel", type: "string", optional: true),
        P(name: "yLabel", type: "string", optional: true),
    ]

    /// Alfred's library: layout, text, data, and chart components that make sense in a read-only answer.
    static let alfred = GenUILibrary(groups: [
        ("Layout", [
            C(name: "Stack", props: [P(name: "children", type: "any[]", optional: false),
                                    P(name: "direction", type: "\"column\" | \"row\"", optional: true),
                                    P(name: "gap", type: gap, optional: true)],
              description: "Vertical (default) or horizontal group; rows wrap their children into equal columns",
              aliases: ["VStack", "Column", "Row", "HStack"]),
            C(name: "Card", props: [P(name: "children", type: "any[]", optional: false),
                                   P(name: "variant", type: "\"card\" | \"sunk\" | \"clear\"", optional: true)],
              description: "Bordered surface grouping related content", aliases: ["Section", "Panel"]),
            C(name: "Grid", props: [P(name: "children", type: "any[]", optional: false),
                                   P(name: "columns", type: "number", optional: true)],
              description: "Equal-width grid (default 2 columns) — metric tiles, option cards"),
            C(name: "Tabs", props: [P(name: "items", type: "TabItem[]", optional: false)],
              description: "Switchable panels — alternatives the user flips between (approach A vs B, languages)"),
            C(name: "TabItem", props: [P(name: "value", type: "string", optional: false),
                                      P(name: "trigger", type: "string", optional: false),
                                      P(name: "content", type: "any[]", optional: false)],
              description: "One tab: id, label, content"),
            C(name: "Accordion", props: [P(name: "items", type: "AccordionItem[]", optional: false)],
              description: "Collapsible sections for detail the user may want (edge cases, deeper dives)"),
            C(name: "AccordionItem", props: [P(name: "title", type: "string", optional: false),
                                            P(name: "content", type: "any[]", optional: false),
                                            P(name: "open", type: "boolean", optional: true)],
              description: "One collapsible section"),
            C(name: "Separator", props: [], description: "Thin divider", aliases: ["Divider"]),
        ]),
        ("Text", [
            C(name: "CardHeader", props: [P(name: "title", type: "string", optional: false),
                                         P(name: "subtitle", type: "string", optional: true)],
              description: "Title with optional subtitle", aliases: ["Header", "InlineHeader", "Title"]),
            C(name: "TextContent", props: [P(name: "text", type: "string", optional: false),
                                          P(name: "size", type: "\"small\" | \"default\" | \"large\" | \"small-heavy\" | \"large-heavy\"", optional: true)],
              description: "Text with inline Markdown (**bold**, `code`)", aliases: ["Text", "Paragraph"]),
            C(name: "Markdown", props: [P(name: "text", type: "string", optional: false)],
              description: "Block Markdown: lists, code fences, tables", aliases: ["MarkDownRenderer"]),
            C(name: "Callout", props: [P(name: "variant", type: "\"info\" | \"warning\" | \"error\" | \"success\" | \"neutral\"", optional: false),
                                      P(name: "title", type: "string", optional: false),
                                      P(name: "description", type: "string", optional: true)],
              description: "Highlighted note — key insight, pitfall, warning", aliases: ["TextCallout", "Alert", "Note"]),
            C(name: "List", props: [P(name: "items", type: "string[]", optional: false),
                                   P(name: "ordered", type: "boolean", optional: true)],
              description: "Bulleted or numbered list (items allow inline Markdown)", aliases: ["ListBlock", "BulletList"]),
            C(name: "CodeBlock", props: [P(name: "language", type: "string", optional: false),
                                        P(name: "codeString", type: "string", optional: false)],
              description: "Syntax-highlighted code with a copy button", aliases: ["Code"]),
            C(name: "Tag", props: [P(name: "text", type: "string", optional: false),
                                  P(name: "variant", type: tone, optional: true)],
              description: "Small pill label (also usable as a table cell)", aliases: ["Badge", "Chip"]),
            C(name: "TagBlock", props: [P(name: "tags", type: "(string | Tag)[]", optional: false)],
              description: "Row of tags", aliases: ["Tags", "Chips"]),
        ]),
        ("Data", [
            C(name: "Table", props: [P(name: "columns", type: "Col[]", optional: false)],
              description: "Column-oriented table: Table([Col(\"Name\", names), Col(\"Time\", times)])", aliases: ["DataTable"]),
            C(name: "Col", props: [P(name: "label", type: "string", optional: false),
                                  P(name: "data", type: "any[]", optional: false),
                                  P(name: "type", type: "\"string\" | \"number\"", optional: true)],
              description: "One table column: header and one value per row (strings, numbers or Tags)", aliases: ["Column"]),
            C(name: "KeyValue", props: [P(name: "pairs", type: "[string, any][]", optional: false)],
              description: "Two-column label → value list (specs, assumptions, estimates)", aliases: ["Properties", "Facts"]),
            C(name: "Metric", props: [P(name: "label", type: "string", optional: false),
                                     P(name: "value", type: "string | number", optional: false),
                                     P(name: "subtext", type: "string", optional: true),
                                     P(name: "trend", type: "\"up\" | \"down\" | \"flat\"", optional: true)],
              description: "Big-number tile (QPS, storage, latency, complexity)", aliases: ["Stat", "KPI", "MetricIndicator"]),
            C(name: "Progress", props: [P(name: "label", type: "string", optional: false),
                                       P(name: "value", type: "number", optional: false),
                                       P(name: "max", type: "number", optional: true)],
              description: "Labeled bar for a share or score (value out of max, default 100)", aliases: ["ProgressBar", "Meter"]),
            C(name: "Compare", props: [P(name: "left", type: "Option", optional: false),
                                      P(name: "right", type: "Option", optional: false)],
              description: "Side-by-side trade-off of two options", aliases: ["Comparison", "VersusBlock"]),
            C(name: "Option", props: [P(name: "title", type: "string", optional: false),
                                     P(name: "pros", type: "string[]", optional: true),
                                     P(name: "cons", type: "string[]", optional: true),
                                     P(name: "verdict", type: "string", optional: true)],
              description: "One option: pros, cons, when to pick it", aliases: ["ProsCons", "OptionCard"]),
        ]),
        ("Charts", [
            C(name: "BarChart", props: [P(name: "labels", type: "string[]", optional: false),
                                       P(name: "series", type: "Series[]", optional: false)] + axes,
              description: "Vertical bars; compare values across categories"),
            C(name: "HorizontalBarChart", props: [P(name: "labels", type: "string[]", optional: false),
                                                 P(name: "series", type: "Series[]", optional: false)] + axes,
              description: "Horizontal bars; long labels or ranked lists"),
            C(name: "LineChart", props: [P(name: "labels", type: "string[]", optional: false),
                                        P(name: "series", type: "Series[]", optional: false)] + axes,
              description: "Lines over ordered categories; trends, growth (e.g. O(n) vs O(n log n))"),
            C(name: "AreaChart", props: [P(name: "labels", type: "string[]", optional: false),
                                        P(name: "series", type: "Series[]", optional: false)] + axes,
              description: "Filled lines; volume over time, cumulative totals"),
            C(name: "Series", props: [P(name: "category", type: "string", optional: false),
                                     P(name: "values", type: "number[]", optional: false)],
              description: "One named series, one value per label"),
            C(name: "PieChart", props: [P(name: "labels", type: "string[]", optional: false),
                                       P(name: "values", type: "number[]", optional: false),
                                       P(name: "variant", type: "\"pie\" | \"donut\"", optional: true)],
              description: "Shares of a whole (≤ 7 slices)", aliases: ["DonutChart"]),
            C(name: "ScatterChart", props: [P(name: "datasets", type: "ScatterSeries[]", optional: false),
                                           P(name: "xLabel", type: "string", optional: true),
                                           P(name: "yLabel", type: "string", optional: true)],
              description: "X/Y points; correlation, clusters, distributions"),
            C(name: "ScatterSeries", props: [P(name: "name", type: "string", optional: false),
                                            P(name: "points", type: "Point[]", optional: false)],
              description: "Named point set"),
            C(name: "Point", props: [P(name: "x", type: "number", optional: false),
                                    P(name: "y", type: "number", optional: false),
                                    P(name: "label", type: "string", optional: true)],
              description: "One x/y point"),
        ]),
        ("Process", [
            C(name: "Steps", props: [P(name: "items", type: "StepsItem[]", optional: false)],
              description: "Numbered sequence — algorithm phases, request flow, rollout plan", aliases: ["Timeline", "Stepper"]),
            C(name: "StepsItem", props: [P(name: "title", type: "string", optional: false),
                                        P(name: "details", type: "string", optional: true)],
              description: "One step (details allow inline Markdown)", aliases: ["Step", "TimelineItem"]),
            C(name: "Diagram", props: [P(name: "source", type: "string", optional: false)],
              description: "Embed a Alfred data-structure diagram (the ```diagram language) inside this layout"),
        ]),
    ])

    /// The prompt section teaching the language and this library.
    static var promptGuide: String {
        """
        RICH UI (```ui blocks, rendered natively and live as you stream)
        Reach for it whenever the answer has structure a glance should catch — it usually replaces bullets that
        would say the same thing, so don't repeat its content in prose:
          estimates / sizing → Metric tiles or KeyValue · trade-offs → Compare or Table · growth, scaling, trends →
          LineChart/BarChart · shares → PieChart · processes, rollouts, request flow → Steps · alternatives → Tabs ·
          pitfalls → Callout.
        Plain prose + bullets stays best for simple facts and behavioral answers. Mix freely with prose, code and
        ```diagram (data-structure state). One or more blocks, wherever they read best — your call.
        Language: one statement per line, `name = expression`; the first line is `root = …`. Components take
        positional args in the order listed (null skips an optional one). Names can be used before they're defined.
        Values: "strings", numbers, true/false/null, [arrays], {objects}; data.field plucks a field from every item.
        Use real, correct numbers; label units.
        \(alfred.promptCatalog)
        Examples (short on purpose — fit the visual to the question):
        X vs Y →
        ```ui
        root = Table([Col("", ["Delivery", "Ordering", "Use for"]), Col("TCP", [Tag("reliable", "success"), "in order", "web, APIs"]), Col("UDP", [Tag("best effort", "warning"), "none", "video, games"])])
        ```
        growth / scaling →
        ```ui
        root = LineChart(["10", "100", "1k", "10k"], [Series("n log n", [33, 664, 9966, 132877]), Series("n²", [100, 10000, 1000000, 100000000])], null, "n", "operations")
        ```
        estimate →
        ```ui
        root = Stack([Grid([Metric("Uploads/day", "720k hours"), Metric("Raw storage", "≈ 1 PB/day", "at ~1.5 GB/hour")]), KeyValue([["Assumption", "500 hours uploaded per minute"], ["Replication", "×3 → ≈ 3 PB/day"]])])
        ```
        """
    }
}
