import Foundation

// MARK: Daily view model

public struct HabitWeekDay: Sendable, Hashable, Identifiable {
  public let date: String
  public let letter: String
  public let mark: HabitDayMark
  public let selected: Bool
  public var id: String { date }
}

/// Everything one daily row shows for the selected day.
public struct HabitViewModel: Sendable, Hashable, Identifiable {
  public let definition: HabitDefinition
  /// The habit's status today.
  public let status: HabitLifecycleStatus
  /// The habit's status on the selected day.
  public let selectedStatus: HabitLifecycleStatus?
  public let entry: HabitEntry?
  public let metrics: HabitMetrics
  public let week: [HabitWeekDay]
  public let selectedDateMark: HabitDayMark
  /// Whether a freeze can still be spent on the selected day.
  public let canFreeze: Bool
  public let frozen: Bool
  public var id: String { definition.id }
  public var value: Int { entry?.value ?? 0 }
  public var isComplete: Bool { value == 100 }
}

public enum HabitModel {
  public static let weekLetters = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]

  public static func viewModel(_ habit: HabitDefinition, selectedDate: String, in state: HabitsState) -> HabitViewModel {
    let weekStart = HabitDates.startOfWeek(selectedDate)
    let mark = HabitRules.mark(habit, on: selectedDate, in: state)
    let pool = state.pool(month: HabitDates.monthKey(selectedDate))
    let week = weekLetters.enumerated().map { index, letter -> HabitWeekDay in
      let date = HabitDates.addDays(weekStart, index)
      return HabitWeekDay(date: date, letter: letter, mark: HabitRules.mark(habit, on: date, in: state), selected: date == selectedDate)
    }
    return HabitViewModel(
      definition: habit,
      status: HabitRules.status(habit.id, on: state.today, in: state) ?? .retired,
      selectedStatus: HabitRules.status(habit.id, on: selectedDate, in: state),
      entry: state.entry(habitId: habit.id, date: selectedDate),
      metrics: HabitRules.metrics(habit, in: state),
      week: week,
      selectedDateMark: mark,
      canFreeze: (mark == .missed || mark == .partial) && selectedDate == HabitDates.addDays(state.today, -1) && (pool?.balance ?? 0) > 0,
      frozen: mark == .frozen
    )
  }

  // MARK: History navigation

  /// The month after moving one step, held at the current month.
  public static func historyMonth(after month: String, step: Int, today: String) -> String {
    let candidate = HabitDates.monthShift(month, step)
    return candidate > HabitDates.monthKey(today) ? month : candidate
  }

  /// The first month with any habit data: the earliest creation date or entry.
  public static func earliestHistoryMonth(_ state: HabitsState) -> String {
    let dates = state.habits.map(\.createdOn) + state.entries.map(\.date)
    return HabitDates.monthKey(dates.reduce(state.today) { $1 < $0 ? $1 : $0 })
  }

  /// The full habit order after moving one habit next to another, so paused and archived habits keep their
  /// relative places. Nil when nothing moves.
  public static func reorderedIds(_ all: [String], moving dragId: String, onto targetId: String) -> [String]? {
    guard dragId != targetId, let from = all.firstIndex(of: dragId), let to = all.firstIndex(of: targetId) else { return nil }
    var without = all.filter { $0 != dragId }
    guard let targetIndex = without.firstIndex(of: targetId) else { return nil }
    without.insert(dragId, at: from < to ? targetIndex + 1 : targetIndex)
    return without
  }

  // MARK: Month summary and trend

  public static func monthSummary(_ month: String, in state: HabitsState) -> HabitMonthSummary {
    let dates = HabitDates.dates(inMonth: month)
    let lastDate = dates.last ?? "\(month)-28"
    // A retired habit keeps its history, so it stays in the months it ran for.
    let rows = state.habits.filter { $0.createdOn <= lastDate }.map { habit -> HabitMonthRow in
      let days = dates.map { HabitRules.mark(habit, on: $0, in: state) }
      let tracked = days.filter(\.isTracked).count
      let completed = days.filter { $0 == .complete }.count
      return HabitMonthRow(
        habit: habit, status: HabitRules.status(habit.id, on: lastDate, in: state), days: days,
        completedDays: completed, partialDays: days.filter { $0 == .partial }.count,
        frozenDays: days.filter { $0 == .frozen }.count, missedDays: days.filter { $0 == .missed }.count,
        trackedDays: tracked, completionRate: HabitRules.percent(completed, of: tracked)
      )
    }
    let perfectDays = dates.filter { $0 < state.today }.filter { date in
      let active = HabitRules.active(on: date, in: state)
      return !active.isEmpty && active.allSatisfy { HabitRules.mark($0, on: date, in: state) == .complete }
    }.count
    let tracked = rows.reduce(0) { $0 + $1.trackedDays }
    let completed = rows.reduce(0) { $0 + $1.completedDays }
    return HabitMonthSummary(
      month: month, label: HabitDates.monthLabel(month), rows: rows, perfectDays: perfectDays,
      frozenDays: rows.reduce(0) { $0 + $1.frozenDays }, completionRate: HabitRules.percent(completed, of: tracked)
    )
  }

  /// Completion per month for the `months` months ending at `endingMonth`, across all habits or one.
  public static func trend(_ state: HabitsState, endingMonth: String, months: Int, habitId: String?) -> [HabitTrendMonth] {
    trend(endingMonth: endingMonth, months: months, habitId: habitId) { monthSummary($0, in: state) }
  }

  /// The trend built from month summaries a caller may already hold, so changing the range or habit reuses them.
  public static func trend(endingMonth: String, months: Int, habitId: String?, summary: (String) -> HabitMonthSummary) -> [HabitTrendMonth] {
    (0..<months).map { index in
      let month = HabitDates.monthShift(endingMonth, index - (months - 1))
      let summary = summary(month)
      let rows = habitId.map { id in summary.rows.filter { $0.habit.id == id } } ?? summary.rows
      let completed = rows.reduce(0) { $0 + $1.completedDays }
      let tracked = rows.reduce(0) { $0 + $1.trackedDays }
      return HabitTrendMonth(
        month: month, shortLabel: HabitDates.shortMonthLabel(month),
        completionRate: tracked == 0 ? nil : HabitRules.percent(completed, of: tracked),
        completedDays: completed, trackedDays: tracked, perfectDays: summary.perfectDays
      )
    }
  }

  public static func sortRows(_ rows: [HabitMonthRow], by sort: HabitTileSort) -> [HabitMonthRow] {
    switch sort {
    case .order: return rows
    case .rate:
      return rows.enumerated().sorted { left, right in
        if left.element.completionRate != right.element.completionRate { return left.element.completionRate > right.element.completionRate }
        let names = left.element.habit.name.localizedCompare(right.element.habit.name)
        return names == .orderedSame ? left.offset < right.offset : names == .orderedAscending
      }.map(\.element)
    case .name:
      return rows.enumerated().sorted { left, right in
        let names = left.element.habit.name.localizedCompare(right.element.habit.name)
        return names == .orderedSame ? left.offset < right.offset : names == .orderedAscending
      }.map(\.element)
    }
  }

  // MARK: Pending check-offs

  /// Replays the clicks still in flight over a state that came from elsewhere, so a returning server result
  /// or a reload cannot re-check a box the user has already cleared, whichever day each click belonged to.
  public static func overlay(_ state: HabitsState, pending: [String: HabitPendingEntry]) -> HabitsState {
    guard !pending.isEmpty else { return state }
    let kept = state.entries.filter { pending[HabitPendingEntry.key($0.habitId, $0.date)] == nil }
    let applied = pending.values.sorted { $0.sequence < $1.sequence }.compactMap { intent -> HabitEntry? in
      intent.value == 0 ? nil : HabitEntry(habitId: intent.habitId, date: intent.date, value: intent.value, createdAt: intent.stamp, updatedAt: intent.stamp)
    }
    return state.with(entries: kept + applied)
  }
}

/// One click's intent, held from the optimistic update until that same click settles. `sequence` rises with
/// every click, so a slower earlier click can tell a later one has taken over the box.
public struct HabitPendingEntry: Sendable, Hashable {
  public let sequence: Int
  public let habitId: String
  public let date: String
  /// Percent the click asked for; 0 clears the entry.
  public let value: Int
  public let stamp: String
  public init(sequence: Int, habitId: String, date: String, value: Int, stamp: String) {
    self.sequence = sequence
    self.habitId = habitId
    self.date = date
    self.value = value
    self.stamp = stamp
  }
  public static func key(_ habitId: String, _ date: String) -> String { "\(habitId)|\(date)" }
}

// MARK: History types

public enum HabitTileSort: String, Sendable, CaseIterable, Identifiable {
  case order, rate, name
  public var id: String { rawValue }
  public var label: String {
    switch self {
    case .order: return "Your order"
    case .rate: return "Completion"
    case .name: return "Name"
    }
  }
}

public struct HabitMonthRow: Sendable, Hashable, Identifiable {
  public let habit: HabitDefinition
  public let status: HabitLifecycleStatus?
  public let days: [HabitDayMark]
  public let completedDays: Int
  public let partialDays: Int
  public let frozenDays: Int
  public let missedDays: Int
  public let trackedDays: Int
  public let completionRate: Int
  public var id: String { habit.id }

  public init(habit: HabitDefinition, status: HabitLifecycleStatus?, days: [HabitDayMark], completedDays: Int, partialDays: Int, frozenDays: Int, missedDays: Int, trackedDays: Int, completionRate: Int) {
    self.habit = habit
    self.status = status
    self.days = days
    self.completedDays = completedDays
    self.partialDays = partialDays
    self.frozenDays = frozenDays
    self.missedDays = missedDays
    self.trackedDays = trackedDays
    self.completionRate = completionRate
  }

  /// "Paused" or "Archived" for a habit not active at the month's end.
  public var lifecycleLabel: String? {
    switch status {
    case .paused?: return "Paused"
    case .retired?: return "Archived"
    default: return nil
    }
  }

  /// The ring's slices: tracked days by state, or one untracked slice.
  public var slices: [HabitPerformanceSlice] {
    guard trackedDays > 0 else { return [HabitPerformanceSlice(kind: .untracked, value: 1)] }
    return [
      HabitPerformanceSlice(kind: .complete, value: completedDays),
      HabitPerformanceSlice(kind: .partial, value: partialDays),
      HabitPerformanceSlice(kind: .frozen, value: frozenDays),
      HabitPerformanceSlice(kind: .missed, value: missedDays)
    ].filter { $0.value > 0 }
  }

  /// What VoiceOver reads for the tile.
  public var accessibilityLabel: String {
    let status = lifecycleLabel.map { " \($0)." } ?? ""
    let states = slices.filter { $0.kind != .untracked }.map { "\($0.value) \($0.kind.label.lowercased())" }.joined(separator: ", ")
    return "\(habit.name).\(status) \(completionRate)% complete. \(states.isEmpty ? "No tracked days." : "\(states).") Open details."
  }
}

public struct HabitPerformanceSlice: Sendable, Hashable {
  public enum Kind: String, Sendable, Hashable {
    case complete, partial, frozen, missed, untracked
    public var label: String {
      switch self {
      case .complete: return "Complete"
      case .partial: return "Partial"
      case .frozen: return "Frozen"
      case .missed: return "Missed"
      case .untracked: return "No tracked days"
      }
    }
  }
  public let kind: Kind
  public let value: Int
  public init(kind: Kind, value: Int) {
    self.kind = kind
    self.value = value
  }
}

/// One drawn arc of a completion ring, as fractions of the full circle.
public struct HabitRingArc: Sendable, Hashable {
  public let kind: HabitPerformanceSlice.Kind
  public let start: Double
  public let end: Double

  /// Lays slices clockwise from twelve o'clock with `gap` (a fraction of the circle) between neighbors.
  public static func arcs(_ slices: [HabitPerformanceSlice], gap: Double) -> [HabitRingArc] {
    let total = Double(slices.reduce(0) { $0 + $1.value })
    guard total > 0 else { return [] }
    let spacing = slices.count > 1 ? gap : 0
    var cursor = 0.0
    return slices.map { slice in
      let span = Double(slice.value) / total
      let arc = HabitRingArc(kind: slice.kind, start: cursor + spacing / 2, end: cursor + spacing / 2 + max(span - spacing, 0))
      cursor += span
      return arc
    }
  }
}

public struct HabitMonthSummary: Sendable, Hashable {
  public let month: String
  public let label: String
  public let rows: [HabitMonthRow]
  public let perfectDays: Int
  public let frozenDays: Int
  public let completionRate: Int
}

public struct HabitTrendMonth: Sendable, Hashable, Identifiable {
  public let month: String
  public let shortLabel: String
  public let completionRate: Int?
  public let completedDays: Int
  public let trackedDays: Int
  public let perfectDays: Int
  public var id: String { month }
}

// MARK: Day totals

/// How one day's habits went: the habits active that day and how many were completed.
public struct HabitDayTotal: Sendable, Hashable {
  public let date: String
  public let active: Int
  public let completed: Int
  public init(date: String, active: Int, completed: Int) {
    self.date = date
    self.active = active
    self.completed = completed
  }

  /// Every active habit completed.
  public var perfect: Bool { active > 0 && completed == active }
}

public extension HabitMonthSummary {
  /// Each day of the month with its active and completed habit counts, read from the rows' day marks so
  /// the calendar and the month summary always agree. Future days and days with no active habit count zero.
  var dayTotals: [HabitDayTotal] {
    HabitDates.dates(inMonth: month).enumerated().map { index, date in
      var active = 0
      var completed = 0
      for row in rows where row.days.indices.contains(index) {
        let mark = row.days[index]
        if mark.isTracked || mark == .pending { active += 1 }
        if mark == .complete { completed += 1 }
      }
      return HabitDayTotal(date: date, active: active, completed: completed)
    }
  }
}
