import AppKit
import Foundation
import ManorKit
import Observation

/// Mood and focus records for the signed-in account. Saves run one at a time so each sends the revision
/// the save before it committed; a rating tap shows at once and returns to the committed record if the
/// save fails.
@MainActor
@Observable
final class MoodFocusStore {
  /// Committed and optimistic records merged, newest information first. The page reads only this.
  private(set) var entries: [MoodFocusEntry] = []
  private(set) var today: String = ""
  private(set) var loaded = false
  private(set) var loadError: String?
  var saveError: String?

  /// Server state by date: revisions and editor baselines come from here, never from optimistic taps.
  @ObservationIgnored private var committed: [String: MoodFocusEntry] = [:]
  @ObservationIgnored private var optimistic: [String: MoodFocusEntry] = [:]
  @ObservationIgnored private var tail: Task<Void, Never>?
  @ObservationIgnored private weak var context: AppContext?

  /// Loads, then reloads whenever the table changes (own saves, other devices, Codex). Runs for the page's life.
  func run(context: AppContext) async {
    self.context = context
    await load()
    let changes = context.gateway.changes(of: ["mood_focus_entries"])
    await withTaskGroup(of: Void.self) { group in
      group.addTask { @MainActor [weak self] in
        for await _ in changes { await self?.load() }
      }
      group.addTask { @MainActor [weak self] in
        // The account's day can turn over while the page stays open.
        for await _ in NotificationCenter.default.notifications(named: NSApplication.didBecomeActiveNotification) {
          self?.refreshToday()
        }
      }
    }
  }

  func refreshToday() {
    guard let context, context.today != today else { return }
    today = context.today
    monthCache.removeAll(keepingCapacity: true)
  }

  func load() async {
    guard let context else { return }
    do {
      let rows = try await context.gateway.rows("mood_focus_entries")
      var parsed: [String: MoodFocusEntry] = [:]
      for row in rows {
        let entry = try MoodFocusEntry(row: row)
        parsed[entry.date] = entry
      }
      // A read that raced a save keeps the newer committed record. Records are never deleted, so one the
      // read has not caught up with yet stays too.
      for (date, entry) in committed where (parsed[date]?.revision ?? -1) < entry.revision {
        parsed[date] = entry
      }
      committed = parsed
      today = context.today
      loadError = nil
      loaded = true
      rebuild()
    } catch {
      if !loaded { loadError = error.localizedDescription } else { saveError = error.localizedDescription }
    }
  }

  func entry(on date: String) -> MoodFocusEntry? { entries.first { $0.date == date } }
  func committedEntry(on date: String) -> MoodFocusEntry? { committed[date] }

  private func rebuild() {
    var merged = committed
    for (date, entry) in optimistic { merged[date] = entry }
    entries = merged.values.sorted { $0.date < $1.date }
    monthCache.removeAll(keepingCapacity: true)
  }

  // MARK: Derived history (computed once per data change, read by views)

  @ObservationIgnored private var monthCache: [String: MoodFocusMonthData] = [:]

  /// Everything History draws for one month and trend range.
  func month(_ month: String, range: Int) -> MoodFocusMonthData {
    let key = "\(month)|\(range)|\(today)"
    if let cached = monthCache[key] { return cached }
    let monthEntries = MoodFocusHistory.entries(entries, inMonth: month)
    let data = MoodFocusMonthData(
      summary: MoodFocusHistory.monthSummary(entries, month: month),
      trend: MoodFocusHistory.monthTrend(entries, endMonth: month, range: range),
      moods: MoodFocusHistory.moodDistribution(monthEntries),
      focuses: MoodFocusHistory.focusDistribution(monthEntries),
      earliestMonth: MoodFocusHistory.earliestEntryMonth(entries, today: today)
    )
    monthCache[key] = data
    return data
  }

  // MARK: Daily ratings command

  /// What a daily ratings save changes: one tapped signal (the other stays as it is), or both signals
  /// explicitly from the day editor, where nil clears one.
  enum DailyRatings {
    case mood(Mood)
    case focus(Focus)
    case both(mood: Mood?, focus: Focus?)
  }

  /// The one place today's and yesterday's ratings reach the server: the operation and its input. Older
  /// days use `correct_mood_focus_history` instead.
  private static func dailyRatingsCommand(_ ratings: DailyRatings, date: String, revision: Int) -> (operation: String, input: JSONObject) {
    let input: JSONObject
    switch ratings {
    case .mood(let mood): input = MoodFocusCommands.rateMood(date: date, mood: mood, revision: revision)
    case .focus(let focus): input = MoodFocusCommands.rateFocus(date: date, focus: focus, revision: revision)
    case .both(let mood, let focus):
      input = MoodFocusCommands.setRatings(MoodFocusHistoryMutation(date: date, mood: mood, focus: focus, expectedUpdatedAt: nil), revision: revision)
    }
    return ("log_daily_ratings", input)
  }

  // MARK: Quick capture

  func setMood(_ mood: Mood, on date: String) {
    rate(date: date, label: "Could not save mood", change: { $0.mood = mood }, ratings: .mood(mood))
  }

  func setFocus(_ focus: Focus, on date: String) {
    rate(date: date, label: "Could not save focus", change: { $0.focus = focus }, ratings: .focus(focus))
  }

  private func rate(date: String, label: String, change: (inout MoodFocusEntry) -> Void, ratings: DailyRatings) {
    let stamp = ISO8601DateFormatter().string(from: Date())
    var next = optimistic[date] ?? committed[date] ?? MoodFocusEntry(date: date, mood: nil, focus: nil, createdAt: stamp, updatedAt: stamp, revision: 0)
    change(&next)
    let before = optimistic[date]
    optimistic[date] = next
    rebuild()
    Task {
      do {
        try await self.save(date: date, command: { Self.dailyRatingsCommand(ratings, date: date, revision: $0) })
        if self.optimistic[date] == next { self.optimistic[date] = nil }
        self.saveError = nil
      } catch {
        if self.optimistic[date] == next { self.optimistic[date] = before }
        self.saveError = "\(label): \(error.localizedDescription)"
      }
      self.rebuild()
    }
  }

  // MARK: History

  /// Saves an editor's ratings. Today goes through quick capture's command; any earlier day through the
  /// history correction. A record that changed since the editor opened is refused.
  func saveHistory(_ mutation: MoodFocusHistoryMutation) async throws {
    let mutation = try mutation.validated()
    let isToday = mutation.date == today
    try await save(
      date: mutation.date,
      command: { revision in
        isToday
          ? Self.dailyRatingsCommand(.both(mood: mutation.mood, focus: mutation.focus), date: mutation.date, revision: revision)
          : ("correct_mood_focus_history", MoodFocusCommands.correctHistory(mutation, revision: revision))
      },
      check: { [weak self] in
        if self?.committed[mutation.date]?.updatedAt != mutation.expectedUpdatedAt {
          throw MoodFocusValidationError(MoodFocusCommands.staleMessage)
        }
      }
    )
    saveError = nil
  }

  // MARK: Serialized saves

  /// Runs after every earlier save has finished; the input is built from the revision committed by then.
  private func save(date: String, command: @escaping (Int) -> (operation: String, input: JSONObject), check: (() throws -> Void)? = nil) async throws {
    guard let context else { return }
    let previous = tail
    let work = Task { @MainActor [weak self] () throws -> Void in
      await previous?.value
      guard let self else { return }
      try check?()
      let revision = self.committed[date]?.revision ?? 0
      let call = command(revision)
      let receipt = try await context.gateway.command(call.operation, call.input)
      if let record = receipt.record {
        let entry = try MoodFocusEntry(row: record)
        self.committed[entry.date] = entry
      }
    }
    tail = Task { _ = try? await work.value }
    try await work.value
    rebuild()
  }

  #if DEBUG
  /// Seeds the store for previews and design snapshots; never called by the app.
  func preview(entries: [MoodFocusEntry], today: String) {
    committed = Dictionary(entries.map { ($0.date, $0) }, uniquingKeysWith: { first, _ in first })
    self.today = today
    loaded = true
    rebuild()
  }
  #endif
}

struct MoodFocusMonthData {
  let summary: MoodFocusMonthSummary
  let trend: [MoodFocusTrendPoint]
  let moods: [MoodFocusDistributionRow<Mood>]
  let focuses: [MoodFocusDistributionRow<Focus>]
  let earliestMonth: String
}
