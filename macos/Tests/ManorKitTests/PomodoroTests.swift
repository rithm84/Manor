import Foundation
import Testing
@testable import ManorKit

private func ts(_ text: String) -> Date { PomodoroTimestamp.parse(text)! }

private func session(id: String = "p1", kind: PomodoroKind = .focus, status: PomodoroStatus = .completed, pausedAt: Date? = nil, pausedSeconds: Int = 0,
                     endedAt: Date? = ts("2026-09-10T16:25:00.000Z"), focused: Int? = 1500, localDate: String = "2026-09-10") -> PomodoroSession {
  PomodoroSession(id: id, kind: kind, status: status, plannedSeconds: 1500, startedAt: ts("2026-09-10T16:00:00.000Z"), pausedAt: pausedAt,
                  pausedSeconds: pausedSeconds, endedAt: endedAt, focusedSeconds: focused, localDate: localDate, revision: 2)
}

private func row(_ overrides: Row = [:]) -> Row {
  var row: Row = [
    "id": "p1", "kind": "focus", "status": "completed", "label": "  Deep work  ", "planned_seconds": 1500,
    "started_at": "2026-09-10T16:00:00.123456+00:00", "paused_at": nil, "paused_seconds": 0, "ended_at": "2026-09-10 16:25:00+00",
    "focused_seconds": 1500, "local_date": "2026-09-10", "revision": 2
  ]
  for (key, value) in overrides { row[key] = value }
  return row
}

@Suite("Pomodoro parsing")
struct PomodoroParsingTests {
  @Test func acceptsARowAndTrimsTheLabel() throws {
    let parsed = try PomodoroSession(row: row())
    #expect(parsed.label == "Deep work")
    #expect(parsed.status == .completed)
    #expect(abs(parsed.startedAt.timeIntervalSince(ts("2026-09-10T16:00:00Z")) - 0.123456) < 0.0001)
    #expect(parsed.endedAt == ts("2026-09-10T16:25:00Z"))
  }

  @Test func rejectsBrokenInvariants() throws {
    #expect(throws: PomodoroValidationError.self) { try PomodoroSession(row: row(["status": "paused", "ended_at": nil, "focused_seconds": nil])) }
    #expect(throws: PomodoroValidationError.self) { try PomodoroSession(row: row(["ended_at": nil])) }
    #expect(throws: PomodoroValidationError.self) { try PomodoroSession(row: row(["kind": "nap"])) }
    #expect(throws: PomodoroValidationError.self) { try parsePomodoroLabel(String(repeating: "a", count: 121)) }
    #expect(try parsePomodoroLabel("   ") == nil)
  }

  @Test func settingsFillDefaultsAndReadStoredKeys() throws {
    #expect(try PomodoroSettings(stored: nil) == .defaults)
    var expected = PomodoroSettings.defaults
    expected.focusMinutes = 50
    expected.autoStartBreaks = true
    #expect(try PomodoroSettings(stored: ["focus_minutes": 50, "auto_start_breaks": true]) == expected)
    #expect(throws: PomodoroValidationError.self) { try PomodoroSettings(stored: ["focus_minutes": 0]) }
    #expect(throws: PomodoroValidationError.self) { try PomodoroSettings(stored: ["long_break_every": 13]) }
  }

  @Test func settingsPatchProducesStoredKeys() throws {
    #expect(try PomodoroSettingsPatch(focusMinutes: 45, autoStartFocus: true).row() == ["focus_minutes": 45, "auto_start_focus": true])
    #expect(throws: PomodoroValidationError.self) { try PomodoroSettingsPatch(shortBreakMinutes: 0).row() }
    #expect(throws: PomodoroValidationError.self) { try PomodoroSettingsPatch().row() }
    var draft = PomodoroSettings.defaults
    draft.longBreakEvery = 6
    let patch = PomodoroSettingsPatch(from: .defaults, to: draft)
    #expect(patch == PomodoroSettingsPatch(longBreakEvery: 6))
    #expect(PomodoroSettingsPatch(from: .defaults, to: .defaults).isEmpty)
  }

  @Test func commandInputsMatchTheService() {
    #expect(PomodoroCommands.start(id: "x", kind: .shortBreak, plannedSeconds: 300, label: nil)
      == ["id": "x", "expected_revision": 0, "kind": "short_break", "planned_seconds": 300, "label": nil])
    #expect(PomodoroCommands.end(session(), completed: false) == ["id": "p1", "expected_revision": 2, "outcome": "abandoned"])
    #expect(PomodoroCommands.relabel(session(), label: "Write") == ["id": "p1", "expected_revision": 2, "label": "Write"])
    #expect(PomodoroCommands.saveSettings(["focus_minutes": 30], profileRevision: 7) == ["expected_revision": 7, "settings": ["focus_minutes": 30]])
  }
}

@Suite("Pomodoro clock")
struct PomodoroClockTests {
  let started = ts("2026-09-10T16:00:00.000Z")

  @Test func countsDownAndExcludesPausedTime() {
    let running = session(status: .running, pausedSeconds: 60, endedAt: nil, focused: nil)
    let clock = Pomodoro.clock(running, at: started.addingTimeInterval(600))
    #expect(clock.elapsedSeconds == 540)
    #expect(clock.remainingSeconds == 960)
    #expect(abs(clock.progress - 0.36) < 0.0001)
    #expect(!clock.due)
  }

  @Test func standsStillWhilePausedAndReadsDueWhenDone() {
    let paused = session(status: .paused, pausedAt: ts("2026-09-10T16:05:00.000Z"), endedAt: nil, focused: nil)
    #expect(Pomodoro.clock(paused, at: started.addingTimeInterval(3600)).remainingSeconds == 1200)
    let running = session(status: .running, endedAt: nil, focused: nil)
    let clock = Pomodoro.clock(running, at: started.addingTimeInterval(26 * 60))
    #expect(clock.remainingSeconds == 0)
    #expect(clock.due)
    #expect(clock.progress == 1)
  }

  @Test func formats() {
    #expect(Pomodoro.formatClock(1500) == "25:00")
    #expect(Pomodoro.formatClock(59) == "00:59")
    #expect(Pomodoro.formatClock(3661) == "1:01:01")
    #expect(Pomodoro.formatMinutes(0) == "0m")
    #expect(Pomodoro.formatMinutes(45 * 60) == "45m")
    #expect(Pomodoro.formatMinutes(3900) == "1h 05m")
    #expect(Pomodoro.formatMinutes(7200) == "2h")
  }

  @Test func offersShortThenLongBreaks() {
    let three = (0..<3).map { session(id: "s\($0)") }
    #expect(Pomodoro.nextKind(after: three[0], sessions: three, settings: .defaults) == .shortBreak)
    let four = (0..<4).map { session(id: "s\($0)") }
    #expect(Pomodoro.nextKind(after: four[0], sessions: four, settings: .defaults) == .longBreak)
    let rest = session(kind: .shortBreak)
    #expect(Pomodoro.nextKind(after: rest, sessions: [rest], settings: .defaults) == .focus)
    let stopped = session(status: .abandoned, focused: 300)
    #expect(Pomodoro.nextKind(after: stopped, sessions: [stopped], settings: .defaults) == .focus)
  }

  @Test func cyclePosition() {
    #expect(Pomodoro.cyclePosition(completedToday: 0, longBreakEvery: 4) == 0)
    #expect(Pomodoro.cyclePosition(completedToday: 3, longBreakEvery: 4) == 3)
    #expect(Pomodoro.cyclePosition(completedToday: 4, longBreakEvery: 4) == 4)
    #expect(Pomodoro.cyclePosition(completedToday: 5, longBreakEvery: 4) == 1)
  }
}

@Suite("Pomodoro statistics")
struct PomodoroStatsTests {
  let sessions = [
    session(id: "a", localDate: "2026-09-01"),
    session(id: "b", localDate: "2026-09-01"),
    session(id: "c", status: .abandoned, focused: 600, localDate: "2026-09-02"),
    session(id: "d", localDate: "2026-09-14"),
    session(id: "e", localDate: "2026-09-13"),
    session(id: "f", localDate: "2026-08-30"),
    session(id: "brk", kind: .shortBreak, focused: 300, localDate: "2026-09-14")
  ]

  @Test func totalsTheMonth() {
    let stats = PomodoroStats.month(sessions, month: "2026-09", today: "2026-09-14")
    #expect(stats.completed == 4)
    #expect(stats.abandoned == 1)
    #expect(stats.focusedSeconds == 4 * 1500 + 600)
    #expect(stats.activeDays == 3)
    #expect(stats.elapsedDays == 14)
    #expect(stats.bestDay?.date == "2026-09-01")
    #expect(stats.days.count == 30)
    #expect(stats.days[0] == PomodoroDay(date: "2026-09-01", completed: 2, focusedSeconds: 3000))
    #expect(stats.perActiveDay == 1.3)
  }

  @Test func countsTheStreak() {
    #expect(PomodoroStats.streak(sessions, today: "2026-09-14") == 2)
    #expect(PomodoroStats.streak(sessions, today: "2026-09-15") == 2)
    #expect(PomodoroStats.streak(sessions, today: "2026-09-16") == 0)
  }

  @Test func measuresPastAndFutureMonths() {
    #expect(PomodoroStats.month(sessions, month: "2026-08", today: "2026-09-14").elapsedDays == 31)
    #expect(PomodoroStats.month(sessions, month: "2026-10", today: "2026-09-14").elapsedDays == 0)
    #expect(PomodoroStats.earliestMonth(sessions, today: "2026-09-14") == "2026-08")
    #expect(PomodoroStats.earliestMonth([], today: "2026-09-14") == "2026-09")
  }

  @Test func groupsTheLogByDay() {
    let days = PomodoroStats.sessionDays(sessions, month: "2026-09")
    #expect(days.map(\.date) == ["2026-09-14", "2026-09-13", "2026-09-02", "2026-09-01"])
    #expect(days[0].sessions.map(\.id) == ["d"])
    #expect(days[2].completedCount == 0)
    #expect(PomodoroDates.dayHeading("2026-09-13", today: "2026-09-14") == "Yesterday")
    #expect(PomodoroDates.dayHeading("2026-09-02", today: "2026-09-14") == "Wed, Sep 2")
  }
}
