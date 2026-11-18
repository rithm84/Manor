import Foundation
import ManorKit
import SwiftUI

/// Statement Markdown: GitHub-flavored blocks (headings, paragraphs, lists, quotes, fenced code, tables, rules,
/// images) in Manor's type. Imported markup never executes; LeetCode's `<sup>` markup and `10^5` read as real
/// superscripts.
struct WorkspaceMarkdown: View {
  let blocks: [WorkspaceMarkdownBlock]
  var fallbackLanguage: ProblemLanguage = .python

  init(_ text: String, fallbackLanguage: ProblemLanguage = .python) {
    blocks = WorkspaceMarkdownParser.blocks(text)
    self.fallbackLanguage = fallbackLanguage
  }

  var body: some View {
    VStack(alignment: .leading, spacing: Space.s3) {
      ForEach(blocks) { block in
        WorkspaceMarkdownBlockView(block: block)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .textSelection(.enabled)
    .tint(Palette.link)
  }
}

struct WorkspaceMarkdownBlock: Identifiable {
  enum Kind {
    case paragraph
    case heading(Int)
    case code(language: String?)
    case listItem(marker: String, depth: Int)
    case quote
    case rule
    case table(rows: [[AttributedString]], header: Bool)
  }
  let id: Int
  let kind: Kind
  var content: AttributedString
  var images: [URL] = []
}

private struct WorkspaceMarkdownBlockView: View {
  let block: WorkspaceMarkdownBlock

  var body: some View {
    switch block.kind {
    case .paragraph:
      VStack(alignment: .leading, spacing: Space.s2) {
        if !block.content.characters.isEmpty { prose(block.content) }
        ForEach(block.images, id: \.self) { url in
          AsyncImage(url: url) { image in image.resizable().scaledToFit() } placeholder: { Color.clear.frame(height: 24) }
            .frame(maxWidth: 520, alignment: .leading)
        }
      }
    case .heading(let level):
      Text(block.content)
        .font(level <= 2 ? .display(Typography.Size.lg) : .ui(Typography.Size.md, weight: .semibold))
        .foregroundStyle(Palette.ink)
        .padding(.top, Space.s1)
    case .code(let language):
      ScrollView(.horizontal, showsIndicators: false) {
        WorkspaceCode(code: String(block.content.characters).replacingOccurrences(of: #"\n$"#, with: "", options: .regularExpression), language: language.flatMap(WorkspaceMarkdownParser.language(forFence:)), size: Typography.Size.sm)
          .padding(.horizontal, Space.s4)
          .padding(.vertical, Space.s3)
      }
      .background(Palette.surfacePaper, in: RoundedRectangle(cornerRadius: Radius.control))
      .overlay(RoundedRectangle(cornerRadius: Radius.control).strokeBorder(Palette.hairline))
    case .listItem(let marker, let depth):
      HStack(alignment: .firstTextBaseline, spacing: Space.s2) {
        Text(marker).font(.ui(Typography.Size.md)).foregroundStyle(Palette.inkMuted).tabular()
          .frame(minWidth: 14, alignment: .trailing)
        prose(block.content)
      }
      .padding(.leading, CGFloat(depth - 1) * Space.s5)
    case .quote:
      prose(block.content)
        .padding(.leading, Space.s3)
        .overlay(alignment: .leading) { Rectangle().fill(Palette.hairlineStrong).frame(width: 2) }
    case .rule:
      Hairline()
    case .table(let rows, let header):
      ScrollView(.horizontal, showsIndicators: false) {
        Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
          ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
            GridRow {
              ForEach(Array(row.enumerated()), id: \.offset) { _, cell in
                Text(cell)
                  .font(.ui(Typography.Size.sm, weight: header && index == 0 ? .semibold : .regular))
                  .foregroundStyle(Palette.inkBody)
                  .padding(.horizontal, Space.s3)
                  .padding(.vertical, Space.s2)
              }
            }
            if index < rows.count - 1 { Hairline().gridCellColumns(max(1, row.count)) }
          }
        }
        .overlay(RoundedRectangle(cornerRadius: Radius.control).strokeBorder(Palette.hairline))
      }
    }
  }

  private func prose(_ content: AttributedString) -> some View {
    Text(content)
      .font(.ui(Typography.Size.md))
      .foregroundStyle(Palette.inkBody)
      .lineSpacing(4)
      .fixedSize(horizontal: false, vertical: true)
  }
}

enum WorkspaceMarkdownParser {
  // MARK: Blocks

  static func blocks(_ markdown: String) -> [WorkspaceMarkdownBlock] {
    let prepared = preprocess(markdown)
    guard let attributed = try? AttributedString(markdown: prepared, options: .init(allowsExtendedAttributes: true, interpretedSyntax: .full, failurePolicy: .returnPartiallyParsedIfPossible)) else {
      return [WorkspaceMarkdownBlock(id: 0, kind: .paragraph, content: AttributedString(markdown))]
    }
    var blocks: [WorkspaceMarkdownBlock] = []
    var lastIntent: PresentationIntent?
    var tableIdentity: Int?
    var tableRows: [Int: [Int: AttributedString]] = [:]
    var tableHasHeader = false

    func flushTable() {
      guard tableIdentity != nil else { return }
      let rows = tableRows.keys.sorted().map { row in
        let cells = tableRows[row] ?? [:]
        return (0...(cells.keys.max() ?? 0)).map { cells[$0] ?? AttributedString() }
      }
      blocks.append(WorkspaceMarkdownBlock(id: blocks.count, kind: .table(rows: rows, header: tableHasHeader), content: AttributedString()))
      tableIdentity = nil
      tableRows = [:]
      tableHasHeader = false
    }

    for run in attributed.runs {
      var piece = AttributedString(attributed[run.range])
      piece.presentationIntent = nil
      let intent = run.presentationIntent
      let components = intent?.components ?? []

      if let table = components.first(where: { if case .table = $0.kind { return true }; return false }) {
        if tableIdentity != table.identity { flushTable(); tableIdentity = table.identity }
        var row = 0, column = 0
        for component in components {
          switch component.kind {
          case .tableHeaderRow: row = -1; tableHasHeader = true
          case .tableRow(let index): row = index
          case .tableCell(let index): column = index
          default: break
          }
        }
        tableRows[row, default: [:]][column, default: AttributedString()].append(piece)
        lastIntent = intent
        continue
      }
      flushTable()

      if let url = run.imageURL {
        if intent == lastIntent, !blocks.isEmpty { blocks[blocks.count - 1].images.append(url) } else {
          blocks.append(WorkspaceMarkdownBlock(id: blocks.count, kind: .paragraph, content: AttributedString(), images: [url]))
          lastIntent = intent
        }
        continue
      }

      if intent == lastIntent, !blocks.isEmpty {
        blocks[blocks.count - 1].content.append(piece)
        continue
      }
      lastIntent = intent
      blocks.append(WorkspaceMarkdownBlock(id: blocks.count, kind: kind(of: components), content: piece))
    }
    flushTable()
    return blocks.map { block in
      var trimmed = block
      if case .code = block.kind { return trimmed }
      while trimmed.content.characters.last?.isNewline == true { trimmed.content.characters.removeLast() }
      return trimmed
    }
  }

  private static func kind(of components: [PresentationIntent.IntentType]) -> WorkspaceMarkdownBlock.Kind {
    for component in components {
      switch component.kind {
      case .header(let level): return .heading(level)
      case .codeBlock(let hint): return .code(language: hint)
      case .thematicBreak: return .rule
      default: break
      }
    }
    if let item = components.first(where: { if case .listItem = $0.kind { return true }; return false }), case .listItem(let ordinal) = item.kind {
      let depth = components.filter { if case .orderedList = $0.kind { return true }; if case .unorderedList = $0.kind { return true }; return false }.count
      let ordered = components.first(where: { if case .orderedList = $0.kind { return true }; if case .unorderedList = $0.kind { return true }; return false }).map { if case .orderedList = $0.kind { return true }; return false } ?? false
      return .listItem(marker: ordered ? "\(ordinal)." : (depth > 1 ? "◦" : "•"), depth: max(1, depth))
    }
    if components.contains(where: { if case .blockQuote = $0.kind { return true }; return false }) { return .quote }
    return .paragraph
  }

  // MARK: Inline

  /// Inline Markdown only (hover documentation, short labels).
  static func inline(_ markdown: String) -> AttributedString {
    let prepared = preprocess(markdown)
    return (try? AttributedString(markdown: prepared, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(markdown)
  }

  /// Splits fenced code from prose.
  static func fencedSegments(_ markdown: String) -> [(isCode: Bool, text: String, language: ProblemLanguage?)] {
    var segments: [(isCode: Bool, text: String, language: ProblemLanguage?)] = []
    var prose: [String] = []
    var code: [String] = []
    var fence: String?
    var language: ProblemLanguage?
    for line in markdown.components(separatedBy: "\n") {
      let trimmed = line.trimmingCharacters(in: .whitespaces)
      if fence == nil, trimmed.hasPrefix("```") {
        if !prose.isEmpty { segments.append((false, prose.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines), nil)); prose = [] }
        fence = "```"
        language = Self.language(forFence: String(trimmed.dropFirst(3)))
        continue
      }
      if fence != nil, trimmed.hasPrefix("```") {
        segments.append((true, code.joined(separator: "\n"), language))
        code = []
        fence = nil
        continue
      }
      if fence != nil { code.append(line) } else { prose.append(line) }
    }
    if fence != nil, !code.isEmpty { segments.append((true, code.joined(separator: "\n"), language)) }
    let rest = prose.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
    if !rest.isEmpty { segments.append((false, rest, nil)) }
    return segments.filter { !$0.text.isEmpty }
  }

  static func language(forFence name: String) -> ProblemLanguage? {
    switch name.trimmingCharacters(in: .whitespaces).lowercased() {
    case "python", "py", "python3": return .python
    case "cpp", "c++", "cc": return .cpp
    case "c": return .c
    case "java": return .java
    case "go", "golang": return .go
    case "javascript", "js", "typescript", "ts": return .javascript
    default: return nil
    }
  }

  // MARK: Preprocessing

  private static let superscripts: [Character: Character] = ["0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "-": "⁻"]
  private static let subscripts: [Character: Character] = ["0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉", "-": "₋"]

  static func script(_ value: String, _ table: [Character: Character]) -> String? {
    let mapped = value.compactMap { table[$0] }
    return mapped.count == value.count ? String(mapped) : nil
  }

  /// Rewrites LeetCode's HTML-flavored markup outside fenced code: numeric `<sup>`/`<sub>` and `10^5` become
  /// superscript characters, and simple formatting tags become Markdown.
  static func preprocess(_ markdown: String) -> String {
    var output: [String] = []
    var inFence = false
    for line in markdown.components(separatedBy: "\n") {
      if line.trimmingCharacters(in: .whitespaces).hasPrefix("```") { inFence.toggle(); output.append(line); continue }
      output.append(inFence ? line : rewrite(line))
    }
    return output.joined(separator: "\n")
  }

  private static func rewrite(_ line: String) -> String {
    var text = line
    for (tag, table) in [("sup", superscripts), ("sub", subscripts)] {
      text = replace(text, pattern: "<\(tag)>([^<]{1,20})</\(tag)>") { groups in
        script(groups[1], table) ?? (tag == "sup" ? "^" + groups[1] : "_" + groups[1])
      }
    }
    text = replace(text, pattern: #"([0-9A-Za-z)\]])\^(-?\d+|\{-?\d{1,20}\})"#) { groups in
      let exponent = groups[2].trimmingCharacters(in: CharacterSet(charactersIn: "{}"))
      return groups[1] + (script(exponent, superscripts) ?? "^" + groups[2])
    }
    let tags: [(String, String)] = [("<code>", "`"), ("</code>", "`"), ("<strong>", "**"), ("</strong>", "**"), ("<b>", "**"), ("</b>", "**"), ("<em>", "*"), ("</em>", "*"), ("<i>", "*"), ("</i>", "*"), ("<br>", "  "), ("<br/>", "  "), ("<br />", "  "), ("<p>", ""), ("</p>", ""), ("&nbsp;", " "), ("&lt;", "<"), ("&gt;", ">"), ("&quot;", "\""), ("&#39;", "'"), ("&amp;", "&")]
    for (from, to) in tags { text = text.replacingOccurrences(of: from, with: to, options: .caseInsensitive) }
    return text
  }

  private static func replace(_ text: String, pattern: String, _ transform: ([String]) -> String) -> String {
    guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return text }
    let source = text as NSString
    var result = ""
    var last = 0
    for match in regex.matches(in: text, range: NSRange(location: 0, length: source.length)) {
      result += source.substring(with: NSRange(location: last, length: match.range.location - last))
      let groups = (0..<match.numberOfRanges).map { index -> String in
        let range = match.range(at: index)
        return range.location == NSNotFound ? "" : source.substring(with: range)
      }
      result += transform(groups)
      last = NSMaxRange(match.range)
    }
    result += source.substring(from: last)
    return result
  }
}
