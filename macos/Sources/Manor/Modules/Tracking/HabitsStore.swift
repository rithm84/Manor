import Foundation
import ManorKit
import Observation

/// What the daily list shows for the selected day, computed once per state or day change.
struct HabitsDailySnapshot {
  let selectedDate: String
  let today: String
  let active: [HabitViewModel]
  let paused: [HabitViewModel]
  let archived: [HabitDefinition]
  let completed: Int
  let frozen: Int
  let pool: HabitMonthPool?

  var isToday: Bool { selectedDate == today }
  var yesterday: String { HabitDates.addDays(today, -1) }
  var remaining: Int { active.count - completed }
  /// A frozen habit is resolved, not pending, so it never counts as left; it still keeps the day from being perfect.
  var uncovered: Int { remaining - frozen }
  var perfect: Bool { !active.isEmpty && remaining == 0 }
}

/// The Habits page's state: the loaded history, the selected day, in-flight check-offs, and every mutation.
@MainActor
@Observable
final class HabitsStore {
  let service: HabitsService
  private(set) var state: HabitsState? { didSet { invalidateDerived() } }
  private(set) var loading = true
  /// The last failure, shown as a banner until the next success.
  var errorMessage: String?
  var selectedDate: String { didSet { if selectedDate != oldValue { rebuildDaily() } } }
  var historyMonth: String
  private(set) var daily: HabitsDailySnapshot?

  @ObservationIgnored private var pending: [String: HabitPendingEntry] = [:]
  @ObservationIgnored private var clickSequence = 0
  @ObservationIgnored private var hasLoaded = false

  init(gateway: Gateway, today: @escaping () -> String) {
    service = HabitsService(gateway: gateway, today: today)
    let now = today()
    selectedDate = now
    historyMonth = HabitDates.monthKey(now)
  }

  // MARK: Loading

  func load() async {
    do {
      let loaded = try await service.load()
      if loaded.isLatest { apply(loaded.state) }
      errorMessage = nil
    } catch is CancellationError {
      // The page went away mid-load; nothing to report.
    } catch {
      errorMessage = Self.message(error)
    }
    loading = false
  }

  /// Reloads whenever another device, an agent, or the mirror changes a habit table.
  func listen() async {
    for await _ in service.gateway.changes(of: HabitsService.tables) {
      await load()
    }
  }

  private func apply(_ loaded: HabitsState) {
    let next = HabitModel.overlay(loaded, pending: pending)
    let today = next.today
    if !hasLoaded {
      hasLoaded = true
      selectedDate = today
      historyMonth = HabitDates.monthKey(today)
    } else if selectedDate > today || selectedDate < HabitDates.addDays(today, -1) {
      // Backfill reaches one day; after midnight passes twice the page returns to today.
      selectedDate = today
    }
    if historyMonth > HabitDates.monthKey(today) { historyMonth = HabitDates.monthKey(today) }
    state = next
    rebuildDaily()
  }

  private func rebuildDaily() {
    guard let state else { daily = nil; return }
    let date = selectedDate
    let active = HabitRules.active(on: date, in: state).map { HabitModel.viewModel($0, selectedDate: date, in: state) }
    let paused = date == state.today
      ? state.habits.filter { HabitRules.status($0.id, on: state.today, in: state) == .paused }.map { HabitModel.viewModel($0, selectedDate: date, in: state) }
      : []
    daily = HabitsDailySnapshot(
      selectedDate: date, today: state.today, active: active, paused: paused,
      archived: state.habits.filter { HabitRules.status($0.id, on: state.today, in: state) == .retired },
      completed: active.filter(\.isComplete).count, frozen: active.filter(\.frozen).count,
      pool: state.pool(month: HabitDates.monthKey(state.today))
    )
  }

  // MARK: Derived history (computed once per data change, read by views)

  @ObservationIgnored private var summaryCache: [String: HabitMonthSummary] = [:]
  @ObservationIgnored private var historyCache: [HistoryKey: HabitsHistoryData] = [:]
  @ObservationIgnored private var detailCache: [String: HabitDetailData] = [:]
  @ObservationIgnored private var earliestMonthCache: String?

  private func invalidateDerived() {
    summaryCache.removeAll(keepingCapacity: true)
    historyCache.removeAll(keepingCapacity: true)
    detailCache.removeAll(keepingCapacity: true)
    earliestMonthCache = nil
  }

  private func summary(_ month: String, in state: HabitsState) -> HabitMonthSummary {
    if let cached = summaryCache[month] { return cached }
    let computed = HabitModel.monthSummary(month, in: state)
    summaryCache[month] = computed
    return computed
  }

  struct HistoryKey: Hashable {
    let month: String
    let range: Int
    let habitId: String?
    let showArchived: Bool
    let sort: HabitTileSort
  }

  /// Everything the History view draws for one month, range, scope, and ordering.
  func history(_ key: HistoryKey) -> HabitsHistoryData? {
    guard let state else { return nil }
    if let cached = historyCache[key] { return cached }
    let summary = summary(key.month, in: state)
    let visible = key.showArchived ? summary.rows : summary.rows.filter { $0.status != .retired }
    // A habit hidden by the archived toggle or absent from the month falls back to all habits.
    let habitId = key.habitId.flatMap { id in visible.contains { $0.habit.id == id } ? id : nil }
    let trend = HabitModel.trend(endingMonth: key.month, months: key.range, habitId: habitId) { self.summary($0, in: state) }
    if earliestMonthCache == nil { earliestMonthCache = HabitModel.earliestHistoryMonth(state) }
    let data = HabitsHistoryData(
      summary: summary, visibleRows: visible, rankedRows: HabitModel.sortRows(visible, by: key.sort),
      archivedCount: summary.rows.filter { $0.status == .retired }.count,
      trendHabitId: habitId, trendHabitName: habitId.flatMap { state.habit($0)?.name }, trend: trend, trendPoints: HabitTrendPoint.points(trend),
      dayTotals: summary.dayTotals,
      earliestMonth: earliestMonthCache ?? key.month
    )
    historyCache[key] = data
    return data
  }

  /// A habit's detail dialog content for one shown month.
  func detail(habitId: String, month: String) -> HabitDetailData? {
    guard let state, let definition = state.habit(habitId) else { return nil }
    let key = "\(habitId)|\(month)|\(selectedDate)"
    if let cached = detailCache[key] { return cached }
    let dates = HabitDates.dates(inMonth: month)
    let marks = dates.map { HabitRules.mark(definition, on: $0, in: state) }
    let data = HabitDetailData(
      habit: HabitModel.viewModel(definition, selectedDate: selectedDate, in: state),
      month: month, dates: dates, marks: marks, completedCount: marks.filter { $0 == .complete }.count,
      canMoveForward: HabitDates.monthShift(month, 1) <= HabitDates.monthKey(state.today)
    )
    detailCache[key] = data
    return data
  }

  // MARK: Mutations

  /// Runs a mutation, applies the committed state, and reports a failure in the banner. Nil on failure.
  @discardableResult
  private func persist(_ failure: String, _ work: () async throws -> HabitsService.Loaded) async -> HabitsState? {
    do {
      let loaded = try await work()
      if loaded.isLatest { apply(loaded.state) }
      errorMessage = nil
      return loaded.state
    } catch {
      errorMessage = "\(failure). \(Self.message(error))"
      return nil
    }
  }

  /// Logs a percent on the selected day (0 clears it). The box changes at once; streaks and the pool settle
  /// on the committed state, and a later click on the same box owns the outcome.
  func log(habitId: String, value: Int) async {
    guard let current = state else { return }
    let date = selectedDate
    let key = HabitPendingEntry.key(habitId, date)
    let prior = current.entry(habitId: habitId, date: date)
    clickSequence += 1
    let sequence = clickSequence
    pending[key] = HabitPendingEntry(sequence: sequence, habitId: habitId, date: date, value: value, stamp: ISO8601DateFormatter().string(from: Date()))
    state = HabitModel.overlay(current, pending: pending)
    rebuildDaily()
    let saved = await persist("Could not save that check-off") { try await service.setEntry(habitId: habitId, date: date, value: value) }
    guard pending[key]?.sequence == sequence else { return }
    pending[key] = nil
    if saved == nil, let latest = state {
      // Only this box goes back; the streaks and pool other results brought in stay.
      let entries = latest.entries.filter { !($0.habitId == habitId && $0.date == date) } + (prior.map { [$0] } ?? [])
      state = latest.with(entries: entries)
      rebuildDaily()
    }
  }

  func freeze(habitId: String) async -> Bool {
    let date = selectedDate
    return await persist("Could not use a freeze") { try await service.applyFreeze(habitId: habitId, date: date) } != nil
  }

  func unfreeze(habitId: String) async {
    let date = selectedDate
    await persist("Could not return the freeze") { try await service.clearFreeze(habitId: habitId, date: date) }
  }

  /// Changes a habit's status from today. Returns the habit's name on success.
  func setStatus(habitId: String, _ status: HabitLifecycleStatus) async -> String? {
    let verb = status == .active ? "resume" : status == .paused ? "pause" : "retire"
    let result = await persist("Could not \(verb) the habit") { try await service.setStatus(habitId: habitId, status: status) }
    return result.map { $0.habit(habitId)?.name ?? "Habit" }
  }

  /// Creates or updates a habit; throws so the editor can show the failure beside the form.
  func save(_ draft: HabitDraft, editing habitId: String?) async throws {
    let loaded: HabitsService.Loaded
    if let habitId {
      loaded = try await service.updateHabit(habitId, draft)
    } else {
      loaded = try await service.createHabit(draft)
    }
    if loaded.isLatest { apply(loaded.state) }
    errorMessage = nil
  }

  /// Saves a full habit order. The habits land in place at once and return to the old order on failure.
  func commitOrder(_ order: [String]) async {
    guard let before = state else { return }
    let byId = Dictionary(uniqueKeysWithValues: before.habits.map { ($0.id, $0) })
    state = before.with(habits: order.compactMap { byId[$0] })
    rebuildDaily()
    if await persist("Could not reorder habits", { try await service.reorder(order) }) == nil {
      state = HabitModel.overlay(before, pending: pending)
      rebuildDaily()
    }
  }

  /// Moves one habit next to another in the full order.
  func move(_ dragId: String, onto targetId: String) async {
    guard let state, let order = HabitModel.reorderedIds(state.habits.map(\.id), moving: dragId, onto: targetId) else { return }
    await commitOrder(order)
  }

  static func message(_ error: Error) -> String {
    (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
  }
}

struct HabitsHistoryData {
  let summary: HabitMonthSummary
  let visibleRows: [HabitMonthRow]
  let rankedRows: [HabitMonthRow]
  let archivedCount: Int
  let trendHabitId: String?
  let trendHabitName: String?
  let trend: [HabitTrendMonth]
  let trendPoints: [HabitTrendPoint]
  let dayTotals: [HabitDayTotal]
  /// The first month with any habit data.
  let earliestMonth: String
}

struct HabitDetailData {
  let habit: HabitViewModel
  let month: String
  let dates: [String]
  let marks: [HabitDayMark]
  let completedCount: Int
  let canMoveForward: Bool
}

/// A month with a rate, and the unbroken run it belongs to, so the line breaks across months with no data.
struct HabitTrendPoint: Identifiable {
  let month: HabitTrendMonth
  let rate: Int
  let run: Int
  var id: String { month.month }

  static func points(_ trend: [HabitTrendMonth]) -> [HabitTrendPoint] {
    var run = 0
    var points: [HabitTrendPoint] = []
    for item in trend {
      guard let rate = item.completionRate else { run += 1; continue }
      points.append(HabitTrendPoint(month: item, rate: rate, run: run))
    }
    return points
  }
}
