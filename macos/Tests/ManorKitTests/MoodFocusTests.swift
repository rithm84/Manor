import Foundation
import Testing
@testable import ManorKit

private func row(date: String = "2026-08-19", mood: JSONValue = "Good", focus: JSONValue = "High", note: JSONValue = "Deep work before lunch.",
                 source: JSONValue = "manual", revision: Int = 3) -> Row {
  ["date": .string(date), "mood": mood, "focus": focus, "note": note, "note_source": source,
   "created_at": "2026-08-19T21:00:00.000Z", "updated_at": "2026-08-19T21:00:00.000Z", "revision": .number(Double(revision))]
}

private func entry(_ date: String, _ mood: Mood?, _ focus: Focus?) -> MoodFocusEntry {
  MoodFocusEntry(date: date, mood: mood, focus: focus, createdAt: "\(date)T21:00:00.000Z", updatedAt: "\(date)T21:00:00.000Z", revision: 1)
}

private let entries = [
  entry("2026-07-31", .good, .high),
  entry("2026-08-01", .great, .resting),
  entry("2026-08-02", .good, .high)
]

@Suite("Mood and focus validation")
struct MoodFocusValidationTests {
  @Test func acceptsIndependentlyLoggedSignals() throws {
    let moodOnly = try MoodFocusEntry(row: row(focus: nil))
    #expect(moodOnly.mood == .good)
    #expect(moodOnly.focus == nil)
    let focusOnly = try MoodFocusEntry(row: row(mood: nil))
    #expect(focusOnly.mood == nil)
    #expect(focusOnly.focus == .high)
    #expect(focusOnly.revision == 3)
  }

  @Test func rejectsEmptyOrOffScaleEntries() {
    #expect(throws: MoodFocusValidationError.self) { try MoodFocusEntry(row: row(mood: nil, focus: nil)) }
    #expect(throws: MoodFocusValidationError.self) { try MoodFocusEntry(row: row(mood: "Fine")) }
    #expect(throws: MoodFocusValidationError.self) { try MoodFocusEntry(row: row(date: "2026-02-30")) }
  }

  @Test func historyCorrectionNeedsARating() throws {
    let valid = MoodFocusHistoryMutation(date: "2026-08-19", mood: .good, focus: nil, expectedUpdatedAt: "2026-08-19T21:00:00.000Z")
    #expect(try valid.validated() == valid)
    #expect(throws: MoodFocusValidationError.self) {
      try MoodFocusHistoryMutation(date: "2026-08-19", mood: nil, focus: nil, expectedUpdatedAt: nil).validated()
    }
  }

  @Test func commandInputsMatchTheService() {
    #expect(MoodFocusCommands.rateMood(date: "2026-08-20", mood: .great, revision: 0) == ["date": "2026-08-20", "expected_revision": 0, "mood": "Great"])
    #expect(MoodFocusCommands.rateFocus(date: "2026-08-20", focus: .lockedOut, revision: 2) == ["date": "2026-08-20", "expected_revision": 2, "focus": "Locked Out"])
    let mutation = MoodFocusHistoryMutation(date: "2026-08-19", mood: nil, focus: .resting, expectedUpdatedAt: nil)
    #expect(MoodFocusCommands.correctHistory(mutation, revision: 0) == ["date": "2026-08-19", "mood": nil, "focus": "Resting", "expected_revision": 0])
    #expect(MoodFocusCommands.setRatings(mutation, revision: 4) == ["date": "2026-08-19", "expected_revision": 4, "mood": nil, "focus": "Resting"])
    // No input carries `note`, so the server keeps whatever text a record already holds.
    for input in [MoodFocusCommands.rateMood(date: "2026-08-20", mood: .good, revision: 1), MoodFocusCommands.setRatings(mutation, revision: 4), MoodFocusCommands.correctHistory(mutation, revision: 0)] {
      #expect(input["note"] == nil)
    }
  }
}

@Suite("Mood and focus history model")
struct MoodFocusHistoryTests {
  @Test func keepsRestDaysOutOfTheFocusAverage() {
    let summary = MoodFocusHistory.monthSummary(entries, month: "2026-08")
    #expect(summary.loggedDays == 2)
    #expect(summary.moodAverage == 4.5)
    #expect(summary.focusAverage == 4)
    #expect(summary.restDays == 1)
    #expect(summary.label == "August 2026")
  }

  @Test func buildsATrendEndingAtTheSelectedMonth() {
    let trend = MoodFocusHistory.monthTrend(entries, endMonth: "2026-08", range: 6)
    #expect(trend.count == 6)
    #expect(trend[4].month == "2026-07" && trend[4].mood == 4 && trend[4].focus == 4)
    #expect(trend[5].month == "2026-08" && trend[5].mood == 4.5 && trend[5].focus == 4)
    #expect(MoodFocusHistory.monthTrend(entries, endMonth: "2026-08", range: 3).map(\.month) == ["2026-06", "2026-07", "2026-08"])
    #expect(MoodFocusHistory.monthTrend(entries, endMonth: "2026-02", range: 3).map(\.month) == ["2025-12", "2026-01", "2026-02"])
    #expect(MoodFocusHistory.monthTrend(entries, endMonth: "2026-08", range: 12).count == 12)
  }

  @Test func boundsBackwardNavigationAtTheEarliestEntry() {
    #expect(MoodFocusHistory.earliestEntryMonth(entries, today: "2026-08-20") == "2026-07")
    #expect(MoodFocusHistory.earliestEntryMonth([], today: "2026-08-20") == "2026-08")
  }

  @Test func namesTheScaleStepNearestAnAverage() {
    #expect(MoodFocusHistory.moodLabel(average: 4.5) == .great)
    #expect(MoodFocusHistory.moodLabel(average: 3.4) == .neutral)
    #expect(MoodFocusHistory.moodLabel(average: nil) == nil)
    #expect(MoodFocusHistory.focusLabel(average: 1.2) == .lockedOut)
    #expect(MoodFocusHistory.focusLabel(average: 5) == .lockedIn)
  }

  @Test func countsRatedDaysPerLevel() {
    let august = entries.filter { $0.date.hasPrefix("2026-08") }
    let mood = MoodFocusHistory.moodDistribution(august)
    #expect(mood.map(\.level) == [.great, .good, .neutral, .bad, .awful])
    #expect(mood[0].count == 1 && mood[0].share == 0.5)
    let focus = MoodFocusHistory.focusDistribution(august)
    #expect(focus.last?.level == .resting && focus.last?.count == 1 && focus.last?.share == 0.5)
    #expect(MoodFocusHistory.moodDistribution([]).allSatisfy { $0.count == 0 && $0.share == 0 })
  }

  @Test func labelsDays() {
    #expect(MoodFocusDates.dayLabel("2026-08-20", today: "2026-08-20") == "Today")
    #expect(MoodFocusDates.dayLabel("2026-08-19", today: "2026-08-20") == "Yesterday")
    #expect(MoodFocusDates.fullDateLabel("2026-08-20") == "Thursday, August 20, 2026")
    #expect(MoodFocusDates.previous("2026-03-01") == "2026-02-28")
    #expect(MoodFocusHistory.canQuickCapture("2026-08-19", today: "2026-08-20"))
    #expect(!MoodFocusHistory.canQuickCapture("2026-08-18", today: "2026-08-20"))
  }
}
