import Foundation

/// Reads `manor_habits_state` and table rows into domain values, refusing anything malformed rather than
/// guessing, as the web client's parsers do.
public enum HabitParsing {
  public static func state(_ value: JSONValue, habitRows: [Row]) throws -> HabitsState {
    guard let object = value.object else { throw HabitsDataError("Habit history did not load. Try again.") }
    let today = try date(object["today"], "today")
    func list(_ key: String) throws -> [JSONValue] {
      guard let array = object[key]?.array else { throw HabitsDataError("Habit history is missing \(key).") }
      return array
    }
    let revisions = Dictionary(habitRows.compactMap { row in row.id.map { ($0, row.revision) } }, uniquingKeysWith: { first, _ in first })
    let habits = try list("habits").map { raw -> HabitDefinition in
      var habit = try definition(raw)
      guard let revision = revisions[habit.id] else { throw HabitsDataError("Habit changed while loading. Reload the page.") }
      guard let revision, revision > 0 else { throw HabitsDataError("A habit is missing its revision.") }
      habit.revision = revision
      return habit
    }
    let lifecycle = try list("lifecycle").map(lifecycleEvent)
    let entries = try list("entries").map(entry)
    let intents = try list("intents").map { raw -> HabitFreezeIntent in
      let item = try record(raw, "freeze intent")
      return HabitFreezeIntent(habitId: try string(item["habitId"], "intent.habitId"), date: try date(item["date"], "intent.date"), createdAt: try string(item["createdAt"], "intent.createdAt"))
    }
    let freezes = try list("freezes").map { raw -> HabitFreezeUsage in
      let item = try record(raw, "freeze")
      return HabitFreezeUsage(habitId: try string(item["habitId"], "freeze.habitId"), date: try date(item["date"], "freeze.date"))
    }
    let grants = try list("grants").map { raw in try date(try record(raw, "grant")["date"], "grant.date") }
    let pools = try list("pools").map { raw -> HabitMonthPool in
      let item = try record(raw, "pool")
      return HabitMonthPool(
        month: try string(item["month"], "pool.month"), capacity: try count(item["capacity"], "pool.capacity"),
        earned: try count(item["earned"], "pool.earned"), spent: try count(item["spent"], "pool.spent"),
        balance: try count(item["balance"], "pool.balance")
      )
    }
    let poolDays = try list("poolDays").map { raw -> HabitPoolDay in
      let item = try record(raw, "pool day")
      return HabitPoolDay(date: try date(item["date"], "poolDay.date"), balance: try count(item["balance"], "poolDay.balance"))
    }
    return HabitsState(today: today, habits: habits, lifecycle: lifecycle, entries: entries, intents: intents, freezes: freezes, grantDates: grants, pools: pools, poolDays: poolDays)
  }

  public static func definition(_ value: JSONValue) throws -> HabitDefinition {
    let habit = try record(value, "habit")
    let name = try string(habit["name"], "habit.name")
    guard name.count <= 80 else { throw HabitsDataError("habit.name must be 80 characters or fewer") }
    guard let kind = habit["kind"]?.string.flatMap(HabitKind.init(rawValue:)) else { throw HabitsDataError("habit.kind must be binary or quantized") }
    let target = try nullableString(habit["targetLabel"], "habit.targetLabel")
    if kind == .binary, target != nil { throw HabitsDataError("binary habits cannot have a target label") }
    if kind == .quantized, target == nil { throw HabitsDataError("quantized habits require a target label") }
    return HabitDefinition(
      id: try string(habit["id"], "habit.id"), name: name, kind: kind, targetLabel: target,
      createdOn: try date(habit["createdOn"], "habit.createdOn"), createdAt: try string(habit["createdAt"], "habit.createdAt")
    )
  }

  public static func lifecycleEvent(_ value: JSONValue) throws -> HabitLifecycleEvent {
    let event = try record(value, "lifecycle event")
    guard let status = event["status"]?.string.flatMap(HabitLifecycleStatus.init(rawValue:)) else {
      throw HabitsDataError("habit lifecycle status must be active, paused, or retired")
    }
    return HabitLifecycleEvent(habitId: try string(event["habitId"], "lifecycle.habitId"), date: try date(event["date"], "lifecycle.date"), status: status, createdAt: try string(event["createdAt"], "lifecycle.createdAt"))
  }

  public static func entry(_ value: JSONValue) throws -> HabitEntry {
    let entry = try record(value, "entry")
    guard let percent = entry["value"]?.int, (1...100).contains(percent) else {
      throw HabitsDataError("habit entry value must be an integer percent from 1 to 100")
    }
    return HabitEntry(
      habitId: try string(entry["habitId"], "entry.habitId"), date: try date(entry["date"], "entry.date"), value: percent,
      createdAt: try string(entry["createdAt"], "entry.createdAt"), updatedAt: try string(entry["updatedAt"], "entry.updatedAt")
    )
  }

  // MARK: Primitives

  private static func record(_ value: JSONValue?, _ label: String) throws -> [String: JSONValue] {
    guard let object = value?.object else { throw HabitsDataError("\(label) must be an object") }
    return object
  }

  private static func string(_ value: JSONValue?, _ label: String) throws -> String {
    guard let text = value?.string?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else {
      throw HabitsDataError("\(label) must be a non-empty string")
    }
    return text
  }

  private static func nullableString(_ value: JSONValue?, _ label: String) throws -> String? {
    if value == nil || value?.isNull == true { return nil }
    return try string(value, label)
  }

  private static func date(_ value: JSONValue?, _ label: String) throws -> String {
    let text = try string(value, label)
    guard HabitDates.isValid(text) else { throw HabitsDataError("\(label) must be a real YYYY-MM-DD date") }
    return text
  }

  private static func count(_ value: JSONValue?, _ label: String) throws -> Int {
    guard let number = value?.int, number >= 0 else { throw HabitsDataError("\(label) must be a non-negative integer") }
    return number
  }
}
