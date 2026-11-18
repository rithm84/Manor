import Foundation

/// A source-reported date at its original precision. Coarse dates are intervals, never pinned to a fake day.
public struct ProblemSourceDate: Sendable, Hashable {
  public enum Precision: String, Sendable, Hashable { case day, month, year, instant }
  public var value: String
  public var precision: Precision

  public init(value: String, precision: Precision) {
    self.value = value
    self.precision = precision
  }

  /// A valid date at its stated precision, or nil.
  public static func parse(_ json: JSONValue?) -> ProblemSourceDate? {
    guard let object = json?.object, let value = object["value"]?.string,
          let precision = object["precision"]?.string.flatMap(Precision.init(rawValue:)) else { return nil }
    let date = ProblemSourceDate(value: value, precision: precision)
    return date.isValid ? date : nil
  }

  var isValid: Bool {
    switch precision {
    case .year: return value.count == 4 && Self.validDay("\(value)-01-01")
    case .month: return value.count == 7 && Self.validDay("\(value)-01")
    case .day: return Self.validDay(value)
    case .instant: return Self.instant(value) != nil
    }
  }

  /// The first and last calendar day the date covers, as `YYYY-MM-DD`. Instants read as their UTC day.
  public var bounds: (from: String, through: String) {
    switch precision {
    case .day: return (value, value)
    case .year: return ("\(value)-01-01", "\(value)-12-31")
    case .instant:
      guard let date = Self.instant(value) else { return (value, value) }
      let day = Self.utcDay.string(from: date)
      return (day, day)
    case .month:
      let bytes = Array(value.utf8)
      guard bytes.count == 7, let year = Self.number(bytes[0..<4]), let month = Self.number(bytes[5..<7]), (1...12).contains(month) else {
        return ("\(value)-01", "\(value)-31")
      }
      return ("\(value)-01", "\(value)-\(Self.daysIn(month: month, year: year))")
    }
  }

  /// The date parsed from an ISO 8601 instant with an explicit offset.
  public static func instant(_ value: String) -> Date? {
    guard value.count >= 11, value.contains("T") else { return nil }
    return isoWithFraction.date(from: value) ?? isoPlain.date(from: value)
  }

  private static let isoWithFraction: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
  }()

  private static let isoPlain: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    return formatter
  }()

  static let utc: Calendar = {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "UTC")!
    return calendar
  }()

  static let utcDay: DateFormatter = {
    let formatter = DateFormatter()
    formatter.calendar = utc
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(identifier: "UTC")
    formatter.dateFormat = "yyyy-MM-dd"
    return formatter
  }()

  /// A real `YYYY-MM-DD` calendar date, checked arithmetically (a library load checks thousands).
  public static func validDay(_ value: String) -> Bool {
    let bytes = Array(value.utf8)
    guard bytes.count == 10, bytes[4] == 45, bytes[7] == 45, bytes[0] != 48,
          let year = number(bytes[0..<4]), let month = number(bytes[5..<7]), let day = number(bytes[8..<10]),
          (1...12).contains(month) else { return false }
    return (1...daysIn(month: month, year: year)).contains(day)
  }

  static func number(_ digits: ArraySlice<UInt8>) -> Int? {
    var value = 0
    for digit in digits {
      guard (48...57).contains(digit) else { return nil }
      value = value * 10 + Int(digit - 48)
    }
    return value
  }

  static func daysIn(month: Int, year: Int) -> Int {
    switch month {
    case 2: return (year % 4 == 0 && year % 100 != 0) || year % 400 == 0 ? 29 : 28
    case 4, 6, 9, 11: return 30
    default: return 31
    }
  }
}

public enum ProblemReportWindow: String, Sendable, CaseIterable, Hashable {
  case days30 = "30d", months3 = "3m", months6 = "6m", year1 = "1y", all, olderThan6Months = "older_than_6m"

  /// Shorter windows rank first among reports of the same snapshot, because they say more about recency.
  public var order: Int {
    switch self {
    case .days30: return 0
    case .months3: return 1
    case .months6: return 2
    case .year1: return 3
    case .olderThan6Months: return 4
    case .all: return 5
    }
  }

  public var label: String {
    switch self {
    case .days30: return "Last 30 days"
    case .months3: return "Last 3 months"
    case .months6: return "Last 6 months"
    case .year1: return "Last year"
    case .all: return "All time"
    case .olderThan6Months: return "6+ months ago"
    }
  }
}

public struct ProblemCompanyReport: Sendable, Hashable {
  public var company: String
  public var window: ProblemReportWindow
  public var frequency: Double?
  public var acceptance: Double?
  public var snapshotDate: String
  public var sourceUrl: String
  public var sourceRevision: String

  public init(company: String, window: ProblemReportWindow, frequency: Double? = nil, acceptance: Double? = nil, snapshotDate: String, sourceUrl: String, sourceRevision: String = "") {
    self.company = company
    self.window = window
    self.frequency = frequency
    self.acceptance = acceptance
    self.snapshotDate = snapshotDate
    self.sourceUrl = sourceUrl
    self.sourceRevision = sourceRevision
  }
}

public struct ProblemSourceSnapshot: Sendable, Hashable {
  public var sourceUrl: String
  public var snapshotDate: String
  public var revision: String?

  public init(sourceUrl: String, snapshotDate: String, revision: String? = nil) {
    self.sourceUrl = sourceUrl
    self.snapshotDate = snapshotDate
    self.revision = revision
  }
}

/// Source recency and provenance: the reported last-asked date, reporting range, frequency, report count,
/// and the company datasets with their snapshot dates and windows.
public struct ProblemSourceMetadata: Sendable, Hashable {
  public enum DifficultySource: String, Sendable, Hashable { case official, estimated }
  public var lastAsked: ProblemSourceDate?
  public var reportedFrom: ProblemSourceDate?
  public var reportedTo: ProblemSourceDate?
  public var frequency: String?
  public var reportCount: Int?
  public var difficultySource: DifficultySource?
  public var isNew: Bool?
  public var durationMinutes: Int?
  public var status: String?
  public var snapshots: [ProblemSourceSnapshot]?
  public var companyReports: [ProblemCompanyReport]?

  public init(
    lastAsked: ProblemSourceDate? = nil, reportedFrom: ProblemSourceDate? = nil, reportedTo: ProblemSourceDate? = nil,
    frequency: String? = nil, reportCount: Int? = nil, difficultySource: DifficultySource? = nil, isNew: Bool? = nil,
    durationMinutes: Int? = nil, status: String? = nil, snapshots: [ProblemSourceSnapshot]? = nil, companyReports: [ProblemCompanyReport]? = nil
  ) {
    self.lastAsked = lastAsked
    self.reportedFrom = reportedFrom
    self.reportedTo = reportedTo
    self.frequency = frequency
    self.reportCount = reportCount
    self.difficultySource = difficultySource
    self.isNew = isNew
    self.durationMinutes = durationMinutes
    self.status = status
    self.snapshots = snapshots
    self.companyReports = companyReports
  }

  /// Parses `source_metadata`. Values that fail their own validation are left out rather than guessed.
  public static func parse(_ json: JSONValue?) -> ProblemSourceMetadata? {
    guard let object = json?.object else { return nil }
    func text(_ key: String) -> String? {
      guard let value = object[key]?.string?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else { return nil }
      return value
    }
    func count(_ key: String) -> Int? { object[key]?.int.flatMap { $0 >= 0 ? $0 : nil } }
    let snapshots = object["snapshots"]?.array?.compactMap { item -> ProblemSourceSnapshot? in
      guard let url = item["sourceUrl"]?.string, let date = item["snapshotDate"]?.string, ProblemSourceDate.validDay(date) else { return nil }
      return ProblemSourceSnapshot(sourceUrl: url, snapshotDate: date, revision: item["revision"]?.string)
    }
    let reports = object["companyReports"]?.array?.compactMap { item -> ProblemCompanyReport? in
      guard let company = item["company"]?.string, let window = item["window"]?.string.flatMap(ProblemReportWindow.init(rawValue:)),
            let date = item["snapshotDate"]?.string, ProblemSourceDate.validDay(date), let url = item["sourceUrl"]?.string else { return nil }
      return ProblemCompanyReport(
        company: company, window: window, frequency: item["frequency"]?.double, acceptance: item["acceptance"]?.double,
        snapshotDate: date, sourceUrl: url, sourceRevision: item["sourceRevision"]?.string ?? ""
      )
    }
    return ProblemSourceMetadata(
      lastAsked: ProblemSourceDate.parse(object["lastAsked"]), reportedFrom: ProblemSourceDate.parse(object["reportedFrom"]),
      reportedTo: ProblemSourceDate.parse(object["reportedTo"]), frequency: text("frequency"), reportCount: count("reportCount"),
      difficultySource: object["difficultySource"]?.string.flatMap(DifficultySource.init(rawValue:)), isNew: object["isNew"]?.bool,
      durationMinutes: count("durationMinutes"), status: text("status"), snapshots: snapshots, companyReports: reports
    )
  }

  /// Whether any scalar fact is present (the facts list of the source details).
  public var hasFacts: Bool {
    lastAsked != nil || reportedFrom != nil || reportedTo != nil || frequency != nil || reportCount != nil
      || durationMinutes != nil || status != nil || isNew == true
  }

  /// Company reports newest snapshot first, then by company and window.
  public var sortedReports: [ProblemCompanyReport] {
    (companyReports ?? []).sorted {
      if $0.snapshotDate != $1.snapshotDate { return $0.snapshotDate > $1.snapshotDate }
      if $0.company != $1.company { return $0.company.localizedCompare($1.company) == .orderedAscending }
      return $0.window.order < $1.window.order
    }
  }

  /// The report a problem's recency reads when it has no asked date: the newest snapshot, then the shortest window.
  public static func latestReport(_ reports: [ProblemCompanyReport]) -> ProblemCompanyReport? {
    reports.reduce(nil) { latest, current in
      guard let latest else { return current }
      if current.snapshotDate > latest.snapshotDate || (current.snapshotDate == latest.snapshotDate && current.window.order < latest.window.order) {
        return current
      }
      return latest
    }
  }
}

/// Reader-facing labels for source dates. Date-only values keep their recorded precision and never shift with time zones.
public enum ProblemDateLabels {
  private static func formatter(_ format: String, zone: TimeZone = TimeZone(identifier: "UTC")!) -> DateFormatter {
    let formatter = DateFormatter()
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.locale = Locale(identifier: "en_US")
    formatter.timeZone = zone
    formatter.setLocalizedDateFormatFromTemplate(format)
    return formatter
  }

  private static let monthYear = formatter("MMMyyyy")
  private static let dayFormatter = formatter("MMMdyyyy")

  /// "Mar 4, 2026" for a `YYYY-MM-DD` day.
  public static func day(_ value: String) -> String {
    guard let date = ProblemSourceDate.utcDay.date(from: value) else { return value }
    return dayFormatter.string(from: date)
  }

  /// A source date at its own precision: "2026", "Mar 2026", "Mar 4, 2026", or a full UTC time for an instant.
  public static func label(_ value: ProblemSourceDate) -> String {
    switch value.precision {
    case .year: return value.value
    case .month:
      guard let date = ProblemSourceDate.utcDay.date(from: "\(value.value)-01") else { return value.value }
      return monthYear.string(from: date)
    case .day: return day(value.value)
    case .instant:
      guard let date = ProblemSourceDate.instant(value.value) else { return value.value }
      let full = formatter("MMMdyyyyhmmz")
      return full.string(from: date)
    }
  }

  /// The one-line label a table cell shows: an instant reads as its day in `zone`.
  public static func compactLabel(_ value: ProblemSourceDate, in zone: TimeZone) -> String {
    guard value.precision == .instant, let date = ProblemSourceDate.instant(value.value) else { return label(value) }
    return formatter("MMMdyyyy", zone: zone).string(from: date)
  }
}
