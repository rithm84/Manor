import Foundation
@testable import ManorKit
import Testing

private func task(_ id: String, due: String, time: String? = nil, priority: TaskPriority? = nil, title: String? = nil, status: TaskStatus = .notStarted, context: String = "Personal") -> TaskItem {
  TaskItem(id: id, title: title ?? id, context: context, priority: priority, status: status, due: due, dueTime: time)
}

@Suite("Task dates")
struct TaskDatesTests {
  @Test func calendarArithmetic() {
    #expect(TaskDates.adding(1, to: "2026-12-31") == "2027-01-01")
    #expect(TaskDates.adding(-1, to: "2028-03-01") == "2028-02-29")
    #expect(TaskDates.daysBetween("2026-08-20", "2026-08-22") == 2)
    #expect(TaskDates.weekday("2026-10-04") == 0)
    #expect(TaskDates.dayLabel("2026-10-04") == "Sun, Oct 4")
    #expect(TaskDates.longDayLabel("2026-11-17") == "Tuesday, November 17")
    #expect(!TaskDates.isDate("2026-02-30"))
  }

  @Test func timeStrings() {
    #expect(TaskDates.isTime("09:30"))
    #expect(TaskDates.isTime("24:00"))
    #expect(!TaskDates.isTime(""))
    #expect(!TaskDates.isTime("9:30"))
    #expect(!TaskDates.isTime("09:3"))
    #expect(!TaskDates.isTime("12:60"))
    #expect(TaskDates.minutes("10:15") == 615)
    #expect(TaskDates.minutes("") == nil)
    #expect(TaskDates.time(fromMinutes: 24 * 60) == "24:00")
    #expect(TaskDates.clock("19:59") == "7:59 PM")
    #expect(TaskDates.clock("00:05") == "12:05 AM")
    #expect(TaskDates.hourLabel(24) == "12 AM")
    #expect(TaskDates.hourLabel(12) == "12 PM")
  }

  @Test func accountLocalNow() {
    let instant = TaskDates.timestamp("2026-10-05T02:59:00Z")!
    let local = TaskDates.local(instant, in: TimeZone(identifier: "America/Los_Angeles")!)
    #expect(local.date == "2026-10-04")
    #expect(local.time == "19:59")
    #expect(TaskDates.timestamp("2026-09-15 16:00:00+00") != nil)
  }
}

@Suite("Computed task buckets")
struct TaskBucketTests {
  @Test func rollsBetweenBuckets() {
    #expect(TaskRules.bucket(forDue: "2026-08-22", today: "2026-08-20") == .week)
    #expect(TaskRules.bucket(forDue: "2026-08-22", today: "2026-08-21") == .tomorrow)
    #expect(TaskRules.bucket(forDue: "2026-08-22", today: "2026-08-22") == .today)
    #expect(TaskRules.bucket(forDue: "2026-08-22", today: "2026-08-23") == .overdue)
    #expect(TaskRules.bucket(forDue: "2026-09-18", today: "2026-08-22") == nil)
  }

  @Test func timedDeadlinesBecomeOverdueAtTheirMinute() {
    let timed = task("t", due: "2026-10-04", time: "19:59")
    #expect(TaskRules.bucket(for: timed, today: "2026-10-04", now: "19:58") == .today)
    #expect(TaskRules.bucket(for: timed, today: "2026-10-04", now: "19:59") == .overdue)
    var dateOnly = timed
    dateOnly.dueTime = nil
    #expect(TaskRules.bucket(for: dateOnly, today: "2026-10-04", now: "23:59") == .today)
    var midnight = timed
    midnight.dueTime = "00:00"
    #expect(TaskRules.bucket(for: midnight, today: "2026-10-04", now: "00:00") == .overdue)
    #expect(TaskRules.dueLabel(timed) == "Sun, Oct 4 · 7:59 PM")
  }

  @Test func weeklyOrder() {
    let tasks = [
      task("low", due: "2026-08-25", priority: .low), task("later", due: "2026-08-26", priority: .high),
      task("none", due: "2026-08-25"), task("high", due: "2026-08-25", priority: .high), task("medium", due: "2026-08-25", priority: .medium)
    ]
    #expect(tasks.sorted(by: TaskRules.weeklyOrder).map(\.id) == ["high", "medium", "low", "none", "later"])
    let sameDay = [task("all-day", due: "2026-10-05"), task("evening", due: "2026-10-05", time: "19:59", priority: .high), task("noon", due: "2026-10-05", time: "12:00", priority: .low)]
    #expect(sameDay.sorted(by: TaskRules.weeklyOrder).map(\.id) == ["noon", "evening", "all-day"])
  }

  @Test func boardHidesDoneAndFarTasks() {
    let tasks = [task("a", due: "2026-08-22"), task("b", due: "2026-08-22", status: .done), task("c", due: "2026-12-01"), task("d", due: "2026-08-20")]
    let board = TaskRules.board(tasks, today: "2026-08-22", now: "09:00")
    #expect(board[.today]?.map(\.id) == ["a"])
    #expect(board[.overdue]?.map(\.id) == ["d"])
    #expect(TaskRules.board(tasks, today: "2026-08-22", now: "09:00", keeping: ["b"])[.today]?.map(\.id) == ["a", "b"])
  }

  @Test func creationRules() throws {
    #expect(!TaskBucket.overdue.allowsCreation)
    #expect(TaskRules.creationDefaultDue(for: .today, today: "2026-08-22") == "2026-08-22")
    #expect(TaskRules.creationDefaultDue(for: .week, today: "2026-08-22") == nil)
    #expect(throws: TaskRules.CreationError(message: "Overdue tasks cannot be created")) { try TaskRules.dueForCreation(bucket: .overdue, today: "2026-08-22", selected: nil) }
    #expect(try TaskRules.dueForCreation(bucket: .tomorrow, today: "2026-08-22", selected: nil) == "2026-08-23")
    #expect(try TaskRules.dueForCreation(bucket: .today, today: "2026-08-22", selected: "2026-08-27") == "2026-08-27")
    #expect(throws: TaskRules.CreationError(message: "This Week tasks require an exact due date")) { try TaskRules.dueForCreation(bucket: .week, today: "2026-08-22", selected: nil) }
  }

  @Test func dropTargets() {
    #expect(TaskRules.canDrop(from: .overdue, onto: .today))
    #expect(TaskRules.canDrop(from: .overdue, onto: .tomorrow))
    #expect(TaskRules.canDrop(from: .today, onto: .tomorrow))
    #expect(TaskRules.canDrop(from: .tomorrow, onto: .today))
    #expect(TaskRules.canDrop(from: .today, onto: .week))
    #expect(!TaskRules.canDrop(from: .week, onto: .week))
    #expect(!TaskRules.canDrop(from: .today, onto: .today))
    #expect(TaskRules.canDrop(from: .week, onto: .today))
    #expect(!TaskRules.canDrop(from: .today, onto: .overdue))
    #expect(TaskRules.due(for: .today, today: "2026-08-22") == "2026-08-22")
    #expect(TaskRules.due(for: .tomorrow, today: "2026-08-22") == "2026-08-23")
  }

  @Test func duplicateResetsIdentity() {
    var source = task("x", due: "2026-08-22", title: "Read", status: .inProgress)
    source.revision = 4
    source.seriesId = "s"
    let copy = TaskRules.duplicate(source, id: "y")
    #expect(copy.title == "Read copy")
    #expect(copy.status == .notStarted)
    #expect(copy.revision == nil && copy.seriesId == nil)
  }
}

@Suite("Scratch block scheduling")
struct TimelineTests {
  @Test func schedulesAcrossTheVisibleRange() throws {
    #expect(ScratchTimeline.startMinutes == 360 && ScratchTimeline.endMinutes == 1440)
    #expect(try ScratchTimeline.freeStart(minutes: 180, after: 21 * 60, busy: []) == "21:00")
    #expect(throws: ScratchTimeline.NoSlotError.self) { try ScratchTimeline.freeStart(minutes: 60, after: 23 * 60 + 15, busy: []) }
  }

  @Test func findsTheNextFreeSlot() throws {
    let block = ScratchBlock(id: "b", taskId: "t", date: "2026-08-22", start: "14:00", end: "15:00", portion: "first half", createdAt: "", expiresAt: "")
    #expect(try ScratchTimeline.freeStart(minutes: 60, after: 14 * 60, busy: ScratchTimeline.busy(on: "2026-08-22", blocks: [block])) == "15:00")
    #expect(try ScratchTimeline.freeStart(minutes: 60, after: 14 * 60, busy: ScratchTimeline.busy(on: "2026-08-23", blocks: [block])) == "14:00")
    #expect(try ScratchTimeline.freeStart(minutes: 30, after: 13 * 60 + 5, busy: ScratchTimeline.busy(on: "2026-08-22", blocks: [block])) == "13:15")
  }

  @Test func estimatesAndPortions() {
    #expect(ScratchTimeline.blockMinutes(for: nil) == 60)
    #expect(ScratchTimeline.blockMinutes(for: .twoHours) == 120)
    #expect(ScratchTimeline.defaultPortion(blockMinutes: 60, estimateMinutes: nil) == "full task")
    #expect(ScratchTimeline.defaultPortion(blockMinutes: 60, estimateMinutes: 120) == "first 60 min")
    #expect(ScratchTimeline.durationLabel(90) == "1 hr 30 min")
    #expect(ScratchTimeline.durationLabel(120) == "2 hours")
    #expect(ScratchTimeline.durationOptions(current: 75) == [15, 30, 45, 60, 75, 90, 120, 180])
    #expect(ScratchTimeline.snapped(367) == 360)
    #expect(ScratchTimeline.snapped(368) == 375)
  }

  @Test func expiresFortyEightHoursAfterTheEnd() throws {
    let zone = TimeZone(identifier: "America/New_York")!
    let expiry = try #require(TaskDates.timestamp(ScratchTimeline.expiry(date: "2026-08-22", end: "15:00", timeZone: zone)))
    let end = try #require(TaskDates.instant(date: "2026-08-22", time: "15:00", in: zone))
    #expect(expiry.timeIntervalSince(end) == 48 * 3600)
  }
}

@Suite("Master filters")
struct MasterFilterTests {
  let tasks = [
    TaskItem(id: "one", title: "Alpha", context: "Personal", estimate: .hour, priority: .high, status: .notStarted, due: "2026-08-22"),
    TaskItem(id: "two", title: "Beta", context: "Uni", estimate: .halfHour, priority: .low, status: .inProgress, due: "2026-08-25"),
    TaskItem(id: "three", title: "Gamma", context: "Personal", priority: .medium, status: .done, due: "2026-09-02")
  ]

  @Test func combinesRulesWithAnd() {
    let rules = [MasterFilterRule(condition: .context("Personal")), MasterFilterRule(condition: .status(.notStarted)), MasterFilterRule(condition: .priority(.high))]
    #expect(MasterFilters.filter(tasks, rules).map(\.id) == ["one"])
  }

  @Test func dueOperators() {
    #expect(MasterFilters.matches(tasks[0], [MasterFilterRule(condition: .due(.before, date: "2026-08-23"))]))
    #expect(MasterFilters.matches(tasks[1], [MasterFilterRule(condition: .due(.on, date: "2026-08-25"))]))
    #expect(MasterFilters.matches(tasks[2], [MasterFilterRule(condition: .due(.after, date: "2026-09-01"))]))
    #expect(MasterFilters.filter(tasks, [MasterFilterRule(condition: .dueWithin(from: "2026-08-22", to: "2026-08-25"))]).map(\.id) == ["one", "two"])
    #expect(MasterFilters.filter(tasks, []).map(\.id) == ["one", "two", "three"])
  }

  @Test func workingAndCompletedViews() {
    #expect(MasterFilters.visible(tasks, rules: [], query: "", completed: false).map(\.id) == ["one", "two"])
    #expect(MasterFilters.visible(tasks, rules: [], query: "", completed: true).map(\.id) == ["three"])
    #expect(MasterFilters.visible(tasks, rules: [], query: " bet ", completed: false).map(\.id) == ["two"])
    #expect(MasterFilters.groupedByContext(tasks).map(\.context) == ["Personal", "Uni"])
  }

  @Test func ruleEditingKeepsIdentity() {
    let rule = MasterFilterRule.make(.due, today: "2026-08-22", firstContext: "Uni", id: "r")
    #expect(rule.condition == .due(.on, date: "2026-08-22"))
    #expect(rule.changingDueOperator(to: .within, today: "2026-08-22").condition == .dueWithin(from: "2026-08-22", to: "2026-08-22"))
    let context = rule.changingProperty(to: .context, today: "2026-08-22", firstContext: "Uni")
    #expect(context.id == "r" && context.condition == .context("Uni"))
  }

  @Test func rulesRoundTripThroughJSON() throws {
    let rules = [
      MasterFilterRule(id: "a", condition: .context("Uni")), MasterFilterRule(id: "b", condition: .status(.inProgress)),
      MasterFilterRule(id: "c", condition: .priority(.high)), MasterFilterRule(id: "d", condition: .due(.after, date: "2026-08-01")),
      MasterFilterRule(id: "e", condition: .dueWithin(from: "2026-08-01", to: "2026-08-09"))
    ]
    #expect(try rules.map { try MasterFilterRule(json: $0.json) } == rules)
    #expect(throws: TaskRecordError.self) { try MasterFilterRule(json: ["id": "x", "property": "due", "operator": "within", "from": "2026-08-09", "to": "2026-08-01"]) }
  }
}

@Suite("Recurrence")
struct RecurrenceTests {
  @Test func retainsEndYearAndWeekdays() throws {
    let input = RecurrenceRule(every: 2, unit: .week, weekdays: [.monday, .friday], until: "2028-01-06")
    let saved = try Recurrence.serialize(input)
    #expect(saved == "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,FR;UNTIL=20280106T235959Z")
    #expect(try Recurrence.parse(saved) == input)
    #expect(try Recurrence.parse("RRULE:" + saved) == input)
  }

  @Test func presetsMatchTheStoredForm() throws {
    #expect(try Recurrence.serialize(RecurrenceRule(every: 1, unit: .day)) == "FREQ=DAILY;INTERVAL=1")
    #expect(try Recurrence.serialize(RecurrenceRule(every: 1, unit: .week, weekdays: [.sunday])) == "FREQ=WEEKLY;INTERVAL=1;BYDAY=SU")
    #expect(try Recurrence.serialize(RecurrenceRule(every: 1, unit: .month, weekdays: [.sunday])) == "FREQ=MONTHLY;INTERVAL=1")
    #expect(throws: RecurrenceError.self) { try Recurrence.serialize(RecurrenceRule(every: 31, unit: .day)) }
    #expect(throws: RecurrenceError.self) { try Recurrence.parse("FREQ=YEARLY") }
    #expect(throws: RecurrenceError.self) { try Recurrence.parse("FREQ=DAILY;BYDAY=MO") }
    #expect(try Recurrence.parse("FREQ=DAILY;INTERVAL=2;UNTIL=20261231").until == "2026-12-31")
  }

  @Test func labelsReadLikeTheWebApp() {
    #expect(Recurrence.label("FREQ=DAILY;INTERVAL=1") == "Every day")
    #expect(Recurrence.label("FREQ=DAILY;INTERVAL=3") == "Every 3 days")
    #expect(Recurrence.label("FREQ=WEEKLY;INTERVAL=1") == "Every week")
    #expect(Recurrence.label("FREQ=WEEKLY;INTERVAL=1;BYDAY=SU") == "Every week on Sunday")
    #expect(Recurrence.label("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,FR;UNTIL=20280106T235959Z") == "Every 2 weeks on Monday, Friday until January 6, 2028")
    #expect(Recurrence.label("FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR") == "Every weekday")
    #expect(Recurrence.label("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TU,WE,TH,FR") == "Every 2 weeks on weekdays")
    #expect(Recurrence.label("FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR,SA,SU") == "Every day")
    #expect(Recurrence.label("FREQ=MONTHLY;INTERVAL=2;UNTIL=20270101T235959Z") == "Every 2 months until January 1, 2027")
    #expect(Recurrence.label("Every other Tuesday") == "Every other Tuesday")
  }

  @Test func occurrencesMatchTheServerRule() throws {
    let weekly = try Recurrence.parse("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,FR")
    // Anchor Wednesday 2026-09-09: the anchor's ISO week and every second week after it.
    #expect(Recurrence.occurrences(weekly, anchor: "2026-09-09", from: "2026-09-09", limit: 4) == ["2026-09-11", "2026-09-21", "2026-09-25", "2026-10-05"])
    let monthly = RecurrenceRule(every: 1, unit: .month)
    #expect(Recurrence.occurrences(monthly, anchor: "2026-01-31", from: "2026-01-31", limit: 3) == ["2026-01-31", "2026-03-31", "2026-05-31"])
    let ending = RecurrenceRule(every: 3, unit: .day, until: "2026-09-07")
    #expect(Recurrence.occurrences(ending, anchor: "2026-09-01", from: "2026-09-01", limit: 10) == ["2026-09-01", "2026-09-04", "2026-09-07"])
    #expect(Recurrence.occurrences(RecurrenceRule(every: 1, unit: .week), anchor: "2026-09-09", from: "2026-09-10", limit: 1) == ["2026-09-16"])
  }
}

@Suite("Calendar days")
struct CalendarDaysTests {
  func event(_ startsAt: String, _ endsAt: String) -> StoredCalendarEvent {
    StoredCalendarEvent(id: "event", accountId: "account", calendarId: "calendar", title: "Appointment", startsAt: startsAt, endsAt: endsAt, startDate: nil, endDate: nil, allDay: false)
  }

  @Test func preservesSpringForwardLocalTimes() {
    let days = CalendarDays.days(event("2026-03-08T09:30:00Z", "2026-03-08T10:30:00Z"), dates: ["2026-03-08"], timeZone: TimeZone(identifier: "America/Los_Angeles")!, color: nil)
    #expect(days.map { [$0.date, $0.start, $0.end] } == [["2026-03-08", "01:30", "03:30"]])
  }

  @Test func clipsMidnightAndSplitsMultiDayEvents() {
    let days = CalendarDays.days(event("2026-09-09T06:00:00Z", "2026-09-11T07:00:00Z"), dates: ["2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11"], timeZone: TimeZone(identifier: "America/Los_Angeles")!, color: nil)
    #expect(days.map { [$0.date, $0.start, $0.end] } == [["2026-09-08", "23:00", "24:00"], ["2026-09-09", "00:00", "24:00"], ["2026-09-10", "00:00", "24:00"]])
  }

  @Test func allDayDatesIgnoreTheZone() {
    var row = event("", "")
    row.allDay = true
    row.startDate = "2026-09-09"
    row.endDate = "2026-09-11"
    let days = CalendarDays.days(row, dates: ["2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11"], timeZone: TimeZone(identifier: "Pacific/Auckland")!, color: nil)
    #expect(days.map(\.date) == ["2026-09-09", "2026-09-10"])
  }

  @Test func windowMatchesTheServerFilter() throws {
    let window = try CalendarWindow(days: ["2026-09-14", "2026-09-15", "2026-09-16"])
    #expect(TaskDates.isoString(window.earliest) == "2026-09-13T00:00:00.000Z")
    #expect(TaskDates.isoString(window.latest) == "2026-09-18T00:00:00.000Z")
    #expect(window.serverFilter == "and(all_day.eq.true,start_date.lte.2026-09-16,end_date.gt.2026-09-14),and(all_day.eq.false,starts_at.lt.2026-09-18T00:00:00.000Z,ends_at.gt.2026-09-13T00:00:00.000Z)")
    func timed(_ start: String, _ end: String) -> Row { ["all_day": false, "starts_at": .string(start), "ends_at": .string(end)] }
    func allDay(_ start: String, _ end: String) -> Row { ["all_day": true, "start_date": .string(start), "end_date": .string(end)] }
    #expect(window.contains(timed("2026-09-15T16:00:00+00:00", "2026-09-15T17:00:00+00:00")))
    #expect(window.contains(timed("2026-09-12T16:00:00-07:00", "2026-09-13T04:00:00+00:00")))
    #expect(!window.contains(timed("2026-09-11T16:00:00Z", "2026-09-12T17:00:00Z")))
    #expect(!window.contains(timed("2026-09-18T16:00:00Z", "2026-09-18T17:00:00Z")))
    #expect(window.contains(allDay("2026-09-16", "2026-09-17")))
    #expect(window.contains(allDay("2026-09-10", "2026-09-15")))
    #expect(!window.contains(allDay("2026-09-10", "2026-09-14")))
    #expect(!window.contains(allDay("2026-09-17", "2026-09-18")))
    #expect(!window.contains(["all_day": false, "starts_at": nil, "ends_at": nil]))
  }
}

@Suite("Task commands")
struct TaskCommandTests {
  var draft: TaskItem { TaskItem(id: "t", title: "  Read  ", context: "Uni", estimate: .hour, due: "2026-08-22") }

  @Test func createsPlainAndRecurringTasks() throws {
    let plain = try TaskCommands.saveTask(draft, contextId: "c", existing: nil)
    #expect(plain.operation == "create_task")
    #expect(plain.input["title"] == "Read")
    #expect(plain.input["expected_revision"] == 0)
    #expect(plain.input["due_time"] == .null)
    #expect(plain.input["priority"] == .null)
    #expect(plain.input["estimate_minutes"] == 60)
    #expect(plain.input["recurrence"] == nil)
    var repeating = draft
    repeating.recurrence = "FREQ=DAILY;INTERVAL=1"
    let series = try TaskCommands.saveTask(repeating, contextId: "c", existing: nil)
    #expect(series.operation == "create_recurring_task")
    #expect(series.input["recurrence"] == "FREQ=DAILY;INTERVAL=1")
  }

  @Test func choosesTheRecurrenceOperationForEdits() throws {
    var saved = draft
    saved.revision = 3
    #expect(throws: TaskRecordError.self) { try TaskCommands.saveTask(draft, contextId: "c", existing: .init(seriesId: nil, recurrence: nil)) }
    let update = try TaskCommands.saveTask(saved, contextId: "c", existing: .init(seriesId: nil, recurrence: nil))
    #expect(update.operation == "update_task" && update.input["expected_revision"] == 3)

    var converting = saved
    converting.recurrence = "FREQ=WEEKLY;INTERVAL=1"
    let convert = try TaskCommands.saveTask(converting, contextId: "c", existing: .init(seriesId: nil, recurrence: nil), newSeriesId: { "new" })
    #expect(convert.operation == "convert_task_to_series" && convert.input["new_series_id"] == "new")

    var occurrence = converting
    occurrence.seriesId = "s"
    occurrence.recurrence = "FREQ=DAILY;INTERVAL=1"
    #expect(throws: TaskRecordError.self) { try TaskCommands.saveTask(occurrence, contextId: "c", existing: .init(seriesId: "s", recurrence: "FREQ=WEEKLY;INTERVAL=1")) }
    occurrence.recurrenceScope = .future
    let future = try TaskCommands.saveTask(occurrence, contextId: "c", existing: .init(seriesId: "s", recurrence: "FREQ=WEEKLY;INTERVAL=1"), newSeriesId: { "n2" })
    #expect(future.operation == "update_future_task_occurrences" && future.input["recurrence"] == "FREQ=DAILY;INTERVAL=1")
    occurrence.recurrence = nil
    let detach = try TaskCommands.saveTask(occurrence, contextId: "c", existing: .init(seriesId: "s", recurrence: "FREQ=WEEKLY;INTERVAL=1"))
    #expect(detach.input["recurrence"] == .null)
    occurrence.recurrenceScope = .this
    occurrence.recurrence = "FREQ=WEEKLY;INTERVAL=1"
    #expect(try TaskCommands.saveTask(occurrence, contextId: "c", existing: .init(seriesId: "s", recurrence: "FREQ=WEEKLY;INTERVAL=1")).operation == "update_task")
  }

  @Test func scratchBlocksStayOnQuarterHours() throws {
    let block = ScratchBlock(id: "b", taskId: nil, date: "2026-08-22", start: "09:00", end: "09:45", portion: " Focus ", createdAt: "", expiresAt: "")
    let command = try TaskCommands.saveScratchBlock(block, exists: false)
    #expect(command.input["start_time"] == "09:00" && command.input["portion"] == "Focus" && command.input["task_id"] == .null)
    var early = block
    early.start = "05:45"
    #expect(throws: TaskRecordError.self) { try TaskCommands.saveScratchBlock(early, exists: false) }
    var ragged = block
    ragged.end = "09:50"
    #expect(throws: TaskRecordError.self) { try TaskCommands.saveScratchBlock(ragged, exists: false) }
  }

  @Test func contextNamesAreUniqueIgnoringCase() throws {
    let contexts = [TaskContext(id: "1", name: "Uni", color: .plum, icon: .target, revision: 1)]
    #expect(throws: TaskRecordError.self) { try TaskCommands.checkUnique("uni", among: contexts) }
    try TaskCommands.checkUnique("UNI", among: contexts, except: "Uni")
    #expect(throws: TaskRecordError.self) { try TaskCommands.createContext(ContextDraft(name: "   ", color: .gold, icon: .code)) }
    let update = try TaskCommands.updateContext(contexts[0], to: ContextDraft(name: "School", color: .gold, icon: .code))
    #expect(update.input["expected_revision"] == 1 && update.input["icon"] == "code")
  }
}

@Suite("Task rows")
struct TaskRowTests {
  @Test func parsesStoredTasks() throws {
    let row: Row = [
      "id": "t", "title": "Read", "context": "Uni", "estimate_minutes": 60, "priority": "High", "status": "In Progress",
      "due": "2026-10-05", "due_time": "19:59", "tags": ["a"], "recurrence": nil, "revision": 2, "series_id": nil,
      "deleted_at": nil, "skipped_at": nil, "superseded_at": nil
    ]
    let task = try TaskItem(row: row)
    #expect(task.estimate == .hour && task.priority == .high && task.status == .inProgress && task.dueTime == "19:59" && task.revision == 2)
    #expect(TaskItem.isLive(row))
    var trashed = row
    trashed["deleted_at"] = "2026-10-05T00:00:00Z"
    #expect(!TaskItem.isLive(trashed))
    var midnight = row
    midnight["due_time"] = "24:00"
    #expect(throws: TaskRecordError.self) { try TaskItem(row: midnight) }
    var ragged = row
    ragged["due_time"] = "12:60"
    #expect(throws: TaskRecordError.self) { try TaskItem(row: ragged) }
  }

  @Test func parsesScratchBlocksAndExpiry() throws {
    let row: Row = ["id": "b", "task_id": nil, "date": "2026-08-22", "start_time": "09:00", "end_time": "10:00", "portion": "", "created_at": "2026-08-22T08:00:00Z", "expires_at": "2026-08-24T14:00:00+00:00", "revision": 1]
    let block = try ScratchBlock(row: row)
    #expect(block.taskId == nil && block.startMinutes == 540)
    #expect(ScratchBlock.isLive(row, now: TaskDates.timestamp("2026-08-23T00:00:00Z")!))
    #expect(!ScratchBlock.isLive(row, now: TaskDates.timestamp("2026-08-25T00:00:00Z")!))
  }
}
