import Foundation
import ManorKit
import Observation

/// The problem library's state: the indexed catalog and custom problems, saved views, attempts, and mistakes
/// notes, plus the current view settings and the rows they select. Parsing, indexing, and querying run off the
/// main thread; the page only swaps in finished results.
@MainActor
@Observable
final class ProblemLibraryStore {
  let gateway: Gateway

  private(set) var index: ProblemLibraryIndex?
  private(set) var views: [ProblemSavedView] = []
  private(set) var attempts: [ProblemAttempt] = []
  /// Newest first.
  private(set) var mistakes: [ProblemMistake] = []
  private(set) var loadError: String?
  private(set) var isLoading = false

  /// The settings the table shows; a saved view is a starting point that these may drift from.
  private(set) var settings = ProblemViewSettings.initial
  private(set) var viewId: String?
  /// The search field's text, which drives `settings.filters.search`.
  private(set) var searchText = ""

  private(set) var result = ProblemQueryResult.empty
  /// Changes whenever `result` or the problems behind it change, so the table reloads.
  private(set) var resultToken = 0
  /// Changes when the filters, sort, or grouping change, so the table returns to the top.
  private(set) var scrollToken = 0
  private(set) var busy = false

  @ObservationIgnored private var started = false
  @ObservationIgnored private var watcher: Task<Void, Never>?
  @ObservationIgnored private var queryTask: Task<Void, Never>?
  @ObservationIgnored private var generation = 0

  static let tables: Set<String> = ["problem_catalog", "leetcode_problems", "problem_practice", "saved_problem_views", "leetcode_attempts", "leetcode_notes"]

  init(gateway: Gateway) { self.gateway = gateway }

  deinit {
    watcher?.cancel()
    queryTask?.cancel()
  }

  var selectedView: ProblemSavedView? { views.first { $0.id == viewId } }
  var isDirty: Bool { selectedView.map { $0.settings != settings } ?? false }
  var problemCount: Int? { index?.count }

  // MARK: Loading

  func start() {
    guard !started else { return }
    started = true
    Task { await reload(Self.tables) }
    watcher = Task { [weak self, gateway] in
      for await tables in gateway.changes(of: Self.tables) {
        guard let self else { return }
        await self.reload(tables)
      }
    }
  }

  func retry() { Task { await reload(Self.tables) } }

  /// Reloads what changed: the whole library for problem rows, practice for attempts, and the small lists alone.
  func reload(_ tables: Set<String>) async {
    let problems = index == nil || !tables.isDisjoint(with: ["problem_catalog", "leetcode_problems"])
    let practice = problems || !tables.isDisjoint(with: ["problem_practice", "leetcode_attempts"])
    if problems { isLoading = true }
    defer { if problems { isLoading = false } }
    do {
      if !tables.isDisjoint(with: ["saved_problem_views"]) || index == nil {
        views = try await gateway.rows("saved_problem_views").map(ProblemSavedView.parse).sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
      }
      if !tables.isDisjoint(with: ["leetcode_notes"]) || index == nil {
        mistakes = try await gateway.rows("leetcode_notes").map(ProblemRows.mistake).sorted { $0.createdAt > $1.createdAt }
      }
      guard practice else { loadError = nil; return }
      let attemptRows = try await gateway.rows("leetcode_attempts")
      let practiceRows = try await gateway.rows("problem_practice")
      let attempts = try attemptRows.map(ProblemRows.attempt)
      let state = try ProblemPractice(attempts: attempts, practiceRows: practiceRows)
      let next: ProblemLibraryIndex
      if problems {
        let catalog = try await gateway.rows("problem_catalog")
        let custom = try await gateway.rows("leetcode_problems")
        next = try await Task.detached(priority: .userInitiated) {
          try ProblemLibraryIndex(records: ProblemRows.library(catalog: catalog, custom: custom, practice: state))
        }.value
      } else if let current = index {
        next = await Task.detached(priority: .userInitiated) { current.updating(practice: state) }.value
      } else {
        return
      }
      self.attempts = attempts
      index = next
      loadError = nil
      requery(resetScroll: false)
    } catch is CancellationError {
    } catch {
      loadError = error.localizedDescription
    }
  }

  // MARK: Querying

  private func requery(resetScroll: Bool) {
    guard let index else { return }
    let query = ProblemQuery(settings)
    queryTask?.cancel()
    generation += 1
    let current = generation
    queryTask = Task { [weak self] in
      let result = await Task.detached(priority: .userInitiated) { index.query(query) }.value
      guard let self, !Task.isCancelled, self.generation == current else { return }
      self.result = result
      self.resultToken += 1
      if resetScroll { self.scrollToken += 1 }
    }
  }

  /// Changes the view settings and re-runs the query when the filters, sort, or grouping changed.
  func update(_ change: (inout ProblemViewSettings) -> Void) {
    var next = settings
    change(&next)
    guard next != settings else { return }
    let projectionChanged = ProblemQuery(next) != ProblemQuery(settings)
    settings = next
    if searchText != next.filters.search { searchText = next.filters.search }
    if projectionChanged { requery(resetScroll: true) }
  }

  func setSearch(_ text: String) {
    searchText = String(text.prefix(500))
    update { $0.filters.search = searchText }
  }

  func clearFilters() { update { $0.filters = .empty } }

  func select(_ view: ProblemSavedView?) {
    viewId = view?.id
    update { $0 = view?.settings ?? .initial }
  }

  // MARK: Saved views

  /// Saves the current settings under `name`, as a new view or over the selected one, and selects the result.
  func saveView(name: String, asNew: Bool) async throws {
    let existing = asNew ? nil : selectedView
    let id = existing?.id ?? UUID().uuidString.lowercased()
    let input = try ProblemCommands.saveView(id: id, expectedRevision: existing?.revision ?? 0, name: name, settings: settings)
    busy = true
    defer { busy = false }
    let receipt = try await gateway.command("save_problem_view", input)
    guard let row = receipt.record else { throw ProblemLibraryError("The view was saved, but Manor did not return it. Refresh the library.") }
    let saved = try ProblemSavedView.parse(row)
    views = (views.filter { $0.id != saved.id } + [saved]).sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    viewId = saved.id
    update { $0 = saved.settings }
  }

  /// Renames a view without touching its saved settings.
  func renameView(_ view: ProblemSavedView, to name: String) async throws {
    let input = try ProblemCommands.saveView(id: view.id, expectedRevision: view.revision, name: name, settings: view.settings)
    busy = true
    defer { busy = false }
    let receipt = try await gateway.command("save_problem_view", input)
    if let row = receipt.record, let saved = try? ProblemSavedView.parse(row) {
      views = views.map { $0.id == saved.id ? saved : $0 }.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }
  }

  func deleteView(_ view: ProblemSavedView) async throws {
    busy = true
    defer { busy = false }
    try await gateway.command("delete_problem_view", ProblemCommands.deleteView(id: view.id, expectedRevision: view.revision))
    views.removeAll { $0.id == view.id }
    if viewId == view.id { select(nil) }
  }

  // MARK: Attempts

  func history(for problemId: String) -> [ProblemAttempt] { ProblemAttempts.history(attempts, for: problemId) }

  func addAttempt(problemId: String, date: String, solution: String) async throws {
    let input = try ProblemCommands.createAttempt(id: UUID().uuidString.lowercased(), problemId: problemId, date: date, solution: solution)
    try await gateway.command("create_attempt", input)
    await reload(["leetcode_attempts"])
  }

  func updateAttempt(_ attempt: ProblemAttempt, date: String, solution: String) async throws {
    let input = try ProblemCommands.updateAttempt(id: attempt.id, expectedRevision: attempt.revision, date: date, solution: solution)
    try await gateway.command("update_attempt", input)
    await reload(["leetcode_attempts"])
  }

  func deleteAttempt(_ attempt: ProblemAttempt) async throws {
    try await gateway.command("delete_attempt", ProblemCommands.deleteAttempt(id: attempt.id, expectedRevision: attempt.revision))
    await reload(["leetcode_attempts"])
  }

  // MARK: Mistakes

  func addMistake(_ text: String) async throws {
    let input = try ProblemCommands.saveMistake(id: UUID().uuidString.lowercased(), expectedRevision: 0, text: text)
    try await gateway.command("save_mistake", input)
    await reload(["leetcode_notes"])
  }

  func updateMistake(_ note: ProblemMistake, text: String) async throws {
    let input = try ProblemCommands.saveMistake(id: note.id, expectedRevision: note.revision, text: text)
    try await gateway.command("save_mistake", input)
    await reload(["leetcode_notes"])
  }

  func deleteMistake(_ note: ProblemMistake) async throws {
    try await gateway.command("delete_mistake", ProblemCommands.deleteMistake(id: note.id, expectedRevision: note.revision))
    mistakes.removeAll { $0.id == note.id }
    await reload(["leetcode_notes"])
  }
}
