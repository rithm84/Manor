import Foundation

// MARK: Properties

public enum TaskPriority: String, CaseIterable, Hashable, Sendable {
  case low = "Low", medium = "Medium", high = "High"
  public var label: String { rawValue }
  /// High sorts first.
  var rank: Int {
    switch self {
    case .high: return 0
    case .medium: return 1
    case .low: return 2
    }
  }
}

public enum TaskStatus: String, CaseIterable, Hashable, Sendable {
  case notStarted = "Not started", inProgress = "In Progress", done = "Done"
  public var label: String { self == .inProgress ? "In progress" : rawValue }
}

/// The time estimate a task carries; the stored value is minutes.
public enum TaskEstimate: Int, CaseIterable, Hashable, Sendable {
  case quarterHour = 15, halfHour = 30, hour = 60, twoHours = 120, threeHours = 180, fourHours = 240
  public var label: String {
    switch self {
    case .quarterHour: return "15 min"
    case .halfHour: return "30 min"
    case .hour: return "1 hour"
    case .twoHours: return "2 hours"
    case .threeHours: return "3 hours"
    case .fourHours: return "4+ hours"
    }
  }
}

public enum RecurrenceScope: String, Hashable, Sendable {
  case this, future
}

// MARK: Contexts

public enum ContextColor: String, CaseIterable, Hashable, Sendable {
  case forest, success, gold, info, plum, today
  public var label: String {
    switch self {
    case .forest: return "Forest"
    case .success: return "Sage"
    case .gold: return "Gold"
    case .info: return "Blue"
    case .plum: return "Plum"
    case .today: return "Amber"
    }
  }
}

public enum ContextIcon: String, CaseIterable, Hashable, Sendable {
  case bookOpen = "book-open", graduationCap = "graduation-cap", library, notebookTabs = "notebook-tabs", brain, calculator
  case briefcase, laptop, rocket, presentation, landmark, badgeDollarSign = "badge-dollar-sign"
  case house, heart, users, shoppingBag = "shopping-bag", utensils, car
  case code, terminal, gitBranch = "git-branch", bug, database, cpu
  case target, trophy, dumbbell, activity, flame, mountain
  case sparkles, palette, music, camera, plane, globe

  public enum Category: String, CaseIterable, Sendable { case learning = "Learning", work = "Work", life = "Life", technology = "Technology", goals = "Goals", creative = "Creative" }

  public var category: Category {
    switch self {
    case .bookOpen, .graduationCap, .library, .notebookTabs, .brain, .calculator: return .learning
    case .briefcase, .laptop, .rocket, .presentation, .landmark, .badgeDollarSign: return .work
    case .house, .heart, .users, .shoppingBag, .utensils, .car: return .life
    case .code, .terminal, .gitBranch, .bug, .database, .cpu: return .technology
    case .target, .trophy, .dumbbell, .activity, .flame, .mountain: return .goals
    case .sparkles, .palette, .music, .camera, .plane, .globe: return .creative
    }
  }

  public var label: String {
    switch self {
    case .bookOpen: return "Book"
    case .graduationCap: return "Graduation"
    case .library: return "Library"
    case .notebookTabs: return "Notebook"
    case .brain: return "Brain"
    case .calculator: return "Calculator"
    case .briefcase: return "Briefcase"
    case .laptop: return "Laptop"
    case .rocket: return "Rocket"
    case .presentation: return "Presentation"
    case .landmark: return "Institution"
    case .badgeDollarSign: return "Finance"
    case .house: return "Home"
    case .heart: return "Heart"
    case .users: return "People"
    case .shoppingBag: return "Shopping"
    case .utensils: return "Food"
    case .car: return "Car"
    case .code: return "Code"
    case .terminal: return "Terminal"
    case .gitBranch: return "Git branch"
    case .bug: return "Bug"
    case .database: return "Database"
    case .cpu: return "Processor"
    case .target: return "Target"
    case .trophy: return "Trophy"
    case .dumbbell: return "Fitness"
    case .activity: return "Activity"
    case .flame: return "Flame"
    case .mountain: return "Mountain"
    case .sparkles: return "Sparkles"
    case .palette: return "Palette"
    case .music: return "Music"
    case .camera: return "Camera"
    case .plane: return "Travel"
    case .globe: return "Globe"
    }
  }
}

/// A context as stored: the name tasks and saved views reference, its icon and color, and the row identity
/// commands need.
public struct TaskContext: Identifiable, Hashable, Sendable {
  public var id: String
  public var name: String
  public var color: ContextColor
  public var icon: ContextIcon
  public var revision: Int

  public init(id: String, name: String, color: ContextColor, icon: ContextIcon, revision: Int) {
    self.id = id
    self.name = name
    self.color = color
    self.icon = icon
    self.revision = revision
  }
}

/// The editable part of a context.
public struct ContextDraft: Hashable, Sendable {
  public var name: String
  public var color: ContextColor
  public var icon: ContextIcon
  public init(name: String, color: ContextColor, icon: ContextIcon) {
    self.name = name
    self.color = color
    self.icon = icon
  }
}

// MARK: Tasks

/// One task occurrence. Named `TaskItem` so it never shadows Swift's `Task`.
public struct TaskItem: Identifiable, Hashable, Sendable {
  public var id: String
  public var title: String
  public var context: String
  public var estimate: TaskEstimate?
  public var priority: TaskPriority?
  public var status: TaskStatus
  public var due: String
  public var dueTime: String?
  public var tags: [String]
  public var recurrence: String?
  /// Nil for a task that does not exist yet.
  public var revision: Int?
  public var seriesId: String?
  /// Draft-only: how an edit to a recurring occurrence applies.
  public var recurrenceScope: RecurrenceScope?

  public init(
    id: String, title: String, context: String, estimate: TaskEstimate? = nil, priority: TaskPriority? = nil,
    status: TaskStatus = .notStarted, due: String, dueTime: String? = nil, tags: [String] = [], recurrence: String? = nil,
    revision: Int? = nil, seriesId: String? = nil, recurrenceScope: RecurrenceScope? = nil
  ) {
    self.id = id
    self.title = title
    self.context = context
    self.estimate = estimate
    self.priority = priority
    self.status = status
    self.due = due
    self.dueTime = dueTime
    self.tags = tags
    self.recurrence = recurrence
    self.revision = revision
    self.seriesId = seriesId
    self.recurrenceScope = recurrenceScope
  }

  public var isRecurring: Bool { seriesId != nil }

  /// The draft compared for dirtiness: everything a save would write.
  public func sameContent(as other: TaskItem) -> Bool {
    title == other.title && context == other.context && estimate == other.estimate && priority == other.priority
      && status == other.status && due == other.due && dueTime == other.dueTime && tags == other.tags
      && recurrence == other.recurrence && (recurrenceScope ?? .this) == (other.recurrenceScope ?? .this)
  }
}

/// A Manor-only time block on the Today timeline. `taskId` nil is a freestanding block.
public struct ScratchBlock: Identifiable, Hashable, Sendable {
  public var id: String
  public var taskId: String?
  public var date: String
  public var start: String
  public var end: String
  public var portion: String
  public var createdAt: String
  public var expiresAt: String
  public var revision: Int?

  public init(id: String, taskId: String?, date: String, start: String, end: String, portion: String, createdAt: String, expiresAt: String, revision: Int? = nil) {
    self.id = id
    self.taskId = taskId
    self.date = date
    self.start = start
    self.end = end
    self.portion = portion
    self.createdAt = createdAt
    self.expiresAt = expiresAt
    self.revision = revision
  }

  public var startMinutes: Int { TaskDates.minutes(start) ?? 0 }
  public var endMinutes: Int { TaskDates.minutes(end) ?? 0 }
}

public struct SavedTaskView: Identifiable, Hashable, Sendable {
  public var id: String
  public var name: String
  public var rules: [MasterFilterRule]
  public var revision: Int?
  public init(id: String, name: String, rules: [MasterFilterRule], revision: Int? = nil) {
    self.id = id
    self.name = name
    self.rules = rules
    self.revision = revision
  }
}

// MARK: Parsing rows

/// A stored record that does not satisfy the task rules.
public struct TaskRecordError: LocalizedError, Sendable {
  public let detail: String
  public init(_ detail: String) { self.detail = detail }
  public var errorDescription: String? { detail }
}

enum TaskRowRead {
  static func string(_ row: Row, _ key: String) throws -> String {
    guard let value = row[key]?.string?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else {
      throw TaskRecordError("\(key) must be a non-empty string")
    }
    return value
  }

  static func optionalString(_ row: Row, _ key: String) throws -> String? {
    guard let value = row[key], !value.isNull else { return nil }
    return try string(row, key)
  }

  static func date(_ row: Row, _ key: String) throws -> String {
    let value = try string(row, key)
    // Postgres dates arrive as YYYY-MM-DD; tolerate a timestamp form by taking its date.
    let date = String(value.prefix(10))
    guard TaskDates.isDate(date) else { throw TaskRecordError("\(key) must be a real calendar date") }
    return date
  }

  static func time(_ row: Row, _ key: String) throws -> String {
    var value = try string(row, key)
    // A `time` column can print seconds.
    if value.count == 8, value.hasSuffix(":00") { value = String(value.prefix(5)) }
    guard TaskDates.isTime(value) else { throw TaskRecordError("\(key) must use 24-hour HH:MM format") }
    return value
  }

  static func revision(_ row: Row) -> Int? { row["revision"]?.int }
}

public extension TaskItem {
  /// A task from its `tasks` row.
  init(row: Row) throws {
    let estimate: TaskEstimate?
    if let value = row["estimate_minutes"], !value.isNull {
      guard let minutes = value.int, let parsed = TaskEstimate(rawValue: minutes) else {
        throw TaskRecordError("estimate_minutes must be 15, 30, 60, 120, 180, 240, or null")
      }
      estimate = parsed
    } else {
      estimate = nil
    }
    let priority: TaskPriority?
    if let value = row["priority"], !value.isNull {
      guard let parsed = value.string.flatMap(TaskPriority.init(rawValue:)) else { throw TaskRecordError("priority must be Low, Medium, High, or null") }
      priority = parsed
    } else {
      priority = nil
    }
    guard let status = row["status"]?.string.flatMap(TaskStatus.init(rawValue:)) else {
      throw TaskRecordError("status must be Not started, In Progress, or Done")
    }
    var dueTime: String?
    if let value = row["due_time"], !value.isNull {
      let time = try TaskRowRead.time(row, "due_time")
      if time == "24:00" { throw TaskRecordError("due_time must be before midnight") }
      dueTime = time
    }
    let tags = (row["tags"]?.array ?? []).compactMap(\.string).filter { !$0.isEmpty }
    self.init(
      id: try TaskRowRead.string(row, "id"), title: try TaskRowRead.string(row, "title"), context: try TaskRowRead.string(row, "context"),
      estimate: estimate, priority: priority, status: status, due: try TaskRowRead.date(row, "due"), dueTime: dueTime,
      tags: tags, recurrence: try TaskRowRead.optionalString(row, "recurrence"), revision: TaskRowRead.revision(row),
      seriesId: row["series_id"]?.string
    )
  }

  /// Rows Home shows: not in Trash, not skipped, and not replaced by a newer series.
  static func isLive(_ row: Row) -> Bool {
    (row["deleted_at"] ?? .null).isNull && (row["skipped_at"] ?? .null).isNull && (row["superseded_at"] ?? .null).isNull
  }
}

public extension TaskContext {
  init(row: Row) throws {
    let name = try TaskRowRead.string(row, "name")
    guard name.count <= 48 else { throw TaskRecordError("context must be 48 characters or fewer") }
    guard let color = row["color"]?.string.flatMap(ContextColor.init(rawValue:)) else { throw TaskRecordError("context.color is not supported") }
    guard let icon = row["icon"]?.string.flatMap(ContextIcon.init(rawValue:)) else { throw TaskRecordError("context.icon is not supported") }
    self.init(id: try TaskRowRead.string(row, "id"), name: name, color: color, icon: icon, revision: TaskRowRead.revision(row) ?? 1)
  }
}

public extension ScratchBlock {
  init(row: Row) throws {
    let start = try TaskRowRead.time(row, "start_time")
    let end = try TaskRowRead.time(row, "end_time")
    if start == "24:00" { throw TaskRecordError("start must be before midnight") }
    guard end > start else { throw TaskRecordError("end must be later than start") }
    let portion = row["portion"]?.string ?? ""
    self.init(
      id: try TaskRowRead.string(row, "id"), taskId: row["task_id"]?.string, date: try TaskRowRead.date(row, "date"), start: start, end: end,
      portion: portion.trimmingCharacters(in: .whitespacesAndNewlines), createdAt: row["created_at"]?.string ?? "",
      expiresAt: try TaskRowRead.string(row, "expires_at"), revision: TaskRowRead.revision(row)
    )
  }

  /// Blocks delete themselves 48 hours after their scheduled end; an expired row is not shown.
  static func isLive(_ row: Row, now: Date) -> Bool {
    guard let text = row["expires_at"]?.string, let expires = TaskDates.timestamp(text) else { return false }
    return expires > now
  }
}

public extension SavedTaskView {
  init(row: Row) throws {
    guard let rules = row["rules"]?.array else { throw TaskRecordError("savedTaskView.rules must be an array") }
    self.init(id: try TaskRowRead.string(row, "id"), name: try TaskRowRead.string(row, "name"), rules: try rules.map(MasterFilterRule.init(json:)), revision: TaskRowRead.revision(row))
  }
}
