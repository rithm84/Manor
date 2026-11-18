import AppKit
import ManorKit

/// Lightweight syntax highlighting for code blocks: comments, strings, numbers, and keywords, tuned per theme.
/// It colors text through attributes only, so the stored code text never changes.
enum NoteCodeHighlighter {
  private static func color(light: UInt32, dark: UInt32) -> NSColor {
    func make(_ value: UInt32) -> NSColor {
      NSColor(srgbRed: CGFloat((value >> 16) & 0xff) / 255, green: CGFloat((value >> 8) & 0xff) / 255, blue: CGFloat(value & 0xff) / 255, alpha: 1)
    }
    return NSColor(name: nil) { $0.noteIsDark ? make(dark) : make(light) }
  }

  static let comment = color(light: 0x7a7480, dark: 0x9a93a3)
  static let string = color(light: 0x2e6b4f, dark: 0x9bd3b0)
  static let number = color(light: 0x985b24, dark: 0xf2bb86)
  static let keyword = color(light: 0x75508f, dark: 0xc89be0)
  static let type = color(light: 0x32658c, dark: 0x8fc5ed)

  private static let commonKeywords: Set<String> = [
    "if", "else", "for", "while", "do", "return", "break", "continue", "switch", "case", "default", "try", "catch", "finally", "throw",
    "throws", "class", "struct", "enum", "interface", "extends", "implements", "import", "export", "from", "as", "new", "this", "self",
    "super", "static", "public", "private", "protected", "internal", "final", "const", "let", "var", "func", "function", "def", "fn",
    "lambda", "async", "await", "yield", "in", "of", "is", "not", "and", "or", "true", "false", "null", "nil", "None", "True", "False",
    "undefined", "void", "type", "typeof", "instanceof", "package", "pub", "mut", "impl", "trait", "where", "match", "with", "guard",
    "protocol", "extension", "override", "init", "deinit", "select", "insert", "update", "delete", "create", "table", "values", "into",
    "join", "on", "group", "by", "order", "limit", "elif", "except", "raise", "pass", "global", "nonlocal", "goto", "defer", "go",
    "chan", "map", "range", "struct", "using", "namespace", "template", "typename", "virtual", "inline", "unsigned", "signed", "int",
    "float", "double", "char", "bool", "string", "boolean", "long", "short", "byte", "readonly", "abstract", "sealed", "module", "require"
  ]

  private static let hashCommentLanguages: Set<String> = ["python", "ruby", "shellscript", "yaml", "r", "julia", "perl", "toml", "graphql"]
  private static let sqlLanguages: Set<String> = ["sql"]

  static func highlight(_ text: NSMutableAttributedString, language: String) {
    let id = NoteSchema.codeLanguage(for: language)
    guard id != "text", text.length > 0, text.length < 60_000 else { return }
    let source = text.string as NSString
    var covered = IndexSet()
    func apply(_ pattern: String, _ color: NSColor, options: NSRegularExpression.Options = [], group: Int = 0) {
      guard let regex = try? NSRegularExpression(pattern: pattern, options: options) else { return }
      for match in regex.matches(in: text.string, range: NSRange(location: 0, length: source.length)) {
        let range = match.range(at: group)
        guard range.location != NSNotFound, !covered.contains(integersIn: range.location..<(range.location + range.length)) else { continue }
        text.addAttribute(.foregroundColor, value: color, range: range)
        covered.insert(integersIn: range.location..<(range.location + range.length))
      }
    }
    if hashCommentLanguages.contains(id) {
      apply(#"#[^\n]*"#, comment)
    } else if sqlLanguages.contains(id) || id == "lua" || id == "haskell" {
      apply(#"--[^\n]*"#, comment)
    } else if id != "css" && id != "json" && id != "html" && id != "xml" {
      apply(#"/\*[\s\S]*?\*/"#, comment)
      apply(#"//[^\n]*"#, comment)
    } else if id == "css" {
      apply(#"/\*[\s\S]*?\*/"#, comment)
    } else if id == "html" || id == "xml" {
      apply(#"<!--[\s\S]*?-->"#, comment)
    }
    apply(#""(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`"#, Self.string)
    apply(#"\b(?:0x[0-9a-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b"#, number)
    if id == "html" || id == "xml" {
      apply(#"</?([A-Za-z][\w:-]*)"#, keyword, group: 1)
      return
    }
    guard let regex = try? NSRegularExpression(pattern: #"\b[A-Za-z_][A-Za-z0-9_]*\b"#) else { return }
    let caseInsensitive = sqlLanguages.contains(id)
    for match in regex.matches(in: text.string, range: NSRange(location: 0, length: source.length)) {
      let range = match.range
      guard !covered.contains(integersIn: range.location..<(range.location + range.length)) else { continue }
      let word = source.substring(with: range)
      if commonKeywords.contains(caseInsensitive ? word.lowercased() : word) {
        text.addAttribute(.foregroundColor, value: keyword, range: range)
      } else if let first = word.unicodeScalars.first, CharacterSet.uppercaseLetters.contains(first), word.count > 1, id != "json" {
        text.addAttribute(.foregroundColor, value: type, range: range)
      }
    }
  }
}
