import AppKit
import ManorKit
import Observation
import SwiftUI

/// Home's page state and actions: the open dialogs, completions mid-fade, drops, and undo. Views call these
/// actions; the store sends the commands.
@MainActor
@Observable
final class HomeModel {
  enum Mode: String { case weekly, master }
  enum ScheduleDay: Hashable { case today, tomorrow }

  /// The open task detail; `dueAttention` asks for an exact date after a This Week drop.
  struct DetailRequest: Identifiable, Equatable {
    let id: String
    var dueAttention = false
  }

  struct CreateRequest: Identifiable, Equatable {
    let id = UUID()
    let bucket: TaskBucket
  }

  let store: HomeStore
  let drag = HomeDrag()
  let calendarDay = CalendarDayStore()
  @ObservationIgnored let context: AppContext
  @ObservationIgnored weak var undoManager: UndoManager?

  var view: Mode {
    didSet { UserDefaults.standard.set(view.rawValue, forKey: "home.view") }
  }
  var scheduleDay: ScheduleDay = .today
  var detail: DetailRequest?
  var create: CreateRequest?
  var blockDetail: IdentifiedString?
  var completing: Set<String> = []
  var persistError: String?
  var now = Date()
  /// Increments when the open dialog's backdrop or Escape asks it to close; the dialog decides how (save, confirm).
  var dismissals = 0

  @ObservationIgnored private var completionTimers: [String: Task<Void, Never>] = [:]

  init(context: AppContext) {
    self.context = context
    store = HomeStore(gateway: context.gateway)
    view = Mode(rawValue: UserDefaults.standard.string(forKey: "home.view") ?? "") ?? .weekly
  }

  // MARK: Clock

  var timeZone: TimeZone { context.timeZone }
  var today: String { TaskDates.local(now, in: timeZone).date }
  var nowTime: String { TaskDates.local(now, in: timeZone).time }
  var scheduleDate: String { scheduleDay == .today ? today : TaskDates.adding(1, to: today) }

  /// Ticks at each minute boundary so buckets roll and the now line moves.
  func runClock() async {
    while !Task.isCancelled {
      let seconds = 60 - Calendar.current.component(.second, from: Date())
      try? await Task.sleep(for: .seconds(seconds))
      now = Date()
    }
  }

  func reportError(_ prefix: String, _ error: Error) {
    withAnimation(Motion.base) { persistError = "\(prefix). \(error.localizedDescription)" }
  }

  // MARK: Opening

  func openTask(_ id: String, dueAttention: Bool = false) {
    detail = DetailRequest(id: id, dueAttention: dueAttention)
  }

  func openCreate(_ bucket: TaskBucket) {
    guard bucket.allowsCreation, store.loaded else { return }
    create = CreateRequest(bucket: bucket)
  }

  // MARK: Completion

  /// Ticking a card persists at once; the card fades and leaves the board after a beat. Ticking it again while
  /// it fades puts it back.
  func toggleComplete(_ id: String) {
    guard let task = store.task(id) else { return }
    if completing.contains(id) || task.status == .done {
      completionTimers[id]?.cancel()
      completionTimers[id] = nil
      withAnimation(Motion.base) { _ = completing.remove(id) }
      Task { await setStatus(.notStarted, of: id, undoName: nil) }
      return
    }
    let previous = task.status
    withAnimation(Motion.fast) { _ = completing.insert(id) }
    completionTimers[id] = Task { @MainActor [weak self] in
      try? await Task.sleep(for: .milliseconds(480))
      guard !Task.isCancelled, let self else { return }
      withAnimation(Motion.settle) { _ = self.completing.remove(id) }
      self.completionTimers[id] = nil
    }
    Task {
      do {
        try await store.setStatus(.done, of: id)
        registerUndo("Complete Task") { model in
          Task { await model.setStatus(previous, of: id, undoName: "Complete Task") }
        }
      } catch {
        completionTimers[id]?.cancel()
        completionTimers[id] = nil
        withAnimation(Motion.base) { _ = completing.remove(id) }
        reportError("Could not save task", error)
      }
    }
  }

  func setStatus(_ status: TaskStatus, of id: String, undoName: String?) async {
    guard let previous = store.task(id)?.status else { return }
    do {
      try await store.setStatus(status, of: id)
      if let undoName {
        registerUndo(undoName) { model in Task { await model.setStatus(previous, of: id, undoName: undoName) } }
      }
    } catch {
      reportError("Could not save task", error)
    }
  }

  // MARK: Saving, duplicating, deleting

  func save(_ task: TaskItem) async throws {
    let previous = store.task(task.id)
    do {
      try await store.saveTask(task)
      persistError = nil
      // Edits to one task undo to its earlier version; series-wide changes (this and future) don't.
      if let previous, task.recurrenceScope == nil, previous != task {
        registerUndo("Edit Task") { model in
          Task { try? await model.store.saveTask(previous) }
        }
      }
    } catch {
      reportError("Could not save task", error)
      throw error
    }
  }

  func duplicate(_ task: TaskItem) async {
    do {
      let copy = try await store.saveTask(TaskRules.duplicate(task))
      registerUndo("Duplicate Task") { model in
        Task { _ = try? await model.store.trashTask(copy.id) }
      }
    } catch {
      reportError("Could not duplicate task", error)
    }
  }

  func moveTask(_ id: String, to bucket: TaskBucket) {
    guard let task = store.task(id), let source = TaskRules.bucket(for: task, today: today, now: nowTime),
      TaskRules.canDrop(from: source, onto: bucket) else { return }
    if bucket == .week {
      openTask(id, dueAttention: true)
      return
    }
    let previousDue = task.due
    Task {
      do {
        try await store.moveTask(id, toDue: TaskRules.due(for: bucket, today: today))
        registerUndo("Move Task") { model in
          Task { try? await model.store.moveTask(id, toDue: previousDue) }
        }
      } catch {
        reportError("Could not move task", error)
      }
    }
  }

  /// Trash with Undo: a toast offers it at once and Edit > Undo keeps it.
  func trash(_ id: String) {
    if detail?.id == id { detail = nil }
    Task {
      do {
        guard let snapshot = try await store.trashTask(id) else { return }
        context.toasts.showUndoable("Task moved to Trash", undoName: "Delete Task", undoManager: undoManager) { self.restore(snapshot.id) }
      } catch {
        reportError("Could not delete task", error)
      }
    }
  }

  /// Deletes a time block with Undo: the toast and Edit > Undo put the same span back as a new block.
  func deleteBlock(_ id: String) async throws {
    guard let previous = store.block(id) else { return }
    try await store.deleteBlock(id)
    let undo: @MainActor (HomeModel) -> Void = { model in
      var copy = previous
      copy.id = UUID().uuidString.lowercased()
      copy.revision = nil
      Task {
        do { try await model.store.saveBlock(copy) } catch { model.reportError("Could not restore time block", error) }
      }
    }
    context.toasts.showUndoable("Time block deleted", undoName: "Delete Time Block", undoManager: undoManager) { undo(self) }
  }

  func restore(_ id: String) {
    Task {
      do {
        try await store.restoreTask(id)
      } catch {
        reportError("Could not restore task", error)
      }
    }
  }

  func skip(_ id: String) {
    if detail?.id == id { detail = nil }
    Task {
      do {
        try await store.skipOccurrence(id)
        context.toasts.show("Occurrence skipped")
      } catch {
        reportError("Could not skip occurrence", error)
      }
    }
  }

  private func registerUndo(_ name: String, _ action: @escaping @MainActor (HomeModel) -> Void) {
    guard let undoManager else { return }
    undoManager.registerUndo(withTarget: self) { model in
      MainActor.assumeIsolated { action(model) }
    }
    undoManager.setActionName(name)
  }

  // MARK: Board drops

  /// A card released over a column or the timeline.
  func drop(_ id: String, on target: HomeDropTarget, preview: TaskTimelineDropPreview?) {
    switch target {
    case .bucket(let bucket):
      moveTask(id, to: bucket)
    case .timeline(let date):
      guard let task = store.task(id), let start = preview?.start, let end = preview?.end else { return }
      let block = ScratchBlock(
        id: UUID().uuidString.lowercased(), taskId: task.id, date: date,
        start: TaskDates.time(fromMinutes: start), end: TaskDates.time(fromMinutes: end),
        portion: ScratchTimeline.defaultPortion(blockMinutes: end - start, estimateMinutes: task.estimate?.rawValue),
        createdAt: TaskDates.isoString(Date()), expiresAt: ScratchTimeline.expiry(date: date, end: TaskDates.time(fromMinutes: end), timeZone: timeZone)
      )
      Task {
        do {
          try await store.saveBlock(block)
          registerUndo("Block Time") { model in Task { try? await model.store.deleteBlock(block.id) } }
        } catch { reportError("Could not create time block", error) }
      }
    }
  }

  /// The keyboard and menu path to the same result as dragging a card onto the schedule: the next open slot.
  func scheduleOnTimeline(_ id: String, day: ScheduleDay) {
    guard let task = store.task(id) else { return }
    let date = day == .today ? today : TaskDates.adding(1, to: today)
    let after = day == .today ? max(ScratchTimeline.startMinutes, TaskDates.minutes(nowTime) ?? 0) : ScratchTimeline.startMinutes
    let minutes = ScratchTimeline.blockMinutes(for: task.estimate)
    do {
      let busy = ScratchTimeline.busy(on: date, blocks: store.blocks, events: eventSpans(on: date))
      guard let start = TaskDates.minutes(try ScratchTimeline.freeStart(minutes: minutes, after: after, busy: busy)) else { return }
      scheduleDay = day
      drop(id, on: .timeline(date: date), preview: TaskTimelineDropPreview(start: start, end: start + minutes, title: task.title))
    } catch {
      context.toasts.show("No open slot before midnight fits this task.")
    }
  }

  /// Event spans count as busy only for the day the timeline shows.
  func eventSpans(on date: String) -> [ClosedRange<Int>] {
    guard date == scheduleDate else { return [] }
    return calendarDay.events.filter { !$0.allDay && $0.date == date }.compactMap { event in
      guard let start = TaskDates.minutes(event.start), let end = TaskDates.minutes(event.end), end > start else { return nil }
      return start...end
    }
  }

  // MARK: Scratch blocks

  func moveBlock(_ id: String, start: Int, end: Int) {
    guard var block = store.block(id) else { return }
    let previous = block
    block.start = TaskDates.time(fromMinutes: start)
    block.end = TaskDates.time(fromMinutes: end)
    block.expiresAt = ScratchTimeline.expiry(date: block.date, end: block.end, timeZone: timeZone)
    Task {
      do {
        try await store.saveBlock(block)
        registerUndo("Move Time Block") { model in Task { try? await model.store.saveBlock(previous) } }
      } catch { reportError("Could not save time block", error) }
    }
  }

  /// A drag on empty timeline makes a freestanding block over that range and opens it to name it.
  func createBlock(start: Int, end: Int) {
    let date = scheduleDate
    let endTime = TaskDates.time(fromMinutes: end)
    let block = ScratchBlock(
      id: UUID().uuidString.lowercased(), taskId: nil, date: date, start: TaskDates.time(fromMinutes: start), end: endTime,
      portion: "", createdAt: TaskDates.isoString(Date()), expiresAt: ScratchTimeline.expiry(date: date, end: endTime, timeZone: timeZone)
    )
    Task {
      do {
        try await store.saveBlock(block)
        registerUndo("New Time Block") { model in Task { try? await model.store.deleteBlock(block.id) } }
        blockDetail = IdentifiedString(value: block.id)
      } catch {
        reportError("Could not create time block", error)
      }
    }
  }
}
