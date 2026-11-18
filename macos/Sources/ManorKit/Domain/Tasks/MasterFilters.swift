import Foundation

public enum MasterFilterProperty: String, CaseIterable, Hashable, Sendable {
  case context, status, priority, due
  public var label: String {
    switch self {
    case .context: return "Context"
    case .status: return "Status"
    case .priority: return "Priority"
    case .due: return "Due date"
    }
  }
}

public enum DueFilterOperator: String, CaseIterable, Hashable, Sendable {
  case before, on, after, within
  public var label: String {
    switch self {
    case .before: return "Before"
    case .on: return "On"
    case .after: return "After"
    case .within: return "Within range"
    }
  }
}

/// One rule of Master's additive filter. Every rule must match (AND).
public struct MasterFilterRule: Identifiable, Hashable, Sendable {
  public enum Condition: Hashable, Sendable {
    case context(String)
    case status(TaskStatus)
    case priority(TaskPriority)
    case due(DueFilterOperator, date: String)
    case dueWithin(from: String, to: String)
  }

  public var id: String
  public var condition: Condition

  public init(id: String = UUID().uuidString.lowercased(), condition: Condition) {
    self.id = id
    self.condition = condition
  }

  public var property: MasterFilterProperty {
    switch condition {
    case .context: return .context
    case .status: return .status
    case .priority: return .priority
    case .due, .dueWithin: return .due
    }
  }

  public func matches(_ task: TaskItem) -> Bool {
    switch condition {
    case .context(let value): return task.context == value
    case .status(let value): return task.status == value
    case .priority(let value): return task.priority == value
    case .dueWithin(let from, let to): return task.due >= from && task.due <= to
    case .due(.before, let date): return task.due < date
    case .due(.on, let date), .due(.within, let date): return task.due == date
    case .due(.after, let date): return task.due > date
    }
  }

  /// The rule as `saved_task_views.rules` stores it.
  public var json: JSONValue {
    switch condition {
    case .context(let value): return ["id": .string(id), "property": "context", "value": .string(value)]
    case .status(let value): return ["id": .string(id), "property": "status", "value": .string(value.rawValue)]
    case .priority(let value): return ["id": .string(id), "property": "priority", "value": .string(value.rawValue)]
    case .due(let op, let date): return ["id": .string(id), "property": "due", "operator": .string(op.rawValue), "date": .string(date)]
    case .dueWithin(let from, let to): return ["id": .string(id), "property": "due", "operator": "within", "from": .string(from), "to": .string(to)]
    }
  }

  public init(json: JSONValue) throws {
    guard let object = json.object else { throw TaskRecordError("master filter rule must be an object") }
    let id = try TaskRowRead.string(object, "id")
    switch object["property"]?.string {
    case "context":
      let value = try TaskRowRead.string(object, "value")
      guard value.count <= 48 else { throw TaskRecordError("context must be 48 characters or fewer") }
      self.init(id: id, condition: .context(value))
    case "status":
      guard let value = object["value"]?.string.flatMap(TaskStatus.init(rawValue:)) else { throw TaskRecordError("status filter value is not supported") }
      self.init(id: id, condition: .status(value))
    case "priority":
      guard let value = object["value"]?.string.flatMap(TaskPriority.init(rawValue:)) else { throw TaskRecordError("priority filter value cannot be null") }
      self.init(id: id, condition: .priority(value))
    case "due":
      guard let op = object["operator"]?.string.flatMap(DueFilterOperator.init(rawValue:)) else {
        throw TaskRecordError("due filter operator must be before, on, after, or within")
      }
      if op == .within {
        let from = try TaskRowRead.date(object, "from"), to = try TaskRowRead.date(object, "to")
        guard to >= from else { throw TaskRecordError("masterFilterRule.to must be on or after from") }
        self.init(id: id, condition: .dueWithin(from: from, to: to))
      } else {
        self.init(id: id, condition: .due(op, date: try TaskRowRead.date(object, "date")))
      }
    default:
      throw TaskRecordError("filter property must be context, status, priority, or due")
    }
  }

  /// A fresh rule for `property` with its starting value.
  public static func make(_ property: MasterFilterProperty, today: String, firstContext: String, id: String = UUID().uuidString.lowercased()) -> MasterFilterRule {
    switch property {
    case .context: return MasterFilterRule(id: id, condition: .context(firstContext))
    case .status: return MasterFilterRule(id: id, condition: .status(.notStarted))
    case .priority: return MasterFilterRule(id: id, condition: .priority(.low))
    case .due: return MasterFilterRule(id: id, condition: .due(.on, date: today))
    }
  }

  /// The rule switched to another property, keeping its identity.
  public func changingProperty(to property: MasterFilterProperty, today: String, firstContext: String) -> MasterFilterRule {
    Self.make(property, today: today, firstContext: firstContext, id: id)
  }

  /// A due rule switched to another operator; its date carries over (a range starts and ends on it).
  public func changingDueOperator(to op: DueFilterOperator, today: String) -> MasterFilterRule {
    let date: String
    switch condition {
    case .dueWithin(let from, _): date = from
    case .due(_, let value): date = value.isEmpty ? today : value
    default: date = today
    }
    if op == .within { return MasterFilterRule(id: id, condition: .dueWithin(from: date, to: date)) }
    return MasterFilterRule(id: id, condition: .due(op, date: date))
  }
}

public enum MasterFilters {
  public static func matches(_ task: TaskItem, _ rules: [MasterFilterRule]) -> Bool {
    rules.allSatisfy { $0.matches(task) }
  }

  public static func filter(_ tasks: [TaskItem], _ rules: [MasterFilterRule]) -> [TaskItem] {
    tasks.filter { matches($0, rules) }
  }

  /// Master's rows: the working view excludes completed tasks and the Completed view shows only them,
  /// then rules and the title search narrow, ordered due first.
  public static func visible(_ tasks: [TaskItem], rules: [MasterFilterRule], query: String, completed: Bool) -> [TaskItem] {
    let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    return tasks
      .filter { completed ? $0.status == .done : $0.status != .done }
      .filter { matches($0, rules) && (needle.isEmpty || $0.title.lowercased().contains(needle)) }
      .sorted(by: TaskRules.weeklyOrder)
  }

  /// Rows grouped by context name, groups in name order.
  public static func groupedByContext(_ tasks: [TaskItem]) -> [(context: String, tasks: [TaskItem])] {
    var groups: [String: [TaskItem]] = [:]
    var order: [String] = []
    for task in tasks {
      if groups[task.context] == nil { order.append(task.context) }
      groups[task.context, default: []].append(task)
    }
    return order.sorted { $0.localizedCompare($1) == .orderedAscending }.map { ($0, groups[$0] ?? []) }
  }
}
