import Testing
@testable import ManorKit

@Suite("Code editor indentation")
struct CodeIndentationTests {
  private func inside(_ prefix: String, _ language: ProblemLanguage = .python) -> Bool {
    CodeIndentation.isInsideStringOrComment(prefix, language: language)
  }

  @Test func notesInADocstringAreProse() {
    #expect(inside("\"\"\"\nchoice:"))
    #expect(inside("def f():\n    '''\n    state:"))
    #expect(!inside("\"\"\"\nnotes\n\"\"\"\nclass Solution:"))
    #expect(!inside("def f(x):"))
  }

  @Test func pythonCommentsAndStringsEndWhereTheyShould() {
    #expect(inside("x = 1  # todo:"))
    #expect(!inside("# note\nif x:"))
    #expect(inside("s = \"key:"))
    #expect(!inside("s = \"a\\\"b\"\nif s:"))
    // A quote inside a comment opens nothing.
    #expect(!inside("# don't\nfor x in y:"))
  }

  @Test func otherLanguagesUseTheirOwnCommentsAndStrings() {
    #expect(inside("// steps: {", .cpp))
    #expect(inside("/* plan:\n  first {", .java))
    #expect(!inside("/* plan */\nint main() {", .c))
    #expect(inside("const t = `line one {\n", .javascript))
    #expect(!inside("func main() {", .go))
    // A Python-style comment is code in C++.
    #expect(!inside("# include x\nint f() {", .cpp))
  }
}
