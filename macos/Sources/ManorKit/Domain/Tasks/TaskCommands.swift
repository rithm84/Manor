import Foundation

/// The `manor_command` operations and inputs Home sends, field for field with the web service.
public enum TaskCommands {
  public struct Command: Sendable {
    public let operation: String
    public let input: JSONObject
  }

  /// What a save needs to know about the stored task it replaces.
  public struct Existing: Sendable {
    public let seriesId: String?
    public let recurrence: String?
    public init(seriesId: String?, recurrence: String?) {
      self.seriesId = seriesId
      self.recurrence = recurrence
    }
    public init(row: Row) {
      seriesId = row["series_id"]?.string
      recurrence = row["recurrence"]?.string
    }
  }

  /// Create or update a task, choosing the recurrence operation the edit needs: a new repeating task creates a
  /// series, a standalone task gaining a repeat converts, "this and future" splits the series, and changing the
  /// repeat of only this occurrence is refused so the draft survives.
  public static func saveTask(_ task: TaskItem, contextId: String, existing: Existing?, newSeriesId: () -> String = { UUID().uuidString.lowercased() }) throws -> Command {
    let title = task.title.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !title.isEmpty else { throw TaskRecordError("Enter a task title") }
    guard title.count <= 300 else { throw TaskRecordError("Task titles are at most 300 characters") }
    guard TaskDates.isDate(task.due) else { throw TaskRecordError("Choose a due date") }
    if let time = task.dueTime, !TaskDates.isTime(time) || time == "24:00" { throw TaskRecordError("Enter a valid due time or remove the time") }
    if existing != nil && task.revision == nil { throw TaskRecordError("Task revision is missing. Reload the task before saving.") }
    var fields: JSONObject = [
      "id": .string(task.id), "title": .string(title), "context_id": .string(contextId),
      "estimate_minutes": .from(task.estimate?.rawValue), "priority": .from(task.priority?.rawValue), "status": .string(task.status.rawValue),
      "due": .string(task.due), "due_time": .from(task.dueTime), "tags": .array(task.tags.map(JSONValue.string)),
      "expected_revision": .number(Double(existing == nil ? 0 : (task.revision ?? 0)))
    ]
    var operation = existing == nil ? "create_task" : "update_task"
    if let existing {
      if existing.seriesId == nil, let recurrence = task.recurrence {
        operation = "convert_task_to_series"
        fields["recurrence"] = .string(recurrence)
        fields["new_series_id"] = .string(newSeriesId())
      } else if task.recurrenceScope == .future {
        operation = "update_future_task_occurrences"
        fields["recurrence"] = .from(task.recurrence)
        fields["new_series_id"] = .string(newSeriesId())
      } else if task.recurrence != existing.recurrence {
        throw TaskRecordError("Choose This and future occurrences to change the repeat pattern. Your draft is preserved.")
      }
    } else if let recurrence = task.recurrence {
      operation = "create_recurring_task"
      fields["recurrence"] = .string(recurrence)
    }
    return Command(operation: operation, input: fields)
  }

  public static func trashTask(id: String, revision: Int) -> Command {
    Command(operation: "trash_task", input: ["id": .string(id), "expected_revision": .number(Double(revision))])
  }

  public static func restoreTask(id: String, revision: Int) -> Command {
    Command(operation: "restore_task", input: ["id": .string(id), "expected_revision": .number(Double(revision))])
  }

  public static func skipOccurrence(id: String, revision: Int) -> Command {
    Command(operation: "skip_task_occurrence", input: ["id": .string(id), "expected_revision": .number(Double(revision))])
  }

  public static func validateContextName(_ name: String) throws -> String {
    let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { throw TaskRecordError("Enter a context name") }
    guard trimmed.count <= 48 else { throw TaskRecordError("Context names are at most 48 characters") }
    return trimmed
  }

  /// Duplicate names are refused, ignoring case; a context may keep its own name.
  public static func checkUnique(_ name: String, among contexts: [TaskContext], except original: String? = nil) throws {
    let lowered = name.lowercased()
    if contexts.contains(where: { $0.name.lowercased() == lowered && $0.name != original }) {
      throw TaskRecordError("A context named \(name) already exists")
    }
  }

  public static func createContext(_ draft: ContextDraft, id: String = UUID().uuidString.lowercased()) throws -> Command {
    Command(operation: "create_context", input: [
      "id": .string(id), "name": .string(try validateContextName(draft.name)), "color": .string(draft.color.rawValue),
      "icon": .string(draft.icon.rawValue), "expected_revision": 0
    ])
  }

  public static func updateContext(_ context: TaskContext, to draft: ContextDraft) throws -> Command {
    Command(operation: "update_context", input: [
      "id": .string(context.id), "name": .string(try validateContextName(draft.name)), "color": .string(draft.color.rawValue),
      "icon": .string(draft.icon.rawValue), "expected_revision": .number(Double(context.revision))
    ])
  }

  public static func removeContext(_ context: TaskContext) -> Command {
    Command(operation: "remove_context", input: ["id": .string(context.id), "expected_revision": .number(Double(context.revision))])
  }

  public static func saveScratchBlock(_ block: ScratchBlock, exists: Bool) throws -> Command {
    guard let start = TaskDates.minutes(block.start), let end = TaskDates.minutes(block.end), start < end,
      ScratchTimeline.isValidSpan(start: start, minutes: end - start) else {
      throw TaskRecordError("Choose a 15-minute boundary between 6 AM and midnight.")
    }
    if exists && block.revision == nil { throw TaskRecordError("Time block revision is missing. Reload before saving.") }
    return Command(operation: "save_scratch_block", input: [
      "id": .string(block.id), "task_id": .from(block.taskId), "date": .string(block.date), "start_time": .string(block.start),
      "end_time": .string(block.end), "portion": .string(block.portion.trimmingCharacters(in: .whitespacesAndNewlines)),
      "expected_revision": .number(Double(exists ? (block.revision ?? 0) : 0))
    ])
  }

  public static func deleteScratchBlock(id: String, revision: Int) -> Command {
    Command(operation: "delete_scratch_block", input: ["id": .string(id), "expected_revision": .number(Double(revision))])
  }

  public static func saveTaskView(_ view: SavedTaskView, exists: Bool) throws -> Command {
    let name = view.name.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !name.isEmpty else { throw TaskRecordError("Enter a view name") }
    guard view.rules.count <= 30 else { throw TaskRecordError("Saved views hold at most 30 filter rules") }
    return Command(operation: "save_task_view", input: [
      "id": .string(view.id), "name": .string(name), "rules": .array(view.rules.map(\.json)),
      "expected_revision": .number(Double(exists ? (view.revision ?? 0) : 0))
    ])
  }

  public static func deleteTaskView(id: String, revision: Int) -> Command {
    Command(operation: "delete_task_view", input: ["id": .string(id), "expected_revision": .number(Double(revision))])
  }
}
