import AppKit
import SwiftUI

/// Renders a list of Markdown blocks with document rhythm: paragraphs and lists keep a steady gap, headings
/// carry extra space above them, and nested content indents under its marker.
struct MarkdownBlocksView: View {
  let blocks: [RenderedMarkdown.Block]
  let size: CGFloat
  var depth = 0
  /// Inside a tight list item, a nested list sits close under its line.
  var tight = false

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      ForEach(Array(blocks.enumerated()), id: \.offset) { index, block in
        MarkdownBlockView(block: block, size: size, depth: depth)
          .padding(.top, index == 0 ? 0 : spacing(before: block))
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private func spacing(before block: RenderedMarkdown.Block) -> CGFloat {
    if tight, case .list = block { return size * 0.3 }
    switch block {
    case .heading(let level, _): return level <= 2 ? size * 1.5 : size * 1.1
    case .rule: return size
    default: return size * 0.75
    }
  }
}

struct MarkdownBlockView: View {
  let block: RenderedMarkdown.Block
  let size: CGFloat
  let depth: Int

  var body: some View {
    switch block {
    case .heading(_, let text):
      Text(text)
        .lineSpacing(2)
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityAddTraits(.isHeader)
    case .paragraph(let text):
      Text(text)
        .lineSpacing(size * 0.32)
        .fixedSize(horizontal: false, vertical: true)
    case .image(let url, let alt):
      MarkdownImageBlock(url: url, alt: alt, size: size)
    case .code(let language, let code):
      MarkdownCodeBlock(language: language, code: code, size: size)
    case .math(let tex):
      MarkdownMathBlock(tex: tex, size: size)
    case .quote(let blocks):
      HStack(alignment: .top, spacing: Space.s3) {
        RoundedRectangle(cornerRadius: 1.5).fill(Palette.hairlineStrong).frame(width: 3)
        MarkdownBlocksView(blocks: blocks, size: size, depth: depth)
          .foregroundStyle(Palette.inkMuted)
      }
      .fixedSize(horizontal: false, vertical: true)
    case .list(let ordered, let start, let tight, let items):
      MarkdownListBlock(ordered: ordered, start: start, tight: tight, items: items, size: size, depth: depth)
    case .table(let header, let rows, let alignments):
      MarkdownTableBlock(header: header, rows: rows, alignments: alignments, size: size)
    case .rule:
      Hairline().padding(.vertical, Space.s1)
    }
  }
}

// MARK: Lists

struct MarkdownListBlock: View {
  let ordered: Bool
  let start: Int
  let tight: Bool
  let items: [RenderedMarkdown.ListItem]
  let size: CGFloat
  let depth: Int

  var body: some View {
    let digits = String(start + items.count - 1).count
    VStack(alignment: .leading, spacing: tight ? size * 0.3 : size * 0.6) {
      ForEach(Array(items.enumerated()), id: \.offset) { index, item in
        HStack(alignment: .firstTextBaseline, spacing: Space.s2) {
          marker(index: index, item: item)
            .frame(minWidth: ordered ? CGFloat(digits) * size * 0.62 + 6 : size * 0.9, alignment: .trailing)
          MarkdownBlocksView(blocks: item.blocks, size: size, depth: depth + 1, tight: tight)
            .opacity(item.checkbox == true ? 0.62 : 1)
        }
      }
    }
    .padding(.leading, Space.s1)
  }

  @ViewBuilder
  private func marker(index: Int, item: RenderedMarkdown.ListItem) -> some View {
    if let checked = item.checkbox {
      Text(Image(systemName: checked ? "checkmark.square.fill" : "square"))
        .font(.system(size: size * 0.95, weight: .regular))
        .foregroundStyle(checked ? Palette.primary : Palette.controlBorder)
        .accessibilityLabel(checked ? "Done" : "Not done")
    } else if ordered {
      Text("\(start + index).")
        .font(.ui(size))
        .foregroundStyle(Palette.inkMuted)
        .monospacedDigit()
    } else {
      Text(["•", "◦", "▪"][depth % 3])
        .font(.ui(size, weight: .semibold))
        .foregroundStyle(Palette.inkMuted)
    }
  }
}

// MARK: Code

struct MarkdownCodeBlock: View {
  let language: String?
  let code: String
  let size: CGFloat
  @State private var hovering = false
  @State private var copied = false

  var body: some View {
    let codeSize = max(Typography.Size.xs, size * 0.87)
    ZStack(alignment: .topTrailing) {
      let text = Text(MarkdownCodeHighlighter.highlight(code, language: language, size: codeSize))
        .lineSpacing(3)
        .fixedSize(horizontal: true, vertical: true)
        .padding(.horizontal, Space.s4)
        .padding(.vertical, Space.s3)
        .padding(.top, language == nil ? 0 : Space.s3)
      // Short lines sit in place; long lines scroll sideways instead of wrapping code.
      ViewThatFits(in: .horizontal) {
        text.frame(maxWidth: .infinity, alignment: .leading)
        ScrollView(.horizontal, showsIndicators: false) { text }
      }
      HStack(spacing: Space.s2) {
        if let language {
          Text(language).font(.ui(Typography.Size.xs, weight: .medium)).foregroundStyle(Palette.inkMuted)
        }
        if hovering || copied {
          Button {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(code, forType: .string)
            copied = true
            Task { try? await Task.sleep(for: .seconds(1.4)); copied = false }
          } label: {
            Image(systemName: copied ? "checkmark" : "doc.on.doc")
              .font(.system(size: 11, weight: .medium))
              .foregroundStyle(copied ? Palette.completion : Palette.inkMuted)
              .frame(width: 22, height: 22)
              .contentShape(Rectangle())
          }
          .buttonStyle(.plain)
          .help("Copy code")
          .accessibilityLabel("Copy code")
          .transition(.opacity)
        }
      }
      .padding(.horizontal, Space.s2)
      .padding(.top, Space.s1)
    }
    .background(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).fill(Palette.surfacePaper))
    .overlay(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).strokeBorder(Palette.hairline, lineWidth: 1))
    .onHover { hovering = $0 }
    .animation(Motion.fast, value: hovering)
  }
}

// MARK: Math

struct MarkdownMathBlock: View {
  let tex: String
  let size: CGFloat

  var body: some View {
    Text(MarkdownMath.render(tex))
      .font(.system(size: size + 2, design: .serif).italic())
      .foregroundStyle(Palette.ink)
      .multilineTextAlignment(.center)
      .fixedSize(horizontal: false, vertical: true)
      .frame(maxWidth: .infinity)
      .padding(.vertical, Space.s2)
      .help(tex)
      .contextMenu {
        Button("Copy TeX") {
          NSPasteboard.general.clearContents()
          NSPasteboard.general.setString(tex, forType: .string)
        }
      }
  }
}

// MARK: Tables

struct MarkdownTableBlock: View {
  let header: [AttributedString]
  let rows: [[AttributedString]]
  let alignments: [HorizontalAlignment]
  let size: CGFloat

  var body: some View {
    ViewThatFits(in: .horizontal) {
      grid(wrapping: false)
      ScrollView(.horizontal, showsIndicators: true) { grid(wrapping: false) }
    }
    .background(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).fill(Palette.surfaceCanvas))
    .clipShape(RoundedRectangle(cornerRadius: Radius.control, style: .continuous))
    .overlay(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).strokeBorder(Palette.hairline, lineWidth: 1))
  }

  private var columns: Int { max(header.count, rows.map(\.count).max() ?? 0) }

  private func grid(wrapping: Bool) -> some View {
    Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
      GridRow {
        ForEach(0..<columns, id: \.self) { column in
          cell(column < header.count ? header[column] : AttributedString(), column: column)
            .background(Palette.surfacePaper)
        }
      }
      ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
        Rectangle().fill(Palette.hairline).frame(height: 1).gridCellUnsizedAxes(.horizontal)
        GridRow {
          ForEach(0..<columns, id: \.self) { column in
            cell(column < row.count ? row[column] : AttributedString(), column: column)
          }
        }
      }
    }
    .fixedSize(horizontal: true, vertical: true)
  }

  private func cell(_ text: AttributedString, column: Int) -> some View {
    let alignment = column < alignments.count ? alignments[column] : .leading
    return Text(text)
      .font(.ui(size - 1))
      .multilineTextAlignment(alignment == .trailing ? .trailing : alignment == .center ? .center : .leading)
      .frame(maxWidth: .infinity, alignment: Alignment(horizontal: alignment, vertical: .center))
      .padding(.horizontal, Space.s3)
      .padding(.vertical, Space.s2)
      .monospacedDigit()
  }
}

// MARK: Images

/// A remote image loaded off the main thread, shown at its natural size up to the column width.
struct MarkdownImageBlock: View {
  let url: URL?
  let alt: String
  let size: CGFloat
  @State private var image: NSImage?
  @State private var failed = false
  @Environment(\.openURL) private var openURL

  var body: some View {
    Group {
      if let image {
        Image(nsImage: image)
          .resizable()
          .interpolation(.high)
          .aspectRatio(image.size, contentMode: .fit)
          .frame(maxWidth: max(1, image.size.width), alignment: .leading)
          .clipShape(RoundedRectangle(cornerRadius: Radius.control, style: .continuous))
          .onTapGesture { if let url { openURL(url) } }
          .help(alt.isEmpty ? (url?.absoluteString ?? "") : alt)
          .accessibilityLabel(alt.isEmpty ? "Image" : alt)
      } else if failed || !Self.loadable(url) {
        Label(alt.isEmpty ? "Image unavailable" : alt, systemImage: "photo")
          .font(.ui(Typography.Size.sm))
          .foregroundStyle(Palette.inkMuted)
          .padding(.horizontal, Space.s3)
          .frame(minHeight: 36)
          .background(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).fill(Palette.surfacePaper))
      } else {
        RoundedRectangle(cornerRadius: Radius.control, style: .continuous)
          .fill(Palette.surfacePaper)
          .frame(maxWidth: 360)
          .frame(height: 120)
          .overlay(ProgressView().controlSize(.small))
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .task(id: url) { await load() }
  }

  static func loadable(_ url: URL?) -> Bool {
    guard let scheme = url?.scheme?.lowercased() else { return false }
    return scheme == "https" || scheme == "http"
  }

  private func load() async {
    guard let url, Self.loadable(url) else { return }
    if let cached = MarkdownImageBlockCache.shared.object(forKey: url as NSURL) {
      image = cached
      return
    }
    do {
      let (data, response) = try await URLSession.shared.data(from: url)
      if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) { failed = true; return }
      guard let loaded = NSImage(data: data) else { failed = true; return }
      MarkdownImageBlockCache.shared.setObject(loaded, forKey: url as NSURL, cost: data.count)
      image = loaded
    } catch {
      if !Task.isCancelled { failed = true }
    }
  }
}

enum MarkdownImageBlockCache {
  nonisolated(unsafe) static let shared: NSCache<NSURL, NSImage> = {
    let cache = NSCache<NSURL, NSImage>()
    cache.totalCostLimit = 64 * 1024 * 1024
    return cache
  }()
}
