import Foundation

/// The computed due buckets of the Weekly board, in column order.
public enum TaskBucket: String, CaseIterable, Identifiable, Hashable, Sendable {
  case overdue, today, tomorrow, week

  public var id: String { rawValue }

  public var label: String {
    switch self {
    case .overdue: return "Overdue"
    case .today: return "Today"
    case .tomorrow: return "Tomorrow"
    case .week: return "This Week"
    }
  }

  /// Overdue has no creation path.
  public var allowsCreation: Bool { self != .overdue }
}

/// The task rules behind Home: buckets, ordering, creation defaults, board drops, and scratch-block scheduling.
public enum TaskRules {
  // MARK: Buckets

  /// The bucket a date-only deadline falls into; nil beyond the seven-day horizon.
  public static func bucket(forDue due: String, today: String) -> TaskBucket? {
    let diff = TaskDates.daysBetween(today, due)
    if diff < 0 { return .overdue }
    if diff == 0 { return .today }
    if diff == 1 { return .tomorrow }
    if diff <= 7 { return .week }
    return nil
  }

  /// A timed task becomes overdue at its account-local minute; a date-only task the following day.
  public static func bucket(for task: TaskItem, today: String, now: String) -> TaskBucket? {
    if task.due == today, let time = task.dueTime, time <= now { return .overdue }
    return bucket(forDue: task.due, today: today)
  }

  /// The tasks on the Weekly board, by column, each column in weekly order. Done tasks leave the board
  /// unless `keeping` holds them (a completion fading out).
  public static func board(_ tasks: [TaskItem], today: String, now: String, keeping: Set<String> = []) -> [TaskBucket: [TaskItem]] {
    var columns: [TaskBucket: [TaskItem]] = [:]
    for task in tasks where task.status != .done || keeping.contains(task.id) {
      if let bucket = bucket(for: task, today: today, now: now) { columns[bucket, default: []].append(task) }
    }
    for key in columns.keys { columns[key]?.sort(by: weeklyOrder) }
    return columns
  }

  /// Exact due date, then exact time (date-only after timed on the same day), then High, Medium, Low, none, then title.
  public static func weeklyOrder(_ left: TaskItem, _ right: TaskItem) -> Bool {
    if left.due != right.due { return left.due < right.due }
    let leftTime = left.dueTime ?? "24:00", rightTime = right.dueTime ?? "24:00"
    if leftTime != rightTime { return leftTime < rightTime }
    let leftRank = left.priority?.rank ?? 3, rightRank = right.priority?.rank ?? 3
    if leftRank != rightRank { return leftRank < rightRank }
    return left.title.localizedCompare(right.title) == .orderedAscending
  }

  public static func daysLate(_ task: TaskItem, today: String) -> Int {
    max(0, -TaskDates.daysBetween(today, task.due))
  }

  // MARK: Board drops

  /// Today and Tomorrow accept a task from any other bucket; This Week accepts one from outside it and hands
  /// off to the due-date editor, because a range is not a date.
  public static func canDrop(from source: TaskBucket, onto target: TaskBucket) -> Bool {
    switch target {
    case .week: return source != .week
    case .today, .tomorrow: return source != target
    case .overdue: return false
    }
  }

  public static func due(for bucket: TaskBucket, today: String) -> String {
    switch bucket {
    case .overdue: return TaskDates.adding(-1, to: today)
    case .today: return today
    case .tomorrow: return TaskDates.adding(1, to: today)
    case .week: return TaskDates.adding(2, to: today)
    }
  }

  // MARK: Creation

  /// The due date a new task starts with: Today and Tomorrow on their exact day, This Week unset.
  public static func creationDefaultDue(for bucket: TaskBucket, today: String) -> String? {
    switch bucket {
    case .today: return today
    case .tomorrow: return TaskDates.adding(1, to: today)
    case .week, .overdue: return nil
    }
  }

  public struct CreationError: LocalizedError, Equatable, Sendable {
    public let message: String
    public var errorDescription: String? { message }
  }

  /// An explicit due picked in the dialog wins over the bucket default.
  public static func dueForCreation(bucket: TaskBucket, today: String, selected: String?) throws -> String {
    guard bucket.allowsCreation else { throw CreationError(message: "Overdue tasks cannot be created") }
    if let selected { return selected }
    guard let fallback = creationDefaultDue(for: bucket, today: today) else {
      throw CreationError(message: "This Week tasks require an exact due date")
    }
    return fallback
  }

  /// The copy Duplicate makes: a new identity, "copy" in the title, not started, and no revision.
  public static func duplicate(_ task: TaskItem, id: String = UUID().uuidString.lowercased()) -> TaskItem {
    var copy = task
    copy.id = id
    copy.title = "\(task.title) copy"
    copy.status = .notStarted
    copy.revision = nil
    copy.seriesId = nil
    copy.recurrenceScope = nil
    return copy
  }

  // MARK: Labels

  /// "Sun, Oct 4 · 7:59 PM", or the date alone for a date-only task.
  public static func dueLabel(_ task: TaskItem) -> String {
    TaskDates.dayLabel(task.due) + (task.dueTime.map { " · \(TaskDates.clock($0))" } ?? "")
  }

  public static func greeting(at time: String) -> String {
    let hour = (TaskDates.minutes(time) ?? 0) / 60
    if hour < 12 { return "Good morning" }
    if hour < 18 { return "Good afternoon" }
    return "Good evening"
  }
}

/// Scratch blocks on the Today timeline: 6 AM through midnight in 15-minute steps.
public enum ScratchTimeline {
  public static let startMinutes = 6 * 60
  public static let endMinutes = 24 * 60
  public static let snap = 15

  public static func snapped(_ minutes: Double) -> Int { Int((minutes / Double(snap)).rounded()) * snap }

  public static func clamp(_ minutes: Int, _ low: Int, _ high: Int) -> Int { min(high, max(low, minutes)) }

  /// The task estimate supplies the block length; one hour when unset.
  public static func blockMinutes(for estimate: TaskEstimate?) -> Int { estimate?.rawValue ?? 60 }

  public static func defaultPortion(blockMinutes: Int, estimateMinutes: Int?) -> String {
    guard let estimateMinutes, blockMinutes < estimateMinutes else { return "full task" }
    return "first \(blockMinutes) min"
  }

  public struct NoSlotError: LocalizedError, Sendable {
    public var errorDescription: String? { "No free slot before midnight fits this task" }
  }

  /// The first 15-minute start at or after `after` where `minutes` fits between the busy spans.
  public static func freeStart(minutes: Int, after: Int, busy: [ClosedRange<Int>]) throws -> String {
    var candidate = Int((Double(after) / Double(snap)).rounded(.up)) * snap
    for span in busy.sorted(by: { $0.lowerBound < $1.lowerBound }) {
      if span.upperBound <= candidate { continue }
      if candidate + minutes <= span.lowerBound { break }
      candidate = span.upperBound
    }
    guard candidate + minutes <= endMinutes else { throw NoSlotError() }
    return TaskDates.time(fromMinutes: candidate)
  }

  /// The busy spans of a day: its scratch blocks (and, when given, event spans).
  public static func busy(on date: String, blocks: [ScratchBlock], events: [ClosedRange<Int>] = []) -> [ClosedRange<Int>] {
    events + blocks.filter { $0.date == date && $0.endMinutes > $0.startMinutes }.map { $0.startMinutes...$0.endMinutes }
  }

  /// Blocks clean themselves up 48 hours after their scheduled end in the account's zone.
  public static func expiry(date: String, end: String, timeZone: TimeZone) -> String {
    let scheduledEnd = TaskDates.instant(date: date, time: end, in: timeZone) ?? Date()
    return TaskDates.isoString(scheduledEnd.addingTimeInterval(48 * 3600))
  }

  /// Whether a start and duration land on 15-minute boundaries inside 6 AM to midnight.
  public static func isValidSpan(start: Int, minutes: Int) -> Bool {
    minutes > 0 && start >= startMinutes && start + minutes <= endMinutes && start % snap == 0 && minutes % snap == 0
  }

  public static func durationLabel(_ minutes: Int) -> String {
    if minutes < 60 { return "\(minutes) min" }
    if minutes == 60 { return "1 hour" }
    if minutes % 60 == 0 { return "\(minutes / 60) hours" }
    return "\(minutes / 60) hr \(minutes % 60) min"
  }

  /// The preset ladder plus the block's own length, so a dragged duration shows as the selected value.
  public static func durationOptions(current: Int) -> [Int] {
    Array(Set([15, 30, 45, 60, 90, 120, 180, current])).sorted()
  }
}
