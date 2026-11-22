import Foundation

/// A light lexical pass over source for the code editor's typing rules: whether a position is inside a string or
/// comment, and which brackets are still open there. Offsets are UTF-16, matching `NSString` and the text view.
public enum CodeIndentation {
  public struct Scan: Sendable {
    /// The position ends inside a string or comment.
    public var inside: Bool
    /// Whether that string or comment is a block comment (`/* … */`).
    public var inBlockComment: Bool
    /// Unmatched opening brackets in code, innermost last, as (offset, character).
    public var open: [(offset: Int, bracket: UInt16)]
  }

  /// Whether `prefix` (the source from its start up to the caret) ends inside a string or comment.
  public static func isInsideStringOrComment(_ prefix: String, language: ProblemLanguage) -> Bool {
    scan(Array(prefix.utf16), upTo: nil, language: language).inside
  }

  static let openers: [UInt16: UInt16] = [40: 41, 91: 93, 123: 125]  // ( ) [ ] { }
  static let closers: [UInt16: UInt16] = [41: 40, 93: 91, 125: 123]

  /// Scans `units[0..<end]` and reports where it ends: in code or not, and the brackets still open.
  public static func scan(_ units: [UInt16], upTo end: Int?, language: ProblemLanguage,
                          onPair: ((_ open: Int, _ close: Int) -> Void)? = nil) -> Scan {
    let limit = min(end ?? units.count, units.count)
    let python = language == .python
    var open: [(offset: Int, bracket: UInt16)] = []
    var i = 0
    func has(_ token: [UInt16], _ k: Int) -> Bool {
      k + token.count <= limit && Array(units[k..<k + token.count]) == token
    }
    let slash: UInt16 = 47, star: UInt16 = 42, hash: UInt16 = 35, newline: UInt16 = 10, backslash: UInt16 = 92
    let quote: UInt16 = 34, apostrophe: UInt16 = 39, backtick: UInt16 = 96

    while i < limit {
      let c = units[i]
      if python ? c == hash : has([slash, slash], i) {
        // A line comment runs to the end of its line.
        var k = i
        while k < limit, units[k] != newline { k += 1 }
        if k >= limit { return Scan(inside: true, inBlockComment: false, open: open) }
        i = k + 1
      } else if !python, has([slash, star], i) {
        var k = i + 2
        while k < limit, !has([star, slash], k) { k += 1 }
        if k >= limit { return Scan(inside: true, inBlockComment: true, open: open) }
        i = k + 2
      } else if python, c == quote || c == apostrophe, has([c, c, c], i) {
        var k = i + 3
        while k < limit, !has([c, c, c], k) { k += units[k] == backslash ? 2 : 1 }
        if k >= limit { return Scan(inside: true, inBlockComment: false, open: open) }
        i = k + 3
      } else if c == quote || c == apostrophe || (c == backtick && (language == .javascript || language == .go)) {
        // Backtick strings (JavaScript templates, Go raw strings) span lines; quoted ones end at the line.
        let multiline = c == backtick
        let escapes = !(language == .go && multiline)
        var k = i + 1
        var closed = false
        while k < limit {
          let d = units[k]
          if escapes, d == backslash { k += 2; continue }
          if d == c { closed = true; break }
          if d == newline, !multiline { break }
          k += 1
        }
        if !closed, k >= limit { return Scan(inside: true, inBlockComment: false, open: open) }
        i = k + 1
      } else {
        if openers[c] != nil {
          open.append((i, c))
        } else if let opener = closers[c], let last = open.last, last.bracket == opener {
          open.removeLast()
          onPair?(last.offset, i)
        }
        i += 1
      }
    }
    return Scan(inside: false, inBlockComment: false, open: open)
  }

  /// The bracket matching the one at `offset`, if `offset` holds a bracket in code.
  public static func matchingBracket(_ units: [UInt16], at offset: Int, language: ProblemLanguage) -> Int? {
    guard offset >= 0, offset < units.count, openers[units[offset]] != nil || closers[units[offset]] != nil else { return nil }
    var match: Int?
    _ = scan(units, upTo: nil, language: language) { open, close in
      if open == offset { match = close } else if close == offset { match = open }
    }
    return match
  }
}
