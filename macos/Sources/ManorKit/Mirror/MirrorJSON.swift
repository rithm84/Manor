import Foundation

/// JSON in and out of the mirror file. `JSONSerialization` parses and writes several times faster than a
/// `Codable` round trip through `JSONValue`, and the mirror moves tens of megabytes of rows on a catalog fill.
enum MirrorJSON {
  static func parse(_ data: Data) throws -> JSONValue {
    value(try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]))
  }

  static func parseObject(_ data: Data) throws -> Row {
    guard case .object(let row) = try parse(data) else { throw MirrorError("A stored row is not a JSON object") }
    return row
  }

  static func parseRows(_ data: Data) throws -> [Row] {
    guard let list = try JSONSerialization.jsonObject(with: data, options: []) as? [Any] else {
      throw MirrorError("The server answered a read with something other than a list of rows")
    }
    return try list.map { item in
      guard case .object(let row) = value(item) else { throw MirrorError("The server answered a read with a row that is not an object") }
      return row
    }
  }

  static func value(_ any: Any) -> JSONValue {
    switch any {
    case let text as String: return .string(text)
    case let number as NSNumber:
      if CFGetTypeID(number) == CFBooleanGetTypeID() { return .bool(number.boolValue) }
      return .number(number.doubleValue)
    case let list as [Any]: return .array(list.map(value))
    case let object as [String: Any]:
      var row: Row = Dictionary(minimumCapacity: object.count)
      for (key, item) in object { row[key] = value(item) }
      return .object(row)
    default: return .null
    }
  }

  static func foundation(_ value: JSONValue) -> Any {
    switch value {
    case .null: return NSNull()
    case .bool(let flag): return NSNumber(value: flag)
    case .number(let number):
      if number.rounded() == number, abs(number) < 9_007_199_254_740_992 { return NSNumber(value: Int64(number)) }
      return NSNumber(value: number)
    case .string(let text): return text
    case .array(let list): return list.map(foundation)
    case .object(let object): return object.mapValues(foundation)
    }
  }

  static func text(_ value: JSONValue) throws -> String {
    String(decoding: try JSONSerialization.data(withJSONObject: foundation(value), options: [.fragmentsAllowed, .withoutEscapingSlashes]), as: UTF8.self)
  }

  static func text(_ row: Row) throws -> String { try text(.object(row)) }
}
