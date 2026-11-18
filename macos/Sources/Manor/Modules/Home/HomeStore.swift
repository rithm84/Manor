import Foundation
import ManorKit
import Observation

/// Home's records and every command it sends. Reads come from the gateway (the mirror once it serves);
/// writes go through `manor_command` with the web service's inputs. Changes show at once and settle on the
/// committed record, or the previous one returns when the save fails.
@MainActor
@Observable
final class HomeStore {
  static let tables: Set<String> = ["tasks", "contexts", "scratch_blocks", "saved_task_views"]

  let gateway: Gateway
  private(set) var tasks: [TaskItem] = []
  private(set) var contexts: [TaskContext] = []
  private(set) var blocks: [ScratchBlock] = []
  private(set) var views: [SavedTaskView] = []
  private(set) var loaded = false
  private(set) var loadError: String?

  /// Raw rows by table and id, newest known revision, so commands carry the right expected revision and a
  /// read that overlapped a command never rolls a committed record back.
  @ObservationIgnored private var rows: [String: [String: Row]] = [:]
  @ObservationIgnored private var observing = false

  init(gateway: Gateway) { self.gateway = gateway }

  // MARK: Loading

  /// Loads now and again whenever one of Home's tables changes, from this device or any other.
  func run() async {
    guard !observing else { return }
    observing = true
    defer { observing = false }
    await load()
    for await _ in gateway.changes(of: Self.tables) {
      await load()
    }
  }

  func load() async {
    do {
      async let taskRows = gateway.rows("tasks")
      async let contextRows = gateway.rows("contexts")
      async let blockRows = gateway.rows("scratch_blocks")
      async let viewRows = gateway.rows("saved_task_views")
      let read = try await (taskRows, contextRows, blockRows, viewRows)
      merge("tasks", read.0)
      merge("contexts", read.1)
      merge("scratch_blocks", read.2)
      merge("saved_task_views", read.3)
      rebuild()
      loadError = nil
      loaded = true
    } catch {
      loadError = error.localizedDescription
      loaded = true
    }
  }

  private func merge(_ table: String, _ read: [Row]) {
    let previous = rows[table] ?? [:]
    var next: [String: Row] = [:]
    for row in read {
      guard let id = row.id else { continue }
      if let known = previous[id], (known.revision ?? 0) > (row.revision ?? 0) { next[id] = known } else { next[id] = row }
    }
    rows[table] = next
  }

  private func rebuild() {
    let now = Date()
    tasks = (rows["tasks"] ?? [:]).values.filter(TaskItem.isLive).compactMap { try? TaskItem(row: $0) }
    contexts = (rows["contexts"] ?? [:]).values.compactMap { try? TaskContext(row: $0) }
      .sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
    blocks = (rows["scratch_blocks"] ?? [:]).values.filter { ScratchBlock.isLive($0, now: now) }.compactMap { try? ScratchBlock(row: $0) }
    views = (rows["saved_task_views"] ?? [:]).values.compactMap { try? SavedTaskView(row: $0) }
      .sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
  }

  private func remember(_ table: String, _ row: Row?) {
    guard let row, let id = row.id else { return }
    rows[table, default: [:]][id] = row
  }

  private func forget(_ table: String, id: String) { rows[table]?[id] = nil }

  private func run(_ command: TaskCommands.Command) async throws -> CommandReceipt {
    try await gateway.command(command.operation, command.input)
  }

  // MARK: Lookups

  func task(_ id: String) -> TaskItem? { tasks.first { $0.id == id } }
  func context(named name: String) -> TaskContext? { contexts.first { $0.name == name } }
  func block(_ id: String) -> ScratchBlock? { blocks.first { $0.id == id } }

  // MARK: Tasks

  /// Saves a new or edited task. The board shows the change at once; a failure restores the previous record.
  @discardableResult
  func saveTask(_ task: TaskItem) async throws -> TaskItem {
    guard let context = context(named: task.context) else { throw TaskRecordError("Choose a Context before saving this task") }
    let existingRow = rows["tasks"]?[task.id]
    let command = try TaskCommands.saveTask(task, contextId: context.id, existing: existingRow.map(TaskCommands.Existing.init(row:)))
    let previous = self.task(task.id)
    var optimistic = task
    optimistic.title = task.title.trimmingCharacters(in: .whitespacesAndNewlines)
    optimistic.recurrenceScope = nil
    replaceTask(optimistic, inserting: previous == nil)
    do {
      let receipt = try await run(command)
      remember("tasks", receipt.record)
      if command.operation == "update_future_task_occurrences" || command.operation == "convert_task_to_series" || command.operation == "create_recurring_task" {
        // Series changes touch other occurrences; read them back.
        await load()
      } else {
        rebuild()
      }
      return receipt.record.flatMap { try? TaskItem(row: $0) } ?? optimistic
    } catch {
      if let previous { replaceTask(previous, inserting: false) } else { tasks.removeAll { $0.id == task.id } }
      throw error
    }
  }

  private func replaceTask(_ task: TaskItem, inserting: Bool) {
    if let index = tasks.firstIndex(where: { $0.id == task.id }) { tasks[index] = task } else if inserting { tasks.append(task) }
  }

  func setStatus(_ status: TaskStatus, of id: String) async throws {
    guard var task = task(id) else { return }
    task.status = status
    try await saveTask(task)
  }

  func moveTask(_ id: String, toDue due: String) async throws {
    guard var task = task(id) else { return }
    task.due = due
    try await saveTask(task)
  }

  /// Moves a task to Trash. Its time blocks go with it on the server; Undo restores the task only.
  func trashTask(_ id: String) async throws -> TaskItem? {
    guard let snapshot = task(id), let revision = rows["tasks"]?[id]?.revision else { return nil }
    tasks.removeAll { $0.id == id }
    let removedBlocks = blocks.filter { $0.taskId == id }
    blocks.removeAll { $0.taskId == id }
    do {
      let receipt = try await run(TaskCommands.trashTask(id: id, revision: revision))
      remember("tasks", receipt.record)
      return snapshot
    } catch {
      tasks.append(snapshot)
      blocks += removedBlocks
      throw error
    }
  }

  func restoreTask(_ id: String) async throws {
    guard let revision = rows["tasks"]?[id]?.revision else { throw TaskRecordError("The task is no longer available") }
    let receipt = try await run(TaskCommands.restoreTask(id: id, revision: revision))
    remember("tasks", receipt.record)
    rebuild()
  }

  func skipOccurrence(_ id: String) async throws {
    guard let revision = rows["tasks"]?[id]?.revision else { return }
    let previous = task(id)
    tasks.removeAll { $0.id == id }
    do {
      let receipt = try await run(TaskCommands.skipOccurrence(id: id, revision: revision))
      remember("tasks", receipt.record)
    } catch {
      if let previous { tasks.append(previous) }
      throw error
    }
  }

  // MARK: Contexts

  @discardableResult
  func addContext(_ draft: ContextDraft) async throws -> TaskContext {
    let name = try TaskCommands.validateContextName(draft.name)
    try TaskCommands.checkUnique(name, among: contexts)
    let receipt = try await run(try TaskCommands.createContext(ContextDraft(name: name, color: draft.color, icon: draft.icon)))
    remember("contexts", receipt.record)
    rebuild()
    guard let row = receipt.record, let context = try? TaskContext(row: row) else { throw TaskRecordError("The new context could not be read back") }
    return context
  }

  /// Renames cascade to tasks and saved views on the server, so everything reads back.
  @discardableResult
  func updateContext(_ original: TaskContext, to draft: ContextDraft) async throws -> TaskContext {
    let name = try TaskCommands.validateContextName(draft.name)
    try TaskCommands.checkUnique(name, among: contexts, except: original.name)
    let receipt = try await run(try TaskCommands.updateContext(original, to: ContextDraft(name: name, color: draft.color, icon: draft.icon)))
    remember("contexts", receipt.record)
    await load()
    guard let row = receipt.record, let context = try? TaskContext(row: row) else { throw TaskRecordError("The context could not be read back") }
    return context
  }

  /// Refused while any task references the context, Trash included.
  func removeContext(_ context: TaskContext) async throws {
    _ = try await run(TaskCommands.removeContext(context))
    forget("contexts", id: context.id)
    rebuild()
  }

  // MARK: Scratch blocks

  func saveBlock(_ block: ScratchBlock) async throws {
    let exists = rows["scratch_blocks"]?[block.id] != nil
    var outgoing = block
    outgoing.revision = rows["scratch_blocks"]?[block.id]?.revision
    let command = try TaskCommands.saveScratchBlock(outgoing, exists: exists)
    let previous = self.block(block.id)
    if let index = blocks.firstIndex(where: { $0.id == block.id }) { blocks[index] = block } else { blocks.append(block) }
    do {
      let receipt = try await run(command)
      remember("scratch_blocks", receipt.record)
      rebuild()
    } catch {
      if let previous, let index = blocks.firstIndex(where: { $0.id == block.id }) { blocks[index] = previous } else { blocks.removeAll { $0.id == block.id } }
      throw error
    }
  }

  func deleteBlock(_ id: String) async throws {
    guard let previous = block(id), let revision = rows["scratch_blocks"]?[id]?.revision else { return }
    blocks.removeAll { $0.id == id }
    do {
      _ = try await run(TaskCommands.deleteScratchBlock(id: id, revision: revision))
      forget("scratch_blocks", id: id)
    } catch {
      blocks.append(previous)
      throw error
    }
  }

  // MARK: Saved views

  func saveView(_ view: SavedTaskView) async throws {
    let exists = rows["saved_task_views"]?[view.id] != nil
    var outgoing = view
    outgoing.revision = rows["saved_task_views"]?[view.id]?.revision
    let receipt = try await run(try TaskCommands.saveTaskView(outgoing, exists: exists))
    remember("saved_task_views", receipt.record)
    rebuild()
  }

  func deleteView(_ id: String) async throws {
    guard let revision = rows["saved_task_views"]?[id]?.revision else { return }
    _ = try await run(TaskCommands.deleteTaskView(id: id, revision: revision))
    forget("saved_task_views", id: id)
    rebuild()
  }
}

/// Connected-calendar events for the Today timeline: enabled calendars only, read through the mirror when it
/// serves and from the server over the day's window otherwise.
@MainActor
@Observable
final class CalendarDayStore {
  private(set) var events: [CalendarDayEvent] = []
  private(set) var error: String?
  @ObservationIgnored private var loadedKey: String?

  func load(date: String, gateway: Gateway, timeZone: TimeZone) async {
    do {
      let calendars = try await gateway.rows("calendars").filter { $0["enabled"]?.bool == true }
      guard !calendars.isEmpty, let window = try? CalendarWindow(days: [date]) else {
        events = []
        error = nil
        return
      }
      let stored: [Row]
      if let mirror = gateway.localMirror, let mirrored = try await mirror.rows("calendar_events", filters: []) {
        stored = mirrored.filter(window.contains)
      } else {
        let data = try await gateway.perform("Read calendar_events") {
          try await gateway.client.from("calendar_events").select().eq("user_id", value: gateway.accountId).or(window.serverFilter).execute().data
        }
        stored = try ManorJSON.rows(from: data)
      }
      var colors: [String: String] = [:]
      for calendar in calendars {
        if let id = calendar["id"]?.string, let account = calendar["account_id"]?.string {
          colors["\(account)\u{1F}\(id)"] = calendar["color"]?.string ?? ""
        }
      }
      events = stored.compactMap(StoredCalendarEvent.init(row:)).flatMap { event -> [CalendarDayEvent] in
        guard let color = colors["\(event.accountId)\u{1F}\(event.calendarId)"] else { return [] }
        return CalendarDays.days(event, dates: [date], timeZone: timeZone, color: color.isEmpty ? nil : color)
      }
      error = nil
      loadedKey = date
    } catch is CancellationError {
      // The timeline moved or redrew mid-read; the next read fills it, so nothing failed.
      return
    } catch {
      if Task.isCancelled { return }
      if loadedKey != date { events = [] }
      self.error = "Calendar events could not be loaded. \(error.localizedDescription)"
    }
  }
}
