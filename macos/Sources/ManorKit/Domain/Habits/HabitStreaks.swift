import Foundation

/// Streak rules, day marks, and the quantized step ladder.
public enum HabitRules {
  // MARK: Step ladder

  private static let quarterSteps = [25, 50, 75, 100]
  /// Unit counts above this log in quarters; tapping through more is unusable.
  private static let maxUnitSteps = 8

  /// The first number in a target label, as written ("Take 2 tablets" gives "2").
  private static func firstNumber(in label: String) -> (value: Double, range: Range<String.Index>)? {
    guard let range = label.range(of: #"\d+(?:\.\d+)?"#, options: .regularExpression), let value = Double(label[range]) else { return nil }
    return (value, range)
  }

  /// Unit count in a "3 tablets" target: the first whole number, wherever it sits. Fractional targets like
  /// "1.5 miles" have no clean per-unit ladder, so they read as none.
  public static func targetUnitCount(_ targetLabel: String?) -> Int? {
    guard let targetLabel, let number = firstNumber(in: targetLabel.trimmingCharacters(in: .whitespacesAndNewlines)) else { return nil }
    guard number.value.rounded() == number.value, number.value >= 1, number.value < Double(Int.max) else { return nil }
    return Int(number.value)
  }

  /// Ascending percent ladder: one step per unit for "N units" targets with N up to 8 ("3 tablets" gives
  /// 33, 66, 100), quarters otherwise. The last step is always exactly 100.
  public static func steps(_ targetLabel: String?) -> [Int] {
    guard let count = targetUnitCount(targetLabel), count <= maxUnitSteps else { return quarterSteps }
    return (0..<count).map { $0 == count - 1 ? 100 : (($0 + 1) * 100) / count }
  }

  /// The logging control's cycle: 0 plus the step ladder.
  public static func ladder(_ targetLabel: String?) -> [Int] { [0] + steps(targetLabel) }

  /// Nearest value on a ladder; keeps entries written under an older ladder on solid steps.
  public static func nearestStep(_ steps: [Int], _ value: Int) -> Int {
    var nearest = steps.first ?? 0
    for step in steps where abs(step - value) < abs(nearest - value) { nearest = step }
    return nearest
  }

  /// The ladder value `offset` steps from `value`, wrapping at both ends.
  public static func shifted(_ ladder: [Int], from value: Int, by offset: Int) -> Int {
    guard !ladder.isEmpty else { return value }
    let index = ladder.firstIndex(of: nearestStep(ladder, value)) ?? 0
    return ladder[((index + offset) % ladder.count + ladder.count) % ladder.count]
  }

  /// Whether a target logs one unit per step (otherwise it logs in quarters).
  public static func logsByUnit(_ targetLabel: String?) -> Bool {
    guard let count = targetUnitCount(targetLabel) else { return false }
    return steps(targetLabel).count == count
  }

  /// The live hint under the target field.
  public static func stepsHint(_ targetLabel: String) -> String {
    guard logsByUnit(targetLabel), let count = targetUnitCount(targetLabel) else { return "Logged in quarters" }
    return count == 1 ? "Logged in one step" : "Logged one at a time, in \(count) steps"
  }

  /// "1 tablet / 3 tablets" for a step's percent on a target.
  public static func stepAmountLabel(_ targetLabel: String, _ value: Int) -> String {
    let trimmed = targetLabel.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let number = firstNumber(in: trimmed) else { return "\(value)%" }
    let suffix = trimmed[number.range.upperBound...].trimmingCharacters(in: .whitespacesAndNewlines)
    let amount = Int((number.value * Double(value) / 100).rounded(.toNearestOrAwayFromZero))
    let isSimplePlural = suffix.range(of: #"^[A-Za-z]+s$"#, options: .regularExpression) != nil
    let unit = amount == 1 && isSimplePlural ? String(suffix.dropLast()) : suffix
    return "\(amount)\(unit.isEmpty ? "" : " \(unit)") / \(targetLabel)"
  }

  // MARK: Lifecycle

  /// The habit's lifecycle status on a date: the last event on or before it, or nil before creation.
  public static func status(_ habitId: String, on date: String, in state: HabitsState) -> HabitLifecycleStatus? {
    state.index.lifecycleByHabit[habitId]?.last { $0.date <= date }?.status
  }

  public static func active(on date: String, in state: HabitsState) -> [HabitDefinition] {
    state.habits.filter { status($0.id, on: date, in: state) == .active }
  }

  // MARK: Marks

  public static func mark(_ habit: HabitDefinition, on date: String, in state: HabitsState) -> HabitDayMark {
    if date > state.today { return .future }
    switch status(habit.id, on: date, in: state) {
    case nil, .retired?: return .inactive
    case .paused?: return .paused
    case .active?: break
    }
    let entry = state.index.entries[habit.id]?[date]
    if entry?.value == 100 { return .complete }
    // A freeze covers the day whatever partial progress it holds.
    if state.index.frozen[habit.id]?.contains(date) == true { return .frozen }
    if entry != nil { return .partial }
    return date == state.today ? .pending : .missed
  }

  // MARK: Metrics

  /// Streaks, gold, completion, and Earn-Back for one habit, walking every day from creation to today.
  public static func metrics(_ habit: HabitDefinition, in state: HabitsState) -> HabitMetrics {
    guard let start = HabitDates.dayNumber(habit.createdOn), let end = HabitDates.dayNumber(state.today) else { return HabitMetrics() }
    let entries = state.index.entries[habit.id] ?? [:]
    let freezes = state.index.frozen[habit.id] ?? []
    let events = state.index.lifecycleByHabit[habit.id] ?? []
    var metrics = HabitMetrics()
    var brokenStreak = 0
    var brokenOn: String?
    var retiredGap = false
    var earnBackMonths = Set<String>()
    var eventIndex = 0
    var status: HabitLifecycleStatus?

    if start <= end {
      for number in start...end {
        let date = HabitDates.string(dayNumber: number)
        while eventIndex < events.count, events[eventIndex].date <= date {
          status = events[eventIndex].status
          eventIndex += 1
        }
        if status == .retired {
          retiredGap = true
          continue
        }
        guard status == .active else { continue }
        if retiredGap {
          metrics.currentStreak = 0
          metrics.freezeFreeDays = 0
          brokenStreak = 0
          brokenOn = nil
          metrics.earnBackProgress = 0
          retiredGap = false
        }
        metrics.trackedDays += 1
        let complete = entries[date]?.value == 100
        if complete {
          metrics.completedDays += 1
          metrics.currentStreak += 1
          metrics.freezeFreeDays += 1
          if let broken = brokenOn, !earnBackMonths.contains(HabitDates.monthKey(broken)) {
            if HabitDates.daysBetween(broken, date) <= 2 {
              if metrics.earnBackProgress == 1 {
                metrics.currentStreak = brokenStreak + 2
                earnBackMonths.insert(HabitDates.monthKey(broken))
                brokenOn = nil
                brokenStreak = 0
                metrics.earnBackProgress = 0
              } else {
                metrics.earnBackProgress = 1
              }
            } else {
              brokenOn = nil
              brokenStreak = 0
              metrics.earnBackProgress = 0
            }
          }
        } else if freezes.contains(date) {
          metrics.currentStreak += 1
          metrics.freezeFreeDays = 0
          brokenOn = nil
          brokenStreak = 0
          metrics.earnBackProgress = 0
        } else if date < state.today {
          let emptyPool = state.index.poolBalance?[date] == 0
          if metrics.currentStreak > 0, emptyPool, !earnBackMonths.contains(HabitDates.monthKey(date)) {
            brokenStreak = metrics.currentStreak
            brokenOn = date
          } else if metrics.currentStreak > 0 {
            brokenStreak = 0
            brokenOn = nil
          }
          metrics.currentStreak = 0
          metrics.freezeFreeDays = 0
          metrics.earnBackProgress = 0
        }
        metrics.bestStreak = max(metrics.bestStreak, metrics.currentStreak)
      }
    }
    metrics.gold = metrics.freezeFreeDays >= 7
    metrics.completionRate = metrics.trackedDays == 0 ? 0 : percent(metrics.completedDays, of: metrics.trackedDays)
    metrics.earnBackUsedThisMonth = earnBackMonths.contains(HabitDates.monthKey(state.today))
    return metrics
  }

  /// A rounded percentage the way the web client rounds (half up).
  public static func percent(_ part: Int, of whole: Int) -> Int {
    guard whole > 0 else { return 0 }
    return Int((Double(part) / Double(whole) * 100).rounded(.toNearestOrAwayFromZero))
  }
}
