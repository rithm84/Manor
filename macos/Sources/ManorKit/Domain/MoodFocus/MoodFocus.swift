import Foundation

// Mood and focus: one date-keyed record per day with independently logged Mood and Focus, and the
// arithmetic the History view reads (month summaries, trends, the month grid, and per-level distributions).

/// Mood, best first, as the scale reads on the page.
public enum Mood: String, CaseIterable, Codable, Sendable, Hashable, Identifiable {
  case great = "Great", good = "Good", neutral = "Neutral", bad = "Bad", awful = "Awful"

  public var id: String { rawValue }
  /// 1 for Awful up to 5 for Great.
  public var level: Int {
    switch self {
    case .awful: return 1
    case .bad: return 2
    case .neutral: return 3
    case .good: return 4
    case .great: return 5
    }
  }

  /// Lowest to highest, the order averages map onto.
  public static let ascending: [Mood] = [.awful, .bad, .neutral, .good, .great]
}

/// Focus, most locked in first. Resting is a deliberate day off, distinct from a missing rating.
public enum Focus: String, CaseIterable, Codable, Sendable, Hashable, Identifiable {
  case lockedIn = "Locked In", high = "High", medium = "Medium", low = "Low", lockedOut = "Locked Out", resting = "Resting"

  public var id: String { rawValue }
  /// 1 for Locked Out up to 5 for Locked In; Resting is 0 and never joins an average.
  public var level: Int {
    switch self {
    case .lockedOut: return 1
    case .low: return 2
    case .medium: return 3
    case .high: return 4
    case .lockedIn: return 5
    case .resting: return 0
    }
  }

  /// The rated levels lowest to highest, the order averages map onto. Resting is not on it.
  public static let ascending: [Focus] = [.lockedOut, .low, .medium, .high, .lockedIn]
}

public struct MoodFocusValidationError: LocalizedError, Equatable, Sendable {
  public let message: String
  public init(_ message: String) { self.message = message }
  public var errorDescription: String? { message }
}

/// One day's record. Either signal may be missing, but not both.
public struct MoodFocusEntry: Equatable, Sendable, Identifiable {
  public var date: String
  public var mood: Mood?
  public var focus: Focus?
  public var createdAt: String
  public var updatedAt: String
  /// The row revision a save sends back as `expected_revision`.
  public var revision: Int

  public var id: String { date }

  public init(date: String, mood: Mood?, focus: Focus?, createdAt: String, updatedAt: String, revision: Int) {
    self.date = date
    self.mood = mood
    self.focus = focus
    self.createdAt = createdAt
    self.updatedAt = updatedAt
    self.revision = revision
  }

  /// Parses a `mood_focus_entries` row, refusing records the server could never have written.
  public init(row: Row) throws {
    guard let date = row["date"]?.string, MoodFocusDates.isValid(date) else {
      throw MoodFocusValidationError("entry.date must be a real YYYY-MM-DD date")
    }
    let mood = try Self.optional(row["mood"], label: "mood") { Mood(rawValue: $0) }
    let focus = try Self.optional(row["focus"], label: "focus") { Focus(rawValue: $0) }
    if mood == nil && focus == nil { throw MoodFocusValidationError("a mood and focus entry must contain mood or focus") }
    guard let createdAt = row["created_at"]?.string, !createdAt.isEmpty, let updatedAt = row["updated_at"]?.string, !updatedAt.isEmpty else {
      throw MoodFocusValidationError("entry timestamps must be ISO timestamps")
    }
    self.init(date: date, mood: mood, focus: focus, createdAt: createdAt, updatedAt: updatedAt, revision: row["revision"]?.int ?? 0)
  }

  private static func optional<T>(_ value: JSONValue?, label: String, _ make: (String) -> T?) throws -> T? {
    guard let value, !value.isNull else { return nil }
    guard let text = value.string, let parsed = make(text) else { throw MoodFocusValidationError("\(label) is not on the scale") }
    return parsed
  }
}

/// A rating change for one day from the History editor. `expectedUpdatedAt` is the `updated_at` the editor
/// opened with, so a record that changed underneath it is refused instead of overwritten.
public struct MoodFocusHistoryMutation: Equatable, Sendable {
  public var date: String
  public var mood: Mood?
  public var focus: Focus?
  public var expectedUpdatedAt: String?

  public init(date: String, mood: Mood?, focus: Focus?, expectedUpdatedAt: String?) {
    self.date = date
    self.mood = mood
    self.focus = focus
    self.expectedUpdatedAt = expectedUpdatedAt
  }

  /// Checks the correction carries a real date and at least one explicit rating.
  public func validated() throws -> MoodFocusHistoryMutation {
    guard MoodFocusDates.isValid(date) else { throw MoodFocusValidationError("history.date must be a real YYYY-MM-DD date") }
    if mood == nil && focus == nil { throw MoodFocusValidationError("a history correction must contain mood or focus") }
    return self
  }
}

/// The `manor_command` inputs, field for field with `MoodFocusService.ts`.
public enum MoodFocusCommands {
  /// `log_daily_ratings` for one quick-capture tap. Only the tapped signal is sent, so the other stays as it is.
  public static func rateMood(date: String, mood: Mood, revision: Int) -> JSONObject {
    ["date": .string(date), "expected_revision": .number(Double(revision)), "mood": .string(mood.rawValue)]
  }

  public static func rateFocus(date: String, focus: Focus, revision: Int) -> JSONObject {
    ["date": .string(date), "expected_revision": .number(Double(revision)), "focus": .string(focus.rawValue)]
  }

  /// `log_daily_ratings` with both signals explicit (null clears one), for today's record edited from History.
  public static func setRatings(_ mutation: MoodFocusHistoryMutation, revision: Int) -> JSONObject {
    ["date": .string(mutation.date), "expected_revision": .number(Double(revision)),
     "mood": .from(mutation.mood?.rawValue), "focus": .from(mutation.focus?.rawValue)]
  }

  /// `correct_mood_focus_history` for any earlier day; it changes only the ratings.
  public static func correctHistory(_ mutation: MoodFocusHistoryMutation, revision: Int) -> JSONObject {
    ["date": .string(mutation.date), "mood": .from(mutation.mood?.rawValue), "focus": .from(mutation.focus?.rawValue),
     "expected_revision": .number(Double(revision))]
  }

  public static let staleMessage = "This daily record changed while you were editing. Close it, reopen it, and apply your changes again."
}

// MARK: Dates

/// Calendar arithmetic on `YYYY-MM-DD` strings. Every calculation runs in UTC on the date itself, so the
/// Mac's time zone never shifts a day; the account time zone only decides what "today" is.
public enum MoodFocusDates {
  static let utc = TimeZone(identifier: "UTC")!
  static let calendar: Calendar = {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = utc
    return calendar
  }()

  static func formatter(_ format: String) -> DateFormatter {
    let formatter = DateFormatter()
    formatter.calendar = calendar
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = utc
    formatter.dateFormat = format
    return formatter
  }

  static let isoFormatter = formatter("yyyy-MM-dd")
  static let monthFormatter = formatter("MMMM yyyy")
  static let shortMonthFormatter = formatter("MMM")
  static let dayFormatter = formatter("EEE, MMM d")
  static let fullFormatter = formatter("EEEE, MMMM d, yyyy")
  static let isoMonthFormatter = formatter("yyyy-MM")

  public static func date(_ string: String) -> Date? {
    guard string.count == 10, let date = isoFormatter.date(from: string), isoFormatter.string(from: date) == string else { return nil }
    return date
  }

  public static func isValid(_ string: String) -> Bool { date(string) != nil }

  public static func adding(_ days: Int, to string: String) -> String {
    guard let date = date(string), let moved = calendar.date(byAdding: .day, value: days, to: date) else { return string }
    return isoFormatter.string(from: moved)
  }

  public static func previous(_ string: String) -> String { adding(-1, to: string) }

  public static func monthKey(_ date: String) -> String { String(date.prefix(7)) }

  public static func monthStart(_ month: String) -> Date? { date("\(month)-01") }

  public static func monthShift(_ month: String, by amount: Int) -> String {
    guard let start = monthStart(month), let moved = calendar.date(byAdding: .month, value: amount, to: start) else { return month }
    return isoMonthFormatter.string(from: moved)
  }

  public static func daysInMonth(_ month: String) -> Int {
    guard let start = monthStart(month), let range = calendar.range(of: .day, in: .month, for: start) else { return 30 }
    return range.count
  }

  public static func monthLabel(_ month: String) -> String {
    monthStart(month).map(monthFormatter.string(from:)) ?? month
  }

  public static func shortMonthLabel(_ month: String) -> String {
    monthStart(month).map(shortMonthFormatter.string(from:)) ?? month
  }

  /// "Today", "Yesterday", or a short weekday and date.
  public static func dayLabel(_ date: String, today: String) -> String {
    if date == today { return "Today" }
    if date == previous(today) { return "Yesterday" }
    return self.date(date).map(dayFormatter.string(from:)) ?? date
  }

  /// "Thursday, August 20, 2026".
  public static func fullDateLabel(_ date: String) -> String {
    self.date(date).map(fullFormatter.string(from:)) ?? date
  }

  /// Monday-first weekday index, 0 for Monday through 6 for Sunday.
  public static func mondayIndex(_ date: String) -> Int {
    guard let parsed = self.date(date) else { return 0 }
    let weekday = calendar.component(.weekday, from: parsed) // 1 = Sunday
    return (weekday + 5) % 7
  }
}

// MARK: History model

public struct MoodFocusMonthSummary: Equatable, Sendable {
  public let label: String
  public let loggedDays: Int
  public let moodAverage: Double?
  public let focusAverage: Double?
  public let restDays: Int
}

public struct MoodFocusTrendPoint: Equatable, Sendable, Identifiable {
  public let month: String
  public let shortLabel: String
  public let mood: Double?
  public let focus: Double?
  public let loggedDays: Int
  public var id: String { month }
}

public struct MoodFocusDayCell: Equatable, Sendable, Identifiable {
  public let date: String
  public let day: Int
  public let entry: MoodFocusEntry?
  public let future: Bool
  public let today: Bool
  public var id: String { date }
}

public struct MoodFocusMonthGrid: Equatable, Sendable {
  /// Empty cells before the first day so the grid starts on Monday.
  public let leadBlanks: Int
  public let cells: [MoodFocusDayCell]
}

public struct MoodFocusDistributionRow<Level: Hashable & Sendable>: Equatable, Sendable {
  public let level: Level
  public let count: Int
  /// Share of rated days on this level, from 0 to 1.
  public let share: Double
}

public enum MoodFocusHistory {

  static func average(_ values: [Int]) -> Double? {
    guard !values.isEmpty else { return nil }
    return (Double(values.reduce(0, +)) / Double(values.count) * 10).rounded() / 10
  }

  public static func entries(_ entries: [MoodFocusEntry], inMonth month: String) -> [MoodFocusEntry] {
    entries.filter { MoodFocusDates.monthKey($0.date) == month }
  }

  /// Averages for a month. Rest days are counted but never pull the focus average down.
  public static func monthSummary(_ entries: [MoodFocusEntry], month: String) -> MoodFocusMonthSummary {
    let monthEntries = self.entries(entries, inMonth: month)
    let moods = monthEntries.compactMap { $0.mood?.level }
    let activeFocus = monthEntries.compactMap { entry -> Int? in
      guard let focus = entry.focus, focus != .resting else { return nil }
      return focus.level
    }
    return MoodFocusMonthSummary(
      label: MoodFocusDates.monthLabel(month),
      loggedDays: monthEntries.count,
      moodAverage: average(moods),
      focusAverage: average(activeFocus),
      restDays: monthEntries.filter { $0.focus == .resting }.count
    )
  }

  /// Monthly averages for `range` months ending at `endMonth`.
  public static func monthTrend(_ entries: [MoodFocusEntry], endMonth: String, range: Int) -> [MoodFocusTrendPoint] {
    (0..<range).map { index in
      let month = MoodFocusDates.monthShift(endMonth, by: index - (range - 1))
      let summary = monthSummary(entries, month: month)
      return MoodFocusTrendPoint(month: month, shortLabel: MoodFocusDates.shortMonthLabel(month), mood: summary.moodAverage, focus: summary.focusAverage, loggedDays: summary.loggedDays)
    }
  }

  /// The scale word nearest an average, so a 4.3 mood month reads as "Good".
  public static func moodLabel(average value: Double?) -> Mood? {
    guard let value else { return nil }
    return Mood.ascending[max(1, min(5, Int(value.rounded()))) - 1]
  }

  public static func focusLabel(average value: Double?) -> Focus? {
    guard let value else { return nil }
    return Focus.ascending[max(1, min(5, Int(value.rounded()))) - 1]
  }

  public static func monthGrid(_ entries: [MoodFocusEntry], month: String, today: String) -> MoodFocusMonthGrid {
    let byDate = Dictionary(self.entries(entries, inMonth: month).map { ($0.date, $0) }, uniquingKeysWith: { first, _ in first })
    let cells = (1...MoodFocusDates.daysInMonth(month)).map { day -> MoodFocusDayCell in
      let date = String(format: "%@-%02d", month, day)
      return MoodFocusDayCell(date: date, day: day, entry: byDate[date], future: date > today, today: date == today)
    }
    return MoodFocusMonthGrid(leadBlanks: MoodFocusDates.mondayIndex("\(month)-01"), cells: cells)
  }

  /// Rated days per mood level, Great first.
  public static func moodDistribution(_ entries: [MoodFocusEntry]) -> [MoodFocusDistributionRow<Mood>] {
    let rated = entries.compactMap(\.mood)
    return Mood.allCases.map { level in
      let count = rated.filter { $0 == level }.count
      return MoodFocusDistributionRow(level: level, count: count, share: rated.isEmpty ? 0 : Double(count) / Double(rated.count))
    }
  }

  /// Rated days per focus level, Locked In first and Resting last.
  public static func focusDistribution(_ entries: [MoodFocusEntry]) -> [MoodFocusDistributionRow<Focus>] {
    let rated = entries.compactMap(\.focus)
    return Focus.allCases.map { level in
      let count = rated.filter { $0 == level }.count
      return MoodFocusDistributionRow(level: level, count: count, share: rated.isEmpty ? 0 : Double(count) / Double(rated.count))
    }
  }

  /// The first month with any check-in; the current month when nothing is logged yet.
  public static func earliestEntryMonth(_ entries: [MoodFocusEntry], today: String) -> String {
    MoodFocusDates.monthKey(entries.map(\.date).reduce(today) { min($0, $1) })
  }

  /// Quick capture covers today and yesterday.
  public static func canQuickCapture(_ date: String, today: String) -> Bool {
    date == today || date == MoodFocusDates.previous(today)
  }
}
