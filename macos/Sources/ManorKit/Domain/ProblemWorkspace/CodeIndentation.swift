import Foundation

/// Where the code editor's caret sits, as far as indentation cares: in code, or inside a string or comment, where a
/// trailing `:` or bracket is prose and a new line keeps its indentation instead of adding a level.
public enum CodeIndentation {
  /// Whether `prefix` (the source from its start up to the caret) ends inside a string or comment.
  public static func isInsideStringOrComment(_ prefix: String, language: ProblemLanguage) -> Bool {
    let chars = Array(prefix.unicodeScalars)
    let python = language == .python
    let lineComment: [Unicode.Scalar] = python ? ["#"] : ["/", "/"]
    var index = 0
    func starts(_ token: [Unicode.Scalar], at at: Int) -> Bool {
      at + token.count <= chars.count && Array(chars[at..<at + token.count]) == token
    }

    while index < chars.count {
      let c = chars[index]
      if starts(lineComment, at: index) {
        // A line comment runs to the end of its line.
        guard let end = chars[index...].firstIndex(of: "\n") else { return true }
        index = end + 1
      } else if !python, starts(["/", "*"], at: index) {
        guard let end = find(["*", "/"], in: chars, from: index + 2) else { return true }
        index = end + 2
      } else if python, c == "\"" || c == "'", starts([c, c, c], at: index) {
        guard let end = find([c, c, c], in: chars, from: index + 3, escapes: true) else { return true }
        index = end + 3
      } else if c == "\"" || c == "'" || (c == "`" && (language == .javascript || language == .go)) {
        // Backtick strings (JavaScript templates, Go raw strings) span lines; quoted ones end at the line.
        let multiline = c == "`"
        var at = index + 1
        var closed = false
        while at < chars.count {
          let d = chars[at]
          if d == "\\" && !(language == .go && multiline) { at += 2; continue }
          if d == c { closed = true; break }
          if d == "\n" && !multiline { break }
          at += 1
        }
        if !closed && at >= chars.count { return true }
        index = at + 1
      } else {
        index += 1
      }
    }
    return false
  }

  private static func find(_ token: [Unicode.Scalar], in chars: [Unicode.Scalar], from start: Int, escapes: Bool = false) -> Int? {
    var at = start
    while at + token.count <= chars.count {
      if escapes, chars[at] == "\\" { at += 2; continue }
      if Array(chars[at..<at + token.count]) == token { return at }
      at += 1
    }
    return nil
  }
}
