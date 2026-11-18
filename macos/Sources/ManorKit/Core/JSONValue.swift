import Foundation

/// A JSON value as Postgres and PostgREST return it. Rows travel as `Row` until a module decodes them.
public enum JSONValue: Codable, Hashable, Sendable {
  case null
  case bool(Bool)
  case number(Double)
  case string(String)
  case array([JSONValue])
  case object([String: JSONValue])

  public init(from decoder: Decoder) throws {
    let container = try decoder.singleValueContainer()
    if container.decodeNil() { self = .null }
    else if let value = try? container.decode(Bool.self) { self = .bool(value) }
    else if let value = try? container.decode(Double.self) { self = .number(value) }
    else if let value = try? container.decode(String.self) { self = .string(value) }
    else if let value = try? container.decode([JSONValue].self) { self = .array(value) }
    else { self = .object(try container.decode([String: JSONValue].self)) }
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.singleValueContainer()
    switch self {
    case .null: try container.encodeNil()
    case .bool(let value): try container.encode(value)
    case .number(let value):
      if value.rounded() == value, abs(value) < 9_007_199_254_740_992 { try container.encode(Int64(value)) }
      else { try container.encode(value) }
    case .string(let value): try container.encode(value)
    case .array(let value): try container.encode(value)
    case .object(let value): try container.encode(value)
    }
  }

  public var string: String? { if case .string(let value) = self { return value }; return nil }
  public var double: Double? { if case .number(let value) = self { return value }; return nil }
  /// A whole number that fits in Int; larger or non-finite numbers read as nil instead of trapping.
  public var int: Int? {
    if case .number(let value) = self, value.isFinite, value.rounded() == value, abs(value) < 9.0e18 { return Int(value) }
    return nil
  }
  public var bool: Bool? { if case .bool(let value) = self { return value }; return nil }
  public var array: [JSONValue]? { if case .array(let value) = self { return value }; return nil }
  public var object: [String: JSONValue]? { if case .object(let value) = self { return value }; return nil }
  public var isNull: Bool { if case .null = self { return true }; return false }

  public subscript(key: String) -> JSONValue? { object?[key] }
}

extension JSONValue: ExpressibleByNilLiteral, ExpressibleByBooleanLiteral, ExpressibleByIntegerLiteral,
  ExpressibleByFloatLiteral, ExpressibleByStringLiteral, ExpressibleByArrayLiteral, ExpressibleByDictionaryLiteral {
  public init(nilLiteral: ()) { self = .null }
  public init(booleanLiteral value: Bool) { self = .bool(value) }
  public init(integerLiteral value: Int) { self = .number(Double(value)) }
  public init(floatLiteral value: Double) { self = .number(value) }
  public init(stringLiteral value: String) { self = .string(value) }
  public init(arrayLiteral elements: JSONValue...) { self = .array(elements) }
  public init(dictionaryLiteral elements: (String, JSONValue)...) { self = .object(Dictionary(uniqueKeysWithValues: elements)) }
}

public extension JSONValue {
  /// Wraps an optional so `nil` becomes JSON null, for command inputs built from optional fields.
  static func from(_ value: String?) -> JSONValue { value.map(JSONValue.string) ?? .null }
  static func from(_ value: Int?) -> JSONValue { value.map { .number(Double($0)) } ?? .null }
  static func from(_ value: Double?) -> JSONValue { value.map(JSONValue.number) ?? .null }
  static func from(_ value: Bool?) -> JSONValue { value.map(JSONValue.bool) ?? .null }

  /// Encodes any `Encodable` (snake_case keys) into a JSON value.
  static func encode<T: Encodable>(_ value: T) throws -> JSONValue {
    try ManorJSON.decoder.decode(JSONValue.self, from: ManorJSON.encoder.encode(value))
  }

  /// Decodes this value into a `Decodable` type whose properties are the camelCase form of snake_case keys.
  func decode<T: Decodable>(_ type: T.Type = T.self) throws -> T {
    try ManorJSON.decoder.decode(T.self, from: ManorJSON.plainEncoder.encode(self))
  }
}

/// One row as PostgREST or the mirror returns it.
public typealias Row = [String: JSONValue]
/// A command input.
public typealias JSONObject = [String: JSONValue]

public extension Dictionary where Key == String, Value == JSONValue {
  func decode<T: Decodable>(_ type: T.Type = T.self) throws -> T { try JSONValue.object(self).decode(T.self) }
  var id: String? { self["id"]?.string }
  var revision: Int? { self["revision"]?.int }
}

/// Shared coders. Domain structs use camelCase properties; the wire uses snake_case.
public enum ManorJSON {
  public static let decoder: JSONDecoder = {
    let decoder = JSONDecoder()
    decoder.keyDecodingStrategy = .convertFromSnakeCase
    return decoder
  }()
  public static let encoder: JSONEncoder = {
    let encoder = JSONEncoder()
    encoder.keyEncodingStrategy = .convertToSnakeCase
    return encoder
  }()
  /// Encodes `JSONValue` trees without touching their keys.
  public static let plainEncoder = JSONEncoder()
  public static let plainDecoder = JSONDecoder()

  public static func rows(from data: Data) throws -> [Row] { try plainDecoder.decode([Row].self, from: data) }
  public static func decodeRows<T: Decodable>(_ type: T.Type, from rows: [Row]) throws -> [T] {
    try decoder.decode([T].self, from: plainEncoder.encode(rows))
  }
}
