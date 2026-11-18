import Foundation
import GRDB

/// Where the copy stands: whether the account copy is complete and how far its feed has been applied, the same
/// two facts for the shared catalog, and how many rows each stored table holds.
public struct MirrorStatus: Sendable, Equatable {
  public var ready: Bool
  public var cursor: Int
  public var catalogReady: Bool
  public var catalogCursor: Int
  public var rowCounts: [String: Int]

  public var totalRows: Int { rowCounts.values.reduce(0, +) }
}

/// A cached derived read with the cursor and account-local day that produced it.
public struct MirrorDerived: Sendable, Equatable {
  public let value: JSONValue
  public let cursor: Int
  public let day: String
}

/// The mirror file: one SQLite database in WAL mode holding a signed-in account's rows.
///
/// Three tables carry everything, in the layout the desktop shell's Rust store used, so a file that shell left
/// behind under the same bundle identifier opens as a ready copy: `meta` holds the schema version, the account,
/// the feed cursor and readiness, and the catalog's cursor and readiness; `rows` holds one record per mirrored
/// row as the server's JSON text, keyed by table and row identity, with its revision; `derived` holds cached
/// derived reads with the cursor and account-local day they were computed for.
///
/// The file belongs to one account and one schema version. Opening it for another account, or after the
/// schema changed, empties it and reports it not ready, which asks the caller to bootstrap. Nothing migrates,
/// because every row can be pulled from the server again. Reads run on the pool's readers and never wait for
/// a write, because WAL lets them read the last committed state while a pull writes.
public final class MirrorStore: Sendable {
  /// What a ready file holds: the layout and the set of tables in `MirrorTables.all`. Raising it discards
  /// every existing file, so the next launch rebuilds from the server.
  public static let schemaVersion = 6

  private enum Meta {
    static let schemaVersion = "schema_version"
    static let accountId = "account_id"
    static let cursor = "cursor"
    static let ready = "ready"
    static let catalogCursor = "catalog_cursor"
    static let catalogReady = "catalog_ready"
  }

  private static let schema = """
    create table if not exists meta(key text primary key, value text not null);
    create table if not exists rows(
        table_name text not null,
        key text not null,
        data text not null,
        revision integer,
        primary key(table_name, key)
    );
    create table if not exists derived(
        name text primary key,
        value text not null,
        cursor integer not null,
        day text not null
    );
    """

  public let url: URL
  public let accountId: String
  private let pool: DatabasePool

  private init(url: URL, accountId: String, pool: DatabasePool) {
    self.url = url
    self.accountId = accountId
    self.pool = pool
  }

  /// Opens or creates the file for `accountId` and reports where the copy stands.
  public static func open(at url: URL, accountId: String) throws -> (MirrorStore, MirrorStatus) {
    var configuration = Configuration()
    configuration.label = "Manor mirror"
    configuration.prepareDatabase { db in
      // NORMAL gives up only the last commit if the machine loses power, which the next pull fetches again.
      try db.execute(sql: "pragma synchronous = NORMAL")
    }
    let pool = try DatabasePool(path: url.path, configuration: configuration)
    let store = MirrorStore(url: url, accountId: accountId, pool: pool)
    try pool.write { db in
      try db.execute(sql: schema)
      let version = try String.fetchOne(db, sql: "select value from meta where key = ?", arguments: [Meta.schemaVersion])
      let account = try String.fetchOne(db, sql: "select value from meta where key = ?", arguments: [Meta.accountId])
      if version != String(schemaVersion) || account != accountId {
        for table in ["rows", "derived", "meta"] { try db.execute(sql: "delete from \(table)") }
        try writeMeta(db, Meta.schemaVersion, String(schemaVersion))
        try writeMeta(db, Meta.accountId, accountId)
        try writeMeta(db, Meta.cursor, "0")
        try writeMeta(db, Meta.ready, "false")
        try writeMeta(db, Meta.catalogCursor, "0")
        try writeMeta(db, Meta.catalogReady, "false")
      }
    }
    return (store, try pool.read(readStatus))
  }

  // MARK: Status

  public func status() async throws -> MirrorStatus {
    try await pool.read { try Self.readStatus($0) }
  }

  private static func readStatus(_ db: Database) throws -> MirrorStatus {
    var counts: [String: Int] = [:]
    let found = try GRDB.Row.fetchCursor(db, sql: "select table_name, count(*) from rows group by table_name")
    while let row = try found.next() { counts[row[0]] = row[1] }
    return MirrorStatus(
      ready: try flag(db, Meta.ready), cursor: try number(db, Meta.cursor),
      catalogReady: try flag(db, Meta.catalogReady), catalogCursor: try number(db, Meta.catalogCursor), rowCounts: counts
    )
  }

  private static func stored(_ db: Database, _ key: String) throws -> String? {
    try String.fetchOne(db, sql: "select value from meta where key = ?", arguments: [key])
  }

  private static func flag(_ db: Database, _ key: String) throws -> Bool {
    switch try stored(db, key) {
    case nil, "false"?: return false
    case "true"?: return true
    case let other?: throw MirrorError("The mirror cannot use `\(other)` as the `\(key)` flag; sign out and in again to rebuild it")
    }
  }

  private static func number(_ db: Database, _ key: String) throws -> Int {
    guard let text = try stored(db, key) else { return 0 }
    guard let value = Int(text), value >= 0 else { throw MirrorError("The mirror cannot use `\(text)` as the `\(key)` number; sign out and in again to rebuild it") }
    return value
  }

  private static func writeMeta(_ db: Database, _ key: String, _ value: String) throws {
    try db.execute(sql: "insert into meta(key, value) values(?, ?) on conflict(key) do update set value = excluded.value", arguments: [key, value])
  }

  // MARK: Writes

  private struct Encoded: Sendable {
    let key: String
    let text: String
    let revision: Int?
  }

  /// Rows are serialized before the write transaction opens, so the writer holds its lock only for SQLite work.
  private static func encode(_ rows: [MirrorRow]) throws -> [Encoded] {
    try rows.map { Encoded(key: $0.key, text: try MirrorJSON.text($0.data), revision: $0.revision) }
  }

  private static func write(_ db: Database, _ table: String, _ rows: [Encoded]) throws {
    let statement = try db.cachedStatement(sql: """
      insert into rows(table_name, key, data, revision) values(?, ?, ?, ?)
      on conflict(table_name, key) do update set data = excluded.data, revision = excluded.revision
      """)
    for row in rows { try statement.execute(arguments: [table, row.key, row.text, row.revision]) }
  }

  /// Replaces every row of one table in one transaction, which is how a bootstrap and a full refresh store a read.
  public func replaceTable(_ table: String, rows: [MirrorRow]) async throws {
    let encoded = try Self.encode(rows)
    try await pool.write { db in
      try db.execute(sql: "delete from rows where table_name = ?", arguments: [table])
      try Self.write(db, table, encoded)
    }
  }

  /// Inserts or overwrites the given rows of one table in one transaction.
  public func upsertRows(_ table: String, rows: [MirrorRow]) async throws {
    guard !rows.isEmpty else { return }
    let encoded = try Self.encode(rows)
    try await pool.write { db in try Self.write(db, table, encoded) }
  }

  /// Removes the given keys of one table. A key the table does not hold changes nothing, because a feed can
  /// report a row the copy never had.
  public func deleteRows(_ table: String, keys: [String]) async throws {
    guard !keys.isEmpty else { return }
    try await pool.write { db in
      let statement = try db.cachedStatement(sql: "delete from rows where table_name = ? and key = ?")
      for key in keys { try statement.execute(arguments: [table, key]) }
    }
  }

  /// Records how far the feed has been applied and whether the copy is complete. A pull calls this after its
  /// rows are stored, so the cursor never runs ahead of the data.
  public func commit(cursor: Int, ready: Bool) async throws {
    try await pool.write { db in
      try Self.writeMeta(db, Meta.cursor, String(cursor))
      try Self.writeMeta(db, Meta.ready, ready ? "true" : "false")
    }
  }

  /// Records how far the catalog's own feed has been applied and whether the catalog copy is complete.
  public func commitCatalog(cursor: Int, ready: Bool) async throws {
    try await pool.write { db in
      try Self.writeMeta(db, Meta.catalogCursor, String(cursor))
      try Self.writeMeta(db, Meta.catalogReady, ready ? "true" : "false")
    }
  }

  public func putDerived(_ name: String, value: JSONValue, cursor: Int, day: String) async throws {
    let text = try MirrorJSON.text(value)
    try await pool.write { db in
      try db.execute(sql: """
        insert into derived(name, value, cursor, day) values(?, ?, ?, ?)
        on conflict(name) do update set value = excluded.value, cursor = excluded.cursor, day = excluded.day
        """, arguments: [name, text, cursor, day])
    }
  }

  /// Drops one cached derived read, which a refresh the cursor cannot see needs to invalidate what it feeds.
  public func deleteDerived(_ name: String) async throws {
    try await pool.write { db in try db.execute(sql: "delete from derived where name = ?", arguments: [name]) }
  }

  // MARK: Reads

  /// A stored row's JSON, parsed straight from SQLite's buffer.
  private static func json(_ stored: GRDB.Row, _ index: Int) throws -> Row {
    try stored.withUnsafeData(atIndex: index) { try MirrorJSON.parseObject($0 ?? Data()) }
  }

  /// Column names a filter may push into SQL. Anything else is filtered after decoding.
  private static func pushable(_ column: String) -> Bool {
    !column.isEmpty && column.utf8.allSatisfy { ($0 >= 0x61 && $0 <= 0x7A) || ($0 >= 0x30 && $0 <= 0x39) || $0 == 0x5F }
  }

  /// One filter as SQL over the stored JSON, matching strict JSON equality, or nil when it must run in Swift.
  private static func condition(_ filter: RowFilter) -> (sql: String, arguments: StatementArguments)? {
    guard pushable(filter.column) else { return nil }
    let path = "'$.\(filter.column)'"
    switch filter.value {
    case .string(let text): return ("json_type(data, \(path)) = 'text' and json_extract(data, \(path)) = ?", [text])
    case .bool(let flag): return ("json_type(data, \(path)) = '\(flag ? "true" : "false")'", [])
    case .null: return ("json_type(data, \(path)) = 'null'", [])
    case .number(let number): return ("json_type(data, \(path)) in ('integer', 'real') and json_extract(data, \(path)) = ?", [number])
    case .array, .object: return nil
    }
  }

  /// The rows of one table that pass every equality filter, unordered. Equality on stored JSON runs inside SQLite,
  /// so only matching rows are decoded.
  public func rows(_ table: String, filters: [RowFilter] = []) async throws -> [Row] {
    var sql = "select data from rows where table_name = ?"
    var arguments: StatementArguments = [table]
    var remaining: [RowFilter] = []
    for filter in filters {
      if let condition = Self.condition(filter) {
        sql += " and " + condition.sql
        arguments += condition.arguments
      } else {
        remaining.append(filter)
      }
    }
    let statementArguments = arguments
    let finalSQL = sql
    let leftover = remaining
    return try await pool.read { db in
      var rows: [Row] = []
      let found = try GRDB.Row.fetchCursor(db, sql: finalSQL, arguments: statementArguments)
      while let stored = try found.next() {
        let row = try Self.json(stored, 0)
        if leftover.allSatisfy({ MirrorRows.matches(row, $0) }) { rows.append(row) }
      }
      return rows
    }
  }

  /// Every stored row of one table with its key and revision, ordered by key.
  public func mirrorRows(_ table: String) async throws -> [MirrorRow] {
    try await pool.read { db in
      var rows: [MirrorRow] = []
      let found = try GRDB.Row.fetchCursor(db, sql: "select key, data, revision from rows where table_name = ? order by key", arguments: [table])
      while let stored = try found.next() {
        rows.append(MirrorRow(key: stored[0], data: try Self.json(stored, 1), revision: stored[2]))
      }
      return rows
    }
  }

  /// One stored row, or nil when the table does not hold that key.
  public func row(_ table: String, key: String) async throws -> MirrorRow? {
    try await pool.read { db in
      guard let stored = try GRDB.Row.fetchOne(db, sql: "select data, revision from rows where table_name = ? and key = ?", arguments: [table, key]) else { return nil }
      return MirrorRow(key: key, data: try Self.json(stored, 0), revision: stored[1])
    }
  }

  /// The key and revision of every stored row of a table, without the JSON a revision check never reads.
  public func revisions(_ table: String) async throws -> [String: Int?] {
    try await pool.read { db in
      var revisions: [String: Int?] = [:]
      let found = try GRDB.Row.fetchCursor(db, sql: "select key, revision from rows where table_name = ?", arguments: [table])
      while let stored = try found.next() { revisions[stored[0] as String] = .some(stored[1] as Int?) }
      return revisions
    }
  }

  public func derived(_ name: String) async throws -> MirrorDerived? {
    try await pool.read { db in
      guard let stored = try GRDB.Row.fetchOne(db, sql: "select value, cursor, day from derived where name = ?", arguments: [name]) else { return nil }
      return MirrorDerived(value: try stored.withUnsafeData(atIndex: 0) { try MirrorJSON.parse($0 ?? Data()) }, cursor: stored[1], day: stored[2])
    }
  }

  // MARK: Lifetime

  /// Closes the file. Later calls fail, which ends any pass still holding the store.
  public func close() {
    try? pool.close()
  }

  /// Closes the file and deletes it with its write-ahead companions, which is what signing out leaves behind.
  public func wipe() throws {
    close()
    try MirrorFiles.remove(url)
  }
}

/// The mirror's place on disk: one file per account under Application Support.
public enum MirrorFiles {
  private static let companions = ["", "-wal", "-shm"]

  /// `~/Library/Application Support/<bundle id>/mirror`. An unbundled development run uses an identifier named
  /// for its environment so it never touches an installed app's copy.
  public static func directory(bundleIdentifier: String?, environment: AppConfig.Environment) throws -> URL {
    let support = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
    let identifier = bundleIdentifier ?? "app.manor.desktop.\(environment.rawValue)"
    return support.appendingPathComponent(identifier, isDirectory: true).appendingPathComponent("mirror", isDirectory: true)
  }

  /// Accepts the canonical lowercase UUID an account id is, and nothing else, because the value names a file.
  public static func isAccountId(_ accountId: String) -> Bool {
    let groups = accountId.split(separator: "-", omittingEmptySubsequences: false)
    let lengths = [8, 4, 4, 4, 12]
    return groups.count == lengths.count && zip(groups, lengths).allSatisfy { group, length in
      group.count == length && group.utf8.allSatisfy { ($0 >= 0x30 && $0 <= 0x39) || ($0 >= 0x61 && $0 <= 0x66) }
    }
  }

  public static func file(in directory: URL, accountId: String) throws -> URL {
    guard isAccountId(accountId) else { throw MirrorError("`\(accountId)` is not an account id; the mirror takes the signed-in account's UUID") }
    return directory.appendingPathComponent("\(accountId).sqlite")
  }

  /// Whether a file in the mirror directory holds another account's copy, counting the WAL companions.
  public static func belongsToAnotherAccount(_ name: String, accountId: String) -> Bool {
    var stem = name
    for suffix in ["-wal", "-shm"] where stem.hasSuffix(suffix) {
      stem.removeLast(suffix.count)
      break
    }
    guard stem.hasSuffix(".sqlite") else { return false }
    return String(stem.dropLast(".sqlite".count)) != accountId
  }

  /// Deletes the copies of every other account. Signing out removes them, so one still here outlived a crash
  /// or a failed delete, and it holds the rows of an account nobody on this Mac is signed into.
  public static func sweep(_ directory: URL, keeping accountId: String) {
    let names = (try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? []
    for name in names where belongsToAnotherAccount(name, accountId: accountId) {
      try? FileManager.default.removeItem(at: directory.appendingPathComponent(name))
    }
  }

  /// Deletes a mirror file and its companions, treating one already gone as done.
  public static func remove(_ url: URL) throws {
    for suffix in companions {
      let path = url.path + suffix
      do { try FileManager.default.removeItem(atPath: path) }
      catch CocoaError.fileNoSuchFile {}
      catch let error as NSError where error.domain == NSCocoaErrorDomain && error.code == NSFileNoSuchFileError {}
    }
  }
}
