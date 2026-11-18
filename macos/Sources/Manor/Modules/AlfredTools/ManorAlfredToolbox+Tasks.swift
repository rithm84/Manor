import Alfred
import Foundation
import ManorKit

// Tasks: find, create, complete or reopen, reschedule, and set priority, with the commands Home sends.

extension ManorAlfredToolbox {
  /// Live tasks (not in Trash, skipped, or replaced), their rows for revisions, and the contexts.
  struct TaskData {
    var tasks: [TaskItem]
    var rows: [String: Row]
    var contexts: [TaskContext]

    func task(_ id: String) -> TaskItem? { tasks.first { $0.id == id } }
  }

  func loadTasks() async throws -> TaskData {
    async let taskRows = gateway.rows("tasks")
    async let contextRows = gateway.rows("contexts")
    let (rows, contexts) = try await (taskRows, contextRows)
    let live = rows.filter(TaskItem.isLive)
    var byId: [String: Row] = [:]
    for row in live { if let id = row.id { byId[id] = row } }
    return TaskData(
      tasks: live.compactMap { try? TaskItem(row: $0) }, rows: byId,
      contexts: contexts.compactMap { try? TaskContext(row: $0) }.sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
    )
  }

  // MARK: Formatting

  func dueText(_ task: TaskItem) -> String {
    let label = ManorToolDates.label(task.due, today: today)
    return "\(task.due)\(label.first?.isLowercase == true ? " (\(label))" : "")\(task.dueTime.map { " \($0)" } ?? "")"
  }

  /// One compact line per task for the model.
  func taskLine(_ task: TaskItem) -> String {
    var parts = ["[\(task.id)] \(task.title)", "due \(dueText(task))"]
    if let priority = task.priority { parts.append(priority.rawValue) }
    parts.append(task.status.label)
    parts.append(task.context)
    if task.isRecurring { parts.append("repeats") }
    return parts.joined(separator: ", ")
  }

  func taskCandidate(_ task: TaskItem) -> ManorTargetCandidate {
    ManorTargetCandidate(id: task.id, title: task.title, detail: "due \(dueText(task))\(task.status == .done ? ", done" : "")")
  }

  // MARK: Resolving references

  /// Every reference resolved to one task, looking first among `primary` tasks and then all live ones; a task due
  /// today breaks a tie between repeats of the same title. Any reference that doesn't resolve fails the call.
  func resolveTasks(_ references: [String], in data: TaskData, primary: (TaskItem) -> Bool) throws -> [TaskItem] {
    let dueToday = Set(data.tasks.filter { $0.due == today }.map(\.id))
    let preferred: (ManorTargetCandidate) -> Bool = { dueToday.contains($0.id) }
    let primaryPool = data.tasks.filter(primary).map(taskCandidate)
    let everything = data.tasks.map(taskCandidate)
    var tasks: [TaskItem] = []
    var problems: [String] = []
    for reference in references {
      var match = ManorTargetMatcher.match(reference, in: primaryPool, preferred: preferred)
      if case .none = match { match = ManorTargetMatcher.match(reference, in: everything, preferred: preferred) }
      if case .one(let candidate) = match, let task = data.task(candidate.id) {
        if !tasks.contains(where: { $0.id == task.id }) { tasks.append(task) }
      } else {
        problems.append(ManorTargetMatcher.problem(reference, kind: "task", match: match) ?? "No task matches \"\(reference)\".")
      }
    }
    if !problems.isEmpty { throw ManorToolArgumentError(problems.joined(separator: "\n")) }
    return tasks
  }

  // MARK: Writing

  /// Saves a task the way Home does: the operation and input `TaskCommands.saveTask` builds for it.
  @discardableResult
  func saveTask(_ task: TaskItem, in data: TaskData) async throws -> Row? {
    guard let taskContext = data.contexts.first(where: { $0.name == task.context }) else {
      throw TaskRecordError("Choose a Context before saving \(Self.quoted(task.title))")
    }
    let command = try TaskCommands.saveTask(task, contextId: taskContext.id, existing: data.rows[task.id].map(TaskCommands.Existing.init(row:)))
    return try await gateway.command(command.operation, command.input).record
  }

  struct TaskWrite {
    /// The tasks as they were before the change, for undo.
    var changed: [TaskItem] = []
    var unchanged: [TaskItem] = []
    var failures: [String] = []
  }

  /// Applies `change` to each task in turn. A task the change leaves as it is isn't sent.
  func writeTasks(_ targets: [TaskItem], in data: TaskData, change: (inout TaskItem) -> Void) async -> TaskWrite {
    var write = TaskWrite()
    for task in targets {
      var next = task
      change(&next)
      next.recurrenceScope = nil
      if next.sameContent(as: task) {
        write.unchanged.append(task)
        continue
      }
      do {
        try await saveTask(next, in: data)
        write.changed.append(task)
      } catch {
        write.failures.append("\(task.title): \(error.localizedDescription)")
      }
    }
    return write
  }

  /// Puts each changed task's fields back as they were, on top of whatever else changed since.
  func restoreTasks(_ previous: [TaskItem], restore: @escaping (inout TaskItem, TaskItem) -> Void) async throws -> Int {
    let data = try await loadTasks()
    var restored = 0
    for old in previous {
      guard var current = data.task(old.id) else { continue }
      let before = current
      restore(&current, old)
      if current.sameContent(as: before) { continue }
      try await saveTask(current, in: data)
      restored += 1
    }
    return restored
  }

  /// The result of a batch write: what changed, what was already that way, what failed, and the undo.
  func taskResult(_ write: TaskWrite, summary: (String) -> String, already: String, undo: @escaping @MainActor () async throws -> String) -> AlfredToolResult {
    let changed = write.changed.map(\.title)
    var details: [String] = []
    if !write.changed.isEmpty { details.append("Changed: " + write.changed.map { "[\($0.id)] \($0.title)" }.joined(separator: "; ")) }
    if !write.unchanged.isEmpty { details.append("\(already): " + write.unchanged.map { "[\($0.id)] \($0.title)" }.joined(separator: "; ")) }
    if !write.failures.isEmpty { details.append("Couldn't change: " + write.failures.joined(separator: "; ")) }
    let output = details.joined(separator: "\n")
    if write.changed.isEmpty {
      if !write.failures.isEmpty { return .failed(write.failures.joined(separator: "\n")) }
      let titles = write.unchanged.map(\.title)
      return .done("\(Self.count(titles, noun: "task")) \(titles.count == 1 ? "was" : "were") \(already.lowercased())", output: output)
    }
    var line = summary(Self.count(changed, noun: "task"))
    if !write.failures.isEmpty { line += ". \(write.failures.count) couldn't be changed" }
    return .done(line, output: output, undo: undo)
  }

  // MARK: Tools

  func findTasks(_ arguments: [String: Any]) async throws -> AlfredToolResult {
    let query = try ManorTaskQuery.parse(arguments, today: today)
    let data = try await loadTasks()
    let result = query.run(data.tasks)
    guard result.total > 0 else { return .found("No tasks match.") }
    let header = result.total > result.tasks.count ? "\(result.tasks.count) of \(result.total) matching tasks:" : "\(result.total) matching task\(result.total == 1 ? "" : "s"):"
    return .found(([header] + result.tasks.map(taskLine)).joined(separator: "\n"))
  }

  func createTask(_ arguments: [String: Any]) async throws -> AlfredToolResult {
    let args = try ManorCreateTaskArgs.parse(arguments, today: today)
    let data = try await loadTasks()
    let taskContext: TaskContext
    if let name = args.context {
      let candidates = data.contexts.map { ManorTargetCandidate(id: $0.id, title: $0.name) }
      let match = try Self.resolved(name, kind: "context", ManorTargetMatcher.match(name, in: candidates))
      taskContext = data.contexts.first { $0.id == match.id }!
    } else if data.contexts.count == 1 {
      taskContext = data.contexts[0]
    } else if data.contexts.isEmpty {
      throw ManorToolArgumentError("This account has no contexts yet. Ask the user to create one on Home first.")
    } else {
      throw ManorToolArgumentError("Which context should the task go in? Ask the user: " + data.contexts.map(\.name).joined(separator: ", "))
    }
    let task = TaskItem(
      id: UUID().uuidString.lowercased(), title: args.title, context: taskContext.name, estimate: args.estimate, priority: args.priority,
      status: .notStarted, due: args.due, dueTime: args.dueTime
    )
    try await saveTask(task, in: data)
    let created = TaskItem(id: task.id, title: task.title, context: task.context, estimate: task.estimate, priority: task.priority, due: task.due, dueTime: task.dueTime)
    return .done(
      "Added \(Self.quoted(task.title)) for \(ManorToolDates.label(task.due, today: today))",
      output: "Created " + taskLine(created),
      undo: { [weak self] in
        guard let self else { throw Self.closed }
        let rows = try await self.gateway.rows("tasks", where: [RowFilter("id", .string(task.id))])
        guard let row = rows.first, TaskItem.isLive(row), let revision = row.revision else { return "\(Self.quoted(task.title)) was already removed" }
        let command = TaskCommands.trashTask(id: task.id, revision: revision)
        try await self.gateway.command(command.operation, command.input)
        return "Moved \(Self.quoted(task.title)) to Trash"
      }
    )
  }

  func setTasksDone(_ arguments: [String: Any]) async throws -> AlfredToolResult {
    let args = try ManorSetTasksDoneArgs.parse(arguments)
    let data = try await loadTasks()
    let targets = try resolveTasks(args.targets, in: data) { args.done ? $0.status != .done : $0.status == .done }
    let write = await writeTasks(targets, in: data) { task in
      if args.done { task.status = .done } else if task.status == .done { task.status = .notStarted }
    }
    let previous = write.changed
    return taskResult(write, summary: { "\(args.done ? "Completed" : "Reopened") \($0)" }, already: args.done ? "Already done" : "Already open") { [weak self] in
      guard let self else { throw Self.closed }
      let count = try await self.restoreTasks(previous) { current, old in current.status = old.status }
      let titles = previous.map(\.title)
      return count == 0 ? "Nothing to undo" : "\(args.done ? "Reopened" : "Completed") \(count == 1 && titles.count == 1 ? Self.quoted(titles[0]) : "\(count) tasks")"
    }
  }

  func rescheduleTasks(_ arguments: [String: Any]) async throws -> AlfredToolResult {
    let args = try ManorRescheduleArgs.parse(arguments, today: today)
    let data = try await loadTasks()
    let targets = try resolveTasks(args.targets, in: data) { $0.status != .done }
    let write = await writeTasks(targets, in: data) { task in
      task.due = args.due
      switch args.time {
      case .keep: break
      case .clear: task.dueTime = nil
      case .set(let time): task.dueTime = time
      }
    }
    let previous = write.changed
    var when = ManorToolDates.label(args.due, today: today)
    if case .set(let time) = args.time { when += " at \(TaskDates.clock(time))" }
    return taskResult(write, summary: { "Moved \($0) to \(when)" }, already: "Already due then") { [weak self] in
      guard let self else { throw Self.closed }
      let count = try await self.restoreTasks(previous) { current, old in
        current.due = old.due
        current.dueTime = old.dueTime
      }
      return count == 0 ? "Nothing to undo" : "Moved \(count == 1 ? Self.quoted(previous[0].title) : "\(count) tasks") back"
    }
  }

  func setTaskPriority(_ arguments: [String: Any]) async throws -> AlfredToolResult {
    let args = try ManorPriorityArgs.parse(arguments)
    let data = try await loadTasks()
    let targets = try resolveTasks(args.targets, in: data) { $0.status != .done }
    let write = await writeTasks(targets, in: data) { $0.priority = args.priority }
    let previous = write.changed
    let summary: (String) -> String = { subject in
      args.priority.map { "Set \(subject) to \($0.rawValue) priority" } ?? "Cleared the priority of \(subject)"
    }
    return taskResult(write, summary: summary, already: args.priority.map { "Already \($0.rawValue)" } ?? "Already without priority") { [weak self] in
      guard let self else { throw Self.closed }
      let count = try await self.restoreTasks(previous) { current, old in current.priority = old.priority }
      return count == 0 ? "Nothing to undo" : "Restored the priority of \(count == 1 ? Self.quoted(previous[0].title) : "\(count) tasks")"
    }
  }

  // MARK: Snapshot

  /// Open tasks due today and overdue, overdue first.
  func homeSnapshot() async -> [String] {
    do {
      let data = try await loadTasks()
      let open = data.tasks.filter { $0.status != .done && $0.due <= today }.sorted {
        if $0.due != $1.due { return $0.due < $1.due }
        return ($0.dueTime ?? "99") < ($1.dueTime ?? "99")
      }
      guard !open.isEmpty else { return ["No open tasks are due today or overdue."] }
      let overdue = open.filter { $0.due < today }
      let dueToday = open.filter { $0.due == today }
      var lines: [String] = []
      let cap = 30
      if !overdue.isEmpty {
        lines.append("Overdue (\(overdue.count)):")
        lines += overdue.prefix(cap).map(taskLine)
      }
      if !dueToday.isEmpty {
        lines.append("Due today (\(dueToday.count)):")
        lines += dueToday.prefix(max(10, cap - min(cap, overdue.count))).map(taskLine)
      }
      return lines
    } catch {
      return ["Tasks couldn't be read: \(error.localizedDescription)"]
    }
  }
}
