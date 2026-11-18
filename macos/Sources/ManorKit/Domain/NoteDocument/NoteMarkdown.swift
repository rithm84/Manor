import Foundation

/// Markdown interchange for the editor: pasted Markdown becomes blocks, and copied blocks become Markdown
/// and plain text. Markdown is lossy by design (PRD "Notes"): math uses LaTeX, the live contents block becomes
/// anchor links, bookmarks and embeds become links, and columns and tabs become sequential sections.
public enum NoteMarkdown {
  // MARK: Import

  /// How Markdown becomes blocks.
  public struct Options: Sendable {
    /// Consecutive lines form one paragraph, as Markdown reads them. Off for pasted text, where each line is
    /// its own paragraph when pasting text with line breaks.
    public var joinParagraphLines = false
    /// The text is still arriving: a trailing partial line that could start a construct, a table header
    /// without its separator yet, and unclosed fences or details blocks wait instead of rendering half-formed.
    public var streaming = false
    /// Gives blocks ids derived from their position (`prefix/0`, `prefix/0.1`), so re-parsing a growing
    /// text keeps the same ids and views update in place.
    public var idPrefix: String?

    public init(joinParagraphLines: Bool = false, streaming: Bool = false, idPrefix: String? = nil) {
      self.joinParagraphLines = joinParagraphLines
      self.streaming = streaming
      self.idPrefix = idPrefix
    }

    /// How Alfred's writing reads: Markdown paragraphs, stable ids.
    public static func alfred(id: String, streaming: Bool) -> Options {
      Options(joinParagraphLines: true, streaming: streaming, idPrefix: id)
    }
  }

  /// Parses Markdown into blocks with fresh ids. Each non-empty line outside a construct becomes its own
  /// paragraph, when pasting text with line breaks.
  public static func blocks(from markdown: String) -> [NoteBlock] {
    blocks(from: markdown, options: Options())
  }

  public static func blocks(from markdown: String, options: Options) -> [NoteBlock] {
    var text = markdown.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
    if options.streaming, let lastBreak = text.lastIndex(of: "\n") {
      // A partial last line renders only when it is plain prose; markers wait for their line to finish.
      let tail = text[text.index(after: lastBreak)...].trimmingCharacters(in: .whitespaces)
      if let first = tail.first, "|-*+>#<`$~0123456789[!".contains(first) { text = String(text[..<lastBreak]) }
    } else if options.streaming, let first = text.trimmingCharacters(in: .whitespaces).first, "|-*+>#<`$~0123456789[!".contains(first) {
      text = ""
    }
    var parser = BlockParser(lines: text.components(separatedBy: "\n"), options: options)
    let parsed = parser.parse()
    guard let prefix = options.idPrefix else { return parsed }
    return assignIDs(parsed, prefix: prefix)
  }

  private static func assignIDs(_ blocks: [NoteBlock], prefix: String) -> [NoteBlock] {
    blocks.enumerated().map { index, block in
      var block = block
      block.id = "\(prefix)/\(index)"
      block.children = assignIDs(block.children, prefix: "\(prefix)/\(index)")
      return block
    }
  }

  /// Whether pasted plain text looks like Markdown worth converting rather than literal text.
  public static func looksLikeMarkdown(_ text: String) -> Bool {
    let patterns = [#"(?m)^#{1,6} \S"#, #"(?m)^\s*([-*+]|\d+[.)]) \S"#, #"(?m)^\s*[-*+] \[[ xX]\] "#, #"(?m)^> "#, #"(?m)^```"#,
                    #"(?m)^\|.*\|\s*$"#, #"\*\*[^*\n]+\*\*"#, #"\[[^\]\n]+\]\([^)\n]+\)"#, #"(?m)^(---|\*\*\*|___)\s*$"#, #"(?m)^\$\$\s*$"#,
                    #"`[^`\n]+`"#, #"~~[^~\n]+~~"#, #"(?m)^<details"#]
    return patterns.contains { text.range(of: $0, options: .regularExpression) != nil }
  }

  /// Callout markers and the tones they map to.
  static let calloutTones: [String: String] = ["NOTE": "info", "INFO": "info", "TIP": "success", "SUCCESS": "success",
                                               "WARNING": "warning", "CAUTION": "warning", "IMPORTANT": "plum"]

  private struct BlockParser {
    let lines: [String]
    let options: Options
    var index = 0

    init(lines: [String], options: Options) {
      self.lines = lines
      self.options = options
    }

    /// True when parsing stopped early, waiting for a construct to finish.
    var pending = false

    mutating func parse() -> [NoteBlock] {
      var blocks: [NoteBlock] = []
      while index < lines.count, !pending {
        let line = lines[index]
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        if trimmed.isEmpty { index += 1; continue }
        if trimmed.hasPrefix("```") || trimmed.hasPrefix("~~~") {
          if let block = code(fence: String(trimmed.prefix(3)), info: String(trimmed.dropFirst(3))) { blocks.append(block) }
          continue
        }
        if trimmed == "$$" {
          if let math = mathBlock() { blocks.append(math); continue }
          if options.streaming { pending = true; break }
        }
        if trimmed.lowercased().hasPrefix("<details") {
          if let toggle = details() { blocks.append(toggle) }
          continue
        }
        if let heading = heading(trimmed) { blocks.append(heading); index += 1; continue }
        if ["---", "***", "___"].contains(trimmed.replacingOccurrences(of: " ", with: "")) && trimmed.count >= 3 {
          blocks.append(NoteSchema.block(.divider)); index += 1; continue
        }
        if trimmed.hasPrefix(">") { blocks.append(quote()); continue }
        if isTableRow(trimmed) {
          if index + 1 < lines.count, isTableSeparator(lines[index + 1]) { blocks.append(table()); continue }
          // A header row whose separator hasn't arrived yet waits, so it doesn't flash as a paragraph.
          if options.streaming, index + 1 >= lines.count || lines[(index + 1)...].allSatisfy({ $0.trimmingCharacters(in: .whitespaces).isEmpty }) {
            pending = true
            break
          }
        }
        if listMarker(line) != nil { blocks.append(contentsOf: list(baseIndent: indent(of: line))); continue }
        if let image = image(trimmed) { blocks.append(image); index += 1; continue }
        blocks.append(paragraph())
      }
      return blocks
    }

    /// A paragraph: one line, or with `joinParagraphLines`, every line up to a blank line or a construct.
    mutating func paragraph() -> NoteBlock {
      var parts = [lines[index].trimmingCharacters(in: .whitespaces)]
      index += 1
      if options.joinParagraphLines {
        while index < lines.count {
          let line = lines[index]
          let trimmed = line.trimmingCharacters(in: .whitespaces)
          if trimmed.isEmpty || startsConstruct(line) { break }
          parts.append(trimmed)
          index += 1
        }
      }
      return NoteSchema.paragraph(NoteMarkdown.inlines(from: parts.joined(separator: " ")))
    }

    func startsConstruct(_ line: String) -> Bool {
      let trimmed = line.trimmingCharacters(in: .whitespaces)
      if trimmed.hasPrefix("```") || trimmed.hasPrefix("~~~") || trimmed == "$$" || trimmed.hasPrefix(">") || trimmed.hasPrefix("|") { return true }
      if trimmed.lowercased().hasPrefix("<details") || heading(trimmed) != nil || listMarker(line) != nil { return true }
      return ["---", "***", "___"].contains(trimmed.replacingOccurrences(of: " ", with: "")) && trimmed.count >= 3
    }

    mutating func code(fence: String, info: String) -> NoteBlock? {
      let opening = index
      index += 1
      var body: [String] = []
      while index < lines.count, !lines[index].trimmingCharacters(in: .whitespaces).hasPrefix(fence) {
        body.append(lines[index])
        index += 1
      }
      if index >= lines.count, options.streaming {
        // An unclosed fence waits for its closing line.
        index = opening
        pending = true
        return nil
      }
      index += 1
      let tag = (info.split(separator: " ").first.map(String.init) ?? "").lowercased()
      // Alfred's visual fences become their own blocks.
      if NoteAlfred.diagramLanguages.contains(tag) { return NoteSchema.block(.diagram, props: ["source": .string(body.joined(separator: "\n"))]) }
      if NoteAlfred.generativeUILanguages.contains(tag) { return NoteSchema.block(.generativeUI, props: ["source": .string(body.joined(separator: "\n"))]) }
      let language = NoteSchema.codeLanguage(for: tag)
      return NoteSchema.block(.codeBlock, props: ["language": .string(language)], content: .plain(body.joined(separator: "\n")))
    }

    mutating func mathBlock() -> NoteBlock? {
      guard let closing = lines[(index + 1)...].firstIndex(where: { $0.trimmingCharacters(in: .whitespaces) == "$$" }) else { return nil }
      let body = lines[(index + 1)..<closing].joined(separator: "\n")
      index = closing + 1
      return NoteSchema.block(.mathBlock, content: .plain(body))
    }

    /// `<details><summary>Title</summary> … </details>` becomes a toggle with the inner Markdown as children.
    mutating func details() -> NoteBlock? {
      let opening = index
      var depth = 0
      var inner: [String] = []
      var title = ""
      var closed = false
      while index < lines.count {
        var line = lines[index]
        index += 1
        let lower = line.lowercased()
        depth += lower.components(separatedBy: "<details").count - 1
        let closes = lower.components(separatedBy: "</details>").count - 1
        if depth == 1, title.isEmpty, let match = line.firstMatch(of: #/<summary>(.*?)</summary>/#) {
          title = String(match.1).trimmingCharacters(in: .whitespaces)
          line = line.replacingOccurrences(of: String(match.0), with: "")
        }
        depth -= closes
        let stripped = line.replacingOccurrences(of: #"(?i)^\s*<details[^>]*>"#, with: "", options: .regularExpression)
          .replacingOccurrences(of: #"(?i)</details>\s*$"#, with: "", options: .regularExpression)
        if depth <= 0 {
          if !stripped.trimmingCharacters(in: .whitespaces).isEmpty { inner.append(stripped) }
          closed = true
          break
        }
        if index - 1 != opening || !stripped.trimmingCharacters(in: .whitespaces).isEmpty { inner.append(stripped) }
      }
      if !closed, options.streaming {
        index = opening
        pending = true
        return nil
      }
      var nested = BlockParser(lines: inner, options: Options(joinParagraphLines: options.joinParagraphLines))
      return NoteSchema.block(.toggleListItem, content: .inline(NoteMarkdown.inlines(from: title)), children: nested.parse())
    }

    func heading(_ trimmed: String) -> NoteBlock? {
      let hashes = trimmed.prefix { $0 == "#" }.count
      guard (1...6).contains(hashes), trimmed.count > hashes, trimmed[trimmed.index(trimmed.startIndex, offsetBy: hashes)] == " " else { return nil }
      var text = String(trimmed.dropFirst(hashes + 1)).trimmingCharacters(in: .whitespaces)
      while text.hasSuffix("#") { text.removeLast() }
      return NoteSchema.block(.heading, props: ["level": .number(Double(min(hashes, 6)))], content: .inline(NoteMarkdown.inlines(from: text.trimmingCharacters(in: .whitespaces))))
    }

    /// A quote, or a callout when it opens with `[!NOTE]`, `[!TIP]`, `[!WARNING]`, or `[!IMPORTANT]`.
    mutating func quote() -> NoteBlock {
      var body: [String] = []
      while index < lines.count {
        let trimmed = lines[index].trimmingCharacters(in: .whitespaces)
        guard trimmed.hasPrefix(">") else { break }
        body.append(String(trimmed.dropFirst()).trimmingCharacters(in: .whitespaces))
        index += 1
      }
      if let first = body.first, let match = first.wholeMatch(of: #/\[!([A-Za-z]+)\]\s*(.*)/#),
         let tone = NoteMarkdown.calloutTones[String(match.1).uppercased()] {
        var rest = Array(body.dropFirst())
        let inlineTitle = String(match.2).trimmingCharacters(in: .whitespaces)
        if !inlineTitle.isEmpty { rest.insert(inlineTitle, at: 0) }
        let text = rest.joined(separator: options.joinParagraphLines ? " " : "\n").trimmingCharacters(in: .whitespaces)
        return NoteSchema.block(.callout, props: ["tone": .string(tone)], content: .inline(NoteMarkdown.inlines(from: text)))
      }
      return NoteSchema.block(.quote, content: .inline(NoteMarkdown.inlines(from: body.joined(separator: "\n"))))
    }

    func isTableRow(_ trimmed: String) -> Bool { trimmed.hasPrefix("|") && trimmed.count > 1 }

    func isTableSeparator(_ line: String) -> Bool {
      let trimmed = line.trimmingCharacters(in: .whitespaces)
      guard trimmed.contains("-") else { return false }
      return trimmed.allSatisfy { "|-: ".contains($0) }
    }

    func cells(_ line: String) -> [String] {
      var trimmed = line.trimmingCharacters(in: .whitespaces)
      if trimmed.hasPrefix("|") { trimmed.removeFirst() }
      if trimmed.hasSuffix("|") { trimmed.removeLast() }
      // Escaped pipes stay in the cell.
      let placeholder = "\u{E000}"
      return trimmed.replacingOccurrences(of: "\\|", with: placeholder).components(separatedBy: "|")
        .map { $0.replacingOccurrences(of: placeholder, with: "|").trimmingCharacters(in: .whitespaces) }
    }

    mutating func table() -> NoteBlock {
      var rows: [[String]] = [cells(lines[index])]
      let alignments = cells(lines[index + 1]).map { spec -> String in
        let left = spec.hasPrefix(":"), right = spec.hasSuffix(":")
        return left && right ? "center" : right ? "right" : "left"
      }
      index += 2
      while index < lines.count, isTableRow(lines[index].trimmingCharacters(in: .whitespaces)) {
        rows.append(cells(lines[index]))
        index += 1
      }
      let width = max(rows.map(\.count).max() ?? 1, alignments.count)
      let table = NoteTable(columnWidths: Array(repeating: .null, count: width), headerRows: 1, rows: rows.map { row in
        NoteTableRow(cells: (0..<width).map { column in
          var props = NoteTableCell.defaultProps
          if column < alignments.count { props["textAlignment"] = .string(alignments[column]) }
          return NoteTableCell(content: column < row.count ? NoteMarkdown.inlines(from: row[column]) : [], props: props)
        })
      })
      return NoteSchema.block(.table, content: .table(table))
    }

    func image(_ trimmed: String) -> NoteBlock? {
      guard let match = trimmed.wholeMatch(of: #/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/#) else { return nil }
      let url = String(match.2)
      let name = URL(string: url)?.lastPathComponent ?? ""
      return NoteSchema.block(.image, props: ["url": .string(url), "alt": .string(String(match.1)), "name": .string(name)])
    }

    func indent(of line: String) -> Int {
      var width = 0
      for character in line {
        if character == " " { width += 1 } else if character == "\t" { width += 4 } else { break }
      }
      return width
    }

    /// The list kind, the item text, the checkbox state, and the number of a list line.
    func listMarker(_ line: String) -> (kind: NoteBlockKind, text: String, checked: Bool?, number: Int?)? {
      let trimmed = line.trimmingCharacters(in: .whitespaces)
      for bullet in ["- ", "* ", "+ "] where trimmed.hasPrefix(bullet) {
        let rest = String(trimmed.dropFirst(2))
        if rest.hasPrefix("[ ] ") || rest == "[ ]" { return (.checkListItem, String(rest.dropFirst(3)).trimmingCharacters(in: .whitespaces), false, nil) }
        if rest.lowercased().hasPrefix("[x] ") || rest.lowercased() == "[x]" { return (.checkListItem, String(rest.dropFirst(3)).trimmingCharacters(in: .whitespaces), true, nil) }
        return (.bulletListItem, rest, nil, nil)
      }
      if let match = trimmed.prefixMatch(of: #/(\d{1,9})[.)] /#) {
        return (.numberedListItem, String(trimmed[match.range.upperBound...]), nil, Int(match.1))
      }
      return nil
    }

    mutating func list(baseIndent: Int) -> [NoteBlock] {
      var items: [NoteBlock] = []
      while index < lines.count {
        let line = lines[index]
        if line.trimmingCharacters(in: .whitespaces).isEmpty {
          // A blank line ends the list unless the next line continues it.
          if index + 1 < lines.count, listMarker(lines[index + 1]) != nil, indent(of: lines[index + 1]) >= baseIndent { index += 1; continue }
          break
        }
        let lineIndent = indent(of: line)
        guard let marker = listMarker(line) else {
          // An indented continuation line joins the item above it.
          if options.joinParagraphLines, lineIndent > baseIndent, !items.isEmpty, !startsConstruct(line) {
            let extra = NoteMarkdown.inlines(from: " " + line.trimmingCharacters(in: .whitespaces))
            items[items.count - 1].content = .inline(NoteMarkdown.merged(items[items.count - 1].inlines + extra))
            index += 1
            continue
          }
          break
        }
        if lineIndent < baseIndent { break }
        if lineIndent > baseIndent, !items.isEmpty {
          let nested = list(baseIndent: lineIndent)
          items[items.count - 1].children.append(contentsOf: nested)
          continue
        }
        var props: [String: JSONValue] = [:]
        if let checked = marker.checked { props["checked"] = .bool(checked) }
        if marker.kind == .numberedListItem, items.last?.kind != .numberedListItem, let number = marker.number, number != 1 {
          props["start"] = .number(Double(number))
        }
        items.append(NoteSchema.block(marker.kind, props: props, content: .inline(NoteMarkdown.inlines(from: marker.text))))
        index += 1
      }
      return items
    }
  }

  /// Parses inline Markdown: bold, italic, strikethrough, inline code, links, and `$`-delimited math.
  public static func inlines(from text: String) -> [NoteInline] {
    var output: [NoteInline] = []
    parseInline(Array(text), styles: .plain, into: &output)
    return merged(output)
  }

  private static func parseInline(_ characters: [Character], styles: NoteStyles, into output: inout [NoteInline]) {
    var buffer = ""
    var index = 0
    func flush() {
      if !buffer.isEmpty { output.append(.text(buffer, styles)); buffer = "" }
    }
    func find(_ token: String, from start: Int) -> Int? {
      let tokenCharacters = Array(token)
      var position = start
      while position + tokenCharacters.count <= characters.count {
        if Array(characters[position..<(position + tokenCharacters.count)]) == tokenCharacters, position > start { return position }
        position += 1
      }
      return nil
    }
    while index < characters.count {
      let character = characters[index]
      if character == "\\", index + 1 < characters.count, "\\`*_~[]()$#".contains(characters[index + 1]) {
        buffer.append(characters[index + 1])
        index += 2
        continue
      }
      if character == "`", let end = find("`", from: index + 1) {
        flush()
        var code = styles
        code.code = true
        output.append(.text(String(characters[(index + 1)..<end]), code))
        index = end + 1
        continue
      }
      if character == "$", index + 1 < characters.count, characters[index + 1] != " ", let end = find("$", from: index + 1), characters[end - 1] != " " {
        flush()
        output.append(.math(String(characters[(index + 1)..<end])))
        index = end + 1
        continue
      }
      var matchedDelimiter = false
      for (token, apply) in [("**", { (s: inout NoteStyles) in s.bold = true }), ("__", { (s: inout NoteStyles) in s.bold = true }),
                             ("~~", { (s: inout NoteStyles) in s.strike = true }), ("*", { (s: inout NoteStyles) in s.italic = true }),
                             ("_", { (s: inout NoteStyles) in s.italic = true })] {
        let tokenCharacters = Array(token)
        guard index + tokenCharacters.count < characters.count, Array(characters[index..<(index + tokenCharacters.count)]) == tokenCharacters else { continue }
        let afterOpen = index + tokenCharacters.count
        guard characters[afterOpen] != " ", let end = find(token, from: afterOpen), characters[end - 1] != " " else { continue }
        // `_` inside words (snake_case) is literal.
        if token == "_" || token == "__", index > 0, characters[index - 1].isLetter || characters[index - 1].isNumber { continue }
        flush()
        var inner = styles
        apply(&inner)
        parseInline(Array(characters[afterOpen..<end]), styles: inner, into: &output)
        index = end + tokenCharacters.count
        matchedDelimiter = true
        break
      }
      if matchedDelimiter { continue }
      if character == "[", let close = find("]", from: index + 1), close + 1 < characters.count, characters[close + 1] == "(",
         let end = find(")", from: close + 1) {
        let label = Array(characters[(index + 1)..<close])
        let href = String(characters[(close + 2)..<end]).trimmingCharacters(in: .whitespaces)
        if !href.contains(" ") || href.hasPrefix("<") {
          flush()
          var inner: [NoteInline] = []
          parseInline(label, styles: styles, into: &inner)
          let runs = inner.compactMap { item -> NoteTextRun? in
            if case .text(let run) = item { return run }
            return NoteTextRun(item.plainText, styles)
          }
          output.append(.link(href: href.trimmingCharacters(in: CharacterSet(charactersIn: "<>")), runs: mergedRuns(runs), other: [:]))
          index = end + 1
          continue
        }
      }
      buffer.append(character)
      index += 1
    }
    flush()
  }

  /// Joins adjacent text items with equal styles, the format's canonical form.
  public static func merged(_ items: [NoteInline]) -> [NoteInline] {
    var out: [NoteInline] = []
    for item in items {
      if case .text(let run) = item, run.text.isEmpty { continue }
      if case .text(let run) = item, case .text(let previous)? = out.last, previous.styles == run.styles {
        out[out.count - 1] = .text(NoteTextRun(previous.text + run.text, run.styles))
      } else {
        out.append(item)
      }
    }
    return out
  }

  static func mergedRuns(_ runs: [NoteTextRun]) -> [NoteTextRun] {
    var out: [NoteTextRun] = []
    for run in runs where !run.text.isEmpty {
      if let previous = out.last, previous.styles == run.styles { out[out.count - 1].text += run.text } else { out.append(run) }
    }
    return out
  }

  // MARK: Export

  /// Markdown for blocks, following the React editor's export rules.
  public static func markdown(from blocks: [NoteBlock], document: [NoteBlock]? = nil) -> String {
    var lines: [String] = []
    let contents = tableOfContentsMarkdown(document ?? blocks)
    write(blocks, depth: 0, numbered: nil, into: &lines, contents: contents)
    while lines.last?.isEmpty == true { lines.removeLast() }
    return lines.joined(separator: "\n")
  }

  /// Plain text for blocks: one line per block, indented children, no Markdown syntax.
  public static func plainText(from blocks: [NoteBlock]) -> String {
    blocks.flattened().compactMap { entry -> String? in
      let indent = String(repeating: "\t", count: entry.depth)
      switch entry.block.kind {
      case .divider, .twoColumns, .noteColumn, .columnList, .column, .documentTabs, .diagram, .generativeUI: return nil
      case .documentTab: return indent + (entry.block.string("title") ?? "")
      case .image, .video, .audio, .file: return indent + (entry.block.string("caption").flatMap { $0.isEmpty ? nil : $0 } ?? entry.block.string("name") ?? "")
      case .webBookmark, .webEmbed: return indent + (entry.block.string("url") ?? "")
      default: return indent + entry.block.plainText
      }
    }.joined(separator: "\n")
  }

  static func tableOfContentsMarkdown(_ blocks: [NoteBlock]) -> String {
    blocks.headings.map { heading in
      "\(String(repeating: "  ", count: max(heading.level - 1, 0)))- [\(heading.title)](#\(NoteFragments.slug(heading.title)))"
    }.joined(separator: "\n")
  }

  private static func write(_ blocks: [NoteBlock], depth: Int, numbered: Int?, into lines: inout [String], contents: String) {
    let indent = String(repeating: "  ", count: depth)
    var number = 0
    var previousKind: NoteBlockKind?
    for (position, block) in blocks.enumerated() {
      let kind = block.kind
      if kind == .numberedListItem {
        number = previousKind == .numberedListItem ? number + 1 : (block.props["start"]?.int ?? 1)
      }
      previousKind = kind
      let text = inlineMarkdown(block.inlines)
      switch kind {
      case .heading:
        let level = max(1, min(block.props["level"]?.int ?? 1, 6))
        lines.append("\(indent)\(String(repeating: "#", count: level)) \(text)")
        lines.append("")
      case .bulletListItem, .toggleListItem:
        lines.append("\(indent)- \(text)")
      case .numberedListItem:
        lines.append("\(indent)\(number). \(text)")
      case .checkListItem:
        lines.append("\(indent)- [\(block.props["checked"]?.bool == true ? "x" : " ")] \(text)")
      case .quote:
        lines.append(contentsOf: text.components(separatedBy: "\n").map { "\(indent)> \($0)" })
        lines.append("")
      case .callout:
        lines.append(contentsOf: text.components(separatedBy: "\n").map { "\(indent)> \($0)" })
        lines.append("")
      case .codeBlock:
        let language = block.string("language") ?? ""
        lines.append("\(indent)```\(language == "text" ? "" : language)")
        lines.append(contentsOf: block.plainText.components(separatedBy: "\n").map { indent + $0 })
        lines.append("\(indent)```")
        lines.append("")
      case .mathBlock:
        lines.append(contentsOf: ["$$", block.plainText, "$$", ""])
      case .divider:
        lines.append("\(indent)***")
        lines.append("")
      case .table:
        if let table = block.content.table, !table.rows.isEmpty {
          let width = table.columnCount
          for (rowIndex, row) in table.rows.enumerated() {
            let cells = (0..<width).map { column in column < row.cells.count ? inlineMarkdown(row.cells[column].content).replacingOccurrences(of: "|", with: "\\|").replacingOccurrences(of: "\n", with: " ") : "" }
            lines.append("\(indent)| \(cells.joined(separator: " | ")) |")
            if rowIndex == 0 { lines.append("\(indent)|\(Array(repeating: " --- |", count: width).joined())") }
          }
          lines.append("")
        }
      case .image:
        let url = block.string("url") ?? ""
        if !url.isEmpty { lines.append("\(indent)![\(block.string("alt") ?? "")](\(url))") }
        if let caption = block.string("caption"), !caption.isEmpty { lines.append("\(indent)\(caption)") }
        lines.append("")
      case .video, .audio, .file:
        let url = block.string("url") ?? ""
        let name = block.string("name").flatMap { $0.isEmpty ? nil : $0 } ?? url
        if !url.isEmpty { lines.append("\(indent)[\(name)](\(url))"); lines.append("") }
      case .tableOfContents:
        lines.append(contents.isEmpty ? "Table of contents" : contents)
        lines.append("")
      case .webBookmark, .webEmbed:
        let url = block.string("url") ?? ""
        let title = block.string("title").flatMap { $0.isEmpty ? nil : $0 } ?? url
        lines.append("[\(kind == .webEmbed ? "Embedded page: \(title)" : title)](\(url))")
        lines.append("")
      case .twoColumns, .columnList:
        for (index, column) in block.children.enumerated() {
          if index > 0 { lines.append("***"); lines.append("") }
          write(column.children, depth: depth, numbered: nil, into: &lines, contents: contents)
        }
        continue
      case .documentTabs, .noteColumn, .column:
        write(block.children, depth: depth, numbered: nil, into: &lines, contents: contents)
        continue
      case .documentTab:
        lines.append("### \(block.string("title") ?? "Tab")")
        lines.append("")
        write(block.children, depth: depth, numbered: nil, into: &lines, contents: contents)
        continue
      case .alfred:
        lines.append(contentsOf: NoteAlfred.markdown(of: block).components(separatedBy: "\n"))
        lines.append("")
      case .diagram, .generativeUI:
        lines.append("```\(kind == .diagram ? "diagram" : "ui")")
        lines.append(contentsOf: (block.string("source") ?? "").components(separatedBy: "\n"))
        lines.append("```")
        lines.append("")
      case .paragraph, .unknown:
        lines.append("\(indent)\(text)")
        lines.append("")
      }
      if !block.children.isEmpty {
        write(block.children, depth: depth + 1, numbered: nil, into: &lines, contents: contents)
      }
      // Lists end with a blank line once the run of items ends.
      if kind.isListItem, position == blocks.count - 1 || !blocks[position + 1].kind.isListItem { lines.append("") }
    }
  }

  /// Inline Markdown for a run of inline content.
  public static func inlineMarkdown(_ items: [NoteInline]) -> String {
    items.map { item -> String in
      switch item {
      case .text(let run): return styled(run)
      case .link(let href, let runs, _): return "[\(runs.map(styled).joined())](\(href))"
      case .mention(_, let title, _): return title
      case .math(let latex, _): return "$\(latex)$"
      case .other(let value): return NoteInline.fallbackText(value)
      }
    }.joined()
  }

  private static func styled(_ run: NoteTextRun) -> String {
    if run.styles.code { return "`\(run.text)`" }
    var text = run.text
    guard !text.trimmingCharacters(in: .whitespaces).isEmpty else { return text }
    let leading = String(text.prefix { $0 == " " })
    let trailing = String(text.reversed().prefix { $0 == " " })
    text = String(text.dropFirst(leading.count).dropLast(trailing.count))
    if run.styles.strike { text = "~~\(text)~~" }
    if run.styles.italic { text = "*\(text)*" }
    if run.styles.bold { text = "**\(text)**" }
    return leading + text + trailing
  }
}
