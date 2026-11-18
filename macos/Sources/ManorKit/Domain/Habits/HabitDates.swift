import Foundation

/// Calendar arithmetic on account-local `YYYY-MM-DD` strings. Habit days are civil dates with no time
/// zone of their own, so the math runs on day numbers (days since 1970-01-01) rather than `Date`.
public enum HabitDates {
  /// The day number of a valid `YYYY-MM-DD` string, or nil when it is not a real calendar date.
  public static func dayNumber(_ date: String) -> Int? {
    let utf8 = Array(date.utf8)
    guard utf8.count == 10, utf8[4] == 45, utf8[7] == 45 else { return nil }
    func digits(_ range: Range<Int>) -> Int? {
      var value = 0
      for index in range {
        let byte = utf8[index]
        guard byte >= 48, byte <= 57 else { return nil }
        value = value * 10 + Int(byte - 48)
      }
      return value
    }
    guard let year = digits(0..<4), let month = digits(5..<7), let day = digits(8..<10),
      (1...12).contains(month), day >= 1, day <= daysIn(year: year, month: month) else { return nil }
    return daysFromCivil(year: year, month: month, day: day)
  }

  /// The `YYYY-MM-DD` string for a day number.
  public static func string(dayNumber: Int) -> String {
    let (year, month, day) = civilFromDays(dayNumber)
    return String(format: "%04d-%02d-%02d", year, month, day)
  }

  public static func isValid(_ date: String) -> Bool { dayNumber(date) != nil }

  /// `date` moved by `amount` days. An invalid date comes back unchanged.
  public static func addDays(_ date: String, _ amount: Int) -> String {
    guard let number = dayNumber(date) else { return date }
    return string(dayNumber: number + amount)
  }

  /// Whole days from `start` to `end` (negative when `end` is earlier).
  public static func daysBetween(_ start: String, _ end: String) -> Int {
    guard let first = dayNumber(start), let last = dayNumber(end) else { return 0 }
    return last - first
  }

  /// `YYYY-MM` for a date.
  public static func monthKey(_ date: String) -> String { String(date.prefix(7)) }

  /// The month `amount` months after `month` (`YYYY-MM`).
  public static func monthShift(_ month: String, _ amount: Int) -> String {
    guard let (year, monthNumber) = parseMonth(month) else { return month }
    let total = year * 12 + (monthNumber - 1) + amount
    let shiftedYear = Int((Double(total) / 12).rounded(.down))
    return String(format: "%04d-%02d", shiftedYear, total - shiftedYear * 12 + 1)
  }

  public static func daysInMonth(_ month: String) -> Int {
    guard let (year, monthNumber) = parseMonth(month) else { return 30 }
    return daysIn(year: year, month: monthNumber)
  }

  /// Every date of a month in order.
  public static func dates(inMonth month: String) -> [String] {
    (1...daysInMonth(month)).map { "\(month)-\(String(format: "%02d", $0))" }
  }

  /// Monday-based weekday index: Monday is 0, Sunday is 6.
  public static func weekdayIndex(_ date: String) -> Int {
    guard let number = dayNumber(date) else { return 0 }
    return ((number + 3) % 7 + 7) % 7
  }

  /// The Monday that starts the week holding `date`.
  public static func startOfWeek(_ date: String) -> String { addDays(date, -weekdayIndex(date)) }

  // MARK: Labels

  /// "Today", "Yesterday", or "Aug 5".
  public static func dayLabel(_ date: String, today: String) -> String {
    if date == today { return "Today" }
    if date == addDays(today, -1) { return "Yesterday" }
    return format(date, "MMM d")
  }

  /// "Wednesday, August 5".
  public static func fullDateLabel(_ date: String) -> String { format(date, "EEEE, MMMM d") }

  /// "August 2026".
  public static func monthLabel(_ month: String) -> String { format("\(month)-01", "MMMM yyyy") }

  /// "Aug".
  public static func shortMonthLabel(_ month: String) -> String { format("\(month)-01", "MMM") }

  private static func format(_ date: String, _ pattern: String) -> String {
    guard let number = dayNumber(date) else { return date }
    return DisplayDates.string(Date(timeIntervalSince1970: TimeInterval(number) * 86_400), pattern)
  }

  // MARK: Civil calendar

  private static func parseMonth(_ month: String) -> (Int, Int)? {
    let parts = month.split(separator: "-")
    guard parts.count == 2, parts[0].count == 4, parts[1].count == 2,
      let year = Int(parts[0]), let monthNumber = Int(parts[1]), (1...12).contains(monthNumber) else { return nil }
    return (year, monthNumber)
  }

  private static func daysIn(year: Int, month: Int) -> Int {
    switch month {
    case 2: return (year % 4 == 0 && year % 100 != 0) || year % 400 == 0 ? 29 : 28
    case 4, 6, 9, 11: return 30
    default: return 31
    }
  }

  private static func daysFromCivil(year: Int, month: Int, day: Int) -> Int {
    let y = month <= 2 ? year - 1 : year
    let era = (y >= 0 ? y : y - 399) / 400
    let yearOfEra = y - era * 400
    let shiftedMonth = (month + 9) % 12
    let dayOfYear = (153 * shiftedMonth + 2) / 5 + day - 1
    let dayOfEra = yearOfEra * 365 + yearOfEra / 4 - yearOfEra / 100 + dayOfYear
    return era * 146_097 + dayOfEra - 719_468
  }

  private static func civilFromDays(_ days: Int) -> (Int, Int, Int) {
    let z = days + 719_468
    let era = (z >= 0 ? z : z - 146_096) / 146_097
    let dayOfEra = z - era * 146_097
    let yearOfEra = (dayOfEra - dayOfEra / 1460 + dayOfEra / 36_524 - dayOfEra / 146_096) / 365
    let dayOfYear = dayOfEra - (365 * yearOfEra + yearOfEra / 4 - yearOfEra / 100)
    let shiftedMonth = (5 * dayOfYear + 2) / 153
    let day = dayOfYear - (153 * shiftedMonth + 2) / 5 + 1
    let month = shiftedMonth < 10 ? shiftedMonth + 3 : shiftedMonth - 9
    let year = yearOfEra + era * 400 + (month <= 2 ? 1 : 0)
    return (year, month, day)
  }
}
