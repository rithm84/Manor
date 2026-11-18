import Foundation

/// Habit reads and commands. Mutations run one at a
/// time so each one sends the revisions committed by the one before it, and every mutation answers with
/// the reloaded state.
@MainActor
public final class HabitsService {
  public static let tables: Set<String> = [
    "habits", "habit_lifecycle", "habit_entries", "habit_freeze_intents", "habit_freeze_usage", "habit_freeze_grants", "habit_month_pools"
  ]

  public let gateway: Gateway
  private let today: () -> String
  private var habitRows: [Row]?
  private var entryRows: [Row]?
  private var tail: Task<Void, Never>?
  private var loadSequence = 0
  private var appliedSequence = 0

  /// `today` is the account-local day, which keys the derived cache.
  public init(gateway: Gateway, today: @escaping () -> String) {
    self.gateway = gateway
    self.today = today
  }

  /// A loaded state, and whether a newer load already answered (a stale result should be dropped).
  public struct Loaded: Sendable {
    public let state: HabitsState
    public let isLatest: Bool
  }

  public func load() async throws -> Loaded {
    loadSequence += 1
    let sequence = loadSequence
    async let history = gateway.derived("manor_habits_state", day: today())
    async let habits = gateway.rows("habits")
    async let entries = gateway.rows("habit_entries")
    let (historyValue, habitValues, entryValues) = try await (history, habits, entries)
    let state = try HabitParsing.state(historyValue, habitRows: habitValues)
    let latest = sequence > appliedSequence
    if latest {
      appliedSequence = sequence
      habitRows = habitValues
      entryRows = entryValues
    }
    return Loaded(state: state, isLatest: latest)
  }

  public func createHabit(_ draft: HabitDraft) async throws -> Loaded {
    let draft = try draft.validated()
    return try await serialize { [self] in
      guard let habitRows else { throw HabitsDataError("Habits are still loading.") }
      try await gateway.command("create_habit", [
        "id": .string(UUID().uuidString.lowercased()), "expected_revision": 0, "name": .string(draft.name),
        "kind": .string(draft.kind.rawValue), "target_label": .from(draft.targetLabel), "position": .number(Double(habitRows.count))
      ])
      return try await load()
    }
  }

  public func updateHabit(_ habitId: String, _ draft: HabitDraft) async throws -> Loaded {
    let draft = try draft.validated()
    guard let revision = draft.expectedRevision, revision > 0 else { throw HabitsDataError("Reload the page before editing this habit.") }
    return try await serialize { [self] in
      try await gateway.command("update_habit", [
        "id": .string(habitId), "expected_revision": .number(Double(revision)), "name": .string(draft.name),
        "kind": .string(draft.kind.rawValue), "target_label": .from(draft.targetLabel)
      ])
      return try await load()
    }
  }

  /// Logs a percent on a day; 0 clears the entry.
  public func setEntry(habitId: String, date: String, value: Int) async throws -> Loaded {
    guard HabitDates.isValid(date), (0...100).contains(value) else { throw HabitsDataError("That check-off is out of range.") }
    return try await serialize { [self] in
      guard let entryRows else { throw HabitsDataError("Habits are still loading.") }
      let existing = entryRows.firstIndex { $0["habit_id"]?.string == habitId && $0["date"]?.string == date }
      let revision = existing.flatMap { entryRows[$0].revision } ?? 0
      let receipt = try await gateway.command(value == 0 ? "clear_habit_entry" : "log_habit", [
        "id": .string(habitId), "date": .string(date), "value": .number(Double(value)), "expected_revision": .number(Double(revision))
      ])
      var others = entryRows
      if let existing { others.remove(at: existing) }
      if value == 0 {
        self.entryRows = others
      } else {
        guard let record = receipt.record else { throw HabitsDataError("The check-off was not confirmed. Try again.") }
        self.entryRows = others + [record]
      }
      return try await load()
    }
  }

  public func setStatus(habitId: String, status: HabitLifecycleStatus) async throws -> Loaded {
    try await serialize { [self] in
      try await gateway.command("set_habit_status", [
        "id": .string(habitId), "expected_revision": .number(Double(try revision(habitId))), "status": .string(status.rawValue)
      ])
      return try await load()
    }
  }

  public func applyFreeze(habitId: String, date: String) async throws -> Loaded {
    try await freezeCommand("apply_habit_freeze", habitId: habitId, date: date)
  }

  public func clearFreeze(habitId: String, date: String) async throws -> Loaded {
    try await freezeCommand("clear_habit_freeze", habitId: habitId, date: date)
  }

  public func reorder(_ habitIds: [String]) async throws -> Loaded {
    guard !habitIds.isEmpty, Set(habitIds).count == habitIds.count else { throw HabitsDataError("That order repeats a habit.") }
    return try await serialize { [self] in
      let items = try habitIds.map { id -> JSONValue in ["id": .string(id), "expected_revision": .number(Double(try revision(id)))] }
      try await gateway.command("reorder_habits", ["habits": .array(items)])
      return try await load()
    }
  }

  // MARK: Private

  private func freezeCommand(_ operation: String, habitId: String, date: String) async throws -> Loaded {
    guard HabitDates.isValid(date) else { throw HabitsDataError("That day is not valid.") }
    return try await serialize { [self] in
      try await gateway.command(operation, ["id": .string(habitId), "date": .string(date), "expected_revision": .number(Double(try revision(habitId)))])
      return try await load()
    }
  }

  private func revision(_ habitId: String) throws -> Int {
    guard let habitRows else { throw HabitsDataError("Habits are still loading.") }
    guard let row = habitRows.first(where: { $0.id == habitId }) else { throw HabitsDataError("That habit is no longer available.") }
    guard let revision = row.revision, revision > 0 else { throw HabitsDataError("That habit is missing its revision.") }
    return revision
  }

  /// Runs `work` after every mutation queued before it has settled, whatever their outcome.
  private func serialize<T: Sendable>(_ work: @escaping @MainActor () async throws -> T) async throws -> T {
    let previous = tail
    let task = Task { @MainActor in
      await previous?.value
      return try await work()
    }
    tail = Task { _ = try? await task.value }
    return try await task.value
  }
}
