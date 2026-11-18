import Foundation

/// A solution language. Typed problems offer C++, Python, JavaScript, Java, and Go; standard-input problems also
/// offer C. The raw value is the identifier the backend, starter code, drafts, and submissions use.
/// Shared by the library and the workspace.
public enum ProblemLanguage: String, CaseIterable, Codable, Hashable, Sendable, Identifiable {
  case cpp, c, python, javascript, java, go

  public var id: String { rawValue }

  public var label: String {
    switch self {
    case .cpp: return "C++"
    case .c: return "C"
    case .python: return "Python"
    case .javascript: return "JavaScript"
    case .java: return "Java"
    case .go: return "Go"
    }
  }

  /// The language's one workspace document in the editor sandbox.
  public var fileName: String {
    switch self {
    case .cpp: return "main.cpp"
    case .c: return "main.c"
    case .python: return "main.py"
    case .javascript: return "main.js"
    case .java: return "Main.java"
    case .go: return "main.go"
    }
  }

  /// The workspace document's URI, which the language server bridge requires exactly.
  public var documentURI: String { "file:///workspace/" + fileName }

  public static let defaultLanguage: ProblemLanguage = .python
}
