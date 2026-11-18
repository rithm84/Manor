import Foundation

/// Reads what someone types into a date field: ISO and numeric dates, month names, relative words ("today",
/// "tomorrow", "next week", "in 3 days", "+2w"), and weekday names ("fri" is the coming Friday, or today on a Friday).
public enum DateTextParser {
  /// `dayFirst` follows the reader's locale (15/11 rather than 11/15); a first number above 12 is a day either way.
  public static func parse(_ text: String, today: CivilDate, dayFirst: Bool = false) -> CivilDate? {
    let input = text.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
      .replacingOccurrences(of: ",", with: " ")
    guard !input.isEmpty else { return nil }
    if let relative = relative(input, today: today) { return relative }
    if let weekday = weekday(input, today: today) { return weekday }
    if let iso = CivilDate(input) { return iso }
    if let numeric = numeric(input, today: today, dayFirst: dayFirst) { return numeric }
    return named(input, today: today)
  }

  /// Whether the locale writes the day before the month.
  public static func localeIsDayFirst(_ locale: Locale = .current) -> Bool {
    guard let format = DateFormatter.dateFormat(fromTemplate: "Md", options: 0, locale: locale),
          let d = format.firstIndex(of: "d"), let m = format.firstIndex(of: "M") else { return false }
    return d < m
  }

  private static let monthNames = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"]
  private static let weekdayNames = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]

  private static func relative(_ input: String, today: CivilDate) -> CivilDate? {
    switch input {
    case "today", "tod", "now": return today
    case "tomorrow", "tmrw", "tmr", "tom": return today.adding(days: 1)
    case "yesterday", "yest": return today.adding(days: -1)
    case "next week": return today.adding(days: 7)
    case "last week": return today.adding(days: -7)
    case "next month": return today.adding(months: 1)
    case "last month": return today.adding(months: -1)
    case "next year": return today.adding(months: 12)
    default: break
    }
    // "+3", "-2", "+2w", "3d", "in 3 days", "2 weeks", "in 1 month", "3 days ago".
    var rest = input
    var sign = 1
    if rest.hasPrefix("in ") { rest.removeFirst(3) }
    if rest.hasSuffix(" ago") { rest.removeLast(4); sign = -1 }
    if rest.hasPrefix("+") { rest.removeFirst() } else if rest.hasPrefix("-") { rest.removeFirst(); sign = -sign }
    rest = rest.trimmingCharacters(in: .whitespaces)
    let digits = rest.prefix { $0.isNumber }
    guard !digits.isEmpty, let count = Int(digits), count <= 3660 else { return nil }
    let unit = rest.dropFirst(digits.count).trimmingCharacters(in: .whitespaces)
    let explicitSign = input.hasPrefix("+") || input.hasPrefix("-") || input.hasPrefix("in ") || input.hasSuffix(" ago")
    switch unit {
    case "d", "day", "days": return today.adding(days: sign * count)
    case "w", "wk", "wks", "week", "weeks": return today.adding(days: sign * count * 7)
    case "m", "mo", "mos", "month", "months": return today.adding(months: sign * count)
    case "y", "yr", "yrs", "year", "years": return today.adding(months: sign * count * 12)
    case "": return explicitSign ? today.adding(days: sign * count) : nil
    default: return nil
    }
  }

  private static func weekday(_ input: String, today: CivilDate) -> CivilDate? {
    var word = input
    var strictlyAfter = false
    if word.hasPrefix("next ") { word.removeFirst(5); strictlyAfter = true }
    else if word.hasPrefix("this ") { word.removeFirst(5) }
    // One letter is ambiguous ("t", "s"); two settle every weekday.
    guard word.count >= 2, let index = weekdayNames.firstIndex(where: { $0.hasPrefix(word) }) else { return nil }
    var offset = (index + 1 - today.weekday + 7) % 7
    if strictlyAfter && offset == 0 { offset = 7 }
    return today.adding(days: offset)
  }

  private static func numeric(_ input: String, today: CivilDate, dayFirst: Bool) -> CivilDate? {
    let separators = CharacterSet(charactersIn: "/.- ")
    let parts = input.components(separatedBy: separators).filter { !$0.isEmpty }
    let numbers = parts.compactMap { $0.allSatisfy(\.isNumber) ? Int($0) : nil }
    guard (1...3).contains(parts.count), numbers.count == parts.count else { return nil }
    if parts.count == 1 {
      // A bare day of the current month.
      guard parts[0].count <= 2 else { return nil }
      return CivilDate(year: today.year, month: today.month, day: numbers[0])
    }
    if parts[0].count == 4, parts.count == 3 { return CivilDate(year: numbers[0], month: numbers[1], day: numbers[2]) }
    var month = numbers[0]
    var day = numbers[1]
    if dayFirst || month > 12 { swap(&month, &day) }
    if month > 12, day <= 12 { swap(&month, &day) }
    let year = parts.count == 3 ? fullYear(numbers[2], digits: parts[2].count) : today.year
    guard let year else { return nil }
    return CivilDate(year: year, month: month, day: day)
  }

  private static func named(_ input: String, today: CivilDate) -> CivilDate? {
    let tokens = input.split(whereSeparator: { $0 == " " || $0 == "/" || $0 == "-" || $0 == "." }).map(String.init)
    guard (2...3).contains(tokens.count) else { return nil }
    var month: Int?
    var numbers: [(value: Int, digits: Int)] = []
    for token in tokens {
      if token.first?.isLetter == true {
        guard month == nil, token.count >= 3, let index = monthNames.firstIndex(where: { $0.hasPrefix(token) }) else { return nil }
        month = index + 1
      } else {
        let digits = token.prefix { $0.isNumber }
        let suffix = token.dropFirst(digits.count)
        guard !digits.isEmpty, ["", "st", "nd", "rd", "th"].contains(suffix), let value = Int(digits) else { return nil }
        numbers.append((value, digits.count))
      }
    }
    guard let month, let day = numbers.first, day.digits <= 2 else { return nil }
    var year = today.year
    if numbers.count == 2 {
      guard let full = fullYear(numbers[1].value, digits: numbers[1].digits) else { return nil }
      year = full
    }
    return CivilDate(year: year, month: month, day: day.value)
  }

  private static func fullYear(_ value: Int, digits: Int) -> Int? {
    switch digits {
    case 2: return 2000 + value
    case 4: return value
    default: return nil
    }
  }
}

/// A time of day in minutes after midnight, stored by Manor as `HH:MM`.
public struct ClockTime: Hashable, Comparable, Sendable, CustomStringConvertible {
  public let minutes: Int

  public init?(minutes: Int) {
    guard (0..<24 * 60).contains(minutes) else { return nil }
    self.minutes = minutes
  }

  public init?(hour: Int, minute: Int) {
    guard (0...23).contains(hour), (0...59).contains(minute) else { return nil }
    self.minutes = hour * 60 + minute
  }

  /// A strict `HH:MM` (seconds, if present, are ignored).
  public init?(_ string: String) {
    let parts = string.split(separator: ":")
    guard parts.count >= 2, parts[0].count == 2, parts[1].count == 2, let hour = Int(parts[0]), let minute = Int(parts[1]) else { return nil }
    self.init(hour: hour, minute: minute)
  }

  public var hour: Int { minutes / 60 }
  public var minute: Int { minutes % 60 }
  public var string: String { String(format: "%02d:%02d", hour, minute) }
  public var description: String { string }

  /// "5:30 PM" or "17:30".
  public func label(twentyFourHour: Bool) -> String {
    if twentyFourHour { return String(format: "%02d:%02d", hour, minute) }
    let h12 = hour % 12 == 0 ? 12 : hour % 12
    return String(format: "%d:%02d %@", h12, minute, hour < 12 ? "AM" : "PM")
  }

  /// Whether the system shows times on a 24-hour clock.
  public static func systemUsesTwentyFourHour(_ locale: Locale = .current) -> Bool {
    let format = DateFormatter.dateFormat(fromTemplate: "j", options: 0, locale: locale) ?? ""
    return !format.contains("a")
  }

  public static func < (lhs: ClockTime, rhs: ClockTime) -> Bool { lhs.minutes < rhs.minutes }
}

/// Reads typed times: "5:30 pm", "5:30p", "5pm", "530p", "17:30", "1730", "17", "noon", "midnight".
public enum TimeTextParser {
  public static func parse(_ text: String) -> ClockTime? {
    var input = text.trimmingCharacters(in: .whitespacesAndNewlines).lowercased().replacingOccurrences(of: " ", with: "")
    guard !input.isEmpty else { return nil }
    switch input {
    case "noon", "midday": return ClockTime(hour: 12, minute: 0)
    case "midnight": return ClockTime(hour: 0, minute: 0)
    default: break
    }
    var meridiem: Character?
    for suffix in ["a.m.", "p.m.", "am", "pm", "a", "p"] where input.hasSuffix(suffix) {
      meridiem = suffix.first
      input.removeLast(suffix.count)
      break
    }
    guard !input.isEmpty else { return nil }
    var hour: Int
    var minute = 0
    if let separator = input.firstIndex(where: { $0 == ":" || $0 == "." || $0 == "h" }) {
      let h = input[..<separator]
      let m = input[input.index(after: separator)...]
      guard (1...2).contains(h.count), h.allSatisfy(\.isNumber), m.count <= 2, m.allSatisfy(\.isNumber),
            let hv = Int(h) else { return nil }
      hour = hv
      minute = m.isEmpty ? 0 : (Int(m) ?? 0) * (m.count == 1 ? 10 : 1)
    } else {
      guard input.allSatisfy(\.isNumber), let value = Int(input) else { return nil }
      switch input.count {
      case 1, 2: hour = value
      case 3, 4:
        hour = value / 100
        minute = value % 100
      default: return nil
      }
    }
    if let meridiem {
      guard (1...12).contains(hour) else { return nil }
      if meridiem == "a" { hour = hour == 12 ? 0 : hour } else { hour = hour == 12 ? 12 : hour + 12 }
    }
    return ClockTime(hour: hour, minute: minute)
  }
}

/// The choices a time list offers.
public enum TimeOptions {
  /// Every `step` minutes from `start` through `end` (inclusive, minutes after midnight), with `current` added
  /// in order when it falls between steps so the list can still center it.
  public static func list(step: Int = 15, start: Int = 0, end: Int = 24 * 60 - 1, including current: ClockTime? = nil) -> [ClockTime] {
    guard step > 0, start <= end else { return [] }
    var times = stride(from: start, through: end, by: step).compactMap { ClockTime(minutes: $0) }
    if let current, current.minutes >= start, current.minutes <= end, !times.contains(current) {
      let index = times.firstIndex { $0 > current } ?? times.endIndex
      times.insert(current, at: index)
    }
    return times
  }

  /// The option nearest to `time`, for highlighting while someone types.
  public static func nearest(to time: ClockTime, in options: [ClockTime]) -> ClockTime? {
    options.min { abs($0.minutes - time.minutes) < abs($1.minutes - time.minutes) }
  }
}
