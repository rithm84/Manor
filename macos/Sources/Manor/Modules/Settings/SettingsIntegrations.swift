import Foundation
import ManorKit
import Supabase

/// The Edge Function calls behind Settings: Google Calendar and X connections (`integrations`) and the course
/// calendar feed (`course-feed`). Account rows they commit reach the mirror before callers read again.
@MainActor
struct SettingsIntegrations {
  let gateway: Gateway

  /// PKCE verifiers for connections waiting on the browser, keyed by their state. They live only in memory:
  /// the code that comes back is useless without them, and a connection never outlives the app session.
  private static var verifiers: [String: String] = [:]

  // MARK: Transport

  /// Invokes a function with `action` and its input, unwrapping the `{ error }` envelope into a readable error.
  /// Requests carry no Origin header, like any native client; the functions treat that as the desktop app and
  /// answer a connection that started here with a `<scheme>://settings?…` link instead of a web address.
  @discardableResult
  func request(_ function: String, _ action: String, _ input: ManorKit.JSONObject = [:]) async throws -> JSONValue {
    var body = input
    body["action"] = .string(action)
    let options = FunctionInvokeOptions(method: .post, body: body)
    do {
      let data: Data = try await gateway.client.functions.invoke(function, options: options) { data, _ in data }
      gateway.markConnected(true)
      return data.isEmpty ? .null : ((try? ManorJSON.plainDecoder.decode(JSONValue.self, from: data)) ?? .null)
    } catch FunctionsError.httpError(let code, let data) {
      gateway.markConnected(true)
      let answer = try? ManorJSON.plainDecoder.decode(JSONValue.self, from: data)
      let message = answer?["error"]?.string ?? answer?["message"]?.string ?? String(decoding: data, as: UTF8.self)
      throw ManorRequestError(operation: action, code: String(code), detail: message.isEmpty ? "The request failed (\(code))." : message)
    } catch let error as URLError {
      gateway.markConnected(false)
      throw ManorConnectionError(operation: action, detail: error.localizedDescription)
    }
  }

  /// A request that commits account rows: the mirror pulls them before the caller reads again.
  @discardableResult
  func write(_ function: String, _ action: String, _ input: ManorKit.JSONObject = [:], tables: Set<String>) async throws -> JSONValue {
    let result = try await request(function, action, input)
    await gateway.afterServerWrite(tables: tables)
    return result
  }

  // MARK: OAuth connections

  /// Starts a Google or X connection: the provider's page opens in the browser and returns to Settings.
  func connect(provider: String) async throws -> URL {
    let pkce = SettingsDomain.PKCE.random()
    let result = try await request("integrations", "oauth_start", ["provider": .string(provider), "codeChallenge": .string(pkce.challenge)])
    guard let address = result["url"]?.string, let url = URL(string: address), let state = result["state"]?.string else {
      throw SettingsDomain.SettingsError.unexpected("connection")
    }
    Self.verifiers[state] = pkce.verifier
    return url
  }

  func completeConnection(code: String, state: String) async throws {
    guard let verifier = Self.verifiers[state] else {
      throw ManorRequestError(operation: "oauth_complete", code: "state", detail: "This connection was started before Manor last opened. Connect again from Settings.")
    }
    try await write("integrations", "oauth_complete", ["code": .string(code), "state": .string(state), "verifier": .string(verifier)], tables: Self.calendarTables)
    Self.verifiers[state] = nil
  }

  static let calendarTables: Set<String> = ["calendar_accounts", "calendars", "calendar_events"]

  // MARK: Google Calendar

  func setCalendar(_ calendarId: String, account accountId: String, enabled: Bool) async throws {
    try await write("integrations", "calendar_visibility", ["calendarId": .string(calendarId), "accountId": .string(accountId), "enabled": .bool(enabled)], tables: Self.calendarTables)
  }

  func disconnectCalendar(account accountId: String) async throws {
    try await write("integrations", "calendar_disconnect", ["accountId": .string(accountId)], tables: Self.calendarTables)
  }

  // MARK: X bookmarks

  func xStatus() async throws -> SettingsDomain.XConnectionStatus {
    try SettingsDomain.xStatus(from: try await gateway.rpc("manor_x_status"))
  }

  func disconnectX() async throws {
    try await write("integrations", "x_disconnect", tables: ["kb_entries"])
  }

  /// Runs one bookmark sync now and reports how many posts arrived.
  func syncX() async throws -> Int {
    let result = try await write("integrations", "x_sync", tables: ["kb_entries"])
    return result["added"]?.int ?? 0
  }

  // MARK: Course calendar feed

  func courseFeedStatus() async throws -> SettingsDomain.CourseFeedStatus {
    try SettingsDomain.courseFeedStatus(from: try await gateway.rpc("manor_course_feed_status"))
  }

  func connectCourseFeed(_ url: String) async throws -> (host: String, count: Int) {
    let result = try await write("course-feed", "connect", ["url": .string(url)], tables: [])
    return (result["host"]?.string ?? "your course calendar", result["count"]?.int ?? 0)
  }

  func disconnectCourseFeed() async throws {
    try await write("course-feed", "disconnect", tables: [])
  }

  func checkCourseFeed() async throws -> (from: String, to: String, total: Int) {
    let result = try await request("course-feed", "events")
    return (result["from"]?.string ?? "", result["to"]?.string ?? "", result["total"]?.int ?? 0)
  }
}
