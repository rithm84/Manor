import Foundation

/// A refusal from the server, worded for the reader. `code` is the Postgres or PostgREST code.
public struct ManorRequestError: LocalizedError, Sendable {
  public let operation: String
  public let code: String
  public let detail: String
  public init(operation: String, code: String, detail: String) {
    self.operation = operation
    self.code = code
    self.detail = detail
  }
  public var isConflict: Bool { code == "PT409" }
  public var errorDescription: String? { Self.describe(code: code, detail: detail) }

  private static let columnNames: [String: String] = [
    "location": "location", "link": "posting link", "company": "company", "role": "role name", "term": "hiring cycle",
    "title": "title", "label": "label", "name": "name", "text": "text", "url": "link", "file_name": "file name"
  ]

  /// Manor names check constraints `<table>_<column>_check`, so a failed one names the value instead.
  public static func describe(code: String, detail: String) -> String {
    switch code {
    case "23514":
      if let range = detail.range(of: #"violates check constraint "([a-z_]+)""#, options: .regularExpression) {
        let constraint = detail[range].split(separator: "\"").dropFirst().first.map(String.init) ?? ""
        if let column = columnNames.keys.first(where: { constraint.hasSuffix("_\($0)_check") }), let name = columnNames[column] {
          return "The \(name) is too long or not in the expected form."
        }
      }
      return "One of the values is outside what Manor accepts."
    case "23505": return "A record with the same identity already exists."
    case "22001": return "One of the values is too long."
    default: return detail
    }
  }
}

/// The request never got an answer: offline, DNS, a dropped socket.
public struct ManorConnectionError: LocalizedError, Sendable {
  public let operation: String
  public let detail: String
  public init(operation: String, detail: String) {
    self.operation = operation
    self.detail = detail
  }
  public var errorDescription: String? { "Manor could not reach the server. Check the connection; this retries on its own." }
}
