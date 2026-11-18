import SwiftUI

// Views other parts of Manor embed (the Notes editor's `/alfred` blocks). They render on a normal document
// background in light and dark: colors follow the surrounding appearance, while the notch card stays dark.

/// A ```diagram block in Alfred's diagram language: a single picture, or a step-through with Back, Next, and
/// Play controls when the source has `step` lines. Sizes itself to its content within `width` (wider diagrams
/// scroll sideways rather than shrinking past readability).
public struct AlfredDiagramView: View {
    let source: String
    let width: CGFloat
    let isComplete: Bool
    let animated: Bool

    /// - Parameters:
    ///   - source: the block's contents, without the fences. A still-streaming source renders what has arrived.
    ///   - width: the column the diagram lays out in.
    ///   - isComplete: false while streaming, so a half-written last line is held back.
    ///   - animated: draws each new shape in as it appears; pass false for saved content.
    public init(source: String, width: CGFloat, isComplete: Bool = true, animated: Bool = false) {
        self.source = source
        self.width = width
        self.isComplete = isComplete
        self.animated = animated
    }

    public var body: some View {
        DiagramView(source: source, complete: isComplete, maxWidth: width)
            .environment(\.diagramAnimation, animated)
            .environment(\.alfredContentWidth, width)
            .frame(width: width, alignment: .leading)
    }
}

/// A ```ui block of generative UI (charts, tables, metrics, steps, tabs, callouts), rendered natively. While the
/// source streams, finished statements stay put and new parts fade in. Sizes itself to its content within `width`.
public struct AlfredGenerativeView: View {
    let source: String
    let width: CGFloat
    let isComplete: Bool
    let scale: CGFloat

    /// - Parameters:
    ///   - source: the block's contents, without the fences.
    ///   - width: the column it lays out in.
    ///   - isComplete: false while streaming.
    ///   - scale: text scale (1 is 13 pt body text).
    public init(source: String, width: CGFloat, isComplete: Bool = true, scale: CGFloat = 1) {
        self.source = source
        self.width = width
        self.isComplete = isComplete
        self.scale = scale
    }

    public var body: some View {
        GenUIView(source: source, complete: isComplete, maxWidth: width, scale: scale)
            .environment(\.diagramAnimation, false)
            .frame(width: width, alignment: .leading)
    }
}

/// Fence languages the writer emits, for editors that split a streamed answer into blocks.
public enum AlfredBlockLanguage {
    /// ```diagram blocks: render with `AlfredDiagramView`.
    public static let diagram: Set<String> = ["diagram", "alfred", "dsviz"]
    /// ```ui blocks: render with `AlfredGenerativeView`.
    public static let generativeUI: Set<String> = ["ui", "genui"]
}

/// A whole Alfred block's `source` (Markdown with ```diagram and ```ui fences), rendered the way the overlay
/// renders answers: prose, lists, tables, and highlighted code, with diagrams and generative UI inline.
public struct AlfredContentView: View {
    let source: String
    let width: CGFloat
    let isComplete: Bool
    let scale: CGFloat
    let animated: Bool

    public init(source: String, width: CGFloat, isComplete: Bool = true, scale: CGFloat = 1, animated: Bool = false) {
        self.source = source
        self.width = width
        self.isComplete = isComplete
        self.scale = scale
        self.animated = animated
    }

    public var body: some View {
        MarkdownView(text: source, scale: scale, streaming: !isComplete)
            .environment(\.diagramAnimation, animated)
            .environment(\.alfredContentWidth, width)
            .frame(width: width, alignment: .leading)
    }
}

/// Splits Alfred's output into the parts an editor stores or renders separately.
public enum AlfredContent {
    public enum Segment: Equatable, Sendable {
        /// Prose and ordinary Markdown (including code fences in other languages).
        case markdown(String)
        /// A ```diagram block's contents; `isComplete` is false while its closing fence hasn't arrived.
        case diagram(source: String, isComplete: Bool)
        /// A ```ui block's contents.
        case generativeUI(source: String, isComplete: Bool)
    }

    /// The parts of `source` in order. Works on a still-streaming source: an unclosed visual block comes back
    /// with `isComplete == false`.
    public static func segments(of source: String) -> [Segment] {
        var segments: [Segment] = []
        var prose: [String] = []
        var visual: (kind: String, lines: [String])?
        var inOtherFence = false

        func flushProse() {
            let text = prose.joined(separator: "\n").trimmingCharacters(in: .newlines)
            if !text.trimmingCharacters(in: .whitespaces).isEmpty { segments.append(.markdown(text)) }
            prose = []
        }

        for line in source.components(separatedBy: "\n") {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if let open = visual {
                if trimmed.hasPrefix("```") {
                    let body = open.lines.joined(separator: "\n")
                    segments.append(open.kind == "diagram" ? .diagram(source: body, isComplete: true) : .generativeUI(source: body, isComplete: true))
                    visual = nil
                } else {
                    visual?.lines.append(line)
                }
                continue
            }
            if trimmed.hasPrefix("```") {
                if inOtherFence {
                    inOtherFence = false
                } else {
                    let language = trimmed.dropFirst(3).trimmingCharacters(in: .whitespaces).lowercased()
                    if AlfredBlockLanguage.diagram.contains(language) || AlfredBlockLanguage.generativeUI.contains(language) {
                        flushProse()
                        visual = (AlfredBlockLanguage.diagram.contains(language) ? "diagram" : "ui", [])
                        continue
                    }
                    inOtherFence = true
                }
            }
            prose.append(line)
        }
        if let open = visual {
            let body = open.lines.joined(separator: "\n")
            segments.append(open.kind == "diagram" ? .diagram(source: body, isComplete: false) : .generativeUI(source: body, isComplete: false))
        } else {
            flushProse()
        }
        return segments
    }

    /// The prose of `source` with diagram and generative-UI blocks left out, for search and plain-text export.
    public static func plainText(of source: String) -> String {
        segments(of: source).compactMap { if case .markdown(let text) = $0 { text } else { nil } }.joined(separator: "\n\n")
    }
}
