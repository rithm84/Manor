import Alfred
import Foundation
import ManorKit

// Tracking: habit check-offs through the Tracking page's service, and the mood and focus check-in with the
// same `log_daily_ratings` input the page sends.

extension ManorAlfredToolbox {
  func habitCandidate(_ habit: HabitDefinition) -> ManorTargetCandidate {
    ManorTargetCandidate(id: habit.id, title: habit.name, detail: habit.targetLabel)
  }

  /// How a stored percent reads for a habit: done, not yet, or the amount toward its target.
  static func habitValueText(_ value: Int, habit: HabitDefinition) -> String {
    if value == 0 { return "not yet" }
    if value == 100 { return "done" }
    if let target = habit.targetLabel { return HabitRules.stepAmountLabel(target, value) }
    return "\(value)%"
  }

  func logHabit(_ arguments: [String: Any]) async throws -> AlfredToolResult {
    let args = try ManorLogHabitArgs.parse(arguments, today: today)
    let state = try await habits.load().state
    let candidates = state.habits.map(habitCandidate)
    let resolved = try Self.resolved(args.habit, kind: "habit", ManorTargetMatcher.match(args.habit, in: candidates, preferred: { candidate in
      HabitRules.status(candidate.id, on: args.date, in: state) == .active
    }))
    guard let habit = state.habit(resolved.id) else { throw ManorToolArgumentError("That habit is no longer available.") }
    let day = ManorToolDates.label(args.date, today: today)
    switch HabitRules.status(habit.id, on: args.date, in: state) {
    case .active?: break
    case .paused?: throw ManorToolArgumentError("\(Self.quoted(habit.name)) is paused, so it can't be logged for \(day).")
    case .retired?: throw ManorToolArgumentError("\(Self.quoted(habit.name)) is retired, so it can't be logged for \(day).")
    case nil: throw ManorToolArgumentError("\(Self.quoted(habit.name)) didn't exist yet \(day).")
    }
    let value = try ManorLogHabitArgs.value(for: args.amount, kind: habit.kind, targetLabel: habit.targetLabel)
    let previous = state.entry(habitId: habit.id, date: args.date)?.value ?? 0
    let name = Self.quoted(habit.name)
    if previous == value {
      return .done("\(name) was already \(Self.habitValueText(value, habit: habit)) for \(day)")
    }
    _ = try await habits.setEntry(habitId: habit.id, date: args.date, value: value)
    let summary: String
    switch value {
    case 0: summary = "Cleared \(name) for \(day)"
    case 100: summary = "Checked off \(name) for \(day)"
    default: summary = "Logged \(Self.habitValueText(value, habit: habit)) of \(name) for \(day)"
    }
    let date = args.date
    let habitId = habit.id
    return .done(summary, output: "\(summary). [\(habit.id)] is now \(Self.habitValueText(value, habit: habit)); it was \(Self.habitValueText(previous, habit: habit)).", undo: { [weak self] in
      guard let self else { throw Self.closed }
      _ = try await self.habits.load()
      _ = try await self.habits.setEntry(habitId: habitId, date: date, value: previous)
      return previous == 0 ? "Unchecked \(name) for \(day)" : "Put \(name) back to \(Self.habitValueText(previous, habit: habit))"
    })
  }

  func logDailyRatings(_ arguments: [String: Any]) async throws -> AlfredToolResult {
    let args = try ManorDailyRatingsArgs.parse(arguments, today: today)
    let existing = try await ratingsEntry(on: args.date)
    let receipt = try await gateway.command("log_daily_ratings", args.commandInput(revision: existing?.revision ?? 0))
    let saved = receipt.record.flatMap { try? MoodFocusEntry(row: $0) }
    let day = ManorToolDates.label(args.date, today: today)
    var parts: [String] = []
    if let mood = args.mood { parts.append("mood as \(mood.rawValue)") }
    if let focus = args.focus { parts.append("focus as \(focus.rawValue)") }
    let summary = "Saved \(day == "today" ? "today's" : day == "yesterday" ? "yesterday's" : "\(day)'s") \(parts.joined(separator: " and "))"
    let output = "\(summary). The day now reads mood \(saved?.mood?.rawValue ?? "not logged"), focus \(saved?.focus?.rawValue ?? "not logged")."
    // A day keeps at least one rating, so a first check-in has no inverse; a correction puts both ratings back.
    guard let existing else { return .done(summary, output: output) }
    let date = args.date
    return .done(summary, output: output, undo: { [weak self] in
      guard let self else { throw Self.closed }
      let revision = try await self.ratingsEntry(on: date)?.revision ?? 0
      let mutation = MoodFocusHistoryMutation(date: date, mood: existing.mood, focus: existing.focus, expectedUpdatedAt: nil)
      try await self.gateway.command("log_daily_ratings", MoodFocusCommands.setRatings(mutation, revision: revision))
      return "Put \(day == "today" ? "today's" : "yesterday's") check-in back"
    })
  }

  func ratingsEntry(on date: String) async throws -> MoodFocusEntry? {
    try await gateway.rows("mood_focus_entries", where: [RowFilter("date", .string(date))])
      .first { $0["date"]?.string?.prefix(10) == Substring(date) }
      .flatMap { try? MoodFocusEntry(row: $0) }
  }

  // MARK: Snapshot

  /// Today's active habits with whether each is logged, and today's mood and focus.
  func trackingSnapshot() async -> [String] {
    var lines: [String] = []
    do {
      let state = try await habits.load().state
      let active = HabitRules.active(on: today, in: state)
      if active.isEmpty {
        lines.append("No active habits today.")
      } else {
        lines.append("Habits today:")
        for habit in active.prefix(40) {
          let value = state.entry(habitId: habit.id, date: today)?.value ?? 0
          let target = habit.targetLabel.map { ", target \($0)" } ?? ""
          lines.append("[\(habit.id)] \(habit.name)\(target): \(Self.habitValueText(value, habit: habit))")
        }
      }
    } catch {
      lines.append("Habits couldn't be read: \(error.localizedDescription)")
    }
    do {
      let entry = try await ratingsEntry(on: today)
      lines.append("Check-in today: mood \(entry?.mood?.rawValue ?? "not logged"), focus \(entry?.focus?.rawValue ?? "not logged").")
    } catch {
      lines.append("Today's check-in couldn't be read: \(error.localizedDescription)")
    }
    return lines
  }
}
