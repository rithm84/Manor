import Foundation

// Pomodoro: sessions, timer preferences, the timer arithmetic, and monthly statistics. The server holds
// the clock: every session carries its start instant, paused time, and plan, so the countdown is derived
// on read and survives relaunches and other devices.

public enum PomodoroKind: String, CaseIterable, Codable, Sendable, Hashable {
  case focus
  case shortBreak = "short_break"
  case longBreak = "long_break"

  public var label: String {
    switch self {
    case .focus: return "Focus"
    case .shortBreak: return "Short break"
    case .longBreak: return "Long break"
    }
  }

}

public enum PomodoroStatus: String, CaseIterable, Codable, Sendable, Hashable {
  case running, paused, completed, abandoned
}

public struct PomodoroValidationError: LocalizedError, Equatable, Sendable {
  public let message: String
  public init(_ message: String) { self.message = message }
  public var errorDescription: String? { message }
}

public enum PomodoroLimits {
  public static let label = 120
  public static let minutes = 180
  public static let longBreakEvery = 12
}

/// A label as the server stores it: trimmed, empty becomes no label, and at most 120 characters.
public func parsePomodoroLabel(_ value: String?) throws -> String? {
  guard let value else { return nil }
  let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
  if trimmed.isEmpty { return nil }
  if trimmed.count > PomodoroLimits.label { throw PomodoroValidationError("label must be \(PomodoroLimits.label) characters or fewer") }
  return trimmed
}

public struct PomodoroSession: Equatable, Sendable, Identifiable {
  public var id: String
  public var kind: PomodoroKind
  public var status: PomodoroStatus
  public var label: String?
  public var plannedSeconds: Int
  public var startedAt: Date
  public var pausedAt: Date?
  public var pausedSeconds: Int
  public var endedAt: Date?
  public var focusedSeconds: Int?
  public var localDate: String
  public var revision: Int

  public init(id: String, kind: PomodoroKind, status: PomodoroStatus, label: String? = nil, plannedSeconds: Int, startedAt: Date, pausedAt: Date? = nil,
              pausedSeconds: Int = 0, endedAt: Date? = nil, focusedSeconds: Int? = nil, localDate: String, revision: Int) {
    self.id = id
    self.kind = kind
    self.status = status
    self.label = label
    self.plannedSeconds = plannedSeconds
    self.startedAt = startedAt
    self.pausedAt = pausedAt
    self.pausedSeconds = pausedSeconds
    self.endedAt = endedAt
    self.focusedSeconds = focusedSeconds
    self.localDate = localDate
    self.revision = revision
  }

  /// Parses a `pomodoro_sessions` row and checks the paused and finished invariants.
  public init(row: Row) throws {
    guard let id = row["id"]?.string, !id.isEmpty else { throw PomodoroValidationError("session.id must be a non-empty string") }
    guard let localDate = row["local_date"]?.string, Self.isISODate(localDate) else { throw PomodoroValidationError("session.localDate must use YYYY-MM-DD format") }
    guard let kind = row["kind"]?.string.flatMap(PomodoroKind.init(rawValue:)) else { throw PomodoroValidationError("session.kind must be focus, short_break, or long_break") }
    guard let status = row["status"]?.string.flatMap(PomodoroStatus.init(rawValue:)) else { throw PomodoroValidationError("session.status must be running, paused, completed, or abandoned") }
    guard let planned = row["planned_seconds"]?.int, planned >= 1 else { throw PomodoroValidationError("session.plannedSeconds must be an integer of at least 1") }
    guard let startedText = row["started_at"]?.string, let started = PomodoroTimestamp.parse(startedText) else { throw PomodoroValidationError("session.startedAt must be an ISO timestamp") }
    guard let pausedSeconds = row["paused_seconds"]?.int, pausedSeconds >= 0 else { throw PomodoroValidationError("session.pausedSeconds must be an integer of at least 0") }
    guard let revision = row["revision"]?.int, revision >= 1 else { throw PomodoroValidationError("session.revision must be an integer of at least 1") }
    let pausedAt = try Self.optionalTimestamp(row["paused_at"], label: "session.pausedAt")
    let endedAt = try Self.optionalTimestamp(row["ended_at"], label: "session.endedAt")
    var focused: Int? = nil
    if let value = row["focused_seconds"], !value.isNull {
      guard let seconds = value.int, seconds >= 0 else { throw PomodoroValidationError("session.focusedSeconds must be an integer of at least 0") }
      focused = seconds
    }
    let label = try parsePomodoroLabel(row["label"]?.string)
    self.init(id: id, kind: kind, status: status, label: label, plannedSeconds: planned, startedAt: started, pausedAt: pausedAt,
              pausedSeconds: pausedSeconds, endedAt: endedAt, focusedSeconds: focused, localDate: localDate, revision: revision)
    try validate()
  }

  public func validate() throws {
    if (status == .paused) != (pausedAt != nil) { throw PomodoroValidationError("a paused session carries pausedAt and no other status does") }
    if isFinished != (endedAt != nil && focusedSeconds != nil) { throw PomodoroValidationError("a finished session carries endedAt and focusedSeconds") }
  }

  public var isActive: Bool { status == .running || status == .paused }
  public var isFinished: Bool { status == .completed || status == .abandoned }

  static func isISODate(_ value: String) -> Bool {
    value.count == 10 && value.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil
  }

  private static func optionalTimestamp(_ value: JSONValue?, label: String) throws -> Date? {
    guard let value, !value.isNull else { return nil }
    guard let text = value.string, let date = PomodoroTimestamp.parse(text) else { throw PomodoroValidationError("\(label) must be an ISO timestamp") }
    return date
  }
}

/// Postgres timestamps (`2026-09-10T16:00:00.123456+00:00`, a space instead of `T`, or `Z`).
public enum PomodoroTimestamp {
  nonisolated(unsafe) private static let formatter: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    return formatter
  }()

  public static func parse(_ text: String) -> Date? {
    var value = text.replacingOccurrences(of: " ", with: "T")
    var fraction = 0.0
    if let dot = value.firstIndex(of: "."), value.distance(from: value.startIndex, to: dot) >= 19 {
      var end = value.index(after: dot)
      while end < value.endIndex, value[end].isNumber { end = value.index(after: end) }
      fraction = Double("0" + value[dot..<end]) ?? 0
      value.removeSubrange(dot..<end)
    }
    if value.count == 19 { value += "Z" }
    if value.hasSuffix("+00") || value.range(of: #"[+-]\d{2}$"#, options: .regularExpression) != nil { value += ":00" }
    return formatter.date(from: value).map { $0.addingTimeInterval(fraction) }
  }
}

// MARK: Preferences

public struct PomodoroSettings: Equatable, Sendable {
  public var focusMinutes: Int
  public var shortBreakMinutes: Int
  public var longBreakMinutes: Int
  public var longBreakEvery: Int
  public var autoStartBreaks: Bool
  public var autoStartFocus: Bool

  public init(focusMinutes: Int = 25, shortBreakMinutes: Int = 5, longBreakMinutes: Int = 15, longBreakEvery: Int = 4, autoStartBreaks: Bool = false, autoStartFocus: Bool = false) {
    self.focusMinutes = focusMinutes
    self.shortBreakMinutes = shortBreakMinutes
    self.longBreakMinutes = longBreakMinutes
    self.longBreakEvery = longBreakEvery
    self.autoStartBreaks = autoStartBreaks
    self.autoStartFocus = autoStartFocus
  }

  public static let defaults = PomodoroSettings()

  /// Preferences as stored under `profiles.settings.pomodoro`; missing keys take the defaults.
  public init(stored: JSONValue?) throws {
    guard let stored, !stored.isNull else { self = .defaults; return }
    guard let object = stored.object else { throw PomodoroValidationError("pomodoro settings must be an object") }
    func minutes(_ key: String, _ fallback: Int, limit: Int = PomodoroLimits.minutes) throws -> Int {
      guard let value = object[key] else { return fallback }
      guard let parsed = value.int, parsed >= 1 else { throw PomodoroValidationError("\(key) must be an integer of at least 1") }
      guard parsed <= limit else { throw PomodoroValidationError("\(key) must be \(limit) or fewer") }
      return parsed
    }
    func flag(_ key: String, _ fallback: Bool) throws -> Bool {
      guard let value = object[key] else { return fallback }
      guard let parsed = value.bool else { throw PomodoroValidationError("\(key) must be true or false") }
      return parsed
    }
    let defaults = PomodoroSettings.defaults
    self.init(
      focusMinutes: try minutes("focus_minutes", defaults.focusMinutes),
      shortBreakMinutes: try minutes("short_break_minutes", defaults.shortBreakMinutes),
      longBreakMinutes: try minutes("long_break_minutes", defaults.longBreakMinutes),
      longBreakEvery: try minutes("long_break_every", defaults.longBreakEvery, limit: PomodoroLimits.longBreakEvery),
      autoStartBreaks: try flag("auto_start_breaks", defaults.autoStartBreaks),
      autoStartFocus: try flag("auto_start_focus", defaults.autoStartFocus)
    )
  }

  public func plannedSeconds(_ kind: PomodoroKind) -> Int {
    switch kind {
    case .focus: return focusMinutes * 60
    case .shortBreak: return shortBreakMinutes * 60
    case .longBreak: return longBreakMinutes * 60
    }
  }
}

/// A preferences change: only the preferences that differ, stored keys, validated as the server validates.
public struct PomodoroSettingsPatch: Equatable, Sendable {
  public var focusMinutes: Int?
  public var shortBreakMinutes: Int?
  public var longBreakMinutes: Int?
  public var longBreakEvery: Int?
  public var autoStartBreaks: Bool?
  public var autoStartFocus: Bool?

  public init(focusMinutes: Int? = nil, shortBreakMinutes: Int? = nil, longBreakMinutes: Int? = nil, longBreakEvery: Int? = nil, autoStartBreaks: Bool? = nil, autoStartFocus: Bool? = nil) {
    self.focusMinutes = focusMinutes
    self.shortBreakMinutes = shortBreakMinutes
    self.longBreakMinutes = longBreakMinutes
    self.longBreakEvery = longBreakEvery
    self.autoStartBreaks = autoStartBreaks
    self.autoStartFocus = autoStartFocus
  }

  /// The fields of `draft` that differ from `current`.
  public init(from current: PomodoroSettings, to draft: PomodoroSettings) {
    self.init(
      focusMinutes: draft.focusMinutes == current.focusMinutes ? nil : draft.focusMinutes,
      shortBreakMinutes: draft.shortBreakMinutes == current.shortBreakMinutes ? nil : draft.shortBreakMinutes,
      longBreakMinutes: draft.longBreakMinutes == current.longBreakMinutes ? nil : draft.longBreakMinutes,
      longBreakEvery: draft.longBreakEvery == current.longBreakEvery ? nil : draft.longBreakEvery,
      autoStartBreaks: draft.autoStartBreaks == current.autoStartBreaks ? nil : draft.autoStartBreaks,
      autoStartFocus: draft.autoStartFocus == current.autoStartFocus ? nil : draft.autoStartFocus
    )
  }

  public var isEmpty: Bool {
    focusMinutes == nil && shortBreakMinutes == nil && longBreakMinutes == nil && longBreakEvery == nil && autoStartBreaks == nil && autoStartFocus == nil
  }

  /// The stored (snake_case) form, refusing values outside the server's limits.
  public func row() throws -> JSONObject {
    var row: JSONObject = [:]
    func number(_ key: String, _ value: Int?, limit: Int) throws {
      guard let value else { return }
      guard (1...limit).contains(value) else { throw PomodoroValidationError("\(key) must be a whole number from 1 to \(limit)") }
      row[key] = .number(Double(value))
    }
    try number("focus_minutes", focusMinutes, limit: PomodoroLimits.minutes)
    try number("short_break_minutes", shortBreakMinutes, limit: PomodoroLimits.minutes)
    try number("long_break_minutes", longBreakMinutes, limit: PomodoroLimits.minutes)
    try number("long_break_every", longBreakEvery, limit: PomodoroLimits.longBreakEvery)
    if let autoStartBreaks { row["auto_start_breaks"] = .bool(autoStartBreaks) }
    if let autoStartFocus { row["auto_start_focus"] = .bool(autoStartFocus) }
    if row.isEmpty { throw PomodoroValidationError("a preferences change must include at least one preference") }
    return row
  }
}

/// The `manor_command` inputs, field for field with `PomodoroService.ts`.
public enum PomodoroCommands {
  public static func start(id: String, kind: PomodoroKind, plannedSeconds: Int, label: String?) -> JSONObject {
    ["id": .string(id), "expected_revision": 0, "kind": .string(kind.rawValue), "planned_seconds": .number(Double(plannedSeconds)), "label": .from(label)]
  }

  /// Pause, resume, and delete carry only the session and its revision.
  public static func session(_ session: PomodoroSession) -> JSONObject {
    ["id": .string(session.id), "expected_revision": .number(Double(session.revision))]
  }

  public static func end(_ session: PomodoroSession, completed: Bool) -> JSONObject {
    ["id": .string(session.id), "expected_revision": .number(Double(session.revision)), "outcome": .string(completed ? "completed" : "abandoned")]
  }

  public static func relabel(_ session: PomodoroSession, label: String?) -> JSONObject {
    ["id": .string(session.id), "expected_revision": .number(Double(session.revision)), "label": .from(label)]
  }

  public static func saveSettings(_ row: JSONObject, profileRevision: Int) -> JSONObject {
    ["expected_revision": .number(Double(profileRevision)), "settings": .object(row)]
  }
}

// MARK: Clock

public struct PomodoroClock: Equatable, Sendable {
  /// Seconds the timer has actually run, pauses excluded.
  public let elapsedSeconds: Int
  public let remainingSeconds: Int
  /// 0 at the start, 1 when the planned time has run out.
  public let progress: Double
  public let due: Bool
}

public enum Pomodoro {
  public static func activeSession(_ sessions: [PomodoroSession]) -> PomodoroSession? {
    sessions.first(where: \.isActive)
  }

  /// Where a session's timer stands at an instant; a paused session stands still at the moment it paused.
  public static func clock(_ session: PomodoroSession, at now: Date) -> PomodoroClock {
    let reference: Date
    if session.status == .paused, let pausedAt = session.pausedAt { reference = pausedAt }
    else if session.isFinished, let endedAt = session.endedAt { reference = endedAt }
    else { reference = now }
    let elapsed = max(0, Int(floor(reference.timeIntervalSince(session.startedAt))) - session.pausedSeconds)
    let remaining = max(0, session.plannedSeconds - elapsed)
    return PomodoroClock(elapsedSeconds: elapsed, remainingSeconds: remaining, progress: min(1, Double(elapsed) / Double(session.plannedSeconds)), due: remaining == 0)
  }

  /// `mm:ss`, or `h:mm:ss` from an hour up.
  public static func formatClock(_ totalSeconds: Int) -> String {
    let seconds = max(0, totalSeconds)
    let hours = seconds / 3600, minutes = (seconds % 3600) / 60, rest = seconds % 60
    return hours > 0 ? String(format: "%d:%02d:%02d", hours, minutes, rest) : String(format: "%02d:%02d", minutes, rest)
  }

  /// Whole minutes for statistics: `1h 05m` from an hour up, `45m` below, `0m` when nothing.
  public static func formatMinutes(_ totalSeconds: Int) -> String {
    let minutes = Int((Double(totalSeconds) / 60).rounded())
    if minutes < 60 { return "\(minutes)m" }
    let hours = minutes / 60, rest = minutes % 60
    return rest == 0 ? "\(hours)h" : String(format: "%dh %02dm", hours, rest)
  }

  public static func completedFocus(_ sessions: [PomodoroSession], on date: String) -> Int {
    sessions.filter { $0.kind == .focus && $0.status == .completed && $0.localDate == date }.count
  }

  /// What comes after a session ends. A completed focus session earns a break, the long one when the day's
  /// completed count reaches the configured cycle; every break, and a stopped focus session, leads back to focus.
  public static func nextKind(after ended: PomodoroSession, sessions: [PomodoroSession], settings: PomodoroSettings) -> PomodoroKind {
    guard ended.kind == .focus, ended.status == .completed else { return .focus }
    let completedToday = completedFocus(sessions, on: ended.localDate)
    return completedToday > 0 && completedToday % settings.longBreakEvery == 0 ? .longBreak : .shortBreak
  }

  /// How many of the current cycle's focus sessions are done, so the dots read as progress toward the long break.
  public static func cyclePosition(completedToday: Int, longBreakEvery: Int) -> Int {
    guard completedToday > 0, longBreakEvery > 0 else { return 0 }
    let remainder = completedToday % longBreakEvery
    return remainder == 0 ? longBreakEvery : remainder
  }
}

// MARK: Dates and statistics

public enum PomodoroDates {
  static let utc = TimeZone(identifier: "UTC")!
  static let calendar: Calendar = {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = utc
    return calendar
  }()

  static func formatter(_ format: String, timeZone: TimeZone = utc) -> DateFormatter {
    let formatter = DateFormatter()
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = timeZone
    formatter.dateFormat = format
    return formatter
  }

  static let isoFormatter = formatter("yyyy-MM-dd")
  static let isoMonthFormatter = formatter("yyyy-MM")
  static let monthFormatter = formatter("MMMM yyyy")
  static let shortDayFormatter = formatter("MMM d")
  static let headingFormatter = formatter("EEE, MMM d")

  static func date(_ string: String) -> Date? { isoFormatter.date(from: string) }

  public static func monthOf(_ date: String) -> String { String(date.prefix(7)) }

  public static func shiftMonth(_ month: String, by amount: Int) -> String {
    guard let start = date("\(month)-01"), let moved = calendar.date(byAdding: .month, value: amount, to: start) else { return month }
    return isoMonthFormatter.string(from: moved)
  }

  public static func shiftDate(_ date: String, by days: Int) -> String {
    guard let parsed = self.date(date), let moved = calendar.date(byAdding: .day, value: days, to: parsed) else { return date }
    return isoFormatter.string(from: moved)
  }

  public static func daysOfMonth(_ month: String) -> [String] {
    guard let start = date("\(month)-01"), let range = calendar.range(of: .day, in: .month, for: start) else { return [] }
    return range.map { String(format: "%@-%02d", month, $0) }
  }

  public static func monthLabel(_ month: String) -> String { date("\(month)-01").map(monthFormatter.string(from:)) ?? month }
  public static func shortDayLabel(_ date: String) -> String { self.date(date).map(shortDayFormatter.string(from:)) ?? date }

  /// "Today", "Yesterday", or a weekday with the date, for the session log's day headings.
  public static func dayHeading(_ date: String, today: String) -> String {
    if date == today { return "Today" }
    if date == shiftDate(today, by: -1) { return "Yesterday" }
    return self.date(date).map(headingFormatter.string(from:)) ?? date
  }

  /// The local start time, "9:05 AM", in the account time zone.
  public static func startTimeLabel(_ session: PomodoroSession, timeZone: TimeZone) -> String {
    let formatter = formatter("h:mm a", timeZone: timeZone)
    return formatter.string(from: session.startedAt)
  }
}

public struct PomodoroDay: Equatable, Sendable, Identifiable {
  public let date: String
  public var completed: Int
  public var focusedSeconds: Int
  public var id: String { date }
  public init(date: String, completed: Int, focusedSeconds: Int) {
    self.date = date
    self.completed = completed
    self.focusedSeconds = focusedSeconds
  }
}

public struct PomodoroMonthStats: Equatable, Sendable {
  public let month: String
  public let completed: Int
  public let abandoned: Int
  public let focusedSeconds: Int
  public let activeDays: Int
  /// Days of the month that have passed, today included, so rates read against real time.
  public let elapsedDays: Int
  public let bestDay: PomodoroDay?
  /// Consecutive days with a completed focus session, ending today or yesterday.
  public let streak: Int
  public let days: [PomodoroDay]

  /// Completed sessions per active day, to one decimal.
  public var perActiveDay: Double? {
    activeDays == 0 ? nil : (Double(completed) / Double(activeDays) * 10).rounded() / 10
  }
}

public struct PomodoroSessionDay: Equatable, Sendable, Identifiable {
  public let date: String
  public let sessions: [PomodoroSession]
  public var id: String { date }
  public var completedCount: Int { sessions.filter { $0.status == .completed }.count }
}

public enum PomodoroStats {
  /// Finished focus sessions of a month, both outcomes; breaks are not statistics.
  public static func focusSessions(_ sessions: [PomodoroSession], month: String) -> [PomodoroSession] {
    sessions.filter { $0.kind == .focus && $0.isFinished && PomodoroDates.monthOf($0.localDate) == month }
  }

  public static func month(_ sessions: [PomodoroSession], month: String, today: String) -> PomodoroMonthStats {
    let dates = PomodoroDates.daysOfMonth(month)
    var byDay = Dictionary(uniqueKeysWithValues: dates.map { ($0, PomodoroDay(date: $0, completed: 0, focusedSeconds: 0)) })
    var completed = 0, abandoned = 0, focused = 0
    for session in focusSessions(sessions, month: month) {
      guard var day = byDay[session.localDate] else { continue }
      let seconds = session.focusedSeconds ?? 0
      focused += seconds
      day.focusedSeconds += seconds
      if session.status == .completed {
        completed += 1
        day.completed += 1
      } else {
        abandoned += 1
      }
      byDay[session.localDate] = day
    }
    let days = dates.compactMap { byDay[$0] }
    let activeDays = days.filter { $0.completed > 0 }.count
    var best: PomodoroDay? = nil
    for day in days where day.completed > 0 {
      if let current = best, !(day.completed > current.completed || (day.completed == current.completed && day.focusedSeconds > current.focusedSeconds)) { continue }
      best = day
    }
    let elapsed = PomodoroDates.monthOf(today) == month ? (Int(today.suffix(2)) ?? 0) : (today > month ? days.count : 0)
    return PomodoroMonthStats(month: month, completed: completed, abandoned: abandoned, focusedSeconds: focused, activeDays: activeDays,
                              elapsedDays: elapsed, bestDay: best, streak: streak(sessions, today: today), days: days)
  }

  /// Consecutive days with a completed focus session, counting back from today, or from yesterday while today is open.
  public static func streak(_ sessions: [PomodoroSession], today: String) -> Int {
    let completedDays = Set(sessions.filter { $0.kind == .focus && $0.status == .completed }.map(\.localDate))
    var cursor = completedDays.contains(today) ? today : PomodoroDates.shiftDate(today, by: -1)
    var count = 0
    while completedDays.contains(cursor) {
      count += 1
      cursor = PomodoroDates.shiftDate(cursor, by: -1)
    }
    return count
  }

  /// The earliest month with a finished session, or the current month for a fresh account.
  public static func earliestMonth(_ sessions: [PomodoroSession], today: String) -> String {
    sessions.filter(\.isFinished).map { PomodoroDates.monthOf($0.localDate) }.min() ?? PomodoroDates.monthOf(today)
  }

  /// Finished focus sessions of a month grouped by local day, newest day and newest session first.
  public static func sessionDays(_ sessions: [PomodoroSession], month: String) -> [PomodoroSessionDay] {
    let grouped = Dictionary(grouping: focusSessions(sessions, month: month), by: \.localDate)
    return grouped.keys.sorted(by: >).map { date in
      PomodoroSessionDay(date: date, sessions: (grouped[date] ?? []).sorted { $0.startedAt > $1.startedAt })
    }
  }
}
