import Foundation

/// A calendar day with no time or zone, the way Manor stores business dates (`YYYY-MM-DD`). Arithmetic runs on
/// whole days, so no time zone or daylight-saving change can move a date. "Today" comes from the account's zone.
public struct CivilDate: Hashable, Comparable, Sendable, CustomStringConvertible {
  public let year: Int
  public let month: Int
  public let day: Int

  public init?(year: Int, month: Int, day: Int) {
    guard (1...12).contains(month), (1...9999).contains(year), day >= 1, day <= CivilDate.daysIn(month: month, year: year) else { return nil }
    self.year = year
    self.month = month
    self.day = day
  }

  /// A strict `YYYY-MM-DD` string.
  public init?(_ string: String) {
    let parts = string.split(separator: "-", omittingEmptySubsequences: false)
    guard string.count == 10, parts.count == 3, parts[0].count == 4, parts[1].count == 2, parts[2].count == 2,
          let year = Int(parts[0]), let month = Int(parts[1]), let day = Int(parts[2]) else { return nil }
    self.init(year: year, month: month, day: day)
  }

  /// Days since 1970-01-01 (negative before it).
  public init(dayNumber: Int) {
    // Howard Hinnant's civil_from_days.
    let z = dayNumber + 719_468
    let era = (z >= 0 ? z : z - 146_096) / 146_097
    let doe = z - era * 146_097
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
    let mp = (5 * doy + 2) / 153
    let day = doy - (153 * mp + 2) / 5 + 1
    let month = mp < 10 ? mp + 3 : mp - 9
    self.year = yoe + era * 400 + (month <= 2 ? 1 : 0)
    self.month = month
    self.day = day
  }

  /// The day in `timeZone` at `now`: pass the account's zone for "today".
  public static func today(in timeZone: TimeZone, now: Date = Date()) -> CivilDate {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = timeZone
    let parts = calendar.dateComponents([.year, .month, .day], from: now)
    return CivilDate(year: parts.year ?? 1970, month: parts.month ?? 1, day: parts.day ?? 1) ?? CivilDate(dayNumber: 0)
  }

  public var string: String { String(format: "%04d-%02d-%02d", year, month, day) }
  public var description: String { string }

  public var dayNumber: Int {
    let y = month <= 2 ? year - 1 : year
    let era = (y >= 0 ? y : y - 399) / 400
    let yoe = y - era * 400
    let mp = month > 2 ? month - 3 : month + 9
    let doy = (153 * mp + 2) / 5 + day - 1
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
    return era * 146_097 + doe - 719_468
  }

  /// ISO weekday: 1 is Monday, 7 is Sunday.
  public var weekday: Int {
    let wd = (dayNumber + 3) % 7  // 1970-01-01 was a Thursday (index 3 from Monday).
    return (wd < 0 ? wd + 7 : wd) + 1
  }

  public func adding(days: Int) -> CivilDate { CivilDate(dayNumber: dayNumber + days) }

  /// Moves by whole months and keeps the day, clamped to the target month's length (Jan 31 + 1 month is Feb 28 or 29).
  public func adding(months: Int) -> CivilDate {
    let target = CivilMonth(year: year, month: month).adding(months: months)
    let day = min(self.day, CivilDate.daysIn(month: target.month, year: target.year))
    return CivilDate(year: target.year, month: target.month, day: day) ?? self
  }

  public func days(until other: CivilDate) -> Int { other.dayNumber - dayNumber }

  public var monthValue: CivilMonth { CivilMonth(year: year, month: month) }

  /// Midnight UTC of the day, for formatters that need a `Date`. Format it with a UTC formatter.
  public var utcDate: Date { Date(timeIntervalSince1970: TimeInterval(dayNumber) * 86_400) }

  public static func < (lhs: CivilDate, rhs: CivilDate) -> Bool { lhs.dayNumber < rhs.dayNumber }

  public static func isLeap(_ year: Int) -> Bool { (year % 4 == 0 && year % 100 != 0) || year % 400 == 0 }

  public static func daysIn(month: Int, year: Int) -> Int {
    switch month {
    case 2: return isLeap(year) ? 29 : 28
    case 4, 6, 9, 11: return 30
    default: return 31
    }
  }
}

/// A month of a year, for the calendar's page.
public struct CivilMonth: Hashable, Comparable, Sendable {
  public let year: Int
  public let month: Int

  public init(year: Int, month: Int) {
    let index = year * 12 + (month - 1)
    self.year = index >= 0 ? index / 12 : (index - 11) / 12
    self.month = index - self.year * 12 + 1
  }

  public func adding(months: Int) -> CivilMonth { CivilMonth(year: year, month: month + months) }
  public var first: CivilDate { CivilDate(year: year, month: month, day: 1)! }
  public var last: CivilDate { CivilDate(year: year, month: month, day: CivilDate.daysIn(month: month, year: year))! }
  public func contains(_ date: CivilDate) -> Bool { date.year == year && date.month == month }

  public static func < (lhs: CivilMonth, rhs: CivilMonth) -> Bool { (lhs.year, lhs.month) < (rhs.year, rhs.month) }
}

/// The inclusive range a picker accepts. Either end may be open.
public struct DateBounds: Hashable, Sendable {
  public var minimum: CivilDate?
  public var maximum: CivilDate?

  public init(minimum: CivilDate? = nil, maximum: CivilDate? = nil) {
    self.minimum = minimum
    self.maximum = maximum
  }

  public static let unbounded = DateBounds()

  public func contains(_ date: CivilDate) -> Bool {
    if let minimum, date < minimum { return false }
    if let maximum, date > maximum { return false }
    return true
  }

  public func clamp(_ date: CivilDate) -> CivilDate {
    if let minimum, date < minimum { return minimum }
    if let maximum, date > maximum { return maximum }
    return date
  }

  /// Whether any day of `month` can be chosen, so the month chevrons know when to stop.
  public func allowsAny(of month: CivilMonth) -> Bool {
    if let minimum, month.last < minimum { return false }
    if let maximum, month.first > maximum { return false }
    return true
  }
}

/// The 6-week page a month calendar shows: always 42 days so the popover never changes height between months.
public enum MonthGrid {
  /// `firstWeekday` is ISO (1 Monday ... 7 Sunday). Manor's calendars start on Monday.
  public static func days(for month: CivilMonth, firstWeekday: Int = 1) -> [CivilDate] {
    let first = month.first
    let lead = (first.weekday - firstWeekday + 7) % 7
    let start = first.adding(days: -lead)
    return (0..<42).map { start.adding(days: $0) }
  }

  /// ISO weekdays in display order.
  public static func weekdays(firstWeekday: Int = 1) -> [Int] {
    (0..<7).map { (firstWeekday - 1 + $0) % 7 + 1 }
  }
}

/// Keyboard movement through a calendar.
public enum DateKey: Sendable {
  case previousDay, nextDay, previousWeek, nextWeek
  case previousMonth, nextMonth, previousYear, nextYear
  case startOfWeek, endOfWeek
}

public enum DateNavigation {
  /// Where the focused day goes for a key. Movement stops at the bounds instead of landing on a disabled day.
  public static func move(_ date: CivilDate, by key: DateKey, within bounds: DateBounds = .unbounded, firstWeekday: Int = 1) -> CivilDate {
    let target: CivilDate
    switch key {
    case .previousDay: target = date.adding(days: -1)
    case .nextDay: target = date.adding(days: 1)
    case .previousWeek: target = date.adding(days: -7)
    case .nextWeek: target = date.adding(days: 7)
    case .previousMonth: target = date.adding(months: -1)
    case .nextMonth: target = date.adding(months: 1)
    case .previousYear: target = date.adding(months: -12)
    case .nextYear: target = date.adding(months: 12)
    case .startOfWeek: target = date.adding(days: -((date.weekday - firstWeekday + 7) % 7))
    case .endOfWeek: target = date.adding(days: 6 - (date.weekday - firstWeekday + 7) % 7)
    }
    return bounds.clamp(target)
  }
}
