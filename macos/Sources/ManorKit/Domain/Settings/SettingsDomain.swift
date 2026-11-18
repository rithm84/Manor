import CryptoKit
import Foundation

/// Account, connection, and agent-access rules behind the Settings page and the agent consent dialog.
public enum SettingsDomain {
  /// At most twelve calendars across every connected Google account, counting hidden ones.
  public static let calendarLimit = 12

  // MARK: Agent connections

  /// An MCP client this account authorized, as `manor_list_mcp_clients` returns it.
  public struct AgentConnection: Hashable, Sendable, Identifiable {
    public let clientId: String
    public let canWrite: Bool
    public let authorizedAt: Date
    public var id: String { clientId }

    public init(clientId: String, canWrite: Bool, authorizedAt: Date) {
      self.clientId = clientId
      self.canWrite = canWrite
      self.authorizedAt = authorizedAt
    }
  }

  public static func agentConnections(from value: JSONValue) throws -> [AgentConnection] {
    guard let items = value.array else { throw SettingsError.unexpected("agent connections") }
    return try items.map { item in
      guard let clientId = item["client_id"]?.string, UUID(uuidString: clientId) != nil,
            let canWrite = item["can_write"]?.bool,
            let authorized = item["authorized_at"]?.string.flatMap(SettingsDomain.parseTimestamp) else {
        throw SettingsError.unexpected("agent connection")
      }
      return AgentConnection(clientId: clientId.lowercased(), canWrite: canWrite, authorizedAt: authorized)
    }
    .sorted { $0.authorizedAt > $1.authorizedAt }
  }

  /// Authorization ids reach Manor through a deep link. Supabase mints an opaque URL-safe token, so only its
  /// shape is checked here and Supabase decides whether it exists.
  public static func validAuthorizationId(_ value: String) -> String? {
    value.range(of: #"^[A-Za-z0-9._-]{8,200}$"#, options: .regularExpression) != nil ? value : nil
  }

  /// What the consent dialog tells you once the agent has its answer.
  public static func agentReturnMessage(clientName: String?) -> String {
    guard let clientName, !clientName.isEmpty else { return "Go back to the app that asked for access. It finishes connecting on its own." }
    return "Go back to \(clientName). It finishes connecting on its own."
  }

  // MARK: Google Calendar

  public struct CalendarAccount: Hashable, Sendable, Identifiable {
    public let id: String
    public let email: String
    public let connectedAt: String
    public init(id: String, email: String, connectedAt: String) {
      self.id = id
      self.email = email
      self.connectedAt = connectedAt
    }
  }

  public struct Calendar: Hashable, Sendable, Identifiable {
    public let id: String
    public let accountId: String
    public let name: String
    public let color: String?
    public var enabled: Bool
    public init(id: String, accountId: String, name: String, color: String?, enabled: Bool) {
      self.id = id
      self.accountId = accountId
      self.name = name
      self.color = color
      self.enabled = enabled
    }
  }

  public static func calendarAccounts(from rows: [Row]) -> [CalendarAccount] {
    rows.compactMap { row in
      guard let id = row["id"]?.string, let email = row["email"]?.string else { return nil }
      return CalendarAccount(id: id, email: email, connectedAt: row["connected_at"]?.string ?? "")
    }
    .sorted { ($0.connectedAt, $0.email) < ($1.connectedAt, $1.email) }
  }

  public static func calendars(from rows: [Row]) -> [Calendar] {
    rows.compactMap { row in
      guard let id = row["id"]?.string, let accountId = row["account_id"]?.string else { return nil }
      return Calendar(id: id, accountId: accountId, name: row["name"]?.string ?? id, color: row["color"]?.string, enabled: row["enabled"]?.bool ?? false)
    }
  }

  /// "5 of 12 calendars" for the Google Calendar row, counting hidden calendars like the limit does.
  public static func calendarUsage(_ count: Int) -> String {
    "\(count) of \(calendarLimit) \(calendarLimit == 1 ? "calendar" : "calendars")"
  }

  // MARK: X bookmarks

  public struct XConnectionStatus: Hashable, Sendable {
    public let connected: Bool
    public let username: String?
    public let connectedAt: String?
    public init(connected: Bool, username: String?, connectedAt: String?) {
      self.connected = connected
      self.username = username
      self.connectedAt = connectedAt
    }
  }

  public static func xStatus(from value: JSONValue) throws -> XConnectionStatus {
    guard let connected = value["connected"]?.bool else { throw SettingsError.unexpected("X connection") }
    return XConnectionStatus(connected: connected, username: value["username"]?.string, connectedAt: value["connectedAt"]?.string)
  }

  public static func syncSummary(added: Int) -> String {
    added == 0 ? "You are up to date." : "\(added) new \(added == 1 ? "bookmark" : "bookmarks")."
  }

  // MARK: Course calendar feed

  public struct CourseFeedStatus: Hashable, Sendable {
    public let connected: Bool
    public let host: String?
    public let lastCheckedAt: Date?
    public let lastItemCount: Int?
    public let lastError: String?
    public init(connected: Bool, host: String?, lastCheckedAt: Date?, lastItemCount: Int?, lastError: String?) {
      self.connected = connected
      self.host = host
      self.lastCheckedAt = lastCheckedAt
      self.lastItemCount = lastItemCount
      self.lastError = lastError
    }
  }

  public static func courseFeedStatus(from value: JSONValue) throws -> CourseFeedStatus {
    guard let connected = value["connected"]?.bool else { throw SettingsError.unexpected("course calendar") }
    return CourseFeedStatus(
      connected: connected, host: value["host"]?.string,
      lastCheckedAt: value["lastCheckedAt"]?.string.flatMap(SettingsDomain.parseTimestamp),
      lastItemCount: value["lastItemCount"]?.int, lastError: value["lastError"]?.string
    )
  }

  /// One sentence describing a connected feed: its host, the last check's count and time, or its failure.
  public static func courseFeedSummary(_ status: CourseFeedStatus, timeZone: TimeZone) -> String {
    let host = status.host ?? "your course calendar"
    if let error = status.lastError { return "Connected to \(host). The last check failed: \(error)" }
    var text = "Connected to \(host)."
    if let count = status.lastItemCount { text += " The last check found \(count) \(count == 1 ? "item" : "items")." }
    if let checked = status.lastCheckedAt {
      let formatter = DateFormatter()
      formatter.locale = Locale(identifier: "en_US")
      formatter.timeZone = timeZone
      formatter.dateFormat = "MMM d, h:mm a"
      text += " Checked \(formatter.string(from: checked))."
    }
    return text
  }

  public static func courseFeedConnected(host: String, count: Int) -> String {
    "Course calendar connected to \(host). \(count) \(count == 1 ? "item is" : "items are") due in the next two weeks."
  }

  public static func courseFeedChecked(total: Int, from: String, to: String) -> String {
    "\(total) \(total == 1 ? "item is" : "items are") due between \(from) and \(to)."
  }

  /// A pasted feed link that is worth sending: an http or https URL with a host.
  public static func validFeedLink(_ value: String) -> String? {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let url = URL(string: trimmed), let scheme = url.scheme?.lowercased(), ["https", "http", "webcal"].contains(scheme), url.host() != nil else { return nil }
    return trimmed
  }

  // MARK: Connection callbacks

  /// What came back on `<scheme>://settings?…` after a provider's authorization page.
  public enum ConnectionCallback: Equatable, Sendable {
    case code(provider: String, code: String, state: String)
    case failure(String)
  }

  public static func connectionCallback(from query: [String: String]) -> ConnectionCallback? {
    if let failure = query["connection_error"], !failure.isEmpty { return .failure(readableConnectionError(failure)) }
    guard let code = query["connection_code"], !code.isEmpty, let state = query["connection_state"], !state.isEmpty else { return nil }
    return .code(provider: query["connection_provider"] == "x" ? "x" : "google", code: code, state: state)
  }

  /// Providers answer a refusal with an OAuth error code; the expired-request message is already a sentence.
  static func readableConnectionError(_ value: String) -> String {
    switch value {
    case "access_denied": return "The connection was cancelled."
    default: return value.contains(" ") ? value : "The connection did not finish (\(value)). Try connecting again."
    }
  }

  // MARK: PKCE

  /// A PKCE verifier and its S256 challenge for an integration authorization.
  public struct PKCE: Sendable {
    public let verifier: String
    public let challenge: String

    public init(verifier: String) {
      self.verifier = verifier
      challenge = Self.base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
    }

    public static func random() -> PKCE {
      var bytes = [UInt8](repeating: 0, count: 32)
      for index in bytes.indices { bytes[index] = UInt8.random(in: 0...255) }
      return PKCE(verifier: base64URL(Data(bytes)))
    }

    static func base64URL(_ data: Data) -> String {
      data.base64EncodedString()
        .replacingOccurrences(of: "+", with: "-")
        .replacingOccurrences(of: "/", with: "_")
        .replacingOccurrences(of: "=", with: "")
    }
  }

  // MARK: Profile

  /// The `save_profile` input. Settings are replaced whole, so the saved settings travel with every change.
  public static func profileInput(name: String, timezone: String, settings: JSONValue?, revision: Int?) -> JSONObject {
    [
      "name": .string(name.trimmingCharacters(in: .whitespacesAndNewlines)),
      "timezone": .string(timezone),
      "settings": settings ?? .object([:]),
      "expected_revision": .number(Double(revision ?? 0))
    ]
  }

  /// Why a display name cannot be saved, or nil when it can.
  public static func nameProblem(_ name: String) -> String? {
    let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty { return "Enter a name." }
    if trimmed.count > 120 { return "Use 120 characters or fewer." }
    return nil
  }

  /// "Los Angeles (GMT-8)" for a time zone picker row.
  public static func timeZoneLabel(_ identifier: String, at date: Date = Date()) -> String {
    let city = identifier.split(separator: "/").last.map { $0.replacingOccurrences(of: "_", with: " ") } ?? identifier
    guard let zone = TimeZone(identifier: identifier) else { return city }
    let seconds = zone.secondsFromGMT(for: date)
    let hours = abs(seconds) / 3600, minutes = abs(seconds) % 3600 / 60
    let offset = seconds == 0 ? "GMT" : "GMT\(seconds < 0 ? "-" : "+")\(hours)\(minutes == 0 ? "" : String(format: ":%02d", minutes))"
    return "\(city) (\(offset))"
  }

  /// Whether two identifiers name the same clock, such as a legacy link (`US/Pacific`) and its canonical zone
  /// (`America/Los_Angeles`): the same offset now and at each of the next four transitions.
  public static func sameTimeZone(_ a: String, _ b: String, from date: Date = Date()) -> Bool {
    if a == b { return true }
    guard let first = TimeZone(identifier: a), let second = TimeZone(identifier: b) else { return false }
    var moment = date
    for _ in 0..<5 {
      guard first.secondsFromGMT(for: moment) == second.secondsFromGMT(for: moment) else { return false }
      let next = first.nextDaylightSavingTimeTransition(after: moment)
      guard next == second.nextDaylightSavingTimeTransition(after: moment) else { return false }
      guard let next else { return true }
      moment = next
    }
    return true
  }

  /// Time zones offered in the picker: every IANA region zone, plus the saved one if it is unusual.
  public static func timeZoneChoices(including saved: String) -> [String] {
    let regions = ["Africa", "America", "Antarctica", "Asia", "Atlantic", "Australia", "Europe", "Indian", "Pacific"]
    var zones = TimeZone.knownTimeZoneIdentifiers.filter { id in regions.contains { id.hasPrefix($0 + "/") } }
    zones.append("UTC")
    if !zones.contains(saved) { zones.append(saved) }
    return zones.sorted()
  }

  public enum SettingsError: LocalizedError {
    case unexpected(String)
    public var errorDescription: String? {
      switch self {
      case .unexpected(let what): return "Manor received an unexpected \(what) answer. Try again."
      }
    }
  }
}

/// Postgres `timestamptz` values as PostgREST and the Edge Functions send them, with or without fractional
/// seconds and with any offset.
extension SettingsDomain {
  public static func parseTimestamp(_ value: String) -> Date? {
    var text = value.trimmingCharacters(in: .whitespaces)
    if text.count > 10, text[text.index(text.startIndex, offsetBy: 10)] == " " {
      text.replaceSubrange(text.index(text.startIndex, offsetBy: 10)...text.index(text.startIndex, offsetBy: 10), with: "T")
    }
    // Normalize fractional seconds to milliseconds, which every formatter accepts.
    if let dot = text.firstIndex(of: "."), text.distance(from: text.startIndex, to: dot) >= 19 {
      var end = text.index(after: dot)
      while end < text.endIndex, text[end].isNumber { end = text.index(after: end) }
      let digits = text[text.index(after: dot)..<end]
      let millis = String((digits + "000").prefix(3))
      text.replaceSubrange(dot..<end, with: "." + millis)
    }
    // "+00" offsets become "+00:00".
    if let match = text.range(of: #"[+-]\d{2}$"#, options: .regularExpression) { text.replaceSubrange(match, with: text[match] + ":00") }
    if !text.contains("T") { text += "T00:00:00Z" }
    if text.range(of: #"(Z|[+-]\d{2}:?\d{2})$"#, options: .regularExpression) == nil { text += "Z" }
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = fractional.date(from: text) { return date }
    let plain = ISO8601DateFormatter()
    plain.formatOptions = [.withInternetDateTime]
    return plain.date(from: text)
  }
}
