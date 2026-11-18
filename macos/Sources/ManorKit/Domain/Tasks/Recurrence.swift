import Foundation

/// The RRULE subset Manor stores on tasks: DAILY, WEEKLY (optionally on chosen weekdays), and MONTHLY, with
/// an interval and an optional inclusive end date. The server materializes occurrences from the same rule.
public enum RecurrenceUnit: String, CaseIterable, Hashable, Sendable {
  case day, week, month
  var frequency: String {
    switch self {
    case .day: return "DAILY"
    case .week: return "WEEKLY"
    case .month: return "MONTHLY"
    }
  }
  public var pluralLabel: String {
    switch self {
    case .day: return "days"
    case .week: return "weeks"
    case .month: return "months"
    }
  }
}

/// Monday-first weekdays, the order RRULE and the repeat editor use.
public enum RecurrenceWeekday: Int, CaseIterable, Hashable, Comparable, Sendable {
  case monday, tuesday, wednesday, thursday, friday, saturday, sunday
  public static func < (lhs: Self, rhs: Self) -> Bool { lhs.rawValue < rhs.rawValue }
  public var code: String { ["MO", "TU", "WE", "TH", "FR", "SA", "SU"][rawValue] }
  public var short: String { ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][rawValue] }
  public var long: String { ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][rawValue] }
  public init?(code: String) {
    guard let index = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"].firstIndex(of: code) else { return nil }
    self.init(rawValue: index)
  }
}

public struct RecurrenceRule: Hashable, Sendable {
  public var every: Int
  public var unit: RecurrenceUnit
  public var weekdays: [RecurrenceWeekday]
  /// Inclusive last day, `YYYY-MM-DD`.
  public var until: String?

  public init(every: Int, unit: RecurrenceUnit, weekdays: [RecurrenceWeekday] = [], until: String? = nil) {
    self.every = every
    self.unit = unit
    self.weekdays = weekdays
    self.until = until
  }

  /// The custom editor's starting rule.
  public static let customDefault = RecurrenceRule(every: 2, unit: .week, weekdays: [.sunday], until: nil)
  public static let intervalRange = 1...30
}

public struct RecurrenceError: LocalizedError, Equatable, Sendable {
  public let message: String
  public init(_ message: String) { self.message = message }
  public var errorDescription: String? { message }
}

public enum Recurrence {
  /// The quick choices the repeat editor offers before Custom.
  public static let presets: [(label: String, value: String?)] = presets(on: .sunday)

  /// The quick choices for a task due on `weekday`: the weekly one names that day ("Every Tuesday").
  public static func presets(on weekday: RecurrenceWeekday) -> [(label: String, value: String?)] {
    [
      ("Doesn't repeat", nil),
      ("Every day", "FREQ=DAILY;INTERVAL=1"),
      ("Every week", "FREQ=WEEKLY;INTERVAL=1"),
      ("Every \(weekday.long)", "FREQ=WEEKLY;INTERVAL=1;BYDAY=\(weekday.code)")
    ]
  }

  /// The weekday of an ISO date (`YYYY-MM-DD`).
  public static func weekday(of iso: String) -> RecurrenceWeekday {
    RecurrenceWeekday(rawValue: (TaskDates.weekday(iso) + 6) % 7) ?? .sunday
  }

  /// The stored form, field order FREQ, INTERVAL, BYDAY, UNTIL, as rrule.js writes it.
  public static func serialize(_ rule: RecurrenceRule) throws -> String {
    guard RecurrenceRule.intervalRange.contains(rule.every) else { throw RecurrenceError("Repeat interval must be between 1 and 30") }
    var parts = ["FREQ=\(rule.unit.frequency)", "INTERVAL=\(rule.every)"]
    if rule.unit == .week, !rule.weekdays.isEmpty {
      parts.append("BYDAY=" + Array(Set(rule.weekdays)).sorted().map(\.code).joined(separator: ","))
    }
    if let until = rule.until {
      guard TaskDates.isDate(until) else { throw RecurrenceError("Repeat end must be a real calendar date") }
      parts.append("UNTIL=\(until.replacingOccurrences(of: "-", with: ""))T235959Z")
    }
    return parts.joined(separator: ";")
  }

  public static func parse(_ value: String) throws -> RecurrenceRule {
    var text = value.trimmingCharacters(in: .whitespacesAndNewlines)
    if text.hasPrefix("RRULE:") { text.removeFirst(6) }
    var frequency: String?
    var every = 1
    var weekdays: [RecurrenceWeekday] = []
    var until: String?
    var seen = Set<String>()
    for token in text.split(separator: ";") {
      let pair = token.split(separator: "=", maxSplits: 1).map(String.init)
      guard pair.count == 2 else { throw RecurrenceError("Malformed repeat rule") }
      let (key, field) = (pair[0], pair[1])
      guard seen.insert(key).inserted else { throw RecurrenceError("Repeat rule repeats field \(key)") }
      switch key {
      case "FREQ": frequency = field
      case "INTERVAL":
        guard let interval = Int(field), interval >= 1 else { throw RecurrenceError("Repeat interval must be a positive number") }
        every = interval
      case "BYDAY":
        weekdays = try field.split(separator: ",").map {
          guard let day = RecurrenceWeekday(code: String($0)) else { throw RecurrenceError("Unknown repeat weekday \($0)") }
          return day
        }.sorted()
      case "UNTIL":
        let digits = String(field.prefix(8))
        guard field.count == 8 || field.count == 16, digits.allSatisfy(\.isNumber) else { throw RecurrenceError("Repeat end requires YYYYMMDD") }
        let date = "\(digits.prefix(4))-\(digits.dropFirst(4).prefix(2))-\(digits.suffix(2))"
        guard TaskDates.isDate(date) else { throw RecurrenceError("Repeat end must be a real calendar date") }
        until = date
      case "WKST", "DTSTART": continue
      default: throw RecurrenceError("Unsupported repeat field \(key)")
      }
    }
    let unit: RecurrenceUnit
    switch frequency {
    case "DAILY": unit = .day
    case "WEEKLY": unit = .week
    case "MONTHLY": unit = .month
    default: throw RecurrenceError("Manor supports daily, weekly, and monthly task repeats")
    }
    if !weekdays.isEmpty && unit != .week { throw RecurrenceError("Weekdays require a weekly repeat") }
    return RecurrenceRule(every: every, unit: unit, weekdays: weekdays, until: until)
  }

  /// A sentence for a stored rule, in the words rrule.js uses, capitalized: "Every 2 weeks on Monday, Friday
  /// until January 6, 2028". Text that is not a rule passes through unchanged.
  public static func label(_ value: String) -> String {
    guard value.hasPrefix("FREQ=") || value.hasPrefix("RRULE:"), let rule = try? parse(value) else { return value }
    return label(rule)
  }

  public static func label(_ rule: RecurrenceRule) -> String {
    let every = rule.every
    var text: String
    switch rule.unit {
    case .day:
      text = every == 1 ? "every day" : "every \(every) days"
    case .month:
      text = every == 1 ? "every month" : "every \(every) months"
    case .week:
      let days = Array(Set(rule.weekdays)).sorted()
      let weekdaysOnly: [RecurrenceWeekday] = [.monday, .tuesday, .wednesday, .thursday, .friday]
      let base = every == 1 ? "every week" : "every \(every) weeks"
      if days.count == 7 {
        text = every == 1 ? "every day" : "\(base) on every day"
      } else if days == weekdaysOnly {
        text = every == 1 ? "every weekday" : "\(base) on weekdays"
      } else if days.isEmpty {
        text = base
      } else {
        text = "\(base) on " + days.map(\.long).joined(separator: ", ")
      }
    }
    if let until = rule.until, let civil = TaskDates.parse(until) {
      text += " until \(TaskDates.monthsLong[civil.month - 1]) \(civil.day), \(civil.year)"
    }
    return text.prefix(1).uppercased() + text.dropFirst()
  }

  /// Whether `day` is an occurrence of `rule` anchored at `anchor`, the same test the server applies when it
  /// materializes a series (weekly intervals count ISO weeks; monthly repeats keep the anchor's day of month).
  public static func occurs(_ rule: RecurrenceRule, anchor: String, on day: String) -> Bool {
    guard let anchorCivil = TaskDates.parse(anchor), let dayCivil = TaskDates.parse(day) else { return false }
    if day < anchor { return false }
    if let until = rule.until, day > until { return false }
    let delta = TaskDates.daysBetween(anchor, day)
    switch rule.unit {
    case .day:
      return delta % rule.every == 0
    case .week:
      // ISO weekday, Monday 0.
      let anchorWeekday = (TaskDates.weekday(anchor) + 6) % 7
      let dayWeekday = (TaskDates.weekday(day) + 6) % 7
      let anchorMonday = TaskDates.adding(-anchorWeekday, to: anchor)
      guard (TaskDates.daysBetween(anchorMonday, day) / 7) % rule.every == 0 else { return false }
      return rule.weekdays.isEmpty ? dayWeekday == anchorWeekday : rule.weekdays.contains { $0.rawValue == dayWeekday }
    case .month:
      let months = (dayCivil.year - anchorCivil.year) * 12 + dayCivil.month - anchorCivil.month
      return months % rule.every == 0 && dayCivil.day == anchorCivil.day
    }
  }

  /// The next `limit` occurrences on or after `from`, searching up to `horizonDays` ahead.
  public static func occurrences(_ rule: RecurrenceRule, anchor: String, from: String, limit: Int, horizonDays: Int = 400) -> [String] {
    var result: [String] = []
    var day = max(from, anchor)
    var steps = 0
    while result.count < limit && steps <= horizonDays {
      if occurs(rule, anchor: anchor, on: day) { result.append(day) }
      if let until = rule.until, day >= until { break }
      day = TaskDates.adding(1, to: day)
      steps += 1
    }
    return result
  }
}
