import Foundation

/// A board column. Interviews and outcomes are grouped, so a drop on them asks which round or outcome.
public enum JobColumn: String, CaseIterable, Sendable, Hashable, Identifiable {
  case toApply = "to_apply"
  case applied
  case oa
  case interview
  case decided

  public var id: String { rawValue }

  public var label: String {
    switch self {
    case .toApply: return "To apply"
    case .applied: return "Applied"
    case .oa: return "OA"
    case .interview: return "Interviews"
    case .decided: return "Decided"
    }
  }

  public var tone: JobTone {
    switch self {
    case .toApply: return .week
    case .applied: return .forest
    case .oa: return .today
    case .interview: return .plum
    case .decided: return .neutral
    }
  }

  /// The stages a drop on this column can land in, in menu order.
  public var stages: [JobStage] { JobStage.allCases.filter { $0.column == self } }

  /// The prompt of the stage picker when the column holds more than one stage.
  public var choicePrompt: String? {
    switch self {
    case .interview: return "Choose interview round"
    case .decided: return "Choose outcome"
    default: return nil
    }
  }
}

/// A requested move: a specific stage (from the card menu) or a column (from a drop).
public enum JobStageRequest: Equatable, Hashable, Sendable {
  case stage(JobStage)
  case column(JobColumn)

  /// The stages the move may end in.
  public var options: [JobStage] {
    switch self {
    case .stage(let stage): return [stage]
    case .column(let column): return column.stages
    }
  }

  /// The preselected stage, or nil when a grouped column needs an explicit choice. Manor never assumes rejection.
  public var initialStage: JobStage? {
    let options = options
    return options.count == 1 ? options[0] : nil
  }

  public var choicePrompt: String {
    if case .column(let column) = self, let prompt = column.choicePrompt { return prompt }
    return "Select stage"
  }

  /// Whether this request would actually move a role currently at `stage`.
  public func moves(from stage: JobStage) -> Bool {
    switch self {
    case .stage(let target): return target != stage
    case .column(let column): return column != stage.column
    }
  }
}

/// A board card's display: the role, its column, and its one current meaningful update.
public struct JobBoardCard: Identifiable, Equatable, Sendable {
  public let role: JobRole
  public let column: JobColumn
  public let detail: String
  /// Nil for stages whose update is the plain applied or posted date.
  public let detailTone: JobTone?
  public var id: String { role.id }

  public init(role: JobRole, today: String) {
    self.role = role
    self.column = role.stage.column
    self.detail = JobLabels.currentUpdate(role.fields, today: today)
    self.detailTone = JobLabels.detailTone(role.fields)
  }
}

/// Visible cards in a board column before every column caps its height and scrolls.
public let jobBoardVisibleCards = 5

/// The words the Jobs surfaces use for dates and states.
public enum JobLabels {
  static func upcoming(_ date: String, today: String) -> String {
    let difference = JobDates.dayDifference(date, from: today)
    if difference == 0 { return "today" }
    if difference == 1 { return "tomorrow" }
    if difference > 1 && difference <= 6 { return JobDates.weekday(date) }
    return JobDates.short(date)
  }

  /// The one update a board card shows for the role's stage.
  public static func currentUpdate(_ role: JobRoleFields, today: String) -> String {
    switch role.stage {
    case .toApply:
      return role.datePosted.map { "Posted \(JobDates.short($0))" } ?? "Posted date not set"
    case .applied:
      return role.appliedDate.map { "Applied \(JobDates.short($0))" } ?? "Applied date not set"
    case .oa:
      if let done = role.oaCompletedDate { return "OA done \(JobDates.short(done))" }
      guard let due = role.oaDueDate else { return "OA due date not set" }
      return JobDates.dayDifference(due, from: today) < 0 ? "OA overdue \(JobDates.short(due))" : "OA due \(upcoming(due, today: today))"
    case .interview1:
      return role.interview1Date.map { "Round 1 \(upcoming($0, today: today))" } ?? "Round 1 date not set"
    case .interview2:
      return role.interview2Date.map { "Round 2 \(upcoming($0, today: today))" } ?? "Round 2 date not set"
    case .interview3:
      return role.interview3Date.map { "Round 3 \(upcoming($0, today: today))" } ?? "Round 3 date not set"
    case .offer:
      return role.decisionDate.map { "Offer \(JobDates.short($0))" } ?? "Offer"
    case .rejected:
      return role.decisionDate.map { "Rejected \(JobDates.short($0))" } ?? "Rejected"
    }
  }

  /// The tone of the card's update. A completed OA reads as done; an open one reads as due.
  public static func detailTone(_ role: JobRoleFields) -> JobTone? {
    switch role.stage {
    case .oa: return role.oaCompletedDate == nil ? .today : .success
    case .interview1, .interview2, .interview3: return .plum
    case .offer: return .success
    case .rejected: return .overdue
    case .applied, .toApply: return nil
    }
  }

  /// Whether an open OA is past its due date.
  public static func oaOverdue(_ role: JobRoleFields, today: String) -> Bool {
    guard role.stage == .oa, role.oaCompletedDate == nil, let due = role.oaDueDate else { return false }
    return JobDates.dayDifference(due, from: today) < 0
  }

  /// The pill on a card past To apply: the day it was applied.
  public static func applied(_ date: String) -> String { "Applied \(JobDates.short(date))" }

  /// "Today", "Yesterday", "3d ago", or the date.
  public static func posted(_ date: String?, today: String) -> String {
    guard let date else { return "Not set" }
    let difference = JobDates.dayDifference(date, from: today)
    if difference == 0 { return "Today" }
    if difference == -1 { return "Yesterday" }
    if difference < -1 && difference >= -6 { return "\(-difference)d ago" }
    return JobDates.short(date)
  }

  /// Freshness of a posting: newest reads warmest, stale settles to neutral.
  public static func postedTone(_ date: String, today: String) -> JobTone {
    let age = -JobDates.dayDifference(date, from: today)
    if age <= 0 { return .today }
    if age <= 3 { return .tomorrow }
    if age <= 14 { return .week }
    return .neutral
  }

  /// One tone per hiring season, so a cycle always reads the same.
  public static func termTone(_ term: String) -> JobTone {
    let lower = term.lowercased()
    if lower.contains("summer") { return .gold }
    if lower.contains("fall") || lower.contains("autumn") { return .plum }
    if lower.contains("spring") { return .success }
    if lower.contains("winter") { return .info }
    return .neutral
  }

  /// "3 new today" when roles posted today wait to be applied to.
  public static func freshRolesNote(_ state: JobsState) -> String? {
    let fresh = state.roles.filter { $0.stage == .toApply && $0.fields.datePosted == state.today }.count
    return fresh == 0 ? nil : "\(fresh) new today"
  }
}
