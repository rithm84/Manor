import Foundation
import Testing
@testable import ManorKit


private let readHabit = HabitDefinition(
  id: "habit-one", name: "Read", kind: .binary, targetLabel: nil, createdOn: "2026-08-01", createdAt: "2026-08-01T08:00:00.000Z"
)

private func lifecycle(_ habitId: String, _ date: String, _ status: HabitLifecycleStatus) -> HabitLifecycleEvent {
  HabitLifecycleEvent(habitId: habitId, date: date, status: status, createdAt: "\(date)T08:00:00.000Z")
}

private func entry(_ habitId: String, _ date: String, _ value: Int) -> HabitEntry {
  HabitEntry(habitId: habitId, date: date, value: value, createdAt: "\(date)T20:00:00.000Z", updatedAt: "\(date)T20:00:00.000Z")
}

private func streakState(
  today: String, completed: [String], frozen: [String], extraLifecycle: [HabitLifecycleEvent] = [], poolDays: [HabitPoolDay]? = nil
) -> HabitsState {
  HabitsState(
    today: today, habits: [readHabit],
    lifecycle: [lifecycle(readHabit.id, readHabit.createdOn, .active)] + extraLifecycle,
    entries: completed.map { entry(readHabit.id, $0, 100) },
    intents: frozen.map { HabitFreezeIntent(habitId: readHabit.id, date: $0, createdAt: "\($0)T22:00:00.000Z") },
    freezes: frozen.map { HabitFreezeUsage(habitId: readHabit.id, date: $0) },
    poolDays: poolDays
  )
}

@Suite("Habit streak metrics")
struct HabitStreakTests {
  @Test func restoresABrokenStreakAfterTwoCleanDaysOnceThatMonth() {
    let state = streakState(today: "2026-08-04", completed: ["2026-08-01", "2026-08-03", "2026-08-04"], frozen: [], poolDays: [HabitPoolDay(date: "2026-08-02", balance: 0)])
    let metrics = HabitRules.metrics(readHabit, in: state)
    #expect(metrics.currentStreak == 3)
    #expect(metrics.earnBackUsedThisMonth)
  }

  @Test func requiresSevenFreezeFreeDaysForGold() {
    let dates = (1...7).map { "2026-08-0\($0)" }
    #expect(HabitRules.metrics(readHabit, in: streakState(today: "2026-08-07", completed: dates, frozen: [])).gold)

    let frozen = HabitRules.metrics(readHabit, in: streakState(today: "2026-08-07", completed: dates.filter { $0 != "2026-08-04" }, frozen: ["2026-08-04"]))
    #expect(frozen.currentStreak == 7)
    #expect(!frozen.gold)
  }

  @Test func offersNoEarnBackWhenFreezesWereAvailableOrTheBalanceIsUnknown() {
    let completed = ["2026-08-01", "2026-08-03", "2026-08-04"]
    #expect(HabitRules.metrics(readHabit, in: streakState(today: "2026-08-04", completed: completed, frozen: [])).currentStreak == 2)
    let withFreezes = streakState(today: "2026-08-04", completed: completed, frozen: [], poolDays: [HabitPoolDay(date: "2026-08-02", balance: 1)])
    #expect(!HabitRules.metrics(readHabit, in: withFreezes).earnBackUsedThisMonth)
  }

  @Test func startsANewStreakAfterReactivationKeepingTheBest() {
    let state = streakState(
      today: "2026-08-05", completed: ["2026-08-01", "2026-08-02", "2026-08-05"], frozen: [],
      extraLifecycle: [lifecycle(readHabit.id, "2026-08-03", .retired), lifecycle(readHabit.id, "2026-08-05", .active)],
      poolDays: [HabitPoolDay(date: "2026-08-03", balance: 0)]
    )
    let metrics = HabitRules.metrics(readHabit, in: state)
    #expect(metrics.currentStreak == 1)
    #expect(metrics.bestStreak == 2)
    #expect(metrics.earnBackProgress == 0)
  }

  @Test func countsOnlyActiveDaysTowardCompletion() {
    let state = streakState(
      today: "2026-08-06", completed: ["2026-08-01", "2026-08-02", "2026-08-05"], frozen: [],
      extraLifecycle: [lifecycle(readHabit.id, "2026-08-03", .paused), lifecycle(readHabit.id, "2026-08-05", .active)]
    )
    let metrics = HabitRules.metrics(readHabit, in: state)
    // Active on the 1st, 2nd, 5th, and 6th (today, still pending).
    #expect(metrics.trackedDays == 4)
    #expect(metrics.completedDays == 3)
    #expect(metrics.completionRate == 75)
    #expect(metrics.currentStreak == 3)
  }
}

@Suite("Habit day marks")
struct HabitMarkTests {
  @Test func readsEachDayState() {
    let state = HabitsState(
      today: "2026-08-05", habits: [readHabit],
      lifecycle: [lifecycle(readHabit.id, "2026-08-01", .active), lifecycle(readHabit.id, "2026-08-04", .paused), lifecycle(readHabit.id, "2026-08-05", .active)],
      entries: [entry(readHabit.id, "2026-08-01", 100), entry(readHabit.id, "2026-08-02", 50)],
      freezes: [HabitFreezeUsage(habitId: readHabit.id, date: "2026-08-02")]
    )
    #expect(HabitRules.mark(readHabit, on: "2026-07-31", in: state) == .inactive)
    #expect(HabitRules.mark(readHabit, on: "2026-08-01", in: state) == .complete)
    // A freeze covers the day whatever partial progress it holds.
    #expect(HabitRules.mark(readHabit, on: "2026-08-02", in: state) == .frozen)
    #expect(HabitRules.mark(readHabit, on: "2026-08-03", in: state) == .missed)
    #expect(HabitRules.mark(readHabit, on: "2026-08-04", in: state) == .paused)
    #expect(HabitRules.mark(readHabit, on: "2026-08-05", in: state) == .pending)
    #expect(HabitRules.mark(readHabit, on: "2026-08-06", in: state) == .future)
  }

  @Test func offersAFreezeOnlyForYesterdaysMissWhileThePoolLasts() {
    let state = HabitsState(
      today: "2026-08-05", habits: [readHabit], lifecycle: [lifecycle(readHabit.id, "2026-08-01", .active)], entries: [],
      pools: [HabitMonthPool(month: "2026-08", capacity: 1, earned: 0, spent: 0, balance: 1)]
    )
    #expect(HabitModel.viewModel(readHabit, selectedDate: "2026-08-04", in: state).canFreeze)
    #expect(!HabitModel.viewModel(readHabit, selectedDate: "2026-08-05", in: state).canFreeze)
    let empty = HabitsState(
      today: "2026-08-05", habits: [readHabit], lifecycle: state.lifecycle, entries: [],
      pools: [HabitMonthPool(month: "2026-08", capacity: 1, earned: 0, spent: 1, balance: 0)]
    )
    #expect(!HabitModel.viewModel(readHabit, selectedDate: "2026-08-04", in: empty).canFreeze)
  }

  @Test func buildsAMondayToSundayWeek() {
    let state = HabitsState(today: "2026-08-05", habits: [readHabit], lifecycle: [lifecycle(readHabit.id, "2026-08-01", .active)], entries: [])
    let week = HabitModel.viewModel(readHabit, selectedDate: "2026-08-05", in: state).week
    #expect(week.map(\.date).first == "2026-08-03")
    #expect(week.map(\.date).last == "2026-08-09")
    #expect(week.map(\.letter) == ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"])
    #expect(week.filter(\.selected).map(\.date) == ["2026-08-05"])
  }
}

@Suite("Quantized habit steps")
struct HabitStepTests {
  @Test func derivesOneStepPerUnitFromASmallTarget() {
    #expect(HabitRules.ladder("2 tablets") == [0, 50, 100])
    #expect(HabitRules.ladder("3 tablets") == [0, 33, 66, 100])
    #expect(HabitRules.ladder("8 glasses") == [0, 12, 25, 37, 50, 62, 75, 87, 100])
    #expect(HabitRules.targetUnitCount("Take 2 tablets") == 2)
  }

  @Test func fallsBackToQuartersForLargeOrNumberlessTargets() {
    #expect(HabitRules.ladder("48 oz") == [0, 25, 50, 75, 100])
    #expect(HabitRules.ladder("105 g") == [0, 25, 50, 75, 100])
    #expect(HabitRules.ladder("a few stretches") == [0, 25, 50, 75, 100])
    #expect(HabitRules.targetUnitCount("1.5 miles") == nil)
  }

  @Test func snapsOlderValuesToTheNearestStep() {
    #expect(HabitRules.nearestStep(HabitRules.ladder("3 tablets"), 25) == 33)
    #expect(HabitRules.nearestStep(HabitRules.ladder("48 oz"), 66) == 75)
  }

  @Test func cyclesThroughTheLadderInBothDirections() {
    let ladder = HabitRules.ladder("105 oz")
    #expect(HabitRules.shifted(ladder, from: 50, by: 1) == 75)
    #expect(HabitRules.shifted(ladder, from: 50, by: -1) == 25)
    #expect(HabitRules.shifted(ladder, from: 100, by: 1) == 0)
    #expect(HabitRules.shifted(ladder, from: 0, by: -1) == 100)
  }

  @Test func labelsTheAmountForAStep() {
    #expect(HabitRules.stepAmountLabel("105 oz", 50) == "53 oz / 105 oz")
    #expect(HabitRules.stepAmountLabel("3 tablets", 33) == "1 tablet / 3 tablets")
    #expect(HabitRules.stepAmountLabel("a few", 50) == "50%")
  }

  @Test func hintsHowATargetLogs() {
    #expect(HabitRules.stepsHint("1 walk") == "Logged in one step")
    #expect(HabitRules.stepsHint("3 tablets") == "Logged one at a time, in 3 steps")
    #expect(HabitRules.stepsHint("48 oz") == "Logged in quarters")
  }
}

private let activeHabit = HabitDefinition(id: "active-habit", name: "Active habit", kind: .quantized, targetLabel: "4 sets", createdOn: "2026-08-01", createdAt: "2026-08-01T08:00:00.000Z")
private let retiredHabit = HabitDefinition(id: "retired-habit", name: "Retired habit", kind: .binary, targetLabel: nil, createdOn: "2026-08-01", createdAt: "2026-08-01T08:01:00.000Z")

private func historyState(habits: [HabitDefinition] = [activeHabit, retiredHabit], entries: [HabitEntry]? = nil) -> HabitsState {
  HabitsState(
    today: "2026-08-05", habits: habits,
    lifecycle: [lifecycle(activeHabit.id, "2026-08-01", .active), lifecycle(retiredHabit.id, "2026-08-01", .active), lifecycle(retiredHabit.id, "2026-08-04", .retired)],
    entries: entries ?? [entry(activeHabit.id, "2026-08-01", 100), entry(activeHabit.id, "2026-08-02", 50), entry(retiredHabit.id, "2026-08-01", 100), entry(retiredHabit.id, "2026-08-02", 100)],
    freezes: [HabitFreezeUsage(habitId: activeHabit.id, date: "2026-08-03")]
  )
}

@Suite("Habit history aggregation")
struct HabitHistoryTests {
  @Test func keepsRetiredHabitsInTheMonthsTheyRan() throws {
    let summary = HabitModel.monthSummary("2026-08", in: historyState())
    let active = try #require(summary.rows.first { $0.habit.id == activeHabit.id })
    let retired = try #require(summary.rows.first { $0.habit.id == retiredHabit.id })
    #expect(active.completedDays == 1)
    #expect(active.partialDays == 1)
    #expect(active.frozenDays == 1)
    #expect(active.trackedDays == 4)
    #expect(active.completionRate == 25)
    #expect(retired.completedDays == 2)
    #expect(retired.trackedDays == 3)
    #expect(retired.status == .retired)
    #expect(summary.rows.count == 2)
    #expect(summary.frozenDays == 1)
  }

  @Test func keepsTwelveMonthHistoryChronological() {
    let trend = HabitModel.trend(historyState(), endingMonth: "2026-08", months: 12, habitId: nil)
    #expect(trend.count == 12)
    #expect(trend.first?.month == "2025-09")
    #expect(trend.last?.month == "2026-08")
  }

  @Test func excludesFutureAndInactiveDaysFromTrendDenominators() {
    let trend = HabitModel.trend(historyState(), endingMonth: "2026-08", months: 3, habitId: nil)
    #expect(trend.map(\.month) == ["2026-06", "2026-07", "2026-08"])
    #expect(trend[0].completionRate == nil && trend[0].trackedDays == 0)
    #expect(trend[1].completionRate == nil && trend[1].trackedDays == 0)
    #expect(trend[2].completionRate == 43)
    #expect(trend[2].completedDays == 3)
    #expect(trend[2].trackedDays == 7)
  }

  @Test func keepsARetiredHabitSelectable() {
    let trend = HabitModel.trend(historyState(), endingMonth: "2026-08", months: 3, habitId: retiredHabit.id)
    #expect(trend.last?.completionRate == 67)
    #expect(trend.last?.completedDays == 2)
    #expect(trend.last?.trackedDays == 3)
  }

  @Test func blocksNavigationBeyondTheCurrentMonth() {
    #expect(HabitModel.historyMonth(after: "2026-08", step: -1, today: "2026-08-05") == "2026-07")
    #expect(HabitModel.historyMonth(after: "2026-07", step: 1, today: "2026-08-05") == "2026-08")
    #expect(HabitModel.historyMonth(after: "2026-08", step: 1, today: "2026-08-05") == "2026-08")
    #expect(HabitDates.monthShift("2026-01", -1) == "2025-12")
    #expect(HabitDates.monthShift("2025-12", 1) == "2026-01")
  }

  @Test func boundsBackwardNavigationAtTheEarliestMonth() {
    #expect(HabitModel.earliestHistoryMonth(historyState()) == "2026-08")
    var backdated = activeHabit
    backdated = HabitDefinition(id: backdated.id, name: backdated.name, kind: backdated.kind, targetLabel: backdated.targetLabel, createdOn: "2026-05-14", createdAt: backdated.createdAt)
    #expect(HabitModel.earliestHistoryMonth(historyState(habits: [backdated, retiredHabit])) == "2026-05")
    #expect(HabitModel.earliestHistoryMonth(historyState(habits: [], entries: [])) == "2026-08")
  }
}

private let performanceRow = HabitMonthRow(
  habit: HabitDefinition(id: "read", name: "Read", kind: .binary, targetLabel: nil, createdOn: "2026-08-01", createdAt: "2026-08-01T08:00:00.000Z"),
  status: .paused, days: [.complete, .complete, .partial, .frozen, .missed, .pending, .future],
  completedDays: 2, partialDays: 1, frozenDays: 1, missedDays: 1, trackedDays: 5, completionRate: 40
)

@Suite("Habit performance rings")
struct HabitRingTests {
  @Test func keepsTheRingDenominatorOnTrackedDays() {
    let slices = performanceRow.slices
    #expect(slices.map(\.kind) == [.complete, .partial, .frozen, .missed])
    #expect(slices.map(\.value) == [2, 1, 1, 1])
    #expect(slices.reduce(0) { $0 + $1.value } == performanceRow.trackedDays)
  }

  @Test func announcesStatusRateCountsAndIntent() {
    #expect(performanceRow.accessibilityLabel == "Read. Paused. 40% complete. 2 complete, 1 partial, 1 frozen, 1 missed. Open details.")
  }

  @Test func laysMixedMonthsOutAsGappedArcs() {
    let gap = 3 / (2 * Double.pi * 52)
    let arcs = HabitRingArc.arcs(performanceRow.slices, gap: gap)
    #expect(arcs.map(\.kind) == [.complete, .partial, .frozen, .missed])
    #expect(abs(arcs[0].start - gap / 2) < 1e-9)
    #expect(abs(arcs[1].start - (0.4 + gap / 2)) < 1e-9)
    let covered = arcs.reduce(0) { $0 + ($1.end - $1.start) }
    #expect(abs(covered - (1 - 4 * gap)) < 1e-9)
  }

  @Test func drawsASingleStateMonthAsOneSeamlessBand() {
    let missedOnly = HabitMonthRow(habit: performanceRow.habit, status: .active, days: [.missed, .pending], completedDays: 0, partialDays: 0, frozenDays: 0, missedDays: 1, trackedDays: 1, completionRate: 0)
    #expect(missedOnly.slices.map(\.kind) == [.missed])
    let arcs = HabitRingArc.arcs(missedOnly.slices, gap: 0.01)
    #expect(arcs.count == 1 && arcs[0].start == 0 && arcs[0].end == 1)
  }
}

@Suite("Habit ordering")
struct HabitOrderTests {
  private func row(_ id: String, _ name: String, _ rate: Int) -> HabitMonthRow {
    HabitMonthRow(habit: HabitDefinition(id: id, name: name, kind: .binary, targetLabel: nil, createdOn: "2026-08-01", createdAt: "2026-08-01T08:00:00.000Z"), status: .active, days: [], completedDays: 0, partialDays: 0, frozenDays: 0, missedDays: 0, trackedDays: 0, completionRate: rate)
  }

  @Test func sortsByOrderRateOrName() {
    let rows = [row("b", "Water", 40), row("a", "Read", 90), row("c", "Stretch", 90)]
    #expect(HabitModel.sortRows(rows, by: .order).map(\.id) == ["b", "a", "c"])
    #expect(HabitModel.sortRows(rows, by: .rate).map(\.id) == ["a", "c", "b"])
    #expect(HabitModel.sortRows(rows, by: .name).map(\.id) == ["a", "c", "b"])
  }

  @Test func movesAHabitNextToItsDropTarget() {
    let all = ["a", "b", "c", "d"]
    #expect(HabitModel.reorderedIds(all, moving: "a", onto: "c") == ["b", "c", "a", "d"])
    #expect(HabitModel.reorderedIds(all, moving: "d", onto: "b") == ["a", "d", "b", "c"])
    #expect(HabitModel.reorderedIds(all, moving: "b", onto: "b") == nil)
    #expect(HabitModel.reorderedIds(all, moving: "b", onto: "zzz") == nil)
  }
}

@Suite("Pending check-offs")
struct HabitPendingTests {
  private let today = "2026-08-05"
  private let yesterday = "2026-08-04"

  private func state() -> HabitsState {
    HabitsState(today: today, habits: [readHabit], lifecycle: [lifecycle(readHabit.id, "2026-08-01", .active)], entries: [entry(readHabit.id, today, 100)])
  }

  private func pending(_ value: Int, _ date: String) -> [String: HabitPendingEntry] {
    [HabitPendingEntry.key(readHabit.id, date): HabitPendingEntry(sequence: 2, habitId: readHabit.id, date: date, value: value, stamp: "\(today)T21:00:00.000Z")]
  }

  @Test func leavesTheStateAloneWhenNothingIsInFlight() {
    #expect(HabitModel.overlay(state(), pending: [:]) == state())
  }

  @Test func replacesAServerEntryWithTheClickedValue() {
    let overlaid = HabitModel.overlay(state(), pending: pending(50, today))
    #expect(overlaid.entries == [HabitEntry(habitId: readHabit.id, date: today, value: 50, createdAt: "\(today)T21:00:00.000Z", updatedAt: "\(today)T21:00:00.000Z")])
    #expect(overlaid.entry(habitId: readHabit.id, date: today)?.value == 50)
  }

  @Test func removesAServerEntryWhenTheClickClearedIt() {
    #expect(HabitModel.overlay(state(), pending: pending(0, today)).entries.isEmpty)
  }

  @Test func keepsAClickOnAnotherDay() {
    let overlaid = HabitModel.overlay(state(), pending: pending(100, yesterday))
    #expect(overlaid.entries.map { [$0.date, String($0.value)] } == [[today, "100"], [yesterday, "100"]])
  }
}

@Suite("Habit data parsing")
struct HabitParsingTests {
  private let payload: JSONValue = [
    "today": "2026-08-05",
    "habits": [["id": "h1", "name": "Water", "kind": "quantized", "targetLabel": "48 oz", "createdOn": "2026-08-01", "createdAt": "2026-08-01T08:00:00Z"]],
    "lifecycle": [["habitId": "h1", "date": "2026-08-01", "status": "active", "createdAt": "2026-08-01T08:00:00Z"]],
    "entries": [["habitId": "h1", "date": "2026-08-02", "value": 50, "createdAt": "2026-08-02T08:00:00Z", "updatedAt": "2026-08-02T08:00:00Z"]],
    "intents": [], "freezes": [], "grants": [["date": "2026-08-03"]],
    "pools": [["month": "2026-08", "capacity": 1, "earned": 1, "spent": 0, "balance": 1]],
    "poolDays": [["date": "2026-08-01", "balance": 1]]
  ]

  @Test func readsTheDerivedStateWithRevisions() throws {
    let state = try HabitParsing.state(payload, habitRows: [["id": "h1", "revision": 3]])
    #expect(state.habits.first?.revision == 3)
    #expect(state.habits.first?.targetLabel == "48 oz")
    #expect(state.entries.first?.value == 50)
    #expect(state.pool(month: "2026-08")?.balance == 1)
    #expect(state.grantDates == ["2026-08-03"])
  }

  @Test func refusesAHabitMissingFromTheTable() {
    #expect(throws: HabitsDataError.self) { try HabitParsing.state(payload, habitRows: []) }
  }

  @Test func refusesImpossibleDates() {
    #expect(!HabitDates.isValid("2026-02-30"))
    #expect(HabitDates.isValid("2028-02-29"))
    #expect(HabitDates.addDays("2026-12-31", 1) == "2027-01-01")
    #expect(HabitDates.daysBetween("2026-08-30", "2026-09-02") == 3)
  }

  @Test func validatesDrafts() throws {
    #expect(throws: HabitsDataError.self) { try HabitDraft(name: "  ", kind: .binary, targetLabel: nil).validated() }
    #expect(throws: HabitsDataError.self) { try HabitDraft(name: "Water", kind: .quantized, targetLabel: " ").validated() }
    #expect(try HabitDraft(name: " Water ", kind: .quantized, targetLabel: " 48 oz ").validated() == HabitDraft(name: "Water", kind: .quantized, targetLabel: "48 oz"))
  }
}
