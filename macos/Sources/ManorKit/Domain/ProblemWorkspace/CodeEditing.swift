import Foundation

/// One change to the editor's text: replace `range` with `text`, then select `selection`. Offsets are UTF-16.
public struct CodeEdit: Equatable, Sendable {
  public var range: NSRange
  public var text: String
  public var selection: NSRange

  public init(range: NSRange, text: String, selection: NSRange) {
    self.range = range
    self.text = text
    self.selection = selection
  }

  /// Moves the caret without changing text.
  static func caret(_ at: Int) -> CodeEdit { CodeEdit(range: NSRange(location: at, length: 0), text: "", selection: NSRange(location: at, length: 0)) }
}

/// The code editor's typing rules, modeled on the defaults of common code editors: auto-indent, bracket and quote
/// pairing, smart Backspace, Tab and Shift-Tab, comment toggling, and line moves. Pure text in, one edit out, so every
/// rule is testable without a text view.
public struct CodeEditing: Sendable {
  public let language: ProblemLanguage
  public let tabSize: Int

  public init(language: ProblemLanguage, tabSize: Int) {
    self.language = language
    self.tabSize = max(1, tabSize)
  }

  var unit: String { String(repeating: " ", count: tabSize) }
  var lineComment: String { language == .python ? "#" : "//" }

  // MARK: Pairs

  /// Brackets and quotes that close themselves. Backticks pair only where they start strings.
  func closer(for value: String) -> String? {
    switch value {
    case "(": return ")"
    case "[": return "]"
    case "{": return "}"
    case "\"": return "\""
    case "'": return "'"
    case "`": return language == .javascript || language == .go ? "`" : nil
    default: return nil
    }
  }

  static let quotes: Set<String> = ["\"", "'", "`"]
  static let closingBrackets: Set<String> = [")", "]", "}"]

  // MARK: Typing

  /// What typing `value` does, or nil to insert it as is. `autoClosed` holds the offsets of closers the editor
  /// inserted itself; only those are typed over or removed as a pair.
  public func type(_ value: String, in text: NSString, selection: NSRange, autoClosed: Set<Int>) -> (edit: CodeEdit, autoCloser: Int?)? {
    let units = Array((text as String).utf16)
    let caret = selection.location
    let next = caret + selection.length < text.length ? text.substring(with: NSRange(location: caret + selection.length, length: 1)) : ""

    // A bracket or quote typed over a selection wraps it.
    if selection.length > 0, let closer = closer(for: value) {
      let inner = text.substring(with: selection)
      if Self.quotes.contains(value), inner.contains("\n") { return nil }
      let edit = CodeEdit(range: selection, text: value + inner + closer, selection: NSRange(location: caret + 1, length: selection.length))
      return (edit, nil)
    }
    guard selection.length == 0 else { return nil }

    // Typing the closer the editor just inserted steps over it.
    if next == value, autoClosed.contains(caret), Self.closingBrackets.contains(value) || Self.quotes.contains(value) {
      return (.caret(caret + 1), nil)
    }

    // A closing bracket on an otherwise blank line lines up with its opener.
    if Self.closingBrackets.contains(value) {
      let line = lineStart(in: text, at: caret)
      let before = text.substring(with: NSRange(location: line, length: caret - line))
      if !before.isEmpty, before.allSatisfy({ $0 == " " || $0 == "\t" }) {
        let scan = CodeIndentation.scan(units, upTo: caret, language: language)
        if !scan.inside, let opener = scan.open.last, CodeIndentation.openers[opener.bracket] == (value as NSString).character(at: 0) {
          let indent = leadingWhitespace(of: lineText(in: text, at: opener.offset))
          if indent != before {
            let edit = CodeEdit(range: NSRange(location: line, length: caret - line), text: indent + value,
                                selection: NSRange(location: line + (indent as NSString).length + 1, length: 0))
            return (edit, nil)
          }
        }
      }
      return nil
    }

    // Python's else, elif, except, and finally line up with the block they continue when their colon is typed.
    if language == .python, value == ":", let edit = dedentContinuation(in: text, caret: caret) { return (edit, nil) }

    guard let closer = closer(for: value) else { return nil }
    let prefix = CodeIndentation.scan(units, upTo: caret, language: language)
    if Self.quotes.contains(value) {
      // Quotes don't pair inside strings or comments, after a word ("don't"), or next to the same quote.
      if prefix.inside { return nil }
      let previous: UInt16 = caret > 0 ? text.character(at: caret - 1) : 32
      if Self.isWord(previous) || previous == (value as NSString).character(at: 0) { return nil }
    }
    // Pair only before whitespace, the end, or punctuation that ends an expression.
    let freeAfter = next.isEmpty || [" ", "\n", "\t", ")", "]", "}", ",", ";", ":", ".", "=", ">"].contains(next)
    guard freeAfter else { return nil }
    let edit = CodeEdit(range: selection, text: value + closer, selection: NSRange(location: caret + 1, length: 0))
    return (edit, caret + 1)
  }

  private func dedentContinuation(in text: NSString, caret: Int) -> CodeEdit? {
    let line = lineStart(in: text, at: caret)
    let before = text.substring(with: NSRange(location: line, length: caret - line))
    let trimmed = before.trimmingCharacters(in: .whitespaces)
    let word = trimmed.prefix { $0.isLetter }
    let heads: [Substring: Set<String>] = [
      "else": ["if", "elif", "for", "while", "try", "except"], "elif": ["if", "elif"],
      "except": ["try", "except"], "finally": ["try", "except", "else"],
    ]
    guard let openers = heads[word] else { return nil }
    let indent = leadingWhitespace(of: before)
    let width = visualWidth(indent)
    // The nearest earlier line, less indented, that starts the block this one continues.
    var cursor = line
    while cursor > 0 {
      let previousLine = lineStart(in: text, at: cursor - 1)
      let content = text.substring(with: NSRange(location: previousLine, length: cursor - 1 - previousLine))
      cursor = previousLine
      let body = content.trimmingCharacters(in: .whitespaces)
      if body.isEmpty || body.hasPrefix("#") { continue }
      let lead = leadingWhitespace(of: content)
      guard visualWidth(lead) < width else { continue }
      let head = String(body.prefix { $0.isLetter })
      guard openers.contains(head), lead != indent else { return nil }
      let replaced = lead + trimmed + ":"
      return CodeEdit(range: NSRange(location: line, length: caret - line), text: replaced,
                      selection: NSRange(location: line + (replaced as NSString).length, length: 0))
    }
    return nil
  }

  // MARK: Enter

  /// A new line: keeps the indentation, adds a level after an opening bracket or a Python colon in code, drops one
  /// after Python's return, pass, break, continue, and raise, splits an empty bracket pair onto three lines, continues
  /// a `/** */` comment, and leaves no trailing spaces on a line that held only indentation.
  public func newline(in text: NSString, selection: NSRange) -> CodeEdit {
    let units = Array((text as String).utf16)
    let caret = selection.location
    let line = lineStart(in: text, at: caret)
    let before = text.substring(with: NSRange(location: line, length: caret - line))
    let indent = leadingWhitespace(of: before)
    let scan = CodeIndentation.scan(units, upTo: caret, language: language)
    let trimmed = before.trimmingCharacters(in: .whitespaces)
    let opener = trimmed.last
    let after = NSMaxRange(selection) < text.length ? text.character(at: NSMaxRange(selection)) : 0

    var newIndent = indent
    var closing: String?
    if scan.inside {
      if scan.inBlockComment, language != .python {
        if trimmed.hasPrefix("/**") { newIndent = indent + " * " } else if trimmed.hasPrefix("*") { newIndent = indent + "* " }
      }
    } else if opener == "{" || opener == "(" || opener == "[" || (language == .python && opener == ":") {
      newIndent = indent + unit
      let pairs: [Character: UInt16] = ["{": 125, "(": 41, "[": 93]
      if let opener, let close = pairs[opener], after == close { closing = "\n" + indent }
    } else if language == .python, Self.endsBlock(trimmed) {
      newIndent = removingOneLevel(from: indent)
    }

    // A line holding only indentation keeps none of it once the caret moves on.
    let blank = !before.isEmpty && trimmed.isEmpty && selection.length == 0 && restOfLineIsEmpty(text, from: caret)
    let range = blank ? NSRange(location: line, length: caret - line) : selection
    let inserted = "\n" + newIndent
    let caretAt = range.location + (inserted as NSString).length
    return CodeEdit(range: range, text: inserted + (closing ?? ""), selection: NSRange(location: caretAt, length: 0))
  }

  static func endsBlock(_ trimmed: String) -> Bool {
    for word in ["return", "pass", "break", "continue", "raise"] where trimmed == word || trimmed.hasPrefix(word + " ") || trimmed.hasPrefix(word + "(") {
      return true
    }
    return false
  }

  // MARK: Backspace

  /// What Backspace does, or nil for the ordinary single-character delete.
  public func backspace(in text: NSString, selection: NSRange, autoClosed: Set<Int>) -> CodeEdit? {
    guard selection.length == 0, selection.location > 0 else { return nil }
    let caret = selection.location
    // Between a pair the editor made, both halves go.
    if caret < text.length, autoClosed.contains(caret), let close = closer(for: text.substring(with: NSRange(location: caret - 1, length: 1))),
       text.substring(with: NSRange(location: caret, length: 1)) == close {
      return CodeEdit(range: NSRange(location: caret - 1, length: 2), text: "", selection: NSRange(location: caret - 1, length: 0))
    }
    // In leading spaces, back to the previous tab stop.
    let line = lineStart(in: text, at: caret)
    let before = text.substring(with: NSRange(location: line, length: caret - line))
    guard !before.isEmpty, before.allSatisfy({ $0 == " " }) else { return nil }
    let count = (before.count - 1) % tabSize + 1
    return CodeEdit(range: NSRange(location: caret - count, length: count), text: "", selection: NSRange(location: caret - count, length: 0))
  }

  // MARK: Tab and Shift-Tab

  /// Tab: spaces to the next tab stop at a caret or within one line; one level on every non-blank selected line.
  public func indent(in text: NSString, selection: NSRange) -> CodeEdit {
    let lines = selectedLines(in: text, selection: selection)
    if selection.length == 0 || lines.count == 1 && !coversWholeLine(text, selection) {
      let line = lineStart(in: text, at: selection.location)
      let column = visualWidth(text.substring(with: NSRange(location: line, length: selection.location - line)))
      let spaces = String(repeating: " ", count: tabSize - column % tabSize)
      return CodeEdit(range: selection, text: spaces, selection: NSRange(location: selection.location + spaces.count, length: 0))
    }
    return transform(text, selection: selection) { line in
      line.trimmingCharacters(in: .whitespaces).isEmpty ? (0, 0, "") : (0, 0, unit)
    }
  }

  /// Shift-Tab: every touched line back to its previous tab stop.
  public func outdent(in text: NSString, selection: NSRange) -> CodeEdit {
    transform(text, selection: selection) { line in
      let lead = leadingWhitespace(of: line)
      guard !lead.isEmpty else { return (0, 0, "") }
      if lead.first == "\t" { return (0, 1, "") }
      let spaces = lead.prefix { $0 == " " }.count
      let width = (spaces - 1) % tabSize + 1
      return (0, min(width, spaces), "")
    }
  }

  // MARK: Comments

  /// Toggles line comments on the touched lines: removes them when every non-blank line has one, otherwise adds them
  /// at the shallowest indentation. A blank line gets a comment marker at its indentation.
  public func toggleComment(in text: NSString, selection: NSRange) -> CodeEdit {
    let lines = selectedLines(in: text, selection: selection)
    let marker = lineComment
    let content = lines.filter { !$0.text.trimmingCharacters(in: .whitespaces).isEmpty }
    if content.isEmpty {
      let line = lines[0]
      let lead = leadingWhitespace(of: line.text)
      let insert = marker + " "
      let at = line.start + (lead as NSString).length
      return CodeEdit(range: NSRange(location: line.start, length: (line.text as NSString).length),
                      text: lead + insert, selection: NSRange(location: at + (insert as NSString).length, length: 0))
    }
    let commented = content.allSatisfy { $0.text.trimmingCharacters(in: .whitespaces).hasPrefix(marker) }
    let column = content.map { (leadingWhitespace(of: $0.text) as NSString).length }.min() ?? 0
    return transform(text, selection: selection) { line in
      let trimmedLine = line.trimmingCharacters(in: .whitespaces)
      guard !trimmedLine.isEmpty else { return (0, 0, "") }
      let lead = (leadingWhitespace(of: line) as NSString).length
      if commented {
        let rest = (line as NSString).substring(from: lead)
        let removed = marker.count + (rest.dropFirst(marker.count).first == " " ? 1 : 0)
        return (lead, removed, "")
      }
      return (min(column, lead), 0, marker + " ")
    }
  }

  // MARK: Lines

  /// Option-Up and Option-Down: moves the touched lines past the neighboring line, keeping them selected.
  public func moveLines(in text: NSString, selection: NSRange, up: Bool) -> CodeEdit? {
    let block = lineBlock(in: text, selection: selection)
    if up {
      guard block.location > 0 else { return nil }
      let previous = lineStart(in: text, at: block.location - 1)
      let neighbor = text.substring(with: NSRange(location: previous, length: block.location - previous))
      var moved = text.substring(with: block)
      var tail = neighbor
      if !moved.hasSuffix("\n") { moved += "\n"; tail = String(tail.dropLast()) }
      let range = NSRange(location: previous, length: NSMaxRange(block) - previous)
      let shift = (neighbor as NSString).length
      return CodeEdit(range: range, text: moved + tail, selection: NSRange(location: selection.location - shift, length: selection.length))
    }
    guard NSMaxRange(block) < text.length else { return nil }
    let nextEnd = NSMaxRange(text.lineRange(for: NSRange(location: NSMaxRange(block), length: 0)))
    var neighbor = text.substring(with: NSRange(location: NSMaxRange(block), length: nextEnd - NSMaxRange(block)))
    var moved = text.substring(with: block)
    if !neighbor.hasSuffix("\n") { neighbor += "\n"; moved = String(moved.dropLast()) }
    let range = NSRange(location: block.location, length: nextEnd - block.location)
    let shift = (neighbor as NSString).length
    return CodeEdit(range: range, text: neighbor + moved, selection: NSRange(location: selection.location + shift, length: selection.length))
  }

  /// Shift-Option-Up and Shift-Option-Down: duplicates the touched lines; the selection follows the copy downward.
  public func copyLines(in text: NSString, selection: NSRange, up: Bool) -> CodeEdit {
    let block = lineBlock(in: text, selection: selection)
    var copy = text.substring(with: block)
    var insertAt = NSMaxRange(block)
    if !copy.hasSuffix("\n") { copy = "\n" + copy; insertAt = NSMaxRange(block) }
    let shift = up ? 0 : (copy as NSString).length
    return CodeEdit(range: NSRange(location: insertAt, length: 0), text: copy, selection: NSRange(location: selection.location + shift, length: selection.length))
  }

  /// Command-Shift-K: deletes the touched lines; the caret lands on the next line.
  public func deleteLines(in text: NSString, selection: NSRange) -> CodeEdit {
    var block = lineBlock(in: text, selection: selection)
    // The last line takes the newline before it instead.
    if NSMaxRange(block) == text.length, !text.substring(with: block).hasSuffix("\n"), block.location > 0 {
      block = NSRange(location: block.location - 1, length: block.length + 1)
    }
    let caret = min(block.location, max(0, text.length - block.length))
    return CodeEdit(range: block, text: "", selection: NSRange(location: caret, length: 0))
  }

  // MARK: Helpers

  static func isWord(_ unit: UInt16) -> Bool {
    (unit >= 65 && unit <= 90) || (unit >= 97 && unit <= 122) || (unit >= 48 && unit <= 57) || unit == 95 || unit == 36 || unit > 127
  }

  func lineStart(in text: NSString, at offset: Int) -> Int {
    text.lineRange(for: NSRange(location: min(offset, text.length), length: 0)).location
  }

  func lineText(in text: NSString, at offset: Int) -> String {
    let range = text.lineRange(for: NSRange(location: offset, length: 0))
    return text.substring(with: range).trimmingCharacters(in: .newlines)
  }

  func leadingWhitespace(of line: String) -> String { String(line.prefix { $0 == " " || $0 == "\t" }) }

  func visualWidth(_ prefix: String) -> Int {
    prefix.reduce(0) { width, char in char == "\t" ? width + tabSize - width % tabSize : width + 1 }
  }

  func removingOneLevel(from indent: String) -> String {
    if indent.hasSuffix("\t") { return String(indent.dropLast()) }
    let spaces = indent.reversed().prefix { $0 == " " }.count
    return String(indent.dropLast(min(spaces, (spaces - 1) % tabSize + 1)))
  }

  func restOfLineIsEmpty(_ text: NSString, from offset: Int) -> Bool {
    offset >= text.length || text.character(at: offset) == 10
  }

  func coversWholeLine(_ text: NSString, _ selection: NSRange) -> Bool {
    let line = text.lineRange(for: selection)
    let content = text.substring(with: line).trimmingCharacters(in: .newlines)
    return selection.location == line.location && selection.length >= (content as NSString).length
  }

  /// The full lines a selection touches. A selection ending at the start of a line doesn't take that line.
  func lineBlock(in text: NSString, selection: NSRange) -> NSRange {
    var end = NSMaxRange(selection)
    if selection.length > 0, end > selection.location, end <= text.length, text.character(at: end - 1) == 10 { end -= 1 }
    return text.lineRange(for: NSRange(location: selection.location, length: max(0, end - selection.location)))
  }

  func selectedLines(in text: NSString, selection: NSRange) -> [(start: Int, text: String)] {
    let block = lineBlock(in: text, selection: selection)
    var lines: [(Int, String)] = []
    var at = block.location
    while at < NSMaxRange(block) || (at == block.location && lines.isEmpty) {
      let range = text.lineRange(for: NSRange(location: at, length: 0))
      lines.append((range.location, text.substring(with: range).trimmingCharacters(in: .newlines)))
      if NSMaxRange(range) == at { break }
      at = NSMaxRange(range)
    }
    return lines
  }

  /// Applies a per-line change — remove `count` units at `column`, then insert `text` there — to every touched line,
  /// and maps the selection through it so it stays on the same characters.
  func transform(_ text: NSString, selection: NSRange, _ change: (String) -> (column: Int, count: Int, text: String)) -> CodeEdit {
    let block = lineBlock(in: text, selection: selection)
    let lines = selectedLines(in: text, selection: selection)
    var output = ""
    var edits: [(at: Int, removed: Int, inserted: Int)] = []
    var cursor = block.location
    for line in lines {
      let (column, count, insert) = change(line.text)
      let ns = line.text as NSString
      let removed = min(count, ns.length - column)
      output += text.substring(with: NSRange(location: cursor, length: line.start - cursor))
      output += ns.substring(to: column) + insert + ns.substring(from: column + removed)
      cursor = line.start + ns.length
      edits.append((line.start + column, removed, (insert as NSString).length))
    }
    output += text.substring(with: NSRange(location: cursor, length: NSMaxRange(block) - cursor))
    func map(_ offset: Int, isEnd: Bool) -> Int {
      var shift = 0
      for edit in edits {
        if offset > edit.at || (offset == edit.at && (isEnd || edit.removed > 0)) {
          shift += edit.inserted - min(edit.removed, max(0, offset - edit.at))
        }
      }
      return offset + shift
    }
    let start = map(selection.location, isEnd: false)
    let end = selection.length == 0 ? start : map(NSMaxRange(selection), isEnd: true)
    let caretOnly = selection.length == 0 ? map(selection.location, isEnd: true) : start
    let newSelection = selection.length == 0 ? NSRange(location: caretOnly, length: 0) : NSRange(location: start, length: max(0, end - start))
    return CodeEdit(range: block, text: output, selection: newSelection)
  }
}
