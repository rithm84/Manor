import Foundation

/// A hand-written lexer for the six solution languages. It colors comments, strings, numbers, keywords, built-in
/// types, type names, calls, constants, and preprocessor lines or annotations; the language server supplies the
/// semantic intelligence. Ranges are UTF-16, so they apply directly to an `NSTextStorage`.
public enum ProblemSyntax {
  public enum Kind: Hashable, Sendable { case keyword, type, function, string, number, comment, attribute, constant }

  public struct Token: Hashable, Sendable {
    public let range: NSRange
    public let kind: Kind
  }

  struct Grammar {
    let keywords: Set<String>
    let types: Set<String>
    let constants: Set<String>
    let lineComment: String
    let blockComments: Bool
    let backtickStrings: Bool
    let tripleQuotes: Bool
    let decorators: Bool
    let preprocessor: Bool
  }

  static func grammar(_ language: ProblemLanguage) -> Grammar {
    switch language {
    case .python:
      return Grammar(
        keywords: ["and", "as", "assert", "async", "await", "break", "class", "continue", "def", "del", "elif", "else", "except", "finally", "for", "from", "global", "if", "import", "in", "is", "lambda", "nonlocal", "not", "or", "pass", "raise", "return", "try", "while", "with", "yield", "match", "case"],
        types: ["int", "float", "str", "bool", "list", "dict", "set", "tuple", "object", "bytes", "complex", "frozenset", "List", "Dict", "Set", "Tuple", "Optional", "Deque"],
        constants: ["True", "False", "None", "self", "cls"], lineComment: "#", blockComments: false, backtickStrings: false, tripleQuotes: true, decorators: true, preprocessor: false
      )
    case .javascript:
      return Grammar(
        keywords: ["async", "await", "break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete", "do", "else", "export", "extends", "finally", "for", "function", "if", "import", "in", "instanceof", "let", "new", "of", "return", "static", "super", "switch", "throw", "try", "typeof", "var", "void", "while", "yield", "get", "set"],
        types: [], constants: ["true", "false", "null", "undefined", "this", "NaN", "Infinity"],
        lineComment: "//", blockComments: true, backtickStrings: true, tripleQuotes: false, decorators: false, preprocessor: false
      )
    case .java:
      return Grammar(
        keywords: ["abstract", "assert", "break", "case", "catch", "class", "continue", "default", "do", "else", "enum", "extends", "final", "finally", "for", "if", "implements", "import", "instanceof", "interface", "native", "new", "package", "private", "protected", "public", "return", "static", "strictfp", "super", "switch", "synchronized", "throw", "throws", "transient", "try", "volatile", "while", "var", "record", "yield"],
        types: ["boolean", "byte", "char", "double", "float", "int", "long", "short", "void"],
        constants: ["true", "false", "null", "this"], lineComment: "//", blockComments: true, backtickStrings: false, tripleQuotes: false, decorators: true, preprocessor: false
      )
    case .go:
      return Grammar(
        keywords: ["break", "case", "chan", "const", "continue", "default", "defer", "else", "fallthrough", "for", "func", "go", "goto", "if", "import", "interface", "map", "package", "range", "return", "select", "struct", "switch", "type", "var"],
        types: ["bool", "byte", "complex64", "complex128", "error", "float32", "float64", "int", "int8", "int16", "int32", "int64", "rune", "string", "uint", "uint8", "uint16", "uint32", "uint64", "uintptr", "any"],
        constants: ["true", "false", "nil", "iota"], lineComment: "//", blockComments: true, backtickStrings: true, tripleQuotes: false, decorators: false, preprocessor: false
      )
    case .cpp:
      return Grammar(
        keywords: ["alignas", "alignof", "break", "case", "catch", "class", "const", "constexpr", "const_cast", "continue", "decltype", "default", "delete", "do", "dynamic_cast", "else", "enum", "explicit", "export", "extern", "for", "friend", "goto", "if", "inline", "mutable", "namespace", "new", "noexcept", "operator", "private", "protected", "public", "register", "reinterpret_cast", "return", "sizeof", "static", "static_assert", "static_cast", "struct", "switch", "template", "throw", "try", "typedef", "typeid", "typename", "union", "using", "virtual", "volatile", "while"],
        types: ["auto", "bool", "char", "double", "float", "int", "long", "short", "signed", "unsigned", "void", "size_t", "string", "vector", "map", "set", "unordered_map", "unordered_set", "pair", "queue", "stack", "deque", "priority_queue", "array", "list", "tuple", "int64_t", "uint64_t", "int32_t"],
        constants: ["true", "false", "nullptr", "NULL", "this"], lineComment: "//", blockComments: true, backtickStrings: false, tripleQuotes: false, decorators: false, preprocessor: true
      )
    case .c:
      return Grammar(
        keywords: ["auto", "break", "case", "const", "continue", "default", "do", "else", "enum", "extern", "for", "goto", "if", "inline", "register", "restrict", "return", "sizeof", "static", "struct", "switch", "typedef", "union", "volatile", "while"],
        types: ["bool", "char", "double", "float", "int", "long", "short", "signed", "unsigned", "void", "size_t", "int64_t", "uint64_t", "int32_t", "FILE"],
        constants: ["true", "false", "NULL"], lineComment: "//", blockComments: true, backtickStrings: false, tripleQuotes: false, decorators: false, preprocessor: true
      )
    }
  }

  /// The language's keywords, constants, and built-in types, for completion before the language server connects.
  public static func words(_ language: ProblemLanguage) -> [String] {
    let grammar = grammar(language)
    return grammar.keywords.union(grammar.constants).union(grammar.types).sorted()
  }

  /// The prefix that starts a line comment.
  public static func lineComment(_ language: ProblemLanguage) -> String { grammar(language).lineComment }

  private static func isIdentifierStart(_ unit: UInt16) -> Bool {
    (unit >= 65 && unit <= 90) || (unit >= 97 && unit <= 122) || unit == 95 || unit == 36 || unit > 127
  }

  private static func isIdentifierPart(_ unit: UInt16) -> Bool { isIdentifierStart(unit) || (unit >= 48 && unit <= 57) }
  private static func isDigit(_ unit: UInt16) -> Bool { unit >= 48 && unit <= 57 }

  /// Where a line starts: inside nothing, a block comment, a multi-line string, or a continued preprocessor line.
  public enum LineState: Hashable, Sendable {
    case normal
    case blockComment
    case string(quote: UInt16, triple: Bool)
    case preprocessor
  }

  /// Every token of a whole text.
  public static func tokens(_ text: String, language: ProblemLanguage) -> [Token] {
    let highlighter = ProblemSyntaxHighlighter(language: language)
    return highlighter.reset(units: Array(text.utf16))
  }

  /// Lexes one line, `units[start..<end]` without its line break, starting in `state`.
  static func lexLine(_ units: [UInt16], start: Int, end: Int, state: LineState, grammar: Grammar, language: ProblemLanguage, into tokens: inout [Token]) -> LineState {
    var index = start
    func add(_ from: Int, _ to: Int, _ kind: Kind) { if to > from { tokens.append(Token(range: NSRange(location: from, length: to - from), kind: kind)) } }
    /// Scans a string body from `from` for its closing quote; returns the end and whether it closed.
    func scanString(from: Int, quote: UInt16, triple: Bool) -> (end: Int, closed: Bool) {
      var position = from
      let escapes = quote != 96 || language == .javascript
      while position < end {
        let current = units[position]
        if current == 92, escapes { position += 2; continue }
        if current == quote {
          if !triple { return (position + 1, true) }
          if position + 2 < end, units[position + 1] == quote, units[position + 2] == quote { return (position + 3, true) }
        }
        position += 1
      }
      return (end, false)
    }
    func lastNonSpaceIsBackslash() -> Bool {
      var position = end - 1
      while position >= start, units[position] == 32 || units[position] == 9 || units[position] == 13 { position -= 1 }
      return position >= start && units[position] == 92
    }

    switch state {
    case .normal: break
    case .blockComment:
      var position = index
      while position + 1 < end, !(units[position] == 42 && units[position + 1] == 47) { position += 1 }
      if position + 1 < end { add(index, position + 2, .comment); index = position + 2 } else { add(index, end, .comment); return .blockComment }
    case .string(let quote, let triple):
      let scanned = scanString(from: index, quote: quote, triple: triple)
      add(index, scanned.end, .string)
      if !scanned.closed { return state }
      index = scanned.end
    case .preprocessor:
      add(index, end, .attribute)
      return lastNonSpaceIsBackslash() ? .preprocessor : .normal
    }

    let comment = Array(grammar.lineComment.utf16)
    var first = true
    while index < end {
      let unit = units[index]
      if unit == 32 || unit == 9 || unit == 13 { index += 1; continue }
      let atLineStart = first && state == .normal
      first = false
      if grammar.preprocessor, atLineStart, unit == 35 {
        add(index, end, .attribute)
        return lastNonSpaceIsBackslash() ? .preprocessor : .normal
      }
      if index + comment.count <= end, comment.indices.allSatisfy({ units[index + $0] == comment[$0] }) {
        add(index, end, .comment)
        return .normal
      }
      if grammar.blockComments, unit == 47, index + 1 < end, units[index + 1] == 42 {
        var position = index + 2
        while position + 1 < end, !(units[position] == 42 && units[position + 1] == 47) { position += 1 }
        if position + 1 < end { add(index, position + 2, .comment); index = position + 2; continue }
        add(index, end, .comment)
        return .blockComment
      }
      if unit == 34 || unit == 39 || (unit == 96 && grammar.backtickStrings) {
        let triple = grammar.tripleQuotes && index + 2 < end && units[index + 1] == unit && units[index + 2] == unit
        let scanned = scanString(from: index + (triple ? 3 : 1), quote: unit, triple: triple)
        add(index, scanned.end, .string)
        if !scanned.closed, triple || unit == 96 { return .string(quote: unit, triple: triple) }
        index = scanned.end
        continue
      }
      if isDigit(unit) || (unit == 46 && index + 1 < end && isDigit(units[index + 1])) {
        var position = index + 1
        while position < end, isIdentifierPart(units[position]) || units[position] == 46 || (units[position] == 39 && language == .cpp) { position += 1 }
        add(index, position, .number)
        index = position
        continue
      }
      if unit == 64, grammar.decorators, index + 1 < end, isIdentifierStart(units[index + 1]) {
        var position = index + 1
        while position < end, isIdentifierPart(units[position]) || units[position] == 46 { position += 1 }
        add(index, position, .attribute)
        index = position
        continue
      }
      if isIdentifierStart(unit) {
        var position = index + 1
        while position < end, isIdentifierPart(units[position]) { position += 1 }
        let word = String(decoding: units[index..<position], as: UTF16.self)
        var next = position
        while next < end, units[next] == 32 { next += 1 }
        let kind: Kind?
        if grammar.keywords.contains(word) { kind = .keyword } else if grammar.constants.contains(word) { kind = .constant } else if grammar.types.contains(word) { kind = .type } else if next < end, units[next] == 40 { kind = .function } else if let initial = word.unicodeScalars.first, initial.properties.isUppercase, word.count > 1 { kind = .type } else { kind = nil }
        if let kind { add(index, position, kind) }
        index = position
        continue
      }
      index += 1
    }
    return .normal
  }
}

/// Incremental highlighting: the lexer state at the start of every line is kept, so an edit re-lexes from the
/// edited line only until the state after a line matches what it was before the edit. Typing inside one line
/// re-lexes that line; opening a block comment re-lexes until the comment closes.
public final class ProblemSyntaxHighlighter: @unchecked Sendable {
  public let language: ProblemLanguage
  private let grammar: ProblemSyntax.Grammar
  /// UTF-16 offsets where each line starts; only line feeds break lines.
  public private(set) var lineStarts: [Int] = [0]
  private var states: [ProblemSyntax.LineState] = [.normal]
  private var length = 0

  public init(language: ProblemLanguage) {
    self.language = language
    grammar = ProblemSyntax.grammar(language)
  }

  /// Lexes a whole text and returns its tokens.
  public func reset(units: [UInt16]) -> [ProblemSyntax.Token] {
    length = units.count
    lineStarts = [0]
    for (index, unit) in units.enumerated() where unit == 10 { lineStarts.append(index + 1) }
    states = Array(repeating: .normal, count: lineStarts.count)
    var tokens: [ProblemSyntax.Token] = []
    for line in lineStarts.indices {
      let next = ProblemSyntax.lexLine(units, start: lineStarts[line], end: lineEnd(line), state: states[line], grammar: grammar, language: language, into: &tokens)
      if line + 1 < states.count { states[line + 1] = next }
    }
    return tokens
  }

  private func lineEnd(_ line: Int) -> Int { line + 1 < lineStarts.count ? lineStarts[line + 1] - 1 : length }

  public func line(of offset: Int) -> Int {
    var low = 0, high = lineStarts.count - 1
    while low < high {
      let middle = (low + high + 1) / 2
      if lineStarts[middle] <= offset { low = middle } else { high = middle - 1 }
    }
    return low
  }

  /// Applies an edit that replaced `replaced` (in the previous text) with `insertedLength` units, and returns the
  /// range of the new text that was re-lexed with its tokens. Everything outside that range keeps its colors.
  public func edit(units: [UInt16], replaced: NSRange, insertedLength: Int) -> (range: NSRange, tokens: [ProblemSyntax.Token]) {
    let delta = insertedLength - replaced.length
    let firstLine = line(of: replaced.location)
    let lastOldLine = line(of: NSMaxRange(replaced))
    let editEnd = replaced.location + insertedLength
    var newStarts = Array(lineStarts[0...firstLine])
    var position = lineStarts[firstLine]
    while position < editEnd {
      if units[position] == 10 { newStarts.append(position + 1) }
      position += 1
    }
    let insertedLines = newStarts.count - 1 - firstLine
    let tailStarts = lineStarts[(lastOldLine + 1)...].map { $0 + delta }
    let tailStates = Array(states[(lastOldLine + 1)...])
    newStarts.append(contentsOf: tailStarts)
    var newStates = Array(states[0...firstLine])
    newStates.append(contentsOf: Array(repeating: ProblemSyntax.LineState.normal, count: insertedLines))
    newStates.append(contentsOf: tailStates)
    lineStarts = newStarts
    states = newStates
    length = units.count

    let lastEditedLine = firstLine + insertedLines
    var tokens: [ProblemSyntax.Token] = []
    var line = firstLine
    while true {
      let next = ProblemSyntax.lexLine(units, start: lineStarts[line], end: lineEnd(line), state: states[line], grammar: grammar, language: language, into: &tokens)
      guard line + 1 < lineStarts.count else { break }
      let converged = line >= lastEditedLine && states[line + 1] == next
      states[line + 1] = next
      if converged { break }
      line += 1
    }
    let end = line + 1 < lineStarts.count ? lineStarts[line + 1] : length
    let start = lineStarts[firstLine]
    return (NSRange(location: start, length: max(0, min(end, length) - start)), tokens)
  }
}
