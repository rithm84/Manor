import Foundation
import Markdown
import SwiftUI

/// A parsed Markdown document as Manor renders it: blocks with their inline text already styled. Parsing is
/// cached by source and size, so re-rendering a view costs a dictionary lookup.
struct RenderedMarkdown {
  indirect enum Block {
    case heading(level: Int, text: AttributedString)
    case paragraph(AttributedString)
    case image(url: URL?, alt: String)
    case code(language: String?, code: String)
    case math(tex: String)
    case quote([Block])
    case list(ordered: Bool, start: Int, tight: Bool, items: [ListItem])
    case table(header: [AttributedString], rows: [[AttributedString]], alignments: [HorizontalAlignment])
    case rule
  }

  struct ListItem {
    var checkbox: Bool?
    var blocks: [Block]
  }

  let blocks: [Block]

  // MARK: Cache

  @MainActor private static var cache: [String: RenderedMarkdown] = [:]
  @MainActor private static var order: [String] = []

  @MainActor static func parsed(_ source: String, size: CGFloat) -> RenderedMarkdown {
    let key = "\(size)\u{1}\(source)"
    if let hit = cache[key] { return hit }
    let document = RenderedMarkdown(source: source, size: size)
    cache[key] = document
    order.append(key)
    if order.count > 64 { cache[order.removeFirst()] = nil }
    return document
  }

  init(source: String, size: CGFloat) {
    let prepared = MarkdownMathPreprocessor.process(source)
    let document = Document(parsing: prepared, options: [.disableSmartOpts])
    let builder = Builder(size: size)
    blocks = builder.blocks(document.children)
  }

  // MARK: Building

  private struct Builder {
    let size: CGFloat

    func blocks(_ children: some Sequence<Markup>) -> [Block] {
      children.flatMap { block($0) }
    }

    func block(_ markup: Markup) -> [Block] {
      switch markup {
      case let heading as Heading:
        return [.heading(level: heading.level, text: inline(heading.children, style: MarkdownInlineStyle(heading: heading.level)))]
      case let paragraph as Paragraph:
        return paragraphBlocks(paragraph)
      case let code as CodeBlock:
        let language = code.language?.trimmingCharacters(in: .whitespaces).lowercased()
        let body = code.code.hasSuffix("\n") ? String(code.code.dropLast()) : code.code
        if language == "math" { return [.math(tex: body)] }
        return [.code(language: language?.isEmpty == false ? language : nil, code: body)]
      case let quote as BlockQuote:
        return [.quote(blocks(quote.children))]
      case let list as OrderedList:
        return [.list(ordered: true, start: Int(list.startIndex), tight: isTight(list), items: items(list.listItems))]
      case let list as UnorderedList:
        return [.list(ordered: false, start: 1, tight: isTight(list), items: items(list.listItems))]
      case let table as Markdown.Table:
        let header = Array(table.head.cells.map { inline($0.children, style: MarkdownInlineStyle(bold: true)) })
        let rows = Array(table.body.rows.map { row in Array(row.cells.map { inline($0.children, style: MarkdownInlineStyle()) }) })
        let alignments: [HorizontalAlignment] = table.columnAlignments.map {
          switch $0 {
          case .some(.center): return .center
          case .some(.right): return .trailing
          default: return .leading
          }
        }
        return [.table(header: header, rows: rows, alignments: alignments)]
      case is ThematicBreak:
        return [.rule]
      case let html as HTMLBlock:
        let text = Self.plainHTML(html.rawHTML)
        return text.isEmpty ? [] : [.paragraph(styled(text, style: MarkdownInlineStyle()))]
      default:
        let nested = blocks(markup.children)
        if !nested.isEmpty { return nested }
        let text = markup.format().trimmingCharacters(in: .whitespacesAndNewlines)
        return text.isEmpty ? [] : [.paragraph(styled(text, style: MarkdownInlineStyle()))]
      }
    }

    private func isTight(_ list: ListItemContainer) -> Bool {
      list.listItems.allSatisfy { item in item.children.filter { $0 is Paragraph }.count <= 1 }
    }

    private func items(_ items: some Sequence<Markdown.ListItem>) -> [ListItem] {
      items.map { item in
        let checkbox: Bool? = item.checkbox.map { $0 == .checked }
        return ListItem(checkbox: checkbox, blocks: blocks(item.children))
      }
    }

    /// A paragraph's text, with its images lifted out as their own blocks after it.
    private func paragraphBlocks(_ paragraph: Paragraph) -> [Block] {
      var images: [Block] = []
      collectImages(paragraph, into: &images)
      let text = inline(paragraph.children, style: MarkdownInlineStyle())
      let hasText = !String(text.characters).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      return (hasText ? [.paragraph(text)] : []) + images
    }

    private func collectImages(_ markup: Markup, into images: inout [Block]) {
      for child in markup.children {
        if let image = child as? Markdown.Image {
          let alt = image.plainText
          images.append(.image(url: image.source.flatMap { URL(string: $0) }, alt: alt))
        } else {
          collectImages(child, into: &images)
        }
      }
    }

    // MARK: Inline text

    func inline(_ children: some Sequence<Markup>, style: MarkdownInlineStyle) -> AttributedString {
      var result = AttributedString()
      for child in children { result += inline(child, style: style) }
      return result
    }

    func inline(_ markup: any Markup, style: MarkdownInlineStyle) -> AttributedString {
      switch markup {
      case let text as Markdown.Text:
        return styled(text.string, style: style)
      case let emphasis as Emphasis:
        var next = style
        next.italic = true
        return inline(emphasis.children, style: next)
      case let strong as Strong:
        var next = style
        next.bold = true
        return inline(strong.children, style: next)
      case let strike as Strikethrough:
        var next = style
        next.strike = true
        return inline(strike.children, style: next)
      case let code as InlineCode:
        if code.code.first == MarkdownMathPreprocessor.marker {
          var next = style
          next.math = true
          return styled(MarkdownMath.render(String(code.code.dropFirst())), style: next)
        }
        var next = style
        next.code = true
        return styled(code.code, style: next)
      case let link as Markdown.Link:
        var next = style
        if let destination = link.destination, let url = URL(string: destination), url.scheme != nil { next.link = url }
        let label = inline(link.children, style: next)
        return label.characters.isEmpty ? styled(link.destination ?? "", style: next) : label
      case is Markdown.Image:
        return AttributedString()
      case is SoftBreak:
        return styled(" ", style: style)
      case is LineBreak:
        return styled("\n", style: style)
      case let html as InlineHTML:
        let raw = html.rawHTML.lowercased()
        if raw.hasPrefix("<br") { return styled("\n", style: style) }
        return AttributedString()
      case let symbol as SymbolLink:
        var next = style
        next.code = true
        return styled(symbol.destination ?? "", style: next)
      default:
        return inline(markup.children, style: style)
      }
    }

    func styled(_ text: String, style: MarkdownInlineStyle) -> AttributedString {
      var run = AttributedString(text)
      run.font = style.font(size: size)
      run.foregroundColor = style.code ? Palette.ink : style.link != nil ? Palette.link : (style.heading > 0 ? Palette.ink : (style.math ? Palette.ink : Palette.inkBody))
      if style.code { run.backgroundColor = Palette.surfaceSoft }
      if style.strike { run.strikethroughStyle = SwiftUI.Text.LineStyle.single }
      if let link = style.link {
        run.link = link
        run.underlineStyle = SwiftUI.Text.LineStyle(pattern: .solid, color: Palette.link.opacity(0.35))
      }
      return run
    }

    static func plainHTML(_ raw: String) -> String {
      var text = raw.replacingOccurrences(of: "<!--[\\s\\S]*?-->", with: "", options: .regularExpression)
      text = text.replacingOccurrences(of: "<br\\s*/?>", with: "\n", options: [.regularExpression, .caseInsensitive])
      text = text.replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression)
      return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }
  }
}

/// The formatting active at one point of inline text.
struct MarkdownInlineStyle {
  var bold = false
  var italic = false
  var strike = false
  var code = false
  var math = false
  var link: URL?
  /// 1 to 6 inside a heading, 0 in body text.
  var heading = 0

  init(bold: Bool = false, heading: Int = 0) {
    self.bold = bold
    self.heading = heading
  }

  static func headingSize(_ level: Int, base: CGFloat) -> CGFloat {
    switch level {
    case 1: return max(Typography.Size.title, base + 7)
    case 2: return max(Typography.Size.lg + 2, base + 4)
    case 3: return max(Typography.Size.lg, base + 2)
    case 4: return max(Typography.Size.emphasis, base + 1)
    default: return base
    }
  }

  func font(size base: CGFloat) -> Font {
    if code { return .code(base * 0.9) }
    if math {
      let font = Font.system(size: base + 1, design: .serif)
      return bold ? font.weight(.semibold).italic() : font.italic()
    }
    var font: Font
    if heading > 0 {
      let size = Self.headingSize(heading, base: base)
      font = heading <= 3 ? .display(size, weight: .semibold) : .ui(size, weight: .semibold)
    } else {
      font = .ui(base, weight: bold ? .semibold : .regular)
    }
    if italic { font = font.italic() }
    return font
  }
}
