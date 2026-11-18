import SwiftUI

/// Fast, language-agnostic highlighter for answer code blocks: comments, strings, numbers,
/// keywords and type-like identifiers. Good enough to scan code at a glance; no dependencies.
enum SyntaxHighlighter {
    struct Palette {
        var plain = Color.adaptive(dark: (0.92, 0.92, 0.92), light: (0.1451, 0.1333, 0.1647))
        var keyword = Color.adaptive(dark: (0.99, 0.47, 0.66), light: (0.70, 0.13, 0.38))
        var string = Color.adaptive(dark: (0.99, 0.79, 0.47), light: (0.58, 0.34, 0.02))
        var number = Color.adaptive(dark: (0.72, 0.62, 1.0), light: (0.40, 0.26, 0.72))
        var comment = Color.adaptive(dark: (0.52, 0.52, 0.52), light: (0.42, 0.41, 0.45))
        var type = Color.adaptive(dark: (0.42, 0.85, 0.94), light: (0.03, 0.43, 0.52))
        var function = Color.adaptive(dark: (0.55, 0.86, 0.55), light: (0.13, 0.45, 0.17))
    }

    static let keywords: Set<String> = [
        // common across C-family, Python, JS/TS, Go, Rust, Swift, Java, Kotlin
        "if", "else", "elif", "for", "while", "do", "return", "break", "continue", "switch", "case", "default",
        "def", "class", "struct", "enum", "interface", "trait", "impl", "fn", "func", "function", "fun", "lambda",
        "let", "var", "val", "const", "static", "final", "public", "private", "protected", "internal", "override",
        "import", "from", "package", "using", "namespace", "include", "module", "export",
        "new", "delete", "try", "catch", "except", "finally", "throw", "throws", "raise", "with", "as", "in", "is",
        "not", "and", "or", "true", "false", "True", "False", "None", "null", "nil", "undefined", "this", "self", "super",
        "void", "int", "long", "short", "char", "bool", "boolean", "float", "double", "string", "auto", "unsigned",
        "async", "await", "yield", "go", "defer", "chan", "select", "match", "where", "guard", "mut", "pub", "use",
        "type", "typedef", "template", "typename", "virtual", "extends", "implements", "instanceof", "typeof", "pass",
        "global", "nonlocal", "assert", "elseif", "end", "then", "loop", "of", "inline", "constexpr", "std",
    ]

    static func highlight(_ code: String, palette: Palette = .init()) -> AttributedString {
        var out = AttributedString()
        let chars = Array(code.unicodeScalars)
        var i = 0
        var buffer = ""

        func emit(_ s: String, _ color: Color) {
            guard !s.isEmpty else { return }
            var a = AttributedString(s)
            a.foregroundColor = color
            out.append(a)
        }
        func flushPlain() { emit(buffer, palette.plain); buffer = "" }
        func peek(_ o: Int) -> Unicode.Scalar? { i + o < chars.count ? chars[i + o] : nil }

        while i < chars.count {
            let c = chars[i]
            // Line comments: //, #, --
            if (c == "/" && peek(1) == "/") || c == "#" || (c == "-" && peek(1) == "-" && peek(2) == " ") {
                flushPlain()
                var s = ""
                while i < chars.count, chars[i] != "\n" { s.unicodeScalars.append(chars[i]); i += 1 }
                emit(s, palette.comment)
                continue
            }
            // Block comments
            if c == "/", peek(1) == "*" {
                flushPlain()
                var s = ""
                while i < chars.count {
                    s.unicodeScalars.append(chars[i])
                    if chars[i] == "/", s.count > 2, s.hasSuffix("*/") { i += 1; break }
                    i += 1
                }
                emit(s, palette.comment)
                continue
            }
            // Strings
            if c == "\"" || c == "'" || c == "`" {
                flushPlain()
                var s = String(c)
                i += 1
                while i < chars.count {
                    let d = chars[i]
                    s.unicodeScalars.append(d)
                    i += 1
                    if d == "\\", i < chars.count { s.unicodeScalars.append(chars[i]); i += 1; continue }
                    if d == c || d == "\n" { break }
                }
                emit(s, palette.string)
                continue
            }
            // Numbers
            if CharacterSet.decimalDigits.contains(c), buffer.last.map({ !$0.isLetter && $0 != "_" }) ?? true {
                flushPlain()
                var s = ""
                while i < chars.count, CharacterSet.alphanumerics.contains(chars[i]) || chars[i] == "." || chars[i] == "_" {
                    s.unicodeScalars.append(chars[i]); i += 1
                }
                emit(s, palette.number)
                continue
            }
            // Identifiers
            if CharacterSet.letters.contains(c) || c == "_" {
                flushPlain()
                var s = ""
                while i < chars.count, CharacterSet.alphanumerics.contains(chars[i]) || chars[i] == "_" {
                    s.unicodeScalars.append(chars[i]); i += 1
                }
                if keywords.contains(s) {
                    emit(s, palette.keyword)
                } else if peek(0) == "(" {
                    emit(s, palette.function)
                } else if s.first?.isUppercase == true {
                    emit(s, palette.type)
                } else {
                    emit(s, palette.plain)
                }
                continue
            }
            buffer.unicodeScalars.append(c)
            i += 1
        }
        flushPlain()
        return out
    }
}
