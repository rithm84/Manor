import Foundation

/// One labeled console field: a parameter, a codec's value, or a class's operations or arguments.
public struct TestcaseField: Hashable, Sendable {
  public let name: String
  public let label: String
  public init(name: String, label: String) { self.name = name; self.label = label }
}

/// One editable console case: one raw JSON value per field.
public struct Testcase: Hashable, Sendable, Identifiable {
  public var id: String
  public var values: [String]
  public init(id: String = UUID().uuidString, values: [String]) { self.id = id; self.values = values }
}

public struct InvalidTestcase: Hashable, Sendable {
  public let caseIndex: Int
  public let fieldIndex: Int
  public let message: String
}

/// Typed problems take one JSON value per line per parameter, one line for a codec's value, or two lines (operation
/// names and argument arrays) for a class. The judge's driver reads that format; these helpers move between it and
/// the labeled fields the console edits. Ported from `problemTestcases.ts`.
public enum ProblemTestcases {
  public static func fields(_ spec: ProblemInterface) -> [TestcaseField] {
    switch spec.kind {
    case .class: return [TestcaseField(name: "operations", label: "Operations"), TestcaseField(name: "arguments", label: "Arguments")]
    case .codec:
      let name = spec.codecParameter ?? "data"
      return [TestcaseField(name: name, label: "\(name) =")]
    case .function: return spec.parameters.map { TestcaseField(name: $0, label: "\($0) =") }
    }
  }

  /// The index just past the string literal that starts at `start`.
  private static func skipString(_ text: [Character], _ start: Int) -> Int {
    var index = start + 1
    while index < text.count, text[index] != "\"" { index += text[index] == "\\" ? 2 : 1 }
    return index + 1
  }

  /// Removes whitespace outside strings so a value occupies one input line; digits are never reparsed, so 64-bit
  /// integers keep their exact text.
  public static func compactJSON(_ text: String) -> String {
    let characters = Array(text)
    var result = ""
    var index = 0
    while index < characters.count {
      let character = characters[index]
      if character == "\"" {
        let end = min(skipString(characters, index), characters.count)
        result += String(characters[index..<end])
        index = end
        continue
      }
      if !character.isWhitespace { result.append(character) }
      index += 1
    }
    return result
  }

  public static func isJSONValue(_ text: String) -> Bool {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty, let data = trimmed.data(using: .utf8) else { return false }
    return (try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])) != nil
  }

  /// Whether `text[from...]` begins with optional commas and whitespace, then `name`, optional whitespace, and `=`.
  private static func introduces(_ text: [Character], at from: Int, name: String) -> Int? {
    var index = from
    while index < text.count, text[index] == "," || text[index].isWhitespace { index += 1 }
    let nameCharacters = Array(name)
    guard index + nameCharacters.count <= text.count, Array(text[index..<(index + nameCharacters.count)]) == nameCharacters else { return nil }
    index += nameCharacters.count
    while index < text.count, text[index].isWhitespace { index += 1 }
    guard index < text.count, text[index] == "=" else { return nil }
    return index + 1
  }

  /// A value ends at the top-level comma or line break that introduces the next named parameter.
  private static func valueEnd(_ text: [Character], start: Int, next: String?) -> Int? {
    guard let next else { return text.count }
    var depth = 0
    var index = start
    while index < text.count {
      let character = text[index]
      if character == "\"" { index = skipString(text, index); continue }
      if character == "[" || character == "{" { depth += 1 } else if character == "]" || character == "}" { depth -= 1 } else if depth == 0, character == "," || character == "\n", introduces(text, at: index, name: next) != nil { return index }
      index += 1
    }
    return nil
  }

  private static func rawLines(_ text: String) -> [String] {
    text.components(separatedBy: "\n").map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
  }

  /// Converts an example's display text back into raw input lines. Function examples read `nums = [2,7,11,15],
  /// target = 9` in parameter order, or one JSON value per line; class examples hold the two raw lines. Nil when the
  /// text does not match the interface.
  public static func parseExampleInput(_ spec: ProblemInterface, _ display: String) -> [String]? {
    let fields = fields(spec)
    let lines = rawLines(display)
    if lines.count == fields.count, lines.allSatisfy(isJSONValue) { return lines.map(compactJSON) }
    if spec.kind == .class { return nil }
    let text = Array(display)
    var values: [String] = []
    var position = 0
    for (index, field) in fields.enumerated() {
      guard let start = introduces(text, at: position, name: field.name) else { return nil }
      var valueStart = start
      while valueStart < text.count, text[valueStart].isWhitespace { valueStart += 1 }
      guard let end = valueEnd(text, start: valueStart, next: index + 1 < fields.count ? fields[index + 1].name : nil) else { return nil }
      let value = compactJSON(String(text[valueStart..<end]).trimmingCharacters(in: .whitespacesAndNewlines))
      guard isJSONValue(value) else { return nil }
      values.append(value)
      position = end
    }
    return values
  }

  /// Example cases prefill the console; an example the interface cannot read becomes an empty case to fill in.
  public static func exampleCases(_ spec: ProblemInterface, _ examples: [ProblemExample]) -> [Testcase] {
    let width = fields(spec).count
    let cases = examples.enumerated().map { index, example in
      Testcase(id: "example-\(index)", values: parseExampleInput(spec, example.input) ?? Array(repeating: "", count: width))
    }
    return cases.isEmpty ? [Testcase(id: "example-0", values: Array(repeating: "", count: width))] : cases
  }

  public static func firstInvalid(_ fields: [TestcaseField], _ cases: [Testcase]) -> InvalidTestcase? {
    for (caseIndex, testcase) in cases.enumerated() {
      if let fieldIndex = testcase.values.firstIndex(where: { !isJSONValue($0) }) {
        let name = fieldIndex < fields.count ? fields[fieldIndex].name : "value"
        return InvalidTestcase(caseIndex: caseIndex, fieldIndex: fieldIndex, message: "Case \(caseIndex + 1): \(name) needs a JSON value, such as [1,2] or \"text\".")
      }
    }
    return nil
  }

  /// Several cases run back to back: each case contributes its fields as consecutive lines.
  public static func input(_ cases: [Testcase]) -> String {
    cases.map { $0.values.map(compactJSON).joined(separator: "\n") }.joined(separator: "\n")
  }

  public static func same(_ left: [Testcase], _ right: [Testcase]) -> Bool {
    left.count == right.count && zip(left, right).allSatisfy { a, b in
      a.values.count == b.values.count && zip(a.values, b.values).allSatisfy { compactJSON($0) == compactJSON($1) }
    }
  }

  /// A result's raw input splits back into one labeled value per field when it holds exactly one case.
  public static func labeledInput(_ fields: [TestcaseField], _ input: String) -> [(field: TestcaseField, value: String)]? {
    let lines = rawLines(input)
    guard lines.count == fields.count else { return nil }
    return zip(fields, lines).map { ($0, $1) }
  }

  /// LeetCode places examples between the description and its Constraints and Follow-up sections. A statement that
  /// already writes its own examples keeps them in place.
  public static func splitStatement(_ markdown: String) -> (description: String, rest: String, hasInlineExamples: Bool) {
    let example = try! NSRegularExpression(pattern: #"^(?:#{1,6}\s*)?(?:\*\*|__)?\s*Example\s*1\b"#, options: [.anchorsMatchLines, .caseInsensitive])
    let section = try! NSRegularExpression(pattern: #"^(?:#{1,6}\s*)?(?:\*\*|__)?\s*(?:Constraints|Follow[- ]up)\b[^\n]*$"#, options: [.anchorsMatchLines, .caseInsensitive])
    let whole = NSRange(markdown.startIndex..., in: markdown)
    let hasInline = example.firstMatch(in: markdown, range: whole) != nil
    guard !hasInline, let match = section.firstMatch(in: markdown, range: whole), let range = Range(match.range, in: markdown) else {
      return (markdown, "", hasInline)
    }
    let description = String(markdown[..<range.lowerBound])
    return (description.replacingOccurrences(of: #"\s+$"#, with: "", options: .regularExpression), String(markdown[range.lowerBound...]), false)
  }

  /// Splits an example input such as `nums = [1,2], target = 3` between its `name = value` pairs, so each pair can
  /// wrap as a unit.
  public static func exampleAssignments(_ input: String) -> [String] {
    let text = Array(input)
    var pairs: [String] = []
    var depth = 0
    var start = 0
    var index = 0
    func startsAssignment(_ from: Int) -> Bool {
      var cursor = from
      while cursor < text.count, text[cursor].isWhitespace { cursor += 1 }
      guard cursor < text.count, text[cursor].isLetter || text[cursor] == "_" else { return false }
      while cursor < text.count, text[cursor].isLetter || text[cursor].isNumber || text[cursor] == "_" { cursor += 1 }
      while cursor < text.count, text[cursor].isWhitespace { cursor += 1 }
      guard cursor < text.count, text[cursor] == "=" else { return false }
      return cursor + 1 >= text.count || text[cursor + 1] != "="
    }
    while index < text.count {
      let character = text[index]
      if character == "\"" { index = skipString(text, index); continue }
      if "[{(".contains(character) { depth += 1 } else if ")}]".contains(character) { depth -= 1 } else if character == ",", depth == 0, startsAssignment(index + 1) {
        pairs.append(String(text[start...index]).trimmingCharacters(in: .whitespacesAndNewlines))
        start = index + 1
      }
      index += 1
    }
    pairs.append(String(text[min(start, text.count)...]).trimmingCharacters(in: .whitespacesAndNewlines))
    return pairs
  }
}
