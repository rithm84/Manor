import Foundation

public enum HabitKind: String, Sendable, Hashable, CaseIterable { case binary, quantized }
public enum HabitLifecycleStatus: String, Sendable, Hashable, CaseIterable { case active, paused, retired }

/// How one habit's day reads: the source of every week strip segment, calendar cell, and ring slice.
public enum HabitDayMark: String, Sendable, Hashable {
  case complete, partial, frozen, missed, pending, future, paused, inactive

  /// Days that count toward a completion rate: the habit was active and the day has passed or is resolved.
  public var isTracked: Bool { [.complete, .partial, .frozen, .missed].contains(self) }
}

public struct HabitDefinition: Sendable, Hashable, Identifiable {
  /// The row revision commands expect; nil until read from the table.
  public var revision: Int?
  public let id: String
  public var name: String
  public var kind: HabitKind
  public var targetLabel: String?
  public let createdOn: String
  public let createdAt: String

  public init(revision: Int? = nil, id: String, name: String, kind: HabitKind, targetLabel: String?, createdOn: String, createdAt: String) {
    self.revision = revision
    self.id = id
    self.name = name
    self.kind = kind
    self.targetLabel = targetLabel
    self.createdOn = createdOn
    self.createdAt = createdAt
  }
}

public struct HabitLifecycleEvent: Sendable, Hashable {
  public let habitId: String
  public let date: String
  public let status: HabitLifecycleStatus
  public let createdAt: String
  public init(habitId: String, date: String, status: HabitLifecycleStatus, createdAt: String) {
    self.habitId = habitId
    self.date = date
    self.status = status
    self.createdAt = createdAt
  }
}

public struct HabitEntry: Sendable, Hashable {
  public let habitId: String
  public let date: String
  /// Percent complete, 1 to 100; only 100 counts as done.
  public let value: Int
  public let createdAt: String
  public let updatedAt: String
  public init(habitId: String, date: String, value: Int, createdAt: String, updatedAt: String) {
    self.habitId = habitId
    self.date = date
    self.value = value
    self.createdAt = createdAt
    self.updatedAt = updatedAt
  }
}

/// A freeze the user chose to spend. Intent is input; usage is what the reconciler derived from it, so the
/// two can differ when the pool ran dry.
public struct HabitFreezeIntent: Sendable, Hashable {
  public let habitId: String
  public let date: String
  public let createdAt: String
  public init(habitId: String, date: String, createdAt: String) {
    self.habitId = habitId
    self.date = date
    self.createdAt = createdAt
  }
}

public struct HabitFreezeUsage: Sendable, Hashable {
  public let habitId: String
  public let date: String
  public init(habitId: String, date: String) {
    self.habitId = habitId
    self.date = date
  }
}

public struct HabitMonthPool: Sendable, Hashable {
  public let month: String
  public let capacity: Int
  public let earned: Int
  public let spent: Int
  public let balance: Int
  public init(month: String, capacity: Int, earned: Int, spent: Int, balance: Int) {
    self.month = month
    self.capacity = capacity
    self.earned = earned
    self.spent = spent
    self.balance = balance
  }
}

/// The shared pool balance after one day's spends and perfect-day grant.
public struct HabitPoolDay: Sendable, Hashable {
  public let date: String
  public let balance: Int
  public init(date: String, balance: Int) {
    self.date = date
    self.balance = balance
  }
}

public struct HabitDraft: Sendable, Hashable {
  public var expectedRevision: Int?
  public var name: String
  public var kind: HabitKind
  public var targetLabel: String?
  public init(expectedRevision: Int? = nil, name: String, kind: HabitKind, targetLabel: String?) {
    self.expectedRevision = expectedRevision
    self.name = name
    self.kind = kind
    self.targetLabel = targetLabel
  }

  public init(habit: HabitDefinition) {
    self.init(expectedRevision: habit.revision, name: habit.name, kind: habit.kind, targetLabel: habit.targetLabel)
  }

  /// The draft trimmed and checked the way the backend checks it.
  public func validated() throws -> HabitDraft {
    let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !name.isEmpty else { throw HabitsDataError("Give the habit a name.") }
    guard name.count <= 80 else { throw HabitsDataError("Habit names are 80 characters or fewer.") }
    let target = targetLabel?.trimmingCharacters(in: .whitespacesAndNewlines)
    switch kind {
    case .binary:
      guard target == nil else { throw HabitsDataError("A one-tap habit has no daily target.") }
      return HabitDraft(expectedRevision: expectedRevision, name: name, kind: .binary, targetLabel: nil)
    case .quantized:
      guard let target, !target.isEmpty else { throw HabitsDataError("Add a daily target, such as 3 tablets.") }
      return HabitDraft(expectedRevision: expectedRevision, name: name, kind: .quantized, targetLabel: target)
    }
  }
}

public struct HabitMetrics: Sendable, Hashable {
  public var currentStreak = 0
  public var bestStreak = 0
  public var freezeFreeDays = 0
  public var gold = false
  public var completedDays = 0
  public var trackedDays = 0
  public var completionRate = 0
  public var earnBackUsedThisMonth = false
  /// 1 after the first clean day of an Earn-Back attempt.
  public var earnBackProgress = 0
  public init() {}
}

/// Habit data that did not match what Manor expects.
public struct HabitsDataError: LocalizedError, Sendable, Equatable {
  public let message: String
  public init(_ message: String) { self.message = message }
  public var errorDescription: String? { message }
}

/// The derived habit history `manor_habits_state` returns, with lookups built once so streaks, marks,
/// and month summaries stay cheap.
public struct HabitsState: Sendable, Equatable {
  public let today: String
  public let habits: [HabitDefinition]
  public let lifecycle: [HabitLifecycleEvent]
  public let entries: [HabitEntry]
  public let intents: [HabitFreezeIntent]
  public let freezes: [HabitFreezeUsage]
  public let pools: [HabitMonthPool]
  /// Shared pool balance after each day; nil when the history is unknown.
  public let poolDays: [HabitPoolDay]?
  public let grantDates: [String]
  let index: HabitsIndex

  public init(
    today: String, habits: [HabitDefinition], lifecycle: [HabitLifecycleEvent], entries: [HabitEntry],
    intents: [HabitFreezeIntent] = [], freezes: [HabitFreezeUsage] = [], grantDates: [String] = [],
    pools: [HabitMonthPool] = [], poolDays: [HabitPoolDay]? = nil
  ) {
    self.today = today
    self.habits = habits
    self.lifecycle = lifecycle
    self.entries = entries
    self.intents = intents
    self.freezes = freezes
    self.grantDates = grantDates
    self.pools = pools
    self.poolDays = poolDays
    self.index = HabitsIndex(lifecycle: lifecycle, entries: entries, freezes: freezes, pools: pools, poolDays: poolDays)
  }

  public func with(habits: [HabitDefinition]) -> HabitsState {
    HabitsState(today: today, habits: habits, lifecycle: lifecycle, entries: entries, intents: intents, freezes: freezes, grantDates: grantDates, pools: pools, poolDays: poolDays)
  }

  public func with(entries: [HabitEntry]) -> HabitsState {
    HabitsState(today: today, habits: habits, lifecycle: lifecycle, entries: entries, intents: intents, freezes: freezes, grantDates: grantDates, pools: pools, poolDays: poolDays)
  }

  public func habit(_ id: String) -> HabitDefinition? { habits.first { $0.id == id } }

  public func pool(month: String) -> HabitMonthPool? { index.poolByMonth[month] }

  public func entry(habitId: String, date: String) -> HabitEntry? { index.entries[habitId]?[date] }

  public static func == (lhs: HabitsState, rhs: HabitsState) -> Bool {
    lhs.today == rhs.today && lhs.habits == rhs.habits && lhs.lifecycle == rhs.lifecycle && lhs.entries == rhs.entries
      && lhs.intents == rhs.intents && lhs.freezes == rhs.freezes && lhs.grantDates == rhs.grantDates
      && lhs.pools == rhs.pools && lhs.poolDays == rhs.poolDays
  }
}

/// Immutable lookups over one state.
final class HabitsIndex: @unchecked Sendable {
  let lifecycleByHabit: [String: [HabitLifecycleEvent]]
  let entries: [String: [String: HabitEntry]]
  let frozen: [String: Set<String>]
  let poolByMonth: [String: HabitMonthPool]
  let poolBalance: [String: Int]?

  init(lifecycle: [HabitLifecycleEvent], entries: [HabitEntry], freezes: [HabitFreezeUsage], pools: [HabitMonthPool], poolDays: [HabitPoolDay]?) {
    lifecycleByHabit = Dictionary(grouping: lifecycle, by: \.habitId).mapValues {
      $0.sorted { ($0.date, $0.createdAt) < ($1.date, $1.createdAt) }
    }
    var byHabit: [String: [String: HabitEntry]] = [:]
    for entry in entries { byHabit[entry.habitId, default: [:]][entry.date] = entry }
    self.entries = byHabit
    var frozen: [String: Set<String>] = [:]
    for freeze in freezes { frozen[freeze.habitId, default: []].insert(freeze.date) }
    self.frozen = frozen
    var poolByMonth: [String: HabitMonthPool] = [:]
    for pool in pools where poolByMonth[pool.month] == nil { poolByMonth[pool.month] = pool }
    self.poolByMonth = poolByMonth
    if let poolDays {
      var balances: [String: Int] = [:]
      for day in poolDays where balances[day.date] == nil { balances[day.date] = day.balance }
      poolBalance = balances
    } else {
      poolBalance = nil
    }
  }
}
