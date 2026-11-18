import Foundation

/// The Language Server Protocol shapes the editor uses, decoded from `JSONValue`. Positions are UTF-16 code units,
/// which match `NSString` offsets in the text view.
public struct LSPPosition: Hashable, Sendable {
  public var line: Int
  public var character: Int
  public init(line: Int, character: Int) { self.line = line; self.character = character }

  init?(_ value: JSONValue?) {
    guard let line = value?["line"]?.int, let character = value?["character"]?.int else { return nil }
    self.init(line: line, character: character)
  }

  var json: JSONValue { ["line": .number(Double(line)), "character": .number(Double(character))] }
}

public struct LSPRange: Hashable, Sendable {
  public var start: LSPPosition
  public var end: LSPPosition
  public init(start: LSPPosition, end: LSPPosition) { self.start = start; self.end = end }

  init?(_ value: JSONValue?) {
    guard let start = LSPPosition(value?["start"]), let end = LSPPosition(value?["end"]) else { return nil }
    self.init(start: start, end: end)
  }
}

public struct LSPTextEdit: Hashable, Sendable {
  public var range: LSPRange
  public var newText: String

  init?(_ value: JSONValue?) {
    guard let newText = value?["newText"]?.string else { return nil }
    // An InsertReplaceEdit carries `insert` and `replace`; the editor applies the replace range.
    guard let range = LSPRange(value?["range"]) ?? LSPRange(value?["replace"]) ?? LSPRange(value?["insert"]) else { return nil }
    self.range = range
    self.newText = newText
  }
}

public enum LSPDiagnosticSeverity: Int, Sendable { case error = 1, warning = 2, information = 3, hint = 4 }

public struct LSPDiagnostic: Hashable, Sendable {
  public var range: LSPRange
  public var severity: LSPDiagnosticSeverity
  public var message: String
  public var source: String?

  public init(range: LSPRange, severity: LSPDiagnosticSeverity, message: String, source: String?) {
    self.range = range; self.severity = severity; self.message = message; self.source = source
  }

  init?(_ value: JSONValue) {
    guard let range = LSPRange(value["range"]), let message = value["message"]?.string else { return nil }
    self.range = range
    self.severity = value["severity"]?.int.flatMap(LSPDiagnosticSeverity.init(rawValue:)) ?? .error
    self.message = message
    self.source = value["source"]?.string
  }
}

/// The completion kinds the editor draws icons for (`CompletionItemKind`).
public enum LSPCompletionKind: Int, Sendable {
  case text = 1, method, function, constructor, field, variable, `class`, interface, module, property, unit, value,
       `enum`, keyword, snippet, color, file, reference, folder, enumMember, constant, `struct`, event, `operator`, typeParameter
}

public struct LSPCompletionItem: Hashable, Sendable, Identifiable {
  public var id: Int
  public var label: String
  public var kind: LSPCompletionKind?
  public var detail: String?
  public var documentation: String?
  /// The text to insert, with snippet placeholders already resolved to their defaults.
  public var insertText: String
  /// Where the caret lands inside `insertText` after a snippet; nil puts it at the end.
  public var caretOffset: Int?
  public var edit: LSPRange?
  public var filterText: String
  public var sortText: String
  public var preselect: Bool
  public var deprecated: Bool
  public var additionalEdits: [LSPTextEdit]

  public init(id: Int, label: String, kind: LSPCompletionKind?, detail: String?, documentation: String?, insertText: String, caretOffset: Int?, edit: LSPRange?, filterText: String, sortText: String, preselect: Bool, deprecated: Bool, additionalEdits: [LSPTextEdit]) {
    self.id = id; self.label = label; self.kind = kind; self.detail = detail; self.documentation = documentation
    self.insertText = insertText; self.caretOffset = caretOffset; self.edit = edit; self.filterText = filterText
    self.sortText = sortText; self.preselect = preselect; self.deprecated = deprecated; self.additionalEdits = additionalEdits
  }

  init?(_ value: JSONValue, index: Int) {
    guard let label = value["label"]?.string else { return nil }
    let textEdit = LSPTextEdit(value["textEdit"])
    let raw = textEdit?.newText ?? value["insertText"]?.string ?? label
    let snippet = value["insertTextFormat"]?.int == 2
    let expanded = snippet ? LSPSnippet.expand(raw) : (raw, nil)
    let labelDetail = value["labelDetails"]?["detail"]?.string
    self.init(
      id: index, label: label + (labelDetail ?? ""), kind: value["kind"]?.int.flatMap(LSPCompletionKind.init(rawValue:)),
      detail: value["detail"]?.string ?? value["labelDetails"]?["description"]?.string,
      documentation: LSPMarkup.text(value["documentation"]), insertText: expanded.0, caretOffset: expanded.1,
      edit: textEdit?.range, filterText: value["filterText"]?.string ?? label, sortText: value["sortText"]?.string ?? label,
      preselect: value["preselect"]?.bool ?? false,
      deprecated: value["deprecated"]?.bool ?? (value["tags"]?.array?.contains(.number(1)) ?? false),
      additionalEdits: value["additionalTextEdits"]?.array?.compactMap { LSPTextEdit($0) } ?? []
    )
  }

  /// Both shapes of a completion response: an item array or a `CompletionList`.
  public static func list(from value: JSONValue) -> (items: [LSPCompletionItem], incomplete: Bool) {
    let raw = value.array ?? value["items"]?.array ?? []
    return (raw.enumerated().compactMap { LSPCompletionItem($1, index: $0) }, value["isIncomplete"]?.bool ?? false)
  }
}

public struct LSPHover: Hashable, Sendable {
  /// Markdown (or plain text) to show.
  public var contents: String
  public var range: LSPRange?

  init?(_ value: JSONValue) {
    guard let text = LSPMarkup.text(value["contents"]), !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
    contents = text
    range = LSPRange(value["range"])
  }
}

public struct LSPSignatureHelp: Hashable, Sendable {
  public struct Signature: Hashable, Sendable {
    public var label: String
    public var documentation: String?
    /// UTF-16 ranges of each parameter inside `label`.
    public var parameters: [Range<Int>]
  }
  public var signatures: [Signature]
  public var activeSignature: Int
  public var activeParameter: Int

  init?(_ value: JSONValue) {
    let signatures: [Signature] = (value["signatures"]?.array ?? []).compactMap { signature in
      guard let label = signature["label"]?.string else { return nil }
      let utf16 = label.utf16
      // String labels are found in order, after the opening parenthesis, so `a` in `max(a, b)` is the parameter.
      var searchFrom = label.firstIndex(of: "(").map { label.index(after: $0) } ?? label.startIndex
      var parameters: [Range<Int>] = []
      for parameter in signature["parameters"]?.array ?? [] {
        if let offsets = parameter["label"]?.array, offsets.count == 2, let start = offsets[0].int, let end = offsets[1].int, start <= end {
          parameters.append(start..<end)
          continue
        }
        guard let text = parameter["label"]?.string, let found = label.range(of: text, range: searchFrom..<label.endIndex) else { continue }
        let start = utf16.distance(from: utf16.startIndex, to: found.lowerBound)
        parameters.append(start..<(start + text.utf16.count))
        searchFrom = found.upperBound
      }
      return Signature(label: label, documentation: LSPMarkup.text(signature["documentation"]), parameters: parameters)
    }
    guard !signatures.isEmpty else { return nil }
    self.signatures = signatures
    let active = min(max(value["activeSignature"]?.int ?? 0, 0), signatures.count - 1)
    activeSignature = active
    activeParameter = value["signatures"]?.array?[active]["activeParameter"]?.int ?? value["activeParameter"]?.int ?? 0
  }
}

/// `MarkupContent`, `MarkedString`, or arrays of them, as Markdown text.
public enum LSPMarkup {
  public static func text(_ value: JSONValue?) -> String? {
    guard let value else { return nil }
    switch value {
    case .string(let text): return text.isEmpty ? nil : text
    case .array(let items):
      let parts = items.compactMap { text($0) }
      return parts.isEmpty ? nil : parts.joined(separator: "\n\n")
    case .object(let object):
      if let markup = object["value"]?.string {
        if let language = object["language"]?.string { return "```\(language)\n\(markup)\n```" }
        return markup.isEmpty ? nil : markup
      }
      return nil
    default: return nil
    }
  }
}

/// Resolves a snippet to plain text: placeholders keep their default text, choices their first option, and the caret
/// lands at `$0`, or the first tab stop when there is no `$0`.
public enum LSPSnippet {
  public static func expand(_ snippet: String) -> (text: String, caret: Int?) {
    var output = ""
    var stops: [(number: Int, offset: Int)] = []
    let characters = Array(snippet)
    var index = 0
    func utf16Count() -> Int { output.utf16.count }
    func parse(until terminator: Character?) {
      while index < characters.count {
        let character = characters[index]
        if let terminator, character == terminator { return }
        if character == "\\", index + 1 < characters.count {
          output.append(characters[index + 1]); index += 2; continue
        }
        if character == "$", index + 1 < characters.count {
          let next = characters[index + 1]
          if next.isNumber {
            var digits = ""
            index += 1
            while index < characters.count, characters[index].isNumber { digits.append(characters[index]); index += 1 }
            stops.append((Int(digits) ?? 0, utf16Count()))
            continue
          }
          if next == "{" {
            index += 2
            var digits = ""
            while index < characters.count, characters[index].isNumber { digits.append(characters[index]); index += 1 }
            let number = Int(digits)
            if let number { stops.append((number, utf16Count())) }
            if index < characters.count, characters[index] == ":" {
              index += 1
              parse(until: "}")
            } else if index < characters.count, characters[index] == "|" {
              index += 1
              var choice = ""
              while index < characters.count, characters[index] != "|", characters[index] != "," { choice.append(characters[index]); index += 1 }
              output += choice
              while index < characters.count, characters[index] != "}" { index += 1 }
            } else {
              // A variable such as ${TM_FILENAME} has no value here.
              while index < characters.count, characters[index] != "}" { index += 1 }
            }
            if index < characters.count, characters[index] == "}" { index += 1 }
            continue
          }
        }
        output.append(character)
        index += 1
      }
    }
    parse(until: nil)
    if let final = stops.first(where: { $0.number == 0 }) { return (output, final.offset) }
    if let first = stops.filter({ $0.number > 0 }).min(by: { $0.number < $1.number }) { return (output, first.offset) }
    return (output, nil)
  }
}

/// Converts between UTF-16 offsets and LSP line/character positions for one text.
public struct LSPLineIndex: Sendable {
  private let lineStarts: [Int]
  public let length: Int

  public init(_ text: String) {
    var starts = [0]
    var offset = 0
    var previousWasCR = false
    for unit in text.utf16 {
      offset += 1
      if unit == 10 {
        if previousWasCR { starts[starts.count - 1] = offset } else { starts.append(offset) }
        previousWasCR = false
      } else if unit == 13 {
        starts.append(offset)
        previousWasCR = true
      } else {
        previousWasCR = false
      }
    }
    lineStarts = starts
    length = offset
  }

  public func position(of offset: Int) -> LSPPosition {
    let clamped = min(max(offset, 0), length)
    var low = 0, high = lineStarts.count - 1
    while low < high {
      let middle = (low + high + 1) / 2
      if lineStarts[middle] <= clamped { low = middle } else { high = middle - 1 }
    }
    return LSPPosition(line: low, character: clamped - lineStarts[low])
  }

  public func offset(of position: LSPPosition) -> Int {
    guard position.line >= 0 else { return 0 }
    guard position.line < lineStarts.count else { return length }
    let start = lineStarts[position.line]
    let end = position.line + 1 < lineStarts.count ? lineStarts[position.line + 1] : length
    return min(start + max(position.character, 0), end)
  }

  public func range(of range: LSPRange) -> NSRange {
    let start = offset(of: range.start)
    let end = max(start, offset(of: range.end))
    return NSRange(location: start, length: end - start)
  }
}
