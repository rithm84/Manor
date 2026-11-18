import Foundation

// Typed reading of the arguments a model sends to Manor's tools, with errors worded so the model can fix the call
// or ask the user. Dates resolve against the account's today.

/// A problem with a tool call's arguments, worded for the reader.
public struct ManorToolArgumentError: LocalizedError, Equatable, Sendable {
  public let message: String
  public init(_ message: String) { self.message = message }
  public var errorDescription: String? { message }
}

/// Raw arguments from a tool call (`JSONSerialization` values or Swift literals).
public struct ManorToolArguments {
  public static let maxTargets = 50

  public let values: [String: Any]
  public init(_ values: [String: Any]) { self.values = values }

  private func present(_ key: String) -> Any? {
    guard let value = values[key], !(value is NSNull) else { return nil }
    return value
  }

  /// Trimmed text; nil when absent or blank.
  public func string(_ key: String) throws -> String? {
    guard let value = present(key) else { return nil }
    guard let text = value as? String else { throw ManorToolArgumentError("\(key) must be text") }
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
  }

  public func requiredString(_ key: String) throws -> String {
    guard let text = try string(key) else { throw ManorToolArgumentError("\(key) is required") }
    return text
  }

  /// Text kept exactly as sent (Markdown keeps its leading spaces and line breaks).
  public func rawText(_ key: String) throws -> String? {
    guard let value = present(key) else { return nil }
    guard let text = value as? String else { throw ManorToolArgumentError("\(key) must be text") }
    return text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : text
  }

  public func bool(_ key: String) throws -> Bool? {
    guard let value = present(key) else { return nil }
    if let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() { return number.boolValue }
    throw ManorToolArgumentError("\(key) must be true or false")
  }

  public func int(_ key: String, in range: ClosedRange<Int>? = nil) throws -> Int? {
    guard let value = present(key) else { return nil }
    guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else {
      throw ManorToolArgumentError("\(key) must be a whole number")
    }
    let double = number.doubleValue
    guard double.rounded() == double, abs(double) < 1e9 else { throw ManorToolArgumentError("\(key) must be a whole number") }
    let int = Int(double)
    if let range, !range.contains(int) { throw ManorToolArgumentError("\(key) must be between \(range.lowerBound) and \(range.upperBound)") }
    return int
  }

  /// One of `options`, matched ignoring case; nil when absent.
  public func option(_ key: String, _ options: [String]) throws -> String? {
    guard let text = try string(key) else { return nil }
    guard let match = options.first(where: { $0.caseInsensitiveCompare(text) == .orderedSame }) else {
      throw ManorToolArgumentError("\(key) must be one of \(options.joined(separator: ", "))")
    }
    return match
  }

  /// A list of task, habit, or role references: IDs or titles, trimmed, blanks dropped, repeats removed.
  public func targets(_ key: String) throws -> [String] {
    guard let value = present(key) else { throw ManorToolArgumentError("\(key) is required") }
    let items: [Any]
    if let array = value as? [Any] { items = array } else if value is String { items = [value] } else {
      throw ManorToolArgumentError("\(key) must be a list of IDs or titles")
    }
    var seen = Set<String>()
    var out: [String] = []
    for item in items {
      guard let text = item as? String else { throw ManorToolArgumentError("\(key) must be a list of IDs or titles") }
      let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
      if !trimmed.isEmpty, seen.insert(trimmed.lowercased()).inserted { out.append(trimmed) }
    }
    guard !out.isEmpty else { throw ManorToolArgumentError("\(key) needs at least one ID or title") }
    guard out.count <= Self.maxTargets else { throw ManorToolArgumentError("\(key) takes at most \(Self.maxTargets) items at a time") }
    return out
  }

  /// A day as `YYYY-MM-DD`, resolved against `today`.
  public func date(_ key: String, today: String) throws -> String? {
    guard let text = try string(key) else { return nil }
    return try ManorToolDates.resolve(text, today: today, field: key)
  }

  /// Today or yesterday only, for check-ins; today when absent.
  public func recentDay(_ key: String, today: String) throws -> String {
    guard let day = try date(key, today: today) else { return today }
    guard day == today || day == TaskDates.adding(-1, to: today) else {
      throw ManorToolArgumentError("\(key) must be today or yesterday")
    }
    return day
  }
}

// MARK: Dates

public enum ManorToolDates {
  /// "today", "tomorrow", "yesterday", or a real `YYYY-MM-DD` date.
  public static func resolve(_ text: String, today: String, field: String = "date") throws -> String {
    let lowered = text.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    switch lowered {
    case "today": return today
    case "tomorrow": return TaskDates.adding(1, to: today)
    case "yesterday": return TaskDates.adding(-1, to: today)
    default:
      guard TaskDates.isDate(lowered) else {
        throw ManorToolArgumentError("\(field) must be today, tomorrow, yesterday, or a real date written YYYY-MM-DD")
      }
      return lowered
    }
  }

  /// "today", "tomorrow", "yesterday", or the date with its weekday, for summaries.
  public static func label(_ date: String, today: String) -> String {
    if date == today { return "today" }
    if date == TaskDates.adding(1, to: today) { return "tomorrow" }
    if date == TaskDates.adding(-1, to: today) { return "yesterday" }
    return TaskDates.dayLabel(date)
  }
}

// MARK: Tasks

public enum ManorTaskStatusFilter: String, Sendable {
  case open, done, all

  public func includes(_ status: TaskStatus) -> Bool {
    switch self {
    case .open: return status != .done
    case .done: return status == .done
    case .all: return true
    }
  }
}

public struct ManorTaskQuery: Equatable, Sendable {
  public var text: String?
  public var dueFrom: String?
  public var dueTo: String?
  public var status: ManorTaskStatusFilter
  public var limit: Int

  public static func parse(_ raw: [String: Any], today: String) throws -> ManorTaskQuery {
    let args = ManorToolArguments(raw)
    var from = try args.date("due_from", today: today)
    var to = try args.date("due_to", today: today)
    if let on = try args.date("due_on", today: today) {
      from = on
      to = on
    }
    if let from, let to, from > to { throw ManorToolArgumentError("due_from must be on or before due_to") }
    return ManorTaskQuery(
      text: try args.string("query"), dueFrom: from, dueTo: to,
      status: ManorTaskStatusFilter(rawValue: try args.option("status", ManorToolCatalog.taskStatuses) ?? "open") ?? .open,
      limit: try args.int("limit", in: 1...50) ?? 20
    )
  }

  public func matches(_ task: TaskItem) -> Bool {
    guard status.includes(task.status) else { return false }
    if let dueFrom, task.due < dueFrom { return false }
    if let dueTo, task.due > dueTo { return false }
    if let text, !ManorTargetMatcher.contains(task.title, text) { return false }
    return true
  }

  /// Matching tasks, earliest due first, then by time and title.
  public func run(_ tasks: [TaskItem]) -> (tasks: [TaskItem], total: Int) {
    let matched = tasks.filter(matches).sorted {
      if $0.due != $1.due { return $0.due < $1.due }
      if ($0.dueTime ?? "99") != ($1.dueTime ?? "99") { return ($0.dueTime ?? "99") < ($1.dueTime ?? "99") }
      return $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending
    }
    return (Array(matched.prefix(limit)), matched.count)
  }
}

public struct ManorCreateTaskArgs: Equatable, Sendable {
  public var title: String
  public var due: String
  public var dueTime: String?
  public var context: String?
  public var priority: TaskPriority?
  public var estimate: TaskEstimate?

  public static func parse(_ raw: [String: Any], today: String) throws -> ManorCreateTaskArgs {
    let args = ManorToolArguments(raw)
    let title = try args.requiredString("title")
    guard title.count <= 300 else { throw ManorToolArgumentError("Task titles are at most 300 characters") }
    var estimate: TaskEstimate?
    if let minutes = try args.int("estimate_minutes") {
      guard let parsed = TaskEstimate(rawValue: minutes) else { throw ManorToolArgumentError("estimate_minutes must be 15, 30, 60, 120, 180, or 240") }
      estimate = parsed
    }
    return ManorCreateTaskArgs(
      title: title, due: try args.date("due", today: today) ?? today, dueTime: try ManorTaskTime.parse(args.string("due_time"), allowClear: false).time,
      context: try args.string("context"),
      priority: try args.option("priority", TaskPriority.allCases.map(\.rawValue)).flatMap(TaskPriority.init(rawValue:)),
      estimate: estimate
    )
  }
}

/// A due-time change: keep each task's time, clear it, or set one.
public enum ManorTaskTime: Equatable, Sendable {
  case keep, clear, set(String)

  public var time: String? {
    if case .set(let value) = self { return value }
    return nil
  }

  public static func parse(_ text: String?, allowClear: Bool) throws -> ManorTaskTime {
    guard let text else { return .keep }
    if allowClear, ["none", "clear", "no time"].contains(text.lowercased()) { return .clear }
    var value = text
    // Accept 9:30 as 09:30.
    if value.count == 4, value.dropFirst().first == ":" { value = "0" + value }
    guard TaskDates.isTime(value), value != "24:00" else {
      throw ManorToolArgumentError("due_time must be a 24-hour time written HH:MM\(allowClear ? ", or none to clear it" : "")")
    }
    return .set(value)
  }
}

public struct ManorSetTasksDoneArgs: Equatable, Sendable {
  public var targets: [String]
  public var done: Bool

  public static func parse(_ raw: [String: Any]) throws -> ManorSetTasksDoneArgs {
    let args = ManorToolArguments(raw)
    return ManorSetTasksDoneArgs(targets: try args.targets("tasks"), done: try args.bool("done") ?? true)
  }
}

public struct ManorRescheduleArgs: Equatable, Sendable {
  public var targets: [String]
  public var due: String
  public var time: ManorTaskTime

  public static func parse(_ raw: [String: Any], today: String) throws -> ManorRescheduleArgs {
    let args = ManorToolArguments(raw)
    let targets = try args.targets("tasks")
    guard let due = try args.date("due", today: today) else { throw ManorToolArgumentError("due is required") }
    return ManorRescheduleArgs(targets: targets, due: due, time: try ManorTaskTime.parse(args.string("due_time"), allowClear: true))
  }
}

public struct ManorPriorityArgs: Equatable, Sendable {
  public var targets: [String]
  /// Nil clears the priority.
  public var priority: TaskPriority?

  public static func parse(_ raw: [String: Any]) throws -> ManorPriorityArgs {
    let args = ManorToolArguments(raw)
    let targets = try args.targets("tasks")
    guard let value = try args.option("priority", ManorToolCatalog.priorities) else { throw ManorToolArgumentError("priority is required") }
    return ManorPriorityArgs(targets: targets, priority: TaskPriority(rawValue: value))
  }
}

// MARK: Tracking

/// How much of a habit a check-off logs, before it meets the habit's kind.
public enum ManorHabitAmount: Equatable, Sendable {
  case done(Bool), units(Int), percent(Int)
}

public struct ManorLogHabitArgs: Equatable, Sendable {
  public var habit: String
  public var date: String
  public var amount: ManorHabitAmount

  public static func parse(_ raw: [String: Any], today: String) throws -> ManorLogHabitArgs {
    let args = ManorToolArguments(raw)
    let habit = try args.requiredString("habit")
    let date = try args.recentDay("date", today: today)
    let done = try args.bool("done")
    let units = try args.int("amount", in: 0...1000)
    let percent = try args.int("percent", in: 0...100)
    guard [done != nil, units != nil, percent != nil].filter({ $0 }).count <= 1 else {
      throw ManorToolArgumentError("Send only one of done, amount, or percent")
    }
    let amount: ManorHabitAmount = units.map(ManorHabitAmount.units) ?? percent.map(ManorHabitAmount.percent) ?? .done(done ?? true)
    return ManorLogHabitArgs(habit: habit, date: date, amount: amount)
  }

  /// The percent to store (0 clears the day), on the habit's own step ladder.
  public static func value(for amount: ManorHabitAmount, kind: HabitKind, targetLabel: String?) throws -> Int {
    switch (kind, amount) {
    case (_, .done(let done)): return done ? 100 : 0
    case (.binary, .units(let units)):
      guard units <= 1 else { throw ManorToolArgumentError("This habit is a one-tap habit; use done") }
      return units == 1 ? 100 : 0
    case (.binary, .percent(let percent)):
      guard percent == 0 || percent == 100 else { throw ManorToolArgumentError("This habit is a one-tap habit; use done") }
      return percent
    case (.quantized, .units(let units)):
      guard HabitRules.logsByUnit(targetLabel), let count = HabitRules.targetUnitCount(targetLabel) else {
        throw ManorToolArgumentError("This habit logs in quarters of its target (\(targetLabel ?? "")); use percent")
      }
      guard units <= count else { throw ManorToolArgumentError("The target is \(targetLabel ?? "\(count)"), so amount must be \(count) or less") }
      return units == 0 ? 0 : HabitRules.steps(targetLabel)[units - 1]
    case (.quantized, .percent(let percent)):
      return HabitRules.nearestStep(HabitRules.ladder(targetLabel), percent)
    }
  }
}

public struct ManorDailyRatingsArgs: Equatable, Sendable {
  public var date: String
  public var mood: Mood?
  public var focus: Focus?

  public static func parse(_ raw: [String: Any], today: String) throws -> ManorDailyRatingsArgs {
    let args = ManorToolArguments(raw)
    let date = try args.recentDay("date", today: today)
    let mood = try args.option("mood", ManorToolCatalog.moods).flatMap(Mood.init(rawValue:))
    let focus = try args.option("focus", ManorToolCatalog.focuses).flatMap(Focus.init(rawValue:))
    guard mood != nil || focus != nil else { throw ManorToolArgumentError("Send a mood, a focus rating, or both") }
    return ManorDailyRatingsArgs(date: date, mood: mood, focus: focus)
  }

  /// The `log_daily_ratings` input, as the Tracking page sends it: only the stated ratings, so the other keeps
  /// its saved value.
  public func commandInput(revision: Int) -> JSONObject {
    var input: JSONObject = ["date": .string(date), "expected_revision": .number(Double(revision))]
    if let mood { input["mood"] = .string(mood.rawValue) }
    if let focus { input["focus"] = .string(focus.rawValue) }
    return input
  }
}

// MARK: Pomodoro

public struct ManorPomodoroStartArgs: Equatable, Sendable {
  public var kind: PomodoroKind
  public var label: String?
  public var minutes: Int?

  public static func parse(_ raw: [String: Any]) throws -> ManorPomodoroStartArgs {
    let args = ManorToolArguments(raw)
    let kind = try args.option("kind", ManorToolCatalog.pomodoroKinds).flatMap(PomodoroKind.init(rawValue:)) ?? .focus
    let label: String?
    do { label = try parsePomodoroLabel(try args.string("label")) } catch { throw ManorToolArgumentError(error.localizedDescription) }
    return ManorPomodoroStartArgs(kind: kind, label: label, minutes: try args.int("minutes", in: 1...PomodoroLimits.minutes))
  }
}

// MARK: Jobs

public struct ManorRoleQuery: Equatable, Sendable {
  public var text: String?
  public var stage: JobStage?
  public var limit: Int

  public static func parse(_ raw: [String: Any]) throws -> ManorRoleQuery {
    let args = ManorToolArguments(raw)
    return ManorRoleQuery(
      text: try args.string("query"), stage: try args.option("stage", ManorToolCatalog.stages).flatMap(JobStage.init(rawValue:)),
      limit: try args.int("limit", in: 1...50) ?? 20
    )
  }

  public func run(_ roles: [JobRole]) -> (roles: [JobRole], total: Int) {
    let matched = roles.filter { role in
      if let stage, role.stage != stage { return false }
      if let text, !ManorTargetMatcher.contains("\(role.company) \(role.role)", text) { return false }
      return true
    }.sorted {
      let left = JobStage.allCases.firstIndex(of: $0.stage) ?? 0
      let right = JobStage.allCases.firstIndex(of: $1.stage) ?? 0
      if left != right { return left < right }
      return $0.company.localizedCaseInsensitiveCompare($1.company) == .orderedAscending
    }
    return (Array(matched.prefix(limit)), matched.count)
  }
}

public struct ManorMoveRoleArgs: Equatable, Sendable {
  public var role: String
  public var stage: JobStage
  /// Set only when the request gave the stage's date.
  public var date: String?

  public static func parse(_ raw: [String: Any], today: String) throws -> ManorMoveRoleArgs {
    let args = ManorToolArguments(raw)
    let role = try args.requiredString("role")
    guard let stage = try args.option("stage", ManorToolCatalog.stages).flatMap(JobStage.init(rawValue:)) else {
      throw ManorToolArgumentError("stage is required")
    }
    return ManorMoveRoleArgs(role: role, stage: stage, date: try args.date("date", today: today))
  }

  /// The role's fields after the move: the stage changes, and its date only when one was given.
  public func applied(to fields: JobRoleFields) -> JobRoleFields {
    var next = fields
    next.stage = stage
    if let date { next[date: stage.dateField] = date }
    return next
  }
}

public struct ManorMarkOADoneArgs: Equatable, Sendable {
  public var role: String
  public var date: String

  public static func parse(_ raw: [String: Any], today: String) throws -> ManorMarkOADoneArgs {
    let args = ManorToolArguments(raw)
    let role = try args.requiredString("role")
    let date = try args.date("date", today: today) ?? today
    guard date <= today else { throw ManorToolArgumentError("The OA completed date can't be in the future") }
    return ManorMarkOADoneArgs(role: role, date: date)
  }
}

// MARK: Notes and navigation

public struct ManorCreateNoteArgs: Equatable, Sendable {
  public var title: String
  public var markdown: String

  public static func parse(_ raw: [String: Any]) throws -> ManorCreateNoteArgs {
    let args = ManorToolArguments(raw)
    let title: String
    do { title = try NoteLimits.title(try args.requiredString("title")) } catch let error as ManorToolArgumentError { throw error } catch {
      throw ManorToolArgumentError(error.localizedDescription)
    }
    return ManorCreateNoteArgs(title: title, markdown: try args.rawText("markdown") ?? "")
  }
}

public struct ManorAppendNoteArgs: Equatable, Sendable {
  public var markdown: String

  public static func parse(_ raw: [String: Any]) throws -> ManorAppendNoteArgs {
    guard let markdown = try ManorToolArguments(raw).rawText("markdown") else { throw ManorToolArgumentError("markdown is required") }
    return ManorAppendNoteArgs(markdown: markdown)
  }
}

public struct ManorOpenPageArgs: Equatable, Sendable {
  public var page: String

  public static func parse(_ raw: [String: Any]) throws -> ManorOpenPageArgs {
    let args = ManorToolArguments(raw)
    guard let page = try args.option("page", ManorToolCatalog.pages) else { throw ManorToolArgumentError("page is required") }
    return ManorOpenPageArgs(page: page)
  }
}
