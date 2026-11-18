import AppKit
import SwiftUI

/// Renders streamed Markdown answers with overlay-tuned typography.
struct MarkdownView: View {
    let text: String
    var scale: CGFloat = 1
    var streaming = false

    var body: some View {
        let blocks = MarkdownParser.parse(text)
        VStack(alignment: .leading, spacing: 10 * scale) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { index, block in
                BlockView(block: block, scale: scale, isFirst: index == 0)
            }
            if streaming { StreamingCaret().padding(.top, -4) }
        }
        .textSelection(.enabled)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct BlockView: View {
    let block: MDBlock
    let scale: CGFloat
    let isFirst: Bool
    @Environment(\.alfredContentWidth) private var contentWidth

    private var body15: Font { .alfred(Theme.answerSize * scale, .regular) }

    private func inline(_ text: String, size: CGFloat = Theme.answerSize) -> AttributedString {
        MarkdownStyle.inline(text, size: size * scale)
    }

    var body: some View {
        switch block {
        case .heading(let level, let text):
            Text(inline(text, size: level <= 2 ? 14.5 : 13.5))
                .font(.alfred((level <= 2 ? 14.5 : 13.5) * scale, .semibold))
                .foregroundStyle(Theme.primaryText)
                .padding(.top, isFirst ? 0 : 4 * scale)
        case .paragraph(let text):
            Text(inline(text))
                .font(body15)
                .foregroundStyle(Theme.primaryText)
                .lineSpacing(5 * scale)
                .fixedSize(horizontal: false, vertical: true)
        case .bullet(let items):
            VStack(alignment: .leading, spacing: 6 * scale) {
                ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                    HStack(alignment: .firstTextBaseline, spacing: 8 * scale) {
                        Text("•")
                            .font(.alfred(13 * scale, .bold))
                            .foregroundStyle(Theme.dim)
                        Text(inline(item))
                            .font(body15).foregroundStyle(Theme.text)
                            .lineSpacing(5 * scale)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        case .numbered(let start, let items):
            VStack(alignment: .leading, spacing: 6 * scale) {
                ForEach(Array(items.enumerated()), id: \.offset) { offset, item in
                    HStack(alignment: .firstTextBaseline, spacing: 7 * scale) {
                        Text("\(start + offset).")
                            .font(.alfredMono(13 * scale, .semibold))
                            .foregroundStyle(Theme.accent)
                        Text(inline(item))
                            .font(body15).foregroundStyle(Theme.text)
                            .lineSpacing(5 * scale)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        case .code(let language, let code, let closed):
            CodeBlockView(language: language, code: code, scale: scale, complete: closed)
        case .diagram(let source, let closed):
            DiagramView(source: source, complete: closed, maxWidth: contentWidth)
                .padding(.vertical, 2)
        case .quote(let text):
            HStack(spacing: 10) {
                RoundedRectangle(cornerRadius: 1).fill(Theme.accent.opacity(0.7)).frame(width: 2.5)
                Text(inline(text)).font(body15.italic()).foregroundStyle(Theme.secondaryText)
            }
        case .rule:
            Rectangle().fill(Theme.hairline).frame(height: 1).padding(.vertical, 2)
        case .table(let header, let alignments, let rows):
            MarkdownTable(header: header, alignments: alignments, rows: rows, scale: scale)
        case .generativeUI(let source, let closed):
            GenUIView(source: source, complete: closed, maxWidth: contentWidth, scale: scale)
                .padding(.vertical, 2)
        }
    }
}

enum MarkdownStyle {
    /// Inline Markdown mapped onto real faces: **bold** → semibold, *italic* → italic, `code` → SF Mono on a subtle chip.
    static func inline(_ text: String, size px: CGFloat) -> AttributedString {
        var a = MarkdownParser.inline(text)
        for run in a.runs {
            guard let intent = run.inlinePresentationIntent else { continue }
            if intent.contains(.code) {
                a[run.range].font = .alfredMono(px - 0.5, .medium)
                a[run.range].foregroundColor = Theme.inlineCode
                a[run.range].backgroundColor = Theme.ink.opacity(0.08)
            } else if intent.contains(.stronglyEmphasized) && intent.contains(.emphasized) {
                a[run.range].font = .alfred(px, .semibold).italic()
            } else if intent.contains(.stronglyEmphasized) {
                a[run.range].font = .alfred(px, .semibold)
                a[run.range].foregroundColor = Theme.ink
            } else if intent.contains(.emphasized) {
                a[run.range].font = .alfred(px).italic()
            }
        }
        return a
    }
}

/// A pipe table: header band, hairline rows, per-column alignment, scrolls sideways when wide.
struct MarkdownTable: View {
    let header: [String]
    let alignments: [MDAlign]
    let rows: [[String]]
    var scale: CGFloat = 1

    private func align(_ c: Int) -> HorizontalAlignment {
        switch alignments.indices.contains(c) ? alignments[c] : .leading {
        case .leading: .leading
        case .center: .center
        case .trailing: .trailing
        }
    }

    private func frameAlign(_ c: Int) -> Alignment {
        switch alignments.indices.contains(c) ? alignments[c] : .leading {
        case .leading: .leading
        case .center: .center
        case .trailing: .trailing
        }
    }

    var body: some View {
        // Lay out in place when it fits the column; scroll sideways only when it's genuinely wider.
        ViewThatFits(in: .horizontal) {
            grid
            ScrollView(.horizontal, showsIndicators: false) { grid.fixedSize(horizontal: true, vertical: false) }
        }
        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Theme.ink.opacity(0.03)))
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 0.5))
    }

    private var grid: some View {
            Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
                GridRow {
                    ForEach(header.indices, id: \.self) { c in
                        Text(MarkdownStyle.inline(header[c], size: 12 * scale))
                            .font(.alfred(12 * scale, .semibold))
                            .foregroundStyle(Theme.secondaryText)
                            .frame(maxWidth: .infinity, alignment: frameAlign(c))
                            .padding(.horizontal, 10).padding(.vertical, 7)
                            .gridColumnAlignment(align(c))
                    }
                }
                .background(Theme.ink.opacity(0.06))
                ForEach(rows.indices, id: \.self) { r in
                    Divider().overlay(Theme.hairline).gridCellUnsizedAxes(.horizontal)
                    GridRow {
                        ForEach(rows[r].indices, id: \.self) { c in
                            Text(MarkdownStyle.inline(rows[r][c], size: 13 * scale))
                                .font(.alfred(13 * scale))
                                .foregroundStyle(Theme.text)
                                .fixedSize(horizontal: false, vertical: true)
                                .frame(maxWidth: .infinity, alignment: frameAlign(c))
                                .padding(.horizontal, 10).padding(.vertical, 6)
                        }
                    }
                }
            }
    }
}

struct CodeBlockView: View {
    let language: String
    let code: String
    let scale: CGFloat
    let complete: Bool
    @State private var copied = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(language.isEmpty ? "code" : language.lowercased())
                    .font(.alfredMono(12, .medium))
                    .foregroundStyle(Theme.tertiaryText)
                Spacer()
                Button {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(code, forType: .string)
                    withAnimation(Theme.snappy) { copied = true }
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.4) { withAnimation { copied = false } }
                } label: {
                    Label(copied ? "Copied" : "Copy", systemImage: copied ? "checkmark" : "doc.on.doc")
                        .font(.alfred(12, .medium))
                        .foregroundStyle(copied ? Theme.me : Theme.secondaryText)
                        .contentTransition(.symbolEffect(.replace))
                }
                .buttonStyle(GhostButtonStyle(padding: .init(top: 3, leading: 6, bottom: 3, trailing: 6), radius: 6))
                .disabled(!complete)
                .opacity(complete ? 1 : 0.4)
            }
            .padding(.leading, 12).padding(.trailing, 6).padding(.vertical, 5)
            Rectangle().fill(Theme.hairline).frame(height: 0.5)
            // In place when it fits; sideways scrolling only for genuinely long lines.
            ViewThatFits(in: .horizontal) {
                codeText.frame(maxWidth: .infinity, alignment: .leading)
                ScrollView(.horizontal, showsIndicators: false) { codeText }
            }
        }
        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Theme.codeBackground))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 0.5))
    }

    private var codeText: some View {
        Text(SyntaxHighlighter.highlight(code))
            .font(.alfredMono(12.5 * scale))
            .lineSpacing(2.5 * scale)
            .fixedSize()
            .padding(12)
    }
}

private struct StreamingCaret: View {
    @State private var on = false
    var body: some View {
        RoundedRectangle(cornerRadius: 1.5)
            .fill(Theme.accent)
            .frame(width: 7, height: 15)
            .opacity(on ? 1 : 0.15)
            .animation(.easeInOut(duration: 0.55).repeatForever(), value: on)
            .onAppear { on = true }
    }
}
