import Foundation

/// Block-level Markdown for model answers. Deliberately small: exactly the constructs answers use,
/// tolerant of half-streamed input (an unterminated ``` fence renders as an open code block).
enum MDBlock: Equatable {
    case heading(level: Int, text: String)
    case paragraph(String)
    case bullet(items: [String])
    case numbered(start: Int, items: [String])
    case code(language: String, code: String, closed: Bool)
    /// ```diagram fenced block — Alfred diagram DSL, rendered natively.
    case diagram(source: String, closed: Bool)
    /// ```ui fenced block — the generative UI language (generative UI: charts, tables, cards…), rendered natively.
    case generativeUI(source: String, closed: Bool)
    /// GitHub-style pipe table.
    case table(header: [String], alignments: [MDAlign], rows: [[String]])
    case quote(String)
    case rule
}

enum MarkdownParser {
    static func parse(_ source: String) -> [MDBlock] {
        var blocks: [MDBlock] = []
        var paragraph: [String] = []
        var bullets: [String] = []
        var numbered: [String] = []
        var numberedStart = 1
        var quote: [String] = []

        func flush() {
            if !paragraph.isEmpty { blocks.append(.paragraph(paragraph.joined(separator: "\n"))); paragraph = [] }
            if !bullets.isEmpty { blocks.append(.bullet(items: bullets)); bullets = [] }
            if !numbered.isEmpty { blocks.append(.numbered(start: numberedStart, items: numbered)); numbered = [] }
            if !quote.isEmpty { blocks.append(.quote(quote.joined(separator: "\n"))); quote = [] }
        }

        let lines = source.components(separatedBy: "\n")
        var i = 0
        while i < lines.count {
            let line = lines[i]
            let trimmed = line.trimmingCharacters(in: .whitespaces)

            // Fenced code
            if trimmed.hasPrefix("```") || trimmed.hasPrefix("~~~") {
                flush()
                let fence = String(trimmed.prefix(3))
                let language = trimmed.dropFirst(3).trimmingCharacters(in: .whitespaces)
                var code: [String] = []
                var closed = false
                i += 1
                while i < lines.count {
                    if lines[i].trimmingCharacters(in: .whitespaces).hasPrefix(fence) { closed = true; break }
                    code.append(lines[i])
                    i += 1
                }
                let body = code.joined(separator: "\n")
                if ["diagram", "alfred", "dsviz"].contains(language.lowercased()) {
                    // Unclosed while streaming: the final element is a partial line unless the text ended in "\n";
                    // DiagramParser holds that partial line back.
                    blocks.append(.diagram(source: body, closed: closed))
                } else if ["ui", "genui"].contains(language.lowercased()) {
                    blocks.append(.generativeUI(source: body, closed: closed))
                } else {
                    blocks.append(.code(language: language, code: body, closed: closed))
                }
                i += 1
                continue
            }

            if trimmed.isEmpty { flush(); i += 1; continue }

            // Pipe table: a header row followed by a |---|:---:| separator row.
            if trimmed.contains("|"), i + 1 < lines.count, let alignments = tableSeparator(lines[i + 1]) {
                flush()
                let header = tableCells(trimmed)
                var rows: [[String]] = []
                i += 2
                while i < lines.count {
                    let row = lines[i].trimmingCharacters(in: .whitespaces)
                    guard !row.isEmpty, row.contains("|") else { break }
                    rows.append(tableCells(row))
                    i += 1
                }
                let width = max(header.count, alignments.count)
                blocks.append(.table(header: header.padded(to: width), alignments: alignments.padded(to: width, with: .leading),
                                     rows: rows.map { $0.padded(to: width) }))
                continue
            }

            if let level = headingLevel(trimmed) {
                flush()
                blocks.append(.heading(level: level, text: String(trimmed.dropFirst(level)).trimmingCharacters(in: .whitespaces)))
            } else if trimmed == "---" || trimmed == "***" || trimmed == "___" {
                flush()
                blocks.append(.rule)
            } else if let item = bulletItem(trimmed) {
                if bullets.isEmpty { flush() }
                bullets.append(item)
            } else if let (n, item) = numberedItem(trimmed) {
                if numbered.isEmpty { flush(); numberedStart = n }
                numbered.append(item)
            } else if trimmed.hasPrefix(">") {
                if quote.isEmpty { flush() }
                quote.append(String(trimmed.dropFirst()).trimmingCharacters(in: .whitespaces))
            } else if !bullets.isEmpty, line.hasPrefix("  ") {
                bullets[bullets.count - 1] += " " + trimmed   // continuation of a list item
            } else if !numbered.isEmpty, line.hasPrefix("  ") {
                numbered[numbered.count - 1] += " " + trimmed
            } else {
                if !bullets.isEmpty || !numbered.isEmpty || !quote.isEmpty { flush() }
                paragraph.append(trimmed)
            }
            i += 1
        }
        flush()
        return blocks
    }

    private static func headingLevel(_ s: String) -> Int? {
        let hashes = s.prefix { $0 == "#" }.count
        guard (1...6).contains(hashes), s.dropFirst(hashes).first == " " else { return nil }
        return hashes
    }

    private static func bulletItem(_ s: String) -> String? {
        for marker in ["- ", "* ", "+ ", "• "] where s.hasPrefix(marker) {
            return String(s.dropFirst(marker.count))
        }
        return nil
    }

    private static func numberedItem(_ s: String) -> (Int, String)? {
        let digits = s.prefix { $0.isNumber }
        guard !digits.isEmpty, digits.count <= 3, let n = Int(digits) else { return nil }
        let rest = s.dropFirst(digits.count)
        guard rest.hasPrefix(". ") || rest.hasPrefix(") ") else { return nil }
        return (n, String(rest.dropFirst(2)))
    }

    /// Inline Markdown (bold, italics, `code`, links) → AttributedString. Falls back to plain text.
    static func inline(_ text: String) -> AttributedString {
        (try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
            ?? AttributedString(text)
    }

    /// `| --- | :---: | ---: |` → column alignments; nil if the line isn't a table separator.
    static func tableSeparator(_ line: String) -> [MDAlign]? {
        let t = line.trimmingCharacters(in: .whitespaces)
        guard t.contains("-"), t.allSatisfy({ "|:- \t".contains($0) }) else { return nil }
        let cells = tableCells(t)
        guard !cells.isEmpty, cells.allSatisfy({ $0.contains("-") }) else { return nil }
        return cells.map { c in
            let l = c.hasPrefix(":"), r = c.hasSuffix(":")
            return l && r ? .center : (r ? .trailing : .leading)
        }
    }

    /// Splits a pipe row into trimmed cells (leading/trailing pipes optional, `\|` stays a literal pipe).
    static func tableCells(_ line: String) -> [String] {
        var t = line.trimmingCharacters(in: .whitespaces)
        if t.hasPrefix("|") { t.removeFirst() }
        if t.hasSuffix("|") && !t.hasSuffix("\\|") { t.removeLast() }
        var cells: [String] = []
        var cur = ""
        var escape = false
        for ch in t {
            if escape { cur.append(ch); escape = false; continue }
            if ch == "\\" { escape = true; continue }
            if ch == "|" { cells.append(cur.trimmingCharacters(in: .whitespaces)); cur = ""; continue }
            cur.append(ch)
        }
        cells.append(cur.trimmingCharacters(in: .whitespaces))
        return cells
    }
}

enum MDAlign: Equatable { case leading, center, trailing }

private extension Array {
    func padded(to n: Int, with filler: Element) -> [Element] { count >= n ? Array(prefix(n)) : self + Array(repeating: filler, count: n - count) }
}

private extension Array where Element == String {
    func padded(to n: Int) -> [String] { padded(to: n, with: "") }
}
