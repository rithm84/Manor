import Foundation

/// Why the mirror refused something: a row, a feed page, or a snapshot that is not in the form it expects.
public struct MirrorError: LocalizedError, Sendable, Equatable {
  public let message: String
  public init(_ message: String) { self.message = message }
  public var errorDescription: String? { message }
}

/// Raised when the mirror is stopped while a pass sits between awaits. The pass then abandons its work instead
/// of writing into a mirror the app has left, which after a sign-out or an account switch is somebody else's.
public struct MirrorAbandoned: Error, Sendable {
  public let accountId: String
}

/// The tables the local mirror holds, how a row is named inside one account, and the rules that decide when a
/// copy is pulled, refreshed in full, or rebuilt.
///
/// `problem_catalog` and `problem_catalog_content` are the shared problem catalog, which follows its own feed
/// and snapshot (`CatalogSync`); `leetcode_problems` and `problem_content_versions` then hold only the
/// account's custom problems and their statements. `note_versions`, `note_attachments`, `action_events`, and
/// the legacy habit tables stay on the server. Adding or removing a table changes what a ready copy holds, so
/// `MirrorStore.schemaVersion` rises with it and copies built under the old set are discarded.
public enum MirrorTables {
  public static let all: [String] = [
    "profiles", "contexts", "tasks", "scratch_blocks", "saved_task_views",
    "habits", "habit_entries", "mood_focus_entries", "pomodoro_sessions",
    "note_folders", "note_pages", "note_suggestions",
    "leetcode_attempts", "leetcode_notes", "leetcode_problems", "saved_problem_views",
    "problem_practice", "problem_content_versions", "problem_catalog", "problem_catalog_content",
    "job_roles", "job_stage_transitions", "job_listings",
    "kb_entries", "resumes", "weekly_reviews",
    "calendar_accounts", "calendars", "calendar_events"
  ]

  private static let allSet = Set(all)

  /// How a row is named inside one account. The change feed reports the same fields in `object_key` and a
  /// re-read asks Postgres for exactly these columns, so one map drives storage, feed lookups, and re-reads.
  public static let keyColumns: [String: [String]] = [
    "profiles": ["user_id"], "contexts": ["id"], "tasks": ["id"], "scratch_blocks": ["id"], "saved_task_views": ["id"],
    "habits": ["id"], "habit_entries": ["habit_id", "date"], "mood_focus_entries": ["date"], "pomodoro_sessions": ["id"],
    "note_folders": ["id"], "note_pages": ["id"], "note_suggestions": ["id"],
    "leetcode_attempts": ["id"], "leetcode_notes": ["id"], "leetcode_problems": ["id"], "saved_problem_views": ["id"],
    "problem_practice": ["problem_id"], "problem_content_versions": ["problem_id", "version"],
    "problem_catalog": ["id"], "problem_catalog_content": ["problem_id"],
    "job_roles": ["id"], "job_stage_transitions": ["id"], "job_listings": ["id"],
    "kb_entries": ["id"], "resumes": ["id"], "weekly_reviews": ["id"],
    "calendar_accounts": ["id"], "calendars": ["account_id", "id"], "calendar_events": ["account_id", "calendar_id", "id"]
  ]

  /// The shared problem catalog: one copy for every account, filled from a snapshot and its own feed.
  public static let catalogTables: [String] = ["problem_catalog", "problem_catalog_content"]

  /// A table only the mirror has: the company reports and source snapshots of catalog problems, keyed by
  /// problem id. `problem_catalog` keeps its rows without them (see `CatalogRows`).
  public static let catalogDetailTable = "problem_catalog_detail"

  /// The account's own tables; the catalog has its own snapshot and feed.
  public static let accountTables: [String] = all.filter { !isCatalogTable($0) }

  /// No change-feed trigger covers these, so the mirror replaces them in full on launch and every hour.
  public static let hourlyTables: [String] = ["job_listings"]
  /// No trigger either, but it only changes alongside `job_roles`, so a `job_roles` change re-pulls it.
  public static let jobRoleDependents: [String] = ["job_stage_transitions"]
  /// Feed-less tables, replaced in full whenever the app launches against a mirror that is already built.
  public static let launchRefreshTables: [String] = hourlyTables + jobRoleDependents

  /// Tables an update can touch without moving `revision`: `touch_note` sets `last_opened_at` alone while the
  /// feed still reports the row's current revision, so a matching local revision never excuses a re-read.
  private static let touchedWithoutRevisionTables: Set<String> = ["note_pages"]

  /// Key columns hold ids, dates, and months, never this control character, so a join on it cannot collide.
  public static let keySeparator = "\u{1f}"

  public static func isMirrored(_ table: String) -> Bool { allSet.contains(table) }
  public static func isCatalogTable(_ table: String) -> Bool { table == "problem_catalog" || table == "problem_catalog_content" }
  /// Tables every account reads whole, with no owner column to filter on.
  public static func isSharedTable(_ table: String) -> Bool { table == "job_listings" || isCatalogTable(table) }
  public static func touchedWithoutRevision(_ table: String) -> Bool { touchedWithoutRevisionTables.contains(table) }

  /// The mirrored table a feed row belongs to, or nil for an `object_type` the mirror ignores.
  public static func mirroredTable(_ objectType: String) -> String? { allSet.contains(objectType) ? objectType : nil }

  public static func keyColumnsOf(_ table: String) -> [String] { keyColumns[table] ?? ["id"] }

  /// The filters a full pull carries, so the copy holds exactly the rows the table's reads may see. The
  /// account only ever reads the open postings of the shared board.
  public static func standingFilters(_ table: String) -> [RowFilter] {
    table == "job_listings" ? [RowFilter("active", .bool(true))] : []
  }

  private static func keyPart(_ table: String, _ column: String, _ value: JSONValue?) throws -> String {
    switch value {
    case .string(let text): return text
    case .number(let number) where number.isFinite: return numberText(number)
    default:
      let shown = value.flatMap { try? String(decoding: ManorJSON.plainEncoder.encode($0), as: UTF8.self) } ?? "null"
      throw MirrorError("\(table).\(column) identifies a row, so it holds text or a number, not \(shown)")
    }
  }

  /// How JavaScript's `String(number)` renders a key number, so keys match the files the web app wrote.
  static func numberText(_ number: Double) -> String {
    if number.rounded() == number, abs(number) < 1e21 { return String(Int64(number)) }
    return String(number)
  }

  /// The stored key of a row read from Postgres. A missing key column is schema drift, so it throws.
  public static func rowKey(_ table: String, _ row: Row) throws -> String {
    try keyColumnsOf(table).map { try keyPart(table, $0, row[$0]) }.joined(separator: keySeparator)
  }

  /// The identity a re-read filters on, or nil when the feed's `object_key` does not name every key column.
  public static func identity(_ table: String, objectKey: Row) throws -> [String: String]? {
    var identity: [String: String] = [:]
    for column in keyColumnsOf(table) {
      guard let value = objectKey[column], !value.isNull else { return nil }
      identity[column] = try keyPart(table, column, value)
    }
    return identity
  }

  public static func key(_ table: String, identity: [String: String]) throws -> String {
    try keyColumnsOf(table).map { column in
      guard let value = identity[column] else { throw MirrorError("A \(table) identity is missing \(column)") }
      return value
    }.joined(separator: keySeparator)
  }

  /// The revision a row carries, or nil for tables without a revision column (calendar rows, job listings).
  public static func revision(of row: Row) -> Int? {
    guard case .number(let value) = row["revision"], value.rounded() == value, value.isFinite else { return nil }
    return Int(value)
  }

  /// Whether a mirror found on disk must be rebuilt instead of pulled. A stored cursor past the account's head
  /// belongs to a different history; the feed answers it with zero rows, so pulling would freeze the copy.
  public static func needsRebuild(ready: Bool, cursor: Int, head: Int) -> Bool {
    !ready || cursor > head
  }
}

/// One stored row: its account-local key, the row as Postgres returned it, and the revision it carried.
public struct MirrorRow: Sendable, Equatable {
  public let key: String
  public let data: Row
  public let revision: Int?
  public init(key: String, data: Row, revision: Int?) {
    self.key = key
    self.data = data
    self.revision = revision
  }

  /// A row read from Postgres or a snapshot, keyed for its table.
  public init(table: String, row: Row) throws {
    self.init(key: try MirrorTables.rowKey(table, row), data: row, revision: MirrorTables.revision(of: row))
  }
}

/// The mirror's answer to a read: the same equality filters and the same ascending key order the server query
/// applies, so a page cannot tell which side served it.
public enum MirrorRows {
  private static let collation = Locale(identifier: "en")

  /// Whether a stored row passes one equality filter the way the server would apply it.
  public static func matches(_ row: Row, _ filter: RowFilter) -> Bool {
    guard let value = row[filter.column] else { return false }
    return value == filter.value
  }

  /// Postgres sorts ascending with nulls last, and a missing column in a stored row reads as a null.
  static func compare(_ left: JSONValue?, _ right: JSONValue?) -> ComparisonResult {
    let a = (left?.isNull ?? true) ? nil : left
    let b = (right?.isNull ?? true) ? nil : right
    switch (a, b) {
    case (nil, nil): return .orderedSame
    case (nil, _): return .orderedDescending
    case (_, nil): return .orderedAscending
    case (.number(let x)?, .number(let y)?): return x < y ? .orderedAscending : x > y ? .orderedDescending : .orderedSame
    case (.bool(let x)?, .bool(let y)?): return x == y ? .orderedSame : (x ? .orderedDescending : .orderedAscending)
    case (.string(let x)?, .string(let y)?): return x == y ? .orderedSame : x.compare(y, locale: collation)
    case (let x?, let y?): return text(x).compare(text(y), locale: collation)
    }
  }

  private static func text(_ value: JSONValue) -> String {
    switch value {
    case .string(let text): return text
    case .number(let number): return MirrorTables.numberText(number)
    case .bool(let flag): return flag ? "true" : "false"
    default: return String(decoding: (try? ManorJSON.plainEncoder.encode(value)) ?? Data(), as: UTF8.self)
    }
  }

  /// Sorts rows by the table's key columns, as the server query orders them.
  public static func sorted(_ table: String, _ rows: [Row]) -> [Row] {
    let columns = ManorTables.order[table] ?? ["id"]
    return rows.sorted { left, right in
      for column in columns {
        let order = compare(left[column], right[column])
        if order != .orderedSame { return order == .orderedAscending }
      }
      return false
    }
  }

  /// Filters and orders rows the way the server would answer the same read.
  public static func select(_ table: String, _ rows: [Row], filters: [RowFilter]) -> [Row] {
    sorted(table, rows.filter { row in filters.allSatisfy { matches(row, $0) } })
  }
}
