import Foundation

/// Where a role stands in the pipeline, in board order.
public enum JobStage: String, CaseIterable, Codable, Sendable, Hashable, Identifiable {
  case toApply = "to_apply"
  case applied
  case oa
  case interview1 = "interview_1"
  case interview2 = "interview_2"
  case interview3 = "interview_3"
  case offer
  case rejected

  public var id: String { rawValue }

  /// The name the board, menus, and dialogs show.
  public var label: String {
    switch self {
    case .toApply: return "To apply"
    case .applied: return "Applied"
    case .oa: return "OA"
    case .interview1: return "Interview 1"
    case .interview2: return "Interview 2"
    case .interview3: return "Interview 3"
    case .offer: return "Offer"
    case .rejected: return "Rejected"
    }
  }

  /// The tone of the stage's option in pickers.
  public var tone: JobTone {
    switch self {
    case .toApply: return .neutral
    case .applied: return .forest
    case .oa: return .today
    case .interview1, .interview2, .interview3: return .plum
    case .offer: return .success
    case .rejected: return .overdue
    }
  }

  /// The board column the stage sits in. Interviews and outcomes share a column.
  public var column: JobColumn {
    switch self {
    case .toApply: return .toApply
    case .applied: return .applied
    case .oa: return .oa
    case .interview1, .interview2, .interview3: return .interview
    case .offer, .rejected: return .decided
    }
  }

  /// The date that records arriving at this stage. A move leads with it.
  public var dateField: JobDateField {
    switch self {
    case .toApply: return .datePosted
    case .applied: return .appliedDate
    case .oa: return .oaDueDate
    case .interview1: return .interview1Date
    case .interview2: return .interview2Date
    case .interview3: return .interview3Date
    case .offer, .rejected: return .decisionDate
    }
  }
}

/// Semantic tones for job pills and stage marks. The app maps each to its palette roles.
public enum JobTone: String, Sendable, Hashable {
  case today, tomorrow, week, neutral, gold, plum, success, info, forest, overdue
}

/// The dated properties of a role, in the order the dialog lists them.
public enum JobDateField: String, CaseIterable, Sendable, Hashable, Identifiable {
  case datePosted, appliedDate, oaDueDate, oaCompletedDate, interview1Date, interview2Date, interview3Date, decisionDate

  public var id: String { rawValue }

  public var label: String {
    switch self {
    case .datePosted: return "Date posted"
    case .appliedDate: return "Applied date"
    case .oaDueDate: return "OA due date"
    case .oaCompletedDate: return "OA completed date"
    case .interview1Date: return "Round 1 interview date"
    case .interview2Date: return "Round 2 interview date"
    case .interview3Date: return "Round 3 interview date"
    case .decisionDate: return "Decision date"
    }
  }
}

/// A validation failure for a role's fields, worded for the reader.
public struct JobValidationError: LocalizedError, Equatable, Sendable {
  public let field: String
  public let message: String
  public init(_ field: String, _ message: String) {
    self.field = field
    self.message = message
  }
  public var errorDescription: String? { message }
}

/// The editable schema every role shares, whatever its stage. Unset values are nil (or empty text).
public struct JobRoleFields: Equatable, Hashable, Sendable {
  public var company: String
  public var role: String
  public var location: String
  public var postingLink: String
  public var datePosted: String?
  public var stage: JobStage
  public var appliedDate: String?
  public var oaDueDate: String?
  public var oaCompletedDate: String?
  public var interview1Date: String?
  public var interview2Date: String?
  public var interview3Date: String?
  public var decisionDate: String?
  /// The resume version (a private file id) the application was sent with.
  public var resumeId: String?
  /// Hiring cycle, for example "Summer 2027".
  public var term: String?

  public init(
    company: String = "", role: String = "", location: String = "", postingLink: String = "", datePosted: String? = nil,
    stage: JobStage = .toApply, appliedDate: String? = nil, oaDueDate: String? = nil, oaCompletedDate: String? = nil,
    interview1Date: String? = nil, interview2Date: String? = nil, interview3Date: String? = nil, decisionDate: String? = nil,
    resumeId: String? = nil, term: String? = nil
  ) {
    self.company = company
    self.role = role
    self.location = location
    self.postingLink = postingLink
    self.datePosted = datePosted
    self.stage = stage
    self.appliedDate = appliedDate
    self.oaDueDate = oaDueDate
    self.oaCompletedDate = oaCompletedDate
    self.interview1Date = interview1Date
    self.interview2Date = interview2Date
    self.interview3Date = interview3Date
    self.decisionDate = decisionDate
    self.resumeId = resumeId
    self.term = term
  }

  /// Blank fields for a new role at `stage`. Dates stay unset until entered.
  public static func empty(stage: JobStage = .toApply) -> JobRoleFields { JobRoleFields(stage: stage) }

  public subscript(date field: JobDateField) -> String? {
    get {
      switch field {
      case .datePosted: return datePosted
      case .appliedDate: return appliedDate
      case .oaDueDate: return oaDueDate
      case .oaCompletedDate: return oaCompletedDate
      case .interview1Date: return interview1Date
      case .interview2Date: return interview2Date
      case .interview3Date: return interview3Date
      case .decisionDate: return decisionDate
      }
    }
    set {
      switch field {
      case .datePosted: datePosted = newValue
      case .appliedDate: appliedDate = newValue
      case .oaDueDate: oaDueDate = newValue
      case .oaCompletedDate: oaCompletedDate = newValue
      case .interview1Date: interview1Date = newValue
      case .interview2Date: interview2Date = newValue
      case .interview3Date: interview3Date = newValue
      case .decisionDate: decisionDate = newValue
      }
    }
  }

  static let maxNameLength = 160
  /// Catalog listings name every office a posting hires for, so this is wider than a typed value needs.
  static let maxLocationLength = 1000
  static let maxLinkLength = 2000

  /// The fields trimmed and checked the way the server and the web app check them. An empty hiring cycle
  /// becomes nil and a blank resume reference is refused.
  public func validated() throws -> JobRoleFields {
    var fields = self
    fields.company = try Self.required(company, "Company", Self.maxNameLength)
    fields.role = try Self.required(role, "Role", Self.maxNameLength)
    fields.location = try Self.optional(location, "Location", Self.maxLocationLength)
    fields.postingLink = try Self.link(postingLink)
    for field in JobDateField.allCases {
      if let value = fields[date: field] {
        guard JobDates.isValid(value) else { throw JobValidationError(field.rawValue, "\(field.label) must be a real calendar date.") }
      }
    }
    if let resumeId {
      let trimmed = resumeId.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !trimmed.isEmpty else { throw JobValidationError("resumeId", "Choose a resume version or none.") }
      fields.resumeId = trimmed
    }
    if let term {
      let trimmed = try Self.optional(term, "Hiring cycle", Self.maxNameLength)
      fields.term = trimmed.isEmpty ? nil : trimmed
    }
    return fields
  }

  private static func required(_ value: String, _ label: String, _ limit: Int) throws -> String {
    let text = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { throw JobValidationError(label, "\(label) is required.") }
    guard text.count <= limit else { throw JobValidationError(label, "\(label) must be \(limit) characters or fewer.") }
    return text
  }

  private static func optional(_ value: String, _ label: String, _ limit: Int) throws -> String {
    let text = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard text.count <= limit else { throw JobValidationError(label, "\(label) must be \(limit) characters or fewer.") }
    return text
  }

  private static func link(_ value: String) throws -> String {
    let text = try optional(value, "Posting link", maxLinkLength)
    if text.isEmpty { return text }
    guard let url = URL(string: text), let scheme = url.scheme?.lowercased(), url.host?.isEmpty == false else {
      throw JobValidationError("postingLink", "The posting link must be a full web address.")
    }
    guard scheme == "https" || scheme == "http" else { throw JobValidationError("postingLink", "The posting link must start with http or https.") }
    return text
  }

  /// The command input columns `create_application` and `update_application` take.
  public var commandInput: JSONObject {
    [
      "company": .string(company), "role": .string(role), "location": .string(location), "link": .string(postingLink),
      "posted": .from(datePosted), "stage": .string(stage.rawValue), "applied": .from(appliedDate), "oa_due": .from(oaDueDate),
      "oa_done": .from(oaCompletedDate), "interview1": .from(interview1Date), "interview2": .from(interview2Date),
      "interview3": .from(interview3Date), "decision": .from(decisionDate), "resume_id": .from(resumeId), "term": .from(term)
    ]
  }
}

/// A tracked application.
public struct JobRole: Identifiable, Equatable, Hashable, Sendable {
  public let id: String
  public var fields: JobRoleFields
  public let createdAt: String
  public let updatedAt: String
  public let revision: Int

  public init(id: String, fields: JobRoleFields, createdAt: String, updatedAt: String, revision: Int) {
    self.id = id
    self.fields = fields
    self.createdAt = createdAt
    self.updatedAt = updatedAt
    self.revision = revision
  }

  public var company: String { fields.company }
  public var role: String { fields.role }
  public var stage: JobStage { fields.stage }

  /// A role from a `job_roles` row. The table's short column names map onto the shared schema.
  public init(row: Row) throws {
    guard let id = row["id"]?.string, !id.isEmpty else { throw JobValidationError("id", "A role row has no id.") }
    guard let stageName = row["stage"]?.string, let stage = JobStage(rawValue: stageName) else {
      throw JobValidationError("stage", "Role \(id) has an unknown stage.")
    }
    func date(_ column: String) -> String? {
      guard let value = row[column]?.string else { return nil }
      return String(value.prefix(10))
    }
    self.id = id
    self.fields = JobRoleFields(
      company: row["company"]?.string ?? "", role: row["role"]?.string ?? "", location: row["location"]?.string ?? "",
      postingLink: row["link"]?.string ?? "", datePosted: date("posted"), stage: stage, appliedDate: date("applied"),
      oaDueDate: date("oa_due"), oaCompletedDate: date("oa_done"), interview1Date: date("interview1"),
      interview2Date: date("interview2"), interview3Date: date("interview3"), decisionDate: date("decision"),
      resumeId: row["resume_id"]?.string, term: row["term"]?.string.flatMap { $0.isEmpty ? nil : $0 }
    )
    self.createdAt = row["created_at"]?.string ?? ""
    self.updatedAt = row["updated_at"]?.string ?? ""
    guard let revision = row["revision"]?.int, revision > 0 else { throw JobValidationError("revision", "Role \(id) has no revision.") }
    self.revision = revision
  }
}

/// One recorded stage change.
public struct JobStageTransition: Identifiable, Equatable, Hashable, Sendable {
  public let id: String
  public let roleId: String
  public let fromStage: JobStage?
  public let toStage: JobStage
  /// ISO timestamp of the change.
  public let changedAt: String

  public init(id: String, roleId: String, fromStage: JobStage?, toStage: JobStage, changedAt: String) {
    self.id = id
    self.roleId = roleId
    self.fromStage = fromStage
    self.toStage = toStage
    self.changedAt = changedAt
  }

  public init(row: Row) throws {
    guard let id = row["id"]?.string, let roleId = row["role_id"]?.string,
          let to = row["to_stage"]?.string.flatMap(JobStage.init(rawValue:)) else {
      throw JobValidationError("transition", "A stage change row is incomplete.")
    }
    self.id = id
    self.roleId = roleId
    self.fromStage = row["from_stage"]?.string.flatMap(JobStage.init(rawValue:))
    self.toStage = to
    self.changedAt = row["at"]?.string ?? ""
  }
}

/// Everything the Jobs page shows for the pipeline.
public struct JobsState: Equatable, Sendable {
  public var today: String
  public var roles: [JobRole]
  public var transitions: [JobStageTransition]

  public init(today: String, roles: [JobRole], transitions: [JobStageTransition]) {
    self.today = today
    self.roles = roles
    self.transitions = transitions
  }

  public func role(_ id: String) -> JobRole? { roles.first { $0.id == id } }
}

/// Calendar-date arithmetic on `YYYY-MM-DD` strings, independent of the Mac's time zone.
public enum JobDates {
  private static let utc = TimeZone(identifier: "UTC")!

  static var calendar: Calendar {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = utc
    return calendar
  }

  /// Midnight UTC of the date, or nil when the string is not a real `YYYY-MM-DD` date.
  public static func date(_ string: String) -> Date? {
    let parts = string.split(separator: "-", omittingEmptySubsequences: false)
    guard string.count == 10, parts.count == 3, parts[0].count == 4, parts[1].count == 2, parts[2].count == 2,
          let year = Int(parts[0]), let month = Int(parts[1]), let day = Int(parts[2]) else { return nil }
    let components = DateComponents(year: year, month: month, day: day)
    guard let date = calendar.date(from: components) else { return nil }
    let back = calendar.dateComponents([.year, .month, .day], from: date)
    guard back.year == year, back.month == month, back.day == day else { return nil }
    return date
  }

  public static func isValid(_ string: String) -> Bool { date(string) != nil }

  /// The `YYYY-MM-DD` string of a UTC-midnight date.
  public static func string(_ date: Date) -> String {
    let parts = calendar.dateComponents([.year, .month, .day], from: date)
    return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
  }

  /// Whole days from `today` to `date`; negative when `date` is past.
  public static func dayDifference(_ date: String, from today: String) -> Int {
    guard let a = Self.date(date), let b = Self.date(today) else { return 0 }
    return calendar.dateComponents([.day], from: b, to: a).day ?? 0
  }

  private static func formatter(_ format: String) -> DateFormatter {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = utc
    formatter.dateFormat = format
    return formatter
  }
  private static let shortFormatter = formatter("MMM d")
  private static let weekdayFormatter = formatter("EEEE")
  private static let longFormatter = formatter("MMM d, yyyy")

  /// "Aug 29".
  public static func short(_ string: String) -> String {
    guard let date = date(string) else { return string }
    return shortFormatter.string(from: date)
  }

  /// "Saturday".
  public static func weekday(_ string: String) -> String {
    guard let date = date(string) else { return string }
    return weekdayFormatter.string(from: date)
  }

  /// "Aug 29, 2026".
  public static func long(_ string: String) -> String {
    guard let date = date(string) else { return string }
    return longFormatter.string(from: date)
  }
}

/// Sortable key for a hiring cycle: "Summer 2027" sorts as 2027.2. Unknown cycles sort last.
public func jobTermSortKey(_ term: String?) -> Double {
  guard let term else { return .infinity }
  let digits = term.filter(\.isNumber)
  guard let year = Int(digits) else { return .infinity }
  let lower = term.lowercased()
  let season: Double = lower.contains("spring") ? 1 : lower.contains("summer") ? 2 : (lower.contains("fall") || lower.contains("autumn")) ? 3 : lower.contains("winter") ? 4 : 0
  return Double(year) + season / 10
}
