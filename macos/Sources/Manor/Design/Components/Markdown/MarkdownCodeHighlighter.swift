import SwiftUI

/// Light syntax coloring for fenced code: comments, strings, numbers, and keywords for the common language
/// families. It is a readability aid, not a parser, so unknown languages fall back to plain code.
enum MarkdownCodeHighlighter {
  enum Token { case plain, keyword, string, comment, number }

  private struct Grammar {
    var lineComments: [String]
    var blockComment: (open: String, close: String)?
    var quotes: Set<Character>
    var keywords: Set<String>
  }

  static func highlight(_ code: String, language: String?, size: CGFloat) -> AttributedString {
    var result = AttributedString()
    for (text, token) in tokens(code, language: language) {
      var run = AttributedString(text)
      run.font = Font.code(size, weight: token == .keyword ? .medium : .regular)
      run.foregroundColor = color(token)
      if token == .comment { run.font = Font.code(size).italic() }
      result += run
    }
    return result
  }

  static func color(_ token: Token) -> Color {
    switch token {
    case .plain: return Palette.ink
    case .keyword: return Palette.primary
    case .string: return Palette.secondary
    case .comment: return Palette.inkMuted
    case .number: return Palette.amber
    }
  }

  /// Splits code into colored runs. Very long blocks stay plain to keep rendering instant.
  static func tokens(_ code: String, language: String?) -> [(String, Token)] {
    guard code.count < 40_000, let grammar = grammar(for: language?.lowercased() ?? "") else { return [(code, .plain)] }
    let chars = Array(code)
    var runs: [(String, Token)] = []
    var plain = ""
    func flush() {
      if !plain.isEmpty { runs.append((plain, .plain)); plain = "" }
    }
    func starts(_ text: String, at index: Int) -> Bool {
      let needle = Array(text)
      guard index + needle.count <= chars.count else { return false }
      return Array(chars[index..<(index + needle.count)]) == needle
    }
    var index = 0
    while index < chars.count {
      let char = chars[index]
      if let block = grammar.blockComment, starts(block.open, at: index) {
        flush()
        var end = index + block.open.count
        while end < chars.count, !starts(block.close, at: end) { end += 1 }
        end = min(chars.count, end + block.close.count)
        runs.append((String(chars[index..<end]), .comment))
        index = end
        continue
      }
      if grammar.lineComments.contains(where: { starts($0, at: index) }) {
        flush()
        var end = index
        while end < chars.count, chars[end] != "\n" { end += 1 }
        runs.append((String(chars[index..<end]), .comment))
        index = end
        continue
      }
      if grammar.quotes.contains(char) {
        flush()
        var end = index + 1
        while end < chars.count, chars[end] != char {
          if chars[end] == "\\" { end += 1 }
          if char != "`", end < chars.count, chars[end] == "\n" { break }
          end += 1
        }
        end = min(chars.count, end + 1)
        runs.append((String(chars[index..<end]), .string))
        index = end
        continue
      }
      if char.isNumber, index == 0 || !(chars[index - 1].isLetter || chars[index - 1] == "_") {
        flush()
        // Always take at least this character: a digit outside ASCII (10⁵, ½, ٣) isn't a hex digit, and a run that
        // didn't advance would loop forever appending empty runs.
        var end = index + 1
        while end < chars.count, chars[end].isHexDigit || chars[end] == "." || chars[end] == "_" || chars[end] == "x" { end += 1 }
        runs.append((String(chars[index..<end]), .number))
        index = end
        continue
      }
      if char.isLetter || char == "_" || char == "@" || char == "#" {
        var end = index + 1
        while end < chars.count, chars[end].isLetter || chars[end].isNumber || chars[end] == "_" { end += 1 }
        let word = String(chars[index..<end])
        if grammar.keywords.contains(word) {
          flush()
          runs.append((word, .keyword))
        } else {
          plain += word
        }
        index = end
        continue
      }
      plain.append(char)
      index += 1
    }
    flush()
    return runs
  }

  private static let cFamily = Set<String>([
    "if", "else", "for", "while", "do", "switch", "case", "default", "break", "continue", "return", "func", "function",
    "var", "let", "const", "class", "struct", "enum", "interface", "protocol", "extension", "import", "export", "from",
    "public", "private", "protected", "internal", "static", "final", "override", "async", "await", "throw", "throws",
    "try", "catch", "finally", "new", "delete", "this", "self", "super", "true", "false", "nil", "null", "undefined",
    "void", "int", "long", "short", "double", "float", "char", "bool", "boolean", "string", "String", "auto", "typedef",
    "namespace", "using", "template", "typename", "include", "define", "package", "type", "fn", "mut", "impl", "trait",
    "pub", "use", "mod", "match", "where", "in", "of", "instanceof", "typeof", "yield", "guard", "defer", "go", "chan",
    "select", "range", "map", "func", "val", "fun", "object", "when", "is", "as", "inout", "some", "any", "unsigned",
    "signed", "sizeof", "extends", "implements", "abstract", "volatile", "virtual", "operator", "friend", "explicit",
    "constexpr", "nullptr", "std", "vector", "#include", "#define", "@Override", "@main", "@State", "@Published"
  ])

  private static let scripting = Set<String>([
    "def", "class", "if", "elif", "else", "for", "while", "in", "not", "and", "or", "is", "return", "import", "from",
    "as", "with", "try", "except", "finally", "raise", "lambda", "yield", "pass", "break", "continue", "global",
    "nonlocal", "assert", "del", "None", "True", "False", "self", "async", "await", "end", "do", "then", "fi", "esac",
    "case", "function", "local", "export", "echo", "begin", "rescue", "ensure", "module", "require", "puts", "nil",
    "true", "false", "unless", "until", "elsif", "print", "match"
  ])

  private static let sql = Set<String>([
    "select", "from", "where", "and", "or", "not", "insert", "into", "values", "update", "set", "delete", "create",
    "table", "drop", "alter", "add", "join", "left", "right", "inner", "outer", "on", "group", "by", "order", "having",
    "limit", "offset", "as", "distinct", "union", "all", "case", "when", "then", "else", "end", "null", "is", "in",
    "exists", "primary", "key", "references", "index", "with", "returning", "function", "returns", "begin", "language",
    "SELECT", "FROM", "WHERE", "AND", "OR", "NOT", "INSERT", "INTO", "VALUES", "UPDATE", "SET", "DELETE", "CREATE",
    "TABLE", "DROP", "ALTER", "JOIN", "LEFT", "INNER", "ON", "GROUP", "BY", "ORDER", "HAVING", "LIMIT", "AS",
    "DISTINCT", "UNION", "CASE", "WHEN", "THEN", "ELSE", "END", "NULL", "IS", "IN", "EXISTS", "WITH", "RETURNING"
  ])

  private static func grammar(for language: String) -> Grammar? {
    switch language {
    case "swift", "js", "javascript", "jsx", "ts", "typescript", "tsx", "java", "c", "h", "cpp", "c++", "cc", "hpp",
         "cs", "csharp", "go", "golang", "rust", "rs", "kotlin", "kt", "dart", "scala", "php", "objc", "objective-c", "zig":
      return Grammar(lineComments: ["//"], blockComment: ("/*", "*/"), quotes: ["\"", "'", "`"], keywords: cFamily)
    case "python", "py", "ruby", "rb", "sh", "bash", "zsh", "shell", "console", "r", "perl", "yaml", "yml", "toml", "dockerfile", "make", "makefile":
      return Grammar(lineComments: ["#"], blockComment: nil, quotes: ["\"", "'"], keywords: scripting)
    case "sql", "postgres", "postgresql", "plpgsql", "psql":
      return Grammar(lineComments: ["--"], blockComment: ("/*", "*/"), quotes: ["'", "\""], keywords: sql)
    case "lua", "haskell", "hs", "elm":
      return Grammar(lineComments: ["--"], blockComment: nil, quotes: ["\"", "'"], keywords: scripting)
    case "json", "jsonc", "json5":
      return Grammar(lineComments: ["//"], blockComment: nil, quotes: ["\""], keywords: ["true", "false", "null"])
    case "html", "xml", "svg", "vue", "css", "scss":
      return Grammar(lineComments: [], blockComment: language.contains("css") ? ("/*", "*/") : ("<!--", "-->"), quotes: ["\"", "'"], keywords: [])
    default:
      return nil
    }
  }
}
