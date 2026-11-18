import Foundation

/// Calendar arithmetic on account-local `YYYY-MM-DD` dates and `HH:MM` wall-clock times, independent of
/// any time zone. Business dates come from the account's saved zone; these helpers only move and format them.
public enum TaskDates {
  /// A civil date as year, month (1-12), and day.
  public struct Civil: Hashable, Sendable {
    public let year: Int
    public let month: Int
    public let day: Int
  }

  public static func parse(_ iso: String) -> Civil? {
    let parts = iso.split(separator: "-")
    guard iso.count == 10, parts.count == 3, let year = Int(parts[0]), let month = Int(parts[1]), let day = Int(parts[2]),
      (1...12).contains(month), day >= 1, day <= daysIn(month: month, year: year) else { return nil }
    return Civil(year: year, month: month, day: day)
  }

  public static func isDate(_ iso: String) -> Bool { parse(iso) != nil }

  public static func format(_ civil: Civil) -> String {
    String(format: "%04d-%02d-%02d", civil.year, civil.month, civil.day)
  }

  static func daysIn(month: Int, year: Int) -> Int {
    switch month {
    case 2: return (year % 4 == 0 && year % 100 != 0) || year % 400 == 0 ? 29 : 28
    case 4, 6, 9, 11: return 30
    default: return 31
    }
  }

  /// Days since 1970-01-01 (Howard Hinnant's days-from-civil).
  public static func dayNumber(_ civil: Civil) -> Int {
    let y = civil.month <= 2 ? civil.year - 1 : civil.year
    let era = (y >= 0 ? y : y - 399) / 400
    let yoe = y - era * 400
    let mp = (civil.month + 9) % 12
    let doy = (153 * mp + 2) / 5 + civil.day - 1
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
    return era * 146_097 + doe - 719_468
  }

  public static func civil(fromDayNumber days: Int) -> Civil {
    let z = days + 719_468
    let era = (z >= 0 ? z : z - 146_096) / 146_097
    let doe = z - era * 146_097
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
    let mp = (5 * doy + 2) / 153
    let day = doy - (153 * mp + 2) / 5 + 1
    let month = mp < 10 ? mp + 3 : mp - 9
    return Civil(year: yoe + era * 400 + (month <= 2 ? 1 : 0), month: month, day: day)
  }

  /// `iso` moved by `days` calendar days.
  public static func adding(_ days: Int, to iso: String) -> String {
    guard let civil = parse(iso) else { return iso }
    return format(self.civil(fromDayNumber: dayNumber(civil) + days))
  }

  /// Whole calendar days from `from` to `to` (negative when `to` is earlier).
  public static func daysBetween(_ from: String, _ to: String) -> Int {
    guard let start = parse(from), let end = parse(to) else { return 0 }
    return dayNumber(end) - dayNumber(start)
  }

  /// 0 is Sunday, 6 is Saturday.
  public static func weekday(_ iso: String) -> Int {
    guard let civil = parse(iso) else { return 0 }
    return ((dayNumber(civil) % 7) + 7 + 4) % 7
  }

  public static let monthsShort = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  public static let monthsLong = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
  public static let weekdaysShort = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
  public static let weekdaysLong = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

  /// "Sun, Oct 4".
  public static func dayLabel(_ iso: String) -> String {
    guard let civil = parse(iso) else { return iso }
    return "\(weekdaysShort[weekday(iso)]), \(monthsShort[civil.month - 1]) \(civil.day)"
  }

  /// "Sunday, October 4".
  public static func longDayLabel(_ iso: String) -> String {
    guard let civil = parse(iso) else { return iso }
    return "\(weekdaysLong[weekday(iso)]), \(monthsLong[civil.month - 1]) \(civil.day)"
  }

  /// "Oct 4".
  public static func shortDate(_ iso: String) -> String {
    guard let civil = parse(iso) else { return iso }
    return "\(monthsShort[civil.month - 1]) \(civil.day)"
  }

  // MARK: Wall-clock times

  /// True for a complete `HH:MM` string (00:00 through 24:00).
  public static func isTime(_ value: String) -> Bool {
    let bytes = Array(value.utf8)
    guard bytes.count == 5, bytes[2] == UInt8(ascii: ":"),
      let hours = Int(value.prefix(2)), let minutes = Int(value.suffix(2)),
      bytes[0...1].allSatisfy({ $0 >= 48 && $0 <= 57 }), bytes[3...4].allSatisfy({ $0 >= 48 && $0 <= 57 }) else { return false }
    return (hours < 24 && minutes < 60) || (hours == 24 && minutes == 0)
  }

  /// Minutes after midnight for `HH:MM`; nil when the text is not a time.
  public static func minutes(_ time: String) -> Int? {
    guard isTime(time), let hours = Int(time.prefix(2)), let minutes = Int(time.suffix(2)) else { return nil }
    return hours * 60 + minutes
  }

  /// `HH:MM` for minutes after midnight, clamped to 00:00 through 24:00.
  public static func time(fromMinutes total: Int) -> String {
    let clamped = max(0, min(24 * 60, total))
    return String(format: "%02d:%02d", clamped / 60, clamped % 60)
  }

  /// "7:59 PM"; 24:00 reads as "12:00 AM".
  public static func clock(_ time: String) -> String {
    guard let total = minutes(time) else { return time }
    let hours24 = (total / 60) % 24
    let meridiem = hours24 >= 12 ? "PM" : "AM"
    let hours12 = hours24 % 12 == 0 ? 12 : hours24 % 12
    return String(format: "%d:%02d %@", hours12, total % 60, meridiem)
  }

  /// "6 AM", "12 PM", and "12 AM" for the midnight that ends the day.
  public static func hourLabel(_ hour: Int) -> String {
    if hour == 24 { return "12 AM" }
    let meridiem = hour >= 12 ? "PM" : "AM"
    return "\(hour % 12 == 0 ? 12 : hour % 12) \(meridiem)"
  }

  // MARK: Account-local now

  /// The account-local date and minute for `instant` in `timeZone`.
  public static func local(_ instant: Date, in timeZone: TimeZone) -> (date: String, time: String) {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = timeZone
    let parts = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: instant)
    let date = format(Civil(year: parts.year ?? 1970, month: parts.month ?? 1, day: parts.day ?? 1))
    return (date, String(format: "%02d:%02d", parts.hour ?? 0, parts.minute ?? 0))
  }

  /// The instant at `time` on `date` in `timeZone` (24:00 is the next midnight).
  public static func instant(date: String, time: String, in timeZone: TimeZone) -> Date? {
    guard let civil = parse(date), let total = minutes(time) else { return nil }
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = timeZone
    guard let midnight = calendar.date(from: DateComponents(year: civil.year, month: civil.month, day: civil.day)) else { return nil }
    return calendar.date(byAdding: .minute, value: total, to: midnight)
  }

  /// Parses a Postgres or ISO 8601 timestamp, with or without fractional seconds.
  public static func timestamp(_ text: String) -> Date? {
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = fractional.date(from: text) { return date }
    let plain = ISO8601DateFormatter()
    plain.formatOptions = [.withInternetDateTime]
    if let date = plain.date(from: text) { return date }
    // Postgres can print a space instead of `T` and a short `+00` offset.
    var normalized = text.replacingOccurrences(of: " ", with: "T")
    if let range = normalized.range(of: #"[+-]\d{2}$"#, options: .regularExpression) {
      normalized.replaceSubrange(range, with: normalized[range] + ":00")
    }
    return fractional.date(from: normalized) ?? plain.date(from: normalized)
  }

  /// `2026-09-13T00:00:00.000Z`, the form JavaScript's `toISOString` prints.
  public static func isoString(_ date: Date) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    formatter.timeZone = TimeZone(identifier: "UTC")
    return formatter.string(from: date)
  }
}
