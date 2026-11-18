import Foundation

/// Dates as people read them: every label follows the Mac's region (order, month names, 12 or 24 hours), so
/// "Fri, Nov 20" in the United States reads "Fri 20 Nov" in the United Kingdom on every page alike. Patterns
/// are written as US-style examples ("EEE, MMM d"); their letters become a localized template. Machine
/// formats (ISO days, storage) never come through here.
public enum DisplayDates {
  nonisolated(unsafe) private static var cache: [String: DateFormatter] = [:]
  private static let lock = NSLock()

  /// A cached formatter for `pattern` in `timeZone` (UTC by default, for civil dates stored as days).
  public static func formatter(_ pattern: String, timeZone: TimeZone = TimeZone(identifier: "UTC")!) -> DateFormatter {
    let template = template(for: pattern)
    let key = "\(template)|\(timeZone.identifier)|\(Locale.current.identifier)"
    lock.lock()
    defer { lock.unlock() }
    if let cached = cache[key] { return cached }
    let formatter = DateFormatter()
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.locale = .current
    formatter.timeZone = timeZone
    formatter.setLocalizedDateFormatFromTemplate(template)
    cache[key] = formatter
    return formatter
  }

  public static func string(_ date: Date, _ pattern: String, timeZone: TimeZone = TimeZone(identifier: "UTC")!) -> String {
    let formatter = formatter(pattern, timeZone: timeZone)
    lock.lock()
    defer { lock.unlock() }
    // The region formats put a narrow no-break space before "AM"; Manor's text uses ordinary spaces.
    return formatter.string(from: date).replacingOccurrences(of: "\u{202F}", with: " ")
  }

  /// "EEE, MMM d, h:mm a" -> "EEEMMMdjmm": the pattern's field letters, with the hour as the region's choice
  /// of 12 or 24 hours.
  static func template(for pattern: String) -> String {
    var letters = pattern.filter(\.isLetter)
    if letters.contains("h") || letters.contains("a") {
      letters = letters.replacingOccurrences(of: "a", with: "").replacingOccurrences(of: "hh", with: "j").replacingOccurrences(of: "h", with: "j")
    }
    return letters
  }
}
