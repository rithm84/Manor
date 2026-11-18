import Foundation

/// Turns re-reads into as few requests as possible: a single-column key becomes one `in` filter per batch of
/// rows, and a composite key becomes `or` expressions of equality chains, each kept under a length cap.
public enum IdentityReads {
  /// How large one re-read request may get: a row count for id lists, a rendered length for identity chains.
  public struct Limits: Sendable {
    public let rows: Int
    public let characters: Int
    public init(rows: Int, characters: Int) {
      self.rows = rows
      self.characters = characters
    }
  }

  /// Both caps keep the rendered query well inside what a proxy accepts in a URL.
  public static let limits = Limits(rows: 200, characters: 4_000)

  public enum Batch: Sendable, Equatable {
    case `in`(column: String, values: [String])
    case or(expression: String)
  }

  /// PostgREST reads a quoted value literally; only the quote and the escape itself need escaping inside it.
  static func quoted(_ value: String) throws -> String {
    if value.unicodeScalars.contains(where: { $0.value < 0x20 }) {
      throw MirrorError("A row identity holds a control character: \(value.debugDescription)")
    }
    return "\"" + value.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"") + "\""
  }

  private static func value(_ table: String, _ change: KeyedChange, _ column: String) throws -> String {
    guard let value = change.identity[column] else {
      throw MirrorError("A \(table) change is missing \(column), so its row cannot be re-read")
    }
    return value
  }

  private static func chain(_ table: String, _ change: KeyedChange, _ columns: [String]) throws -> String {
    "and(" + (try columns.map { "\($0).eq.\(try quoted(try value(table, change, $0)))" }).joined(separator: ",") + ")"
  }

  public static func batches(_ table: String, _ lookups: [KeyedChange], limits: Limits = limits) throws -> [Batch] {
    guard limits.rows >= 1 else { throw MirrorError("An identity batch holds at least one row") }
    guard limits.characters >= 1 else { throw MirrorError("An identity expression holds at least one character") }
    let columns = MirrorTables.keyColumnsOf(table)
    if columns.count == 1 {
      var batches: [Batch] = []
      var offset = 0
      while offset < lookups.count {
        let slice = lookups[offset..<min(offset + limits.rows, lookups.count)]
        batches.append(.in(column: columns[0], values: try slice.map { try value(table, $0, columns[0]) }))
        offset += limits.rows
      }
      return batches
    }
    // Fills one expression at a time and starts the next before the current would pass the cap. A single chain
    // longer than the cap travels on its own, because nothing shorter addresses that row.
    var batches: [Batch] = []
    var chains: [String] = []
    var length = 0
    for change in lookups {
      let next = try chain(table, change, columns)
      if !chains.isEmpty, length + 1 + next.count > limits.characters {
        batches.append(.or(expression: chains.joined(separator: ",")))
        chains = []
        length = 0
      }
      length += chains.isEmpty ? next.count : 1 + next.count
      chains.append(next)
    }
    if !chains.isEmpty { batches.append(.or(expression: chains.joined(separator: ","))) }
    return batches
  }
}

/// The span a calendar read covers. All-day rows are compared as dates because they carry no zone, and timed
/// rows as instants over a span widened by a day on each side, which catches every event that touches one of
/// the requested account-local days in any time zone. Pages filter the mirrored `calendar_events` with it.
public struct CalendarWindow: Sendable, Equatable {
  public let firstDate: String
  public let lastDate: String
  public let earliest: Date
  public let latest: Date

  /// The window over ordered `YYYY-MM-DD` days.
  public init(days ordered: [String]) throws {
    guard let first = ordered.first, let last = ordered.last else { throw MirrorError("A calendar window covers at least one day") }
    guard let start = Self.utcDay(first), let end = Self.utcDay(last) else { throw MirrorError("A calendar window takes YYYY-MM-DD days") }
    firstDate = first
    lastDate = last
    earliest = start.addingTimeInterval(-86_400)
    latest = end.addingTimeInterval(2 * 86_400)
  }

  private static func utcDay(_ text: String) -> Date? {
    let parts = text.split(separator: "-").compactMap { Int($0) }
    guard parts.count == 3 else { return nil }
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "UTC")!
    return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
  }

  private static func iso(_ date: Date) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.string(from: date)
  }

  public var earliestText: String { Self.iso(earliest) }
  public var latestText: String { Self.iso(latest) }

  /// The server-side form of the window, as one PostgREST `or` expression over `calendar_events`.
  public var serverFilter: String {
    "and(all_day.eq.true,start_date.lte.\(lastDate),end_date.gt.\(firstDate))," +
      "and(all_day.eq.false,starts_at.lt.\(latestText),ends_at.gt.\(earliestText))"
  }

  /// Whether a stored `calendar_events` row falls inside the window.
  public func contains(_ row: Row) -> Bool {
    if row["all_day"] == .bool(true) {
      guard let start = row["start_date"]?.string, let end = row["end_date"]?.string else { return false }
      return start <= lastDate && end > firstDate
    }
    guard row["all_day"] == .bool(false), let start = row["starts_at"]?.string.flatMap(Self.instant),
          let end = row["ends_at"]?.string.flatMap(Self.instant) else { return false }
    return start < latest && end > earliest
  }

  /// Parses the timestamps Postgres and Google return: with or without fractional seconds, any offset.
  static func instant(_ text: String) -> Date? {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = formatter.date(from: text) { return date }
    formatter.formatOptions = [.withInternetDateTime]
    return formatter.date(from: text)
  }
}
