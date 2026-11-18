import Foundation
import Supabase

/// The two functions that expose one change feed. Both feeds return the same columns.
public struct FeedFunctions: Sendable, Equatable {
  public let cursor: String
  public let changes: String
  /// The account's own feed, covering every owner-scoped table.
  public static let workspace = FeedFunctions(cursor: "manor_workspace_cursor", changes: "manor_workspace_changes")
  /// The shared problem catalog's feed, the same for every account.
  public static let catalog = FeedFunctions(cursor: "manor_catalog_cursor", changes: "manor_catalog_changes")
}

/// Everything the mirror asks of the server. `SupabaseRemote` is the real one; tests substitute their own.
public protocol MirrorRemote: Sendable {
  /// The feed's head cursor, 0 before its first change.
  func feedCursor(_ feed: FeedFunctions) async throws -> Int
  func feedChanges(_ feed: FeedFunctions, since: Int, limit: Int) async throws -> [FeedChange]
  /// A whole table, owner-scoped except for the shared tables, with the given equality filters.
  func readTable(_ table: String, filters: [RowFilter]) async throws -> [Row]
  /// The rows these changes name, as they are now. A row that was deleted or is hidden does not come back.
  func readIdentities(_ table: String, lookups: [KeyedChange]) async throws -> [Row]
  /// A Storage object, or nil when it does not exist.
  func download(bucket: String, path: String) async throws -> Data?
}

/// The most rows one feed request asks for. The RPC clamps its own limit to 1000.
let feedPageSize = 1000

/// The mirror's requests, made off the main actor so decoding tens of megabytes never stalls a page. A
/// request that gets no answer marks the gateway disconnected, and one that does marks it connected again,
/// because the mirror now does most of the app's talking to the server.
struct SupabaseRemote: MirrorRemote {
  let client: SupabaseClient
  let accountId: String
  let connection: @Sendable (Bool) async -> Void

  private func perform<T: Sendable>(_ operation: String, _ body: () async throws -> T) async throws -> T {
    do {
      let value = try await body()
      await connection(true)
      return value
    } catch let error as PostgrestError {
      await connection(true)
      throw ManorRequestError(operation: operation, code: error.code ?? "unknown", detail: error.message)
    } catch let error as StorageError {
      await connection(true)
      throw ManorRequestError(operation: operation, code: error.statusCode ?? "unknown", detail: error.message)
    } catch let error as HTTPError {
      await connection(true)
      let body = try? MirrorJSON.parse(error.data)
      let code = body?["code"]?.string ?? body?["statusCode"]?.string ?? String(error.response.statusCode)
      throw ManorRequestError(operation: operation, code: code, detail: body?["message"]?.string ?? error.localizedDescription)
    } catch let error as URLError where error.code != .cancelled {
      await connection(false)
      throw ManorConnectionError(operation: operation, detail: error.localizedDescription)
    }
  }

  /// PostgREST renders a bigint as a JSON number, and as a string once it leaves the safe integer range.
  static func cursor(_ value: JSONValue?, nullable: Bool = false) throws -> Int? {
    switch value {
    case .number(let number)? where number.rounded() == number && number >= 0: return Int(number)
    case .string(let text)? where !text.isEmpty && text.allSatisfy(\.isASCII) && text.allSatisfy(\.isNumber):
      guard let value = Int(text) else { throw MirrorError("The change feed returned a cursor past what Manor can count: \(text)") }
      return value
    case .null? where nullable, nil where nullable: return nil
    default: throw MirrorError("The change feed returned \(String(describing: value)) where it promises a cursor")
    }
  }

  static func changes(from value: JSONValue) throws -> [FeedChange] {
    guard case .array(let list) = value else { throw MirrorError("The change feed did not answer with a list") }
    return try list.map { item in
      guard let object = item.object, let objectType = item["object_type"]?.string, !objectType.isEmpty,
            case .object(let objectKey)? = object["object_key"],
            let kind = item["change"]?.string.flatMap(FeedChange.Kind.init(rawValue:)),
            let cursor = try cursor(object["cursor"]) else {
        throw MirrorError("The change feed returned a row that is not in the expected form")
      }
      return FeedChange(cursor: cursor, objectType: objectType, objectKey: objectKey, change: kind, revision: try Self.cursor(object["revision"], nullable: true))
    }
  }

  func feedCursor(_ feed: FeedFunctions) async throws -> Int {
    let data = try await perform(feed.cursor) { try await client.rpc(feed.cursor).execute().data }
    guard let value = try Self.cursor(try MirrorJSON.parse(data)) else { throw MirrorError("The change feed has no head cursor") }
    return value
  }

  func feedChanges(_ feed: FeedFunctions, since: Int, limit: Int) async throws -> [FeedChange] {
    let params: JSONObject = ["p_since": .number(Double(since)), "p_limit": .number(Double(limit))]
    let data = try await perform(feed.changes) { try await client.rpc(feed.changes, params: params).execute().data }
    return try Self.changes(from: try MirrorJSON.parse(data))
  }

  private static func filterValue(_ value: JSONValue) -> String {
    switch value {
    case .string(let value): return value
    case .bool(let value): return value ? "true" : "false"
    case .number(let value): return MirrorTables.numberText(value)
    case .null: return "null"
    default: return (try? MirrorJSON.text(value)) ?? "null"
    }
  }

  func readTable(_ table: String, filters: [RowFilter]) async throws -> [Row] {
    let order = ManorTables.order[table] ?? ["id"]
    var all: [Row] = []
    var offset = 0
    while offset < 100_000 {
      var query = client.from(table).select(ManorTables.readColumns(table))
      if !ManorTables.isShared(table) { query = query.eq("user_id", value: accountId) }
      for filter in filters { query = query.eq(filter.column, value: Self.filterValue(filter.value)) }
      var ordered = query.order(order[0], ascending: true)
      for column in order.dropFirst() { ordered = ordered.order(column, ascending: true) }
      let page = ordered.range(from: offset, to: offset + 999)
      let data = try await perform("Read \(table)") { try await page.execute().data }
      let rows = try MirrorJSON.parseRows(data)
      all += rows
      if rows.count < 1000 { return all }
      offset += 1000
    }
    throw ManorRequestError(operation: "Read \(table)", code: "range", detail: "Use a filtered query for more than 100,000 records.")
  }

  func readIdentities(_ table: String, lookups: [KeyedChange]) async throws -> [Row] {
    var rows: [Row] = []
    for batch in try IdentityReads.batches(table, lookups) {
      var query = client.from(table).select(ManorTables.readColumns(table))
      if !ManorTables.isShared(table) { query = query.eq("user_id", value: accountId) }
      switch batch {
      case .in(let column, let values): query = query.in(column, values: values)
      case .or(let expression): query = query.or(expression)
      }
      let request = query
      let data = try await perform("Re-read \(table)") { try await request.execute().data }
      rows += try MirrorJSON.parseRows(data)
    }
    return rows
  }

  func download(bucket: String, path: String) async throws -> Data? {
    do {
      return try await perform("Download \(path)") { try await client.storage.from(bucket).download(path: path) }
    } catch let error as ManorRequestError where error.code == "404" || error.code == "400" && error.detail.localizedCaseInsensitiveContains("not found") {
      return nil
    }
  }
}
