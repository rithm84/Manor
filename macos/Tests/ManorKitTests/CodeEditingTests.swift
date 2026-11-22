import Foundation
import Testing
@testable import ManorKit

/// Applies an edit and renders the result with `|` at the caret (or `[...]` around a selection).
private func run(_ source: String, _ language: ProblemLanguage = .python, tab: Int = 4,
                 _ action: (CodeEditing, NSString, NSRange) -> CodeEdit?) -> String {
  let caret = (source as NSString).range(of: "|")
  var text = source.replacingOccurrences(of: "|", with: "")
  var selection = NSRange(location: caret.location, length: 0)
  if caret.location == NSNotFound {
    let open = (source as NSString).range(of: "[").location, close = (source as NSString).range(of: "]").location
    text = source.replacingOccurrences(of: "[", with: "").replacingOccurrences(of: "]", with: "")
    selection = NSRange(location: open, length: close - open - 1)
  }
  let ns = text as NSString
  guard let edit = action(CodeEditing(language: language, tabSize: tab), ns, selection) else { return "nil" }
  let result = ns.replacingCharacters(in: edit.range, with: edit.text) as NSString
  if edit.selection.length == 0 { return result.replacingCharacters(in: edit.selection, with: "|") }
  let marked = result.replacingCharacters(in: NSRange(location: NSMaxRange(edit.selection), length: 0), with: "]") as NSString
  return marked.replacingCharacters(in: NSRange(location: edit.selection.location, length: 0), with: "[")
}

@Suite("Code editor typing rules")
struct CodeEditingTests {
  @Test func enterIndentsOnlyInCode() {
    #expect(run("def f(x):|") { $0.newline(in: $1, selection: $2) } == "def f(x):\n    |")
    #expect(run("\"\"\"\nstate:|") { $0.newline(in: $1, selection: $2) } == "\"\"\"\nstate:\n|")
    #expect(run("x = 1  # todo:|") { $0.newline(in: $1, selection: $2) } == "x = 1  # todo:\n|")
    #expect(run("int f() {|}", .cpp) { $0.newline(in: $1, selection: $2) } == "int f() {\n    |\n}")
  }

  @Test func enterDedentsAfterPythonBlockEnders() {
    #expect(run("    return x|") { $0.newline(in: $1, selection: $2) } == "    return x\n|")
    #expect(run("        pass|") { $0.newline(in: $1, selection: $2) } == "        pass\n    |")
    // "returned" is a name, not the keyword.
    #expect(run("    returned = 1|") { $0.newline(in: $1, selection: $2) } == "    returned = 1\n    |")
  }

  @Test func enterLeavesNoSpacesOnABlankLine() {
    #expect(run("if x:\n    |") { $0.newline(in: $1, selection: $2) } == "if x:\n\n    |")
  }

  @Test func enterContinuesDocComments() {
    #expect(run("/**|", .java) { $0.newline(in: $1, selection: $2) } == "/**\n * |")
    #expect(run("/**\n * one|", .java) { $0.newline(in: $1, selection: $2) } == "/**\n * one\n * |")
  }

  @Test func bracketsAndQuotesPairWhereCodeEditorsDo() {
    let t: (String, String, ProblemLanguage) -> String = { source, value, language in
      run(source, language) { e, text, sel in e.type(value, in: text, selection: sel, autoClosed: [])?.edit }
    }
    #expect(t("x = |", "(", .python) == "x = (|)")
    #expect(t("x = |", "'", .python) == "x = '|'")
    #expect(t("const s = |", "`", .javascript) == "const s = `|`")
    #expect(t("char c = |", "`", .cpp) == "nil")
    // Not after a word, not inside a string or comment, not before a word.
    #expect(t("don|", "'", .python) == "nil")
    #expect(t("# it|", "'", .python) == "nil")
    #expect(t("s = \"a|", "'", .python) == "nil")
    #expect(t("x = |abc", "(", .python) == "nil")
  }

  @Test func selectionsAreWrapped() {
    #expect(run("x = [a + b]") { e, text, sel in e.type("(", in: text, selection: sel, autoClosed: [])?.edit } == "x = ([a + b])")
    #expect(run("[word]") { e, text, sel in e.type("\"", in: text, selection: sel, autoClosed: [])?.edit } == "\"[word]\"")
  }

  @Test func onlyAutoInsertedClosersAreSteppedOverOrDeletedAsAPair() {
    #expect(run("f(x|)") { e, text, sel in e.type(")", in: text, selection: sel, autoClosed: [3])?.edit } == "f(x)|")
    // A closer the person typed is not stepped over.
    #expect(run("f(g(x|)") { e, text, sel in e.type(")", in: text, selection: sel, autoClosed: [])?.edit } == "nil")
    #expect(run("f(|)") { e, text, sel in e.backspace(in: text, selection: sel, autoClosed: [2]) } == "f|")
    #expect(run("\"a\"|\"b\"") { e, text, sel in e.backspace(in: text, selection: sel, autoClosed: []) } == "nil")
  }

  @Test func closersLineUpWithTheirOpener() {
    #expect(run("int f() {\n    x;\n    |", .cpp) { e, text, sel in e.type("}", in: text, selection: sel, autoClosed: [])?.edit } == "int f() {\n    x;\n}|")
  }

  @Test func pythonContinuationsLineUpWithTheirBlock() {
    #expect(run("if a:\n    b()\n    else|") { e, text, sel in e.type(":", in: text, selection: sel, autoClosed: [])?.edit } == "if a:\n    b()\nelse:|")
    #expect(run("try:\n    b()\n    except ValueError|") { e, text, sel in e.type(":", in: text, selection: sel, autoClosed: [])?.edit }
      == "try:\n    b()\nexcept ValueError:|")
    // Already aligned: nothing to do.
    #expect(run("if a:\n    b()\nelse|") { e, text, sel in e.type(":", in: text, selection: sel, autoClosed: [])?.edit } == "nil")
  }

  @Test func backspaceRemovesOneIndentLevel() {
    #expect(run("if x:\n        |") { e, text, sel in e.backspace(in: text, selection: sel, autoClosed: []) } == "if x:\n    |")
    #expect(run("if x:\n      |") { e, text, sel in e.backspace(in: text, selection: sel, autoClosed: []) } == "if x:\n    |")
    #expect(run("if x:\n    y|") { e, text, sel in e.backspace(in: text, selection: sel, autoClosed: []) } == "nil")
  }

  @Test func tabAndShiftTab() {
    #expect(run("ab|") { $0.indent(in: $1, selection: $2) } == "ab  |")
    #expect(run("[a\n\nb]") { $0.indent(in: $1, selection: $2) } == "[    a\n\n    b]")
    #expect(run("      x|") { $0.outdent(in: $1, selection: $2) } == "    x|")
    #expect(run("    |x") { $0.outdent(in: $1, selection: $2) } == "|x")
  }

  @Test func commentToggleKeepsTheCaret() {
    #expect(run("    x = 1|") { $0.toggleComment(in: $1, selection: $2) } == "    # x = 1|")
    #expect(run("    # x = 1|") { $0.toggleComment(in: $1, selection: $2) } == "    x = 1|")
    #expect(run("[a\n  b]", .cpp) { $0.toggleComment(in: $1, selection: $2) } == "[// a\n//   b]")
    #expect(run("    |", .go) { $0.toggleComment(in: $1, selection: $2) } == "    // |")
  }

  @Test func lineMovesCopiesAndDeletes() {
    #expect(run("a\nb|\nc") { $0.moveLines(in: $1, selection: $2, up: true) } == "b|\na\nc")
    #expect(run("a|\nb\nc") { $0.moveLines(in: $1, selection: $2, up: false) } == "b\na|\nc")
    #expect(run("a\nb\nc|") { $0.moveLines(in: $1, selection: $2, up: true) } == "a\nc|\nb")
    #expect(run("a\nb|") { $0.moveLines(in: $1, selection: $2, up: false) } == "nil")
    #expect(run("a|\nb") { $0.copyLines(in: $1, selection: $2, up: false) } == "a\na|\nb")
    #expect(run("a\nb|") { $0.copyLines(in: $1, selection: $2, up: true) } == "a\nb|\nb")
    #expect(run("a\nb|\nc") { $0.deleteLines(in: $1, selection: $2) } == "a\n|c")
    #expect(run("a\nb|") { $0.deleteLines(in: $1, selection: $2) } == "a|")
  }

  @Test func bracketMatchingSkipsStringsAndComments() {
    let units = Array("f(\")\", x) # )".utf16)
    #expect(CodeIndentation.matchingBracket(units, at: 1, language: .python) == 8)
    #expect(CodeIndentation.matchingBracket(units, at: 8, language: .python) == 1)
    #expect(CodeIndentation.matchingBracket(units, at: 3, language: .python) == nil)
  }
}
