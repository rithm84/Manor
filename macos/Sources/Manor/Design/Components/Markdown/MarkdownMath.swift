import Foundation

/// TeX math shown as readable Unicode: Greek letters, operators, relations, arrows, fractions, roots, and
/// super and subscripts. It covers what reviews, statements, and notes actually write; anything it does not
/// recognize stays visible as written rather than disappearing.
enum MarkdownMath {
  static func render(_ tex: String) -> String {
    var parser = Parser(Array(tex))
    let text = parser.sequence(closing: false)
    return text.replacingOccurrences(of: "  +", with: " ", options: .regularExpression).trimmingCharacters(in: .whitespacesAndNewlines)
  }

  private struct Parser {
    let chars: [Character]
    var index = 0
    init(_ chars: [Character]) { self.chars = chars }

    mutating func sequence(closing: Bool) -> String {
      var out = ""
      while index < chars.count {
        let char = chars[index]
        switch char {
        case "}":
          index += 1
          if closing { return out }
        case "{":
          index += 1
          out += sequence(closing: true)
        case "^", "_":
          index += 1
          out += MarkdownMath.script(argument(), superscript: char == "^")
        case "\\":
          out += command()
        case "~":
          index += 1
          out += " "
        case "&":
          index += 1
          out += " "
        default:
          index += 1
          out.append(char)
        }
      }
      return out
    }

    /// One argument: a braced group, a command, or a single character.
    mutating func argument() -> String {
      while index < chars.count, chars[index] == " " { index += 1 }
      guard index < chars.count else { return "" }
      switch chars[index] {
      case "{":
        index += 1
        return sequence(closing: true)
      case "\\":
        return command()
      default:
        let char = chars[index]
        index += 1
        return String(char)
      }
    }

    mutating func command() -> String {
      index += 1
      guard index < chars.count else { return "\\" }
      var name = ""
      if chars[index].isLetter {
        while index < chars.count, chars[index].isLetter {
          name.append(chars[index])
          index += 1
        }
      } else {
        name = String(chars[index])
        index += 1
      }
      switch name {
      case "frac", "dfrac", "tfrac":
        let numerator = argument(), denominator = argument()
        return "\(MarkdownMath.group(numerator))/\(MarkdownMath.group(denominator))"
      case "sqrt":
        var degree = ""
        if index < chars.count, chars[index] == "[" {
          index += 1
          while index < chars.count, chars[index] != "]" { degree.append(chars[index]); index += 1 }
          index += 1
        }
        let radicand = argument()
        let root = degree == "3" ? "∛" : degree == "4" ? "∜" : (degree.isEmpty ? "√" : MarkdownMath.script(degree, superscript: true) + "√")
        return root + MarkdownMath.group(radicand)
      case "binom":
        let n = argument(), k = argument()
        return "C(\(n), \(k))"
      case "text", "textrm", "textit", "textbf", "mathrm", "mathbf", "mathit", "mathsf", "mathtt", "operatorname", "boldsymbol", "mathcal", "mathbb", "mathfrak", "mbox":
        let content = argument()
        if name == "mathbb", let doubled = MarkdownMath.doubleStruck[content] { return doubled }
        return content
      case "overline", "bar": return argument() + "\u{0305}"
      case "hat": return argument() + "\u{0302}"
      case "vec": return argument() + "\u{20D7}"
      case "dot": return argument() + "\u{0307}"
      case "tilde": return argument() + "\u{0303}"
      case "left", "right", "big", "Big", "bigg", "Bigg", "displaystyle", "textstyle", "limits", "nolimits": return ""
      case "begin", "end":
        _ = argument()
        return ""
      default:
        if let symbol = MarkdownMath.symbols[name] { return symbol }
        if MarkdownMath.functions.contains(name) { return name }
        return "\\" + name
      }
    }
  }

  static func group(_ text: String) -> String {
    let plain = text.trimmingCharacters(in: .whitespaces)
    let simple = plain.count <= 1 || plain.allSatisfy { $0.isLetter || $0.isNumber || $0 == "." }
    return simple ? plain : "(\(plain))"
  }

  static func script(_ text: String, superscript: Bool) -> String {
    let map = superscript ? superscripts : subscripts
    var out = ""
    for char in text {
      guard let mapped = map[char] else {
        let plain = text.trimmingCharacters(in: .whitespaces)
        return (superscript ? "^" : "_") + (plain.count > 1 ? "(\(plain))" : plain)
      }
      out.append(mapped)
    }
    return out
  }

  static let superscripts: [Character: Character] = Dictionary(uniqueKeysWithValues: zip(
    "0123456789+-=()niabcdefghjklmoprstuvwxyzABDEGHIJKLMNOPRTUVW′*",
    "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱᵃᵇᶜᵈᵉᶠᵍʰʲᵏˡᵐᵒᵖʳˢᵗᵘᵛʷˣʸᶻᴬᴮᴰᴱᴳᴴᴵᴶᴷᴸᴹᴺᴼᴾᴿᵀᵁⱽᵂ′*"
  ).map { ($0, $1) })

  static let subscripts: [Character: Character] = Dictionary(uniqueKeysWithValues: zip(
    "0123456789+-=()aehijklmnoprstuvx",
    "₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑₕᵢⱼₖₗₘₙₒₚᵣₛₜᵤᵥₓ"
  ).map { ($0, $1) })

  static let doubleStruck: [String: String] = ["R": "ℝ", "N": "ℕ", "Z": "ℤ", "Q": "ℚ", "C": "ℂ", "P": "ℙ", "E": "𝔼"]

  static let functions: Set<String> = [
    "log", "ln", "lg", "exp", "sin", "cos", "tan", "cot", "sec", "csc", "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh",
    "min", "max", "sup", "inf", "lim", "det", "gcd", "deg", "dim", "ker", "arg", "Pr", "mod", "bmod"
  ]

  static let symbols: [String: String] = [
    "alpha": "α", "beta": "β", "gamma": "γ", "delta": "δ", "epsilon": "ϵ", "varepsilon": "ε", "zeta": "ζ", "eta": "η",
    "theta": "θ", "vartheta": "ϑ", "iota": "ι", "kappa": "κ", "lambda": "λ", "mu": "μ", "nu": "ν", "xi": "ξ", "pi": "π",
    "varpi": "ϖ", "rho": "ρ", "varrho": "ϱ", "sigma": "σ", "varsigma": "ς", "tau": "τ", "upsilon": "υ", "phi": "ϕ",
    "varphi": "φ", "chi": "χ", "psi": "ψ", "omega": "ω",
    "Gamma": "Γ", "Delta": "Δ", "Theta": "Θ", "Lambda": "Λ", "Xi": "Ξ", "Pi": "Π", "Sigma": "Σ", "Upsilon": "Υ",
    "Phi": "Φ", "Psi": "Ψ", "Omega": "Ω",
    "times": "×", "cdot": "·", "div": "÷", "pm": "±", "mp": "∓", "ast": "∗", "star": "⋆", "circ": "∘", "bullet": "•",
    "oplus": "⊕", "otimes": "⊗", "leq": "≤", "le": "≤", "geq": "≥", "ge": "≥", "neq": "≠", "ne": "≠", "approx": "≈",
    "equiv": "≡", "sim": "∼", "simeq": "≃", "cong": "≅", "propto": "∝", "ll": "≪", "gg": "≫", "prec": "≺", "succ": "≻",
    "infty": "∞", "sum": "∑", "prod": "∏", "coprod": "∐", "int": "∫", "iint": "∬", "oint": "∮", "partial": "∂",
    "nabla": "∇", "forall": "∀", "exists": "∃", "nexists": "∄", "in": "∈", "notin": "∉", "ni": "∋", "subset": "⊂",
    "subseteq": "⊆", "supset": "⊃", "supseteq": "⊇", "cup": "∪", "cap": "∩", "bigcup": "⋃", "bigcap": "⋂",
    "emptyset": "∅", "varnothing": "∅", "setminus": "∖",
    "to": "→", "rightarrow": "→", "leftarrow": "←", "gets": "←", "Rightarrow": "⇒", "Leftarrow": "⇐", "implies": "⇒",
    "iff": "⇔", "Leftrightarrow": "⇔", "leftrightarrow": "↔", "mapsto": "↦", "uparrow": "↑", "downarrow": "↓",
    "longrightarrow": "⟶", "longleftarrow": "⟵",
    "ldots": "…", "dots": "…", "cdots": "⋯", "vdots": "⋮", "ddots": "⋱",
    "lfloor": "⌊", "rfloor": "⌋", "lceil": "⌈", "rceil": "⌉", "langle": "⟨", "rangle": "⟩",
    "neg": "¬", "lnot": "¬", "land": "∧", "wedge": "∧", "lor": "∨", "vee": "∨", "top": "⊤", "bot": "⊥", "perp": "⊥",
    "parallel": "∥", "angle": "∠", "triangle": "△", "degree": "°", "prime": "′", "ell": "ℓ", "hbar": "ℏ", "Re": "ℜ", "Im": "ℑ",
    "aleph": "ℵ", "mid": "|", "vert": "|", "Vert": "‖", "|": "‖", "lvert": "|", "rvert": "|",
    "quad": "  ", "qquad": "   ", ",": " ", ";": " ", ":": " ", "!": "", " ": " ",
    "{": "{", "}": "}", "%": "%", "_": "_", "$": "$", "#": "#", "&": "&", "\\": " "
  ]
}

/// Moves TeX math out of the way of the Markdown parser: `$$…$$` and `\[…\]` blocks become `math` fenced code,
/// and `$…$` and `\(…\)` spans become inline code marked with `MarkdownMath.marker`, so underscores and asterisks
/// inside math are never read as emphasis. Code spans and fenced code are left untouched.
enum MarkdownMathPreprocessor {
  static let marker: Character = "\u{E000}"

  static func process(_ source: String) -> String {
    guard source.contains("$") || source.contains("\\(") || source.contains("\\[") else { return source }
    let lines = source.components(separatedBy: "\n")
    var out: [String] = []
    out.reserveCapacity(lines.count)
    var fence: (char: Character, count: Int)?
    var index = 0
    while index < lines.count {
      let line = lines[index]
      let indent = String(line.prefix { $0 == " " || $0 == "\t" })
      let trimmed = line.dropFirst(indent.count)
      if let open = fence {
        out.append(line)
        let run = trimmed.prefix { $0 == open.char }.count
        if run >= open.count, trimmed.dropFirst(run).allSatisfy(\.isWhitespace) { fence = nil }
        index += 1
        continue
      }
      if let first = trimmed.first, first == "`" || first == "~" {
        let run = trimmed.prefix { $0 == first }.count
        if run >= 3 {
          fence = (first, run)
          out.append(line)
          index += 1
          continue
        }
      }
      if let block = displayBlock(lines: lines, at: index, indent: indent, trimmed: String(trimmed)) {
        out.append("\(indent)```math")
        out.append(contentsOf: block.body.map { indent + $0 })
        out.append("\(indent)```")
        index = block.next
        continue
      }
      out.append(inlineMath(line))
      index += 1
    }
    return out.joined(separator: "\n")
  }

  /// A display block opening on this line: `$$` or `\[` at the start, closed on the same or a later line.
  private static func displayBlock(lines: [String], at index: Int, indent: String, trimmed: String) -> (body: [String], next: Int)? {
    let pairs: [(open: String, close: String)] = [("$$", "$$"), ("\\[", "\\]")]
    for pair in pairs where trimmed.hasPrefix(pair.open) {
      let rest = String(trimmed.dropFirst(pair.open.count))
      if let range = rest.range(of: pair.close) {
        guard rest[range.upperBound...].trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
        let body = String(rest[..<range.lowerBound]).trimmingCharacters(in: .whitespaces)
        return body.isEmpty ? nil : ([body], index + 1)
      }
      var body: [String] = rest.trimmingCharacters(in: .whitespaces).isEmpty ? [] : [rest]
      var cursor = index + 1
      while cursor < lines.count {
        let line = lines[cursor].trimmingCharacters(in: .whitespaces)
        if let range = line.range(of: pair.close) {
          let before = String(line[..<range.lowerBound])
          if !before.trimmingCharacters(in: .whitespaces).isEmpty { body.append(before) }
          return body.isEmpty ? nil : (body, cursor + 1)
        }
        if line.isEmpty, pair.open == "$$" { return nil }
        body.append(line)
        cursor += 1
      }
      return nil
    }
    return nil
  }

  /// Rewrites inline math spans on one line, leaving code spans and escaped dollars alone.
  static func inlineMath(_ line: String) -> String {
    guard line.contains("$") || line.contains("\\(") else { return line }
    let chars = Array(line)
    var out = ""
    var index = 0
    while index < chars.count {
      let char = chars[index]
      if char == "`" {
        let run = countRun(chars, from: index, of: "`")
        if let close = findBacktickClose(chars, from: index + run, run: run) {
          out += String(chars[index..<(close + run)])
          index = close + run
        } else {
          out += String(chars[index..<(index + run)])
          index += run
        }
        continue
      }
      if char == "\\", index + 1 < chars.count {
        if chars[index + 1] == "(", let close = find(chars, "\\)", from: index + 2) {
          out += code(String(chars[(index + 2)..<close]))
          index = close + 2
          continue
        }
        out += String(chars[index...(index + 1)])
        index += 2
        continue
      }
      if char == "$" {
        if index + 1 < chars.count, chars[index + 1] == "$", let close = find(chars, "$$", from: index + 2), close > index + 2 {
          out += code(String(chars[(index + 2)..<close]))
          index = close + 2
          continue
        }
        if let close = inlineClose(chars, from: index) {
          out += code(String(chars[(index + 1)..<close]))
          index = close + 1
          continue
        }
      }
      out.append(char)
      index += 1
    }
    return out
  }

  /// The closing `$` of a span opening at `start`: content starts and ends without a space, and the closing
  /// dollar is not followed by a digit, so prices like "$5 and $10" stay text.
  private static func inlineClose(_ chars: [Character], from start: Int) -> Int? {
    let first = start + 1
    guard first < chars.count, !chars[first].isWhitespace, chars[first] != "$" else { return nil }
    var cursor = first
    while cursor < chars.count {
      if chars[cursor] == "\\" { cursor += 2; continue }
      if chars[cursor] == "$" {
        guard cursor > first, !chars[cursor - 1].isWhitespace else { return nil }
        if cursor + 1 < chars.count, chars[cursor + 1].isNumber { return nil }
        return cursor
      }
      cursor += 1
    }
    return nil
  }

  private static func code(_ tex: String) -> String {
    let content = String(marker) + tex
    var longest = 0, current = 0
    for char in content {
      current = char == "`" ? current + 1 : 0
      longest = max(longest, current)
    }
    let fence = String(repeating: "`", count: longest + 1)
    let pad = content.hasSuffix("`") ? " " : ""
    return fence + content + pad + fence
  }

  private static func countRun(_ chars: [Character], from start: Int, of char: Character) -> Int {
    var cursor = start
    while cursor < chars.count, chars[cursor] == char { cursor += 1 }
    return cursor - start
  }

  private static func findBacktickClose(_ chars: [Character], from start: Int, run: Int) -> Int? {
    var cursor = start
    while cursor < chars.count {
      if chars[cursor] == "`" {
        let length = countRun(chars, from: cursor, of: "`")
        if length == run { return cursor }
        cursor += length
      } else {
        cursor += 1
      }
    }
    return nil
  }

  private static func find(_ chars: [Character], _ needle: String, from start: Int) -> Int? {
    let pattern = Array(needle)
    guard start <= chars.count - pattern.count else { return nil }
    for cursor in start...(chars.count - pattern.count) where Array(chars[cursor..<(cursor + pattern.count)]) == pattern {
      return cursor
    }
    return nil
  }
}
