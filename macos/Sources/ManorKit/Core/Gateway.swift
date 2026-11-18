import Foundation
import Observation
import Supabase

/// The receipt `manor_command` returns. `record` and `records` are the committed rows.
public struct CommandReceipt: Sendable {
  public let commandId: UUID
  public let operation: String
  public let replayed: Bool
  public let record: Row?
  public let records: [Row]
  public let raw: JSONValue
}

/// Account-bound transport: reads (from the local mirror once it serves, otherwise the server), commands
/// through `manor_command`, RPCs, and Edge Functions. Modules subscribe to `changes(of:)` to reload when
/// a table they show changes, whether from their own command, a mirror pull, or another device.
@MainActor
@Observable
public final class Gateway {
  public let client: SupabaseClient
  public let accountId: String
  public let config: AppConfig
  /// False after a request never got an answer; true again after the next one that did.
  public private(set) var isConnected = true

  @ObservationIgnored private var mirror: LocalMirror?
  @ObservationIgnored private var subscribers: [UUID: (tables: Set<String>?, continuation: AsyncStream<Set<String>>.Continuation)] = [:]
  @ObservationIgnored private var issued: [UUID] = []

  public init(client: SupabaseClient, accountId: String, config: AppConfig) {
    self.client = client
    self.accountId = accountId
    self.config = config
  }

  // MARK: Mirror

  public func attachMirror(_ mirror: LocalMirror?) { self.mirror = mirror }

  public func stopMirror() async {
    await mirror?.stop()
    mirror = nil
  }

  public var localMirror: LocalMirror? { mirror }

  // MARK: Change notifications

  /// A stream that yields the changed table names whenever any of `tables` changes; nil subscribes to everything.
  public func changes(of tables: Set<String>? = nil) -> AsyncStream<Set<String>> {
    let id = UUID()
    let (stream, continuation) = AsyncStream<Set<String>>.makeStream(bufferingPolicy: .bufferingNewest(1))
    subscribers[id] = (tables, continuation)
    continuation.onTermination = { [weak self] _ in
      Task { @MainActor in self?.subscribers[id] = nil }
    }
    return stream
  }

  /// Tells subscribers these tables changed. The mirror calls it after a pull; commands call it after commit.
  public func publish(_ tables: Set<String>) {
    guard !tables.isEmpty else { return }
    for subscriber in subscribers.values {
      if let wanted = subscriber.tables {
        let hit = wanted.intersection(tables)
        if !hit.isEmpty { subscriber.continuation.yield(hit) }
      } else {
        subscriber.continuation.yield(tables)
      }
    }
  }

  /// Whether this device issued a command; its realtime echo carries nothing new.
  public func issuedCommand(_ id: UUID) -> Bool { issued.contains(id) }

  // MARK: Reads

  public func rows(_ table: String, where filters: [RowFilter] = []) async throws -> [Row] {
    if let mirror, let rows = try await mirror.rows(table, filters: filters) { return rows }
    return try await rowsFromServer(table, where: filters)
  }

  /// Rows decoded into a domain type (snake_case columns map to camelCase properties).
  public func rows<T: Decodable>(_ table: String, as type: T.Type, where filters: [RowFilter] = []) async throws -> [T] {
    try ManorJSON.decodeRows(T.self, from: try await rows(table, where: filters))
  }

  /// One row by its mirror key, falling back to a filtered server read.
  public func row(_ table: String, key: String, serverFilters: [RowFilter]) async throws -> Row? {
    if let mirror, case .row(let row) = try await mirror.row(table, key: key) { return row }
    return try await rowsFromServer(table, where: serverFilters).first
  }

  /// The read straight from Postgres, paginated and owner-scoped except for the shared tables.
  public func rowsFromServer(_ table: String, where filters: [RowFilter] = [], columns: String? = nil) async throws -> [Row] {
    var all: [Row] = []
    var offset = 0
    while offset < 100_000 {
      var query = client.from(table).select(columns ?? ManorTables.readColumns(table))
      if !ManorTables.isShared(table) { query = query.eq("user_id", value: accountId) }
      for filter in filters { query = query.eq(filter.column, value: Self.filterValue(filter.value)) }
      var ordered = query.order((ManorTables.order[table] ?? ["id"])[0], ascending: true)
      for column in (ManorTables.order[table] ?? ["id"]).dropFirst() { ordered = ordered.order(column, ascending: true) }
      let data = try await perform("Read \(table)") { try await ordered.range(from: offset, to: offset + 999).execute().data }
      let page = try ManorJSON.rows(from: data)
      all += page
      if page.count < 1000 { return all }
      offset += 1000
    }
    throw ManorRequestError(operation: "Read \(table)", code: "range", detail: "Use a filtered query for more than 100,000 records.")
  }

  // MARK: Commands

  /// Runs a named domain operation. A retry with the same command id replays the original receipt.
  @discardableResult
  public func command(_ operation: String, _ input: JSONObject, id: UUID = UUID()) async throws -> CommandReceipt {
    issued.append(id)
    if issued.count > 500 { issued.removeFirst(issued.count - 500) }
    let params: JSONObject = ["p_command_id": .string(id.uuidString.lowercased()), "p_operation": .string(operation), "p_input": .object(input)]
    var attempt = 0
    while true {
      do {
        let data = try await perform(operation) { try await self.client.rpc("manor_command", params: params).execute().data }
        let raw = try ManorJSON.plainDecoder.decode(JSONValue.self, from: data)
        guard let commandId = raw["command_id"]?.string, UUID(uuidString: commandId) == id, raw["operation"]?.string == operation else {
          throw ManorRequestError(operation: operation, code: "receipt", detail: "Command receipt does not match the request.")
        }
        let receipt = CommandReceipt(
          commandId: id, operation: operation, replayed: raw["replayed"]?.bool ?? false,
          record: raw["record"]?.object, records: raw["records"]?.array?.compactMap(\.object) ?? [], raw: raw
        )
        if let mirror { await mirror.afterCommand() }
        publish(ManorTables.affected(by: operation) ?? Set(ManorTables.all))
        return receipt
      } catch let error as ManorRequestError where attempt < 2 && error.code == "40001" {
        attempt += 1
      } catch let error as ManorConnectionError where attempt < 2 {
        _ = error
        attempt += 1
      }
      try await Task.sleep(for: .milliseconds(250 * (1 << attempt)))
    }
  }

  /// Calls a Postgres function and returns its JSON result.
  @discardableResult
  public func rpc(_ name: String, _ params: JSONObject = [:]) async throws -> JSONValue {
    let data = try await perform(name) {
      params.isEmpty ? try await self.client.rpc(name).execute().data : try await self.client.rpc(name, params: params).execute().data
    }
    return data.isEmpty ? .null : try ManorJSON.plainDecoder.decode(JSONValue.self, from: data)
  }

  /// An account-derived RPC, served from the mirror's cursor-keyed cache when a mirror is attached.
  public func derived(_ name: String, day: String, _ params: JSONObject = [:]) async throws -> JSONValue {
    guard let mirror else { return try await rpc(name, params) }
    return try await mirror.derived(name, day: day) { [weak self] in
      guard let self else { return .null }
      return try await self.rpc(name, params)
    }
  }

  /// Invokes an Edge Function with a JSON body and returns its JSON answer.
  @discardableResult
  public func function(_ name: String, _ body: JSONObject = [:], method: FunctionInvokeOptions.Method = .post) async throws -> JSONValue {
    do {
      let data: Data = try await client.functions.invoke(name, options: FunctionInvokeOptions(method: method, body: body)) { data, _ in data }
      markConnected(true)
      return data.isEmpty ? .null : ((try? ManorJSON.plainDecoder.decode(JSONValue.self, from: data)) ?? .string(String(decoding: data, as: UTF8.self)))
    } catch FunctionsError.httpError(let code, let data) {
      markConnected(true)
      let body = try? ManorJSON.plainDecoder.decode(JSONValue.self, from: data)
      let message = body?["error"]?.string ?? body?["message"]?.string ?? String(decoding: data, as: UTF8.self)
      throw ManorRequestError(operation: name, code: String(code), detail: message.isEmpty ? "The request failed (\(code))." : message)
    } catch let error as URLError {
      markConnected(false)
      throw ManorConnectionError(operation: name, detail: error.localizedDescription)
    }
  }

  /// A refresh after a write that committed outside `command`, such as an upload finalizing.
  public func afterServerWrite(tables: Set<String>? = nil) async {
    if let mirror { await mirror.afterCommand() }
    publish(tables ?? Set(ManorTables.all))
  }

  // MARK: Transport

  public func markConnected(_ connected: Bool) {
    if isConnected != connected { isConnected = connected }
  }

  /// Runs one request and translates its failure into a Manor error.
  public func perform<T>(_ operation: String, _ body: () async throws -> T) async throws -> T {
    do {
      let value = try await body()
      markConnected(true)
      return value
    } catch let error as PostgrestError {
      markConnected(true)
      throw ManorRequestError(operation: operation, code: error.code ?? "unknown", detail: error.message)
    } catch let error as HTTPError {
      markConnected(true)
      let body = try? ManorJSON.plainDecoder.decode(JSONValue.self, from: error.data)
      let code = body?["code"]?.string ?? String(error.response.statusCode)
      throw ManorRequestError(operation: operation, code: code, detail: body?["message"]?.string ?? error.localizedDescription)
    } catch let error as URLError where error.code != .cancelled {
      markConnected(false)
      throw ManorConnectionError(operation: operation, detail: error.localizedDescription)
    }
  }

  private static func filterValue(_ value: JSONValue) -> String {
    switch value {
    case .string(let value): return value
    case .bool(let value): return value ? "true" : "false"
    case .number(let value): return value.rounded() == value ? String(Int64(value)) : String(value)
    case .null: return "null"
    default: return String(decoding: (try? ManorJSON.plainEncoder.encode(value)) ?? Data(), as: UTF8.self)
    }
  }
}
