import ManorKit
import SwiftUI

/// A habit's details as a centered dialog: streak stats, a month calendar of day states, how the streak
/// works, and the edit, pause, resume, retire, and reactivate actions.
struct HabitDetailPanel: View {
  let data: HabitDetailData
  @Binding var month: String
  let onClose: () -> Void
  let onEdit: () -> Void
  let onStatus: (HabitLifecycleStatus) -> Void
  let onRetire: () -> Void
  @State private var rulesOpen = false

  private var habit: HabitViewModel { data.habit }
  private var definition: HabitDefinition { habit.definition }
  private var metrics: HabitMetrics { habit.metrics }

  var body: some View {
    VStack(spacing: 0) {
      HStack {
        Text("Habit details").font(.ui(Typography.Size.sm, weight: .medium)).foregroundStyle(Palette.inkMuted)
        Spacer()
        IconButton("xmark", label: "Close", action: onClose)
      }
      .padding(.horizontal, Space.s5)
      .padding(.top, Space.s3)
      ScrollView {
        VStack(alignment: .leading, spacing: Space.s5) {
          identity
          stats
          calendar
          rules
          actions
          retireZone
        }
        .padding(.horizontal, Space.s5)
        .padding(.top, Space.s1)
        .padding(.bottom, Space.s5)
      }
      .scrollBounceBehavior(.basedOnSize)
    }
  }

  private var identity: some View {
    VStack(alignment: .leading, spacing: 4) {
      HStack(spacing: Space.s2) {
        Text(definition.name).font(.dialogTitle).foregroundStyle(Palette.ink).lineLimit(2)
        if metrics.gold {
          HabitStreakFlame(state: .gilded, size: 20).help("Seven days without a freeze")
        }
      }
      .accessibilityElement(children: .ignore)
      .accessibilityAddTraits(.isHeader)
      .accessibilityLabel(metrics.gold ? "\(definition.name), freeze-free week" : definition.name)
      Text(kindLine).font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted)
    }
  }

  private var kindLine: String {
    let shape: String
    if definition.kind == .binary {
      shape = "One tap"
    } else {
      let target = definition.targetLabel ?? ""
      shape = HabitRules.logsByUnit(target) ? "One at a time to \(target)" : "In quarters to \(target)"
    }
    switch habit.status {
    case .paused: return "\(shape) · Paused"
    case .retired: return "\(shape) · Retired"
    case .active: return shape
    }
  }

  private var stats: some View {
    let flame = HabitFlameState.of(streak: metrics.currentStreak, atRisk: false, gold: metrics.gold)
    return HStack(spacing: Space.s2) {
      stat(label: "Current streak") {
        HStack(spacing: 4) {
          if metrics.gold {
            HabitStreakNumber(streak: metrics.currentStreak, state: .gilded, size: 20)
          } else {
            Text("\(metrics.currentStreak)").font(.ui(20, weight: .semibold)).tabular().foregroundStyle(Palette.ink)
          }
          if metrics.currentStreak > 0 { HabitStreakFlame(state: flame, size: 18) }
        }
      }
      stat(label: "Best streak") { Text("\(metrics.bestStreak)").font(.ui(20, weight: .semibold)).tabular().foregroundStyle(Palette.ink) }
      stat(label: "All time") { Text("\(metrics.completionRate)%").font(.ui(20, weight: .semibold)).tabular().foregroundStyle(Palette.ink) }
    }
  }

  private func stat<Value: View>(label: String, @ViewBuilder value: () -> Value) -> some View {
    VStack(alignment: .leading, spacing: 3) {
      value().frame(height: 26, alignment: .leading)
      Text(label).font(.ui(Typography.Size.xs)).foregroundStyle(Palette.inkMuted)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(Space.s3)
    .overlay(RoundedRectangle(cornerRadius: Radius.card, style: .continuous).strokeBorder(Palette.hairline, lineWidth: 1))
    .accessibilityElement(children: .combine)
  }

  // MARK: Month calendar

  private var calendar: some View {
    let dates = data.dates
    let marks = data.marks
    let lead = HabitDates.weekdayIndex(dates.first ?? "\(data.month)-01")
    return VStack(alignment: .leading, spacing: Space.s3) {
      HStack {
        VStack(alignment: .leading, spacing: 2) {
          Text(HabitDates.monthLabel(data.month)).font(.ui(Typography.Size.body, weight: .semibold)).foregroundStyle(Palette.ink)
          Text("\(data.completedCount) completed").font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted).tabular()
        }
        Spacer()
        HistoryMonthNav(
          label: HabitDates.monthLabel(data.month), canMoveBack: true, canMoveForward: data.canMoveForward,
          onShift: { month = HabitDates.monthShift(month, $0) }, onCurrent: nil, style: .arrows
        )
      }
      LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 5), count: 7), spacing: 5) {
        ForEach(Array(["M", "T", "W", "T", "F", "S", "S"].enumerated()), id: \.offset) { _, letter in
          Text(letter).font(.ui(Typography.Size.xs, weight: .medium)).foregroundStyle(Palette.inkMuted)
        }
        ForEach(0..<lead, id: \.self) { _ in Color.clear.frame(height: 32) }
        ForEach(Array(zip(dates, marks).enumerated()), id: \.offset) { index, item in
          DayCell(day: index + 1, date: item.0, mark: item.1)
        }
      }
      .animation(Motion.base, value: data.month)
      HStack(spacing: Space.s3) {
        legend(Palette.completion, nil, "Complete")
        legend(Palette.frozenInfo, nil, "Freeze")
        legend(Palette.overdueErrorTint, Palette.overdueError, "Missed")
      }
    }
  }

  private func legend(_ fill: Color, _ border: Color?, _ label: String) -> some View {
    HStack(spacing: 5) {
      Circle().fill(fill).overlay { if let border { Circle().strokeBorder(border, lineWidth: 1) } }.frame(width: 9, height: 9)
      Text(label).font(.ui(Typography.Size.xs)).foregroundStyle(Palette.inkMuted)
    }
  }

  // MARK: Rules and actions

  private var rules: some View {
    VStack(alignment: .leading, spacing: 0) {
      Button { withAnimation(Motion.base) { rulesOpen.toggle() } } label: {
        HStack(spacing: 6) {
          Image(systemName: "chevron.right").font(.system(size: 10, weight: .semibold)).foregroundStyle(Palette.inkMuted)
            .rotationEffect(.degrees(rulesOpen ? 90 : 0))
          Text("How this streak works").font(.ui(Typography.Size.body, weight: .medium)).foregroundStyle(Palette.inkBody)
          Spacer()
        }
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      if rulesOpen {
        VStack(alignment: .leading, spacing: Space.s2) {
          Text("Miss a day and you can spend a freeze on this habit the next day to keep its streak.")
          Text("Seven completed days without a freeze make the flame blaze.")
          Text("After a break, two clean days within 48 hours can restore the streak once this month.")
          if metrics.earnBackUsedThisMonth { Text("Earn-Back has been used this month.") }
        }
        .font(.ui(Typography.Size.sm))
        .foregroundStyle(Palette.inkMuted)
        .fixedSize(horizontal: false, vertical: true)
        .padding(.leading, Space.s5)
        .padding(.top, Space.s3)
        .transition(.opacity)
      }
    }
    .padding(.vertical, Space.s3)
    .overlay(alignment: .top) { Hairline() }
    .overlay(alignment: .bottom) { Hairline() }
  }

  @ViewBuilder
  private var actions: some View {
    if habit.status != .retired {
      HStack(spacing: Space.s2) {
        Button(action: onEdit) { Label("Edit habit", systemImage: "pencil") }.buttonStyle(.ghost)
        if habit.status == .active {
          Button { onStatus(.paused) } label: { Label("Pause", systemImage: "pause") }.buttonStyle(.ghost)
        } else {
          Button { onStatus(.active) } label: { Label("Resume", systemImage: "play") }.buttonStyle(.ghost)
        }
      }
      .labelStyle(.titleAndIcon)
    }
  }

  private var retireZone: some View {
    let retired = habit.status == .retired
    return HStack(spacing: Space.s3) {
      VStack(alignment: .leading, spacing: 3) {
        Text(retired ? "Archived" : "Retire habit").font(.ui(Typography.Size.body, weight: .semibold)).foregroundStyle(Palette.ink)
        Text(retired ? "Bring it back to track it again from today." : "Moves it to your archive. History stays.")
          .font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted)
      }
      Spacer()
      if retired {
        Button { onStatus(.active) } label: { Label("Reactivate", systemImage: "play") }.buttonStyle(.secondary)
      } else {
        Button(action: onRetire) { Label("Retire", systemImage: "archivebox") }.buttonStyle(.secondary)
      }
    }
    .padding(Space.s3)
    .background(RoundedRectangle(cornerRadius: Radius.card, style: .continuous).fill(Palette.surfaceSoft))
  }
}

/// One day in the habit's month calendar.
private struct DayCell: View {
  let day: Int
  let date: String
  let mark: HabitDayMark

  var body: some View {
    ZStack {
      Circle().fill(fill)
      if let border { Circle().strokeBorder(border, lineWidth: 1) }
      if mark == .frozen {
        HabitFreezeCrystal(size: 13)
      } else {
        Text("\(day)").font(.ui(Typography.Size.xs, weight: mark == .complete ? .medium : .regular)).tabular().foregroundStyle(foreground)
      }
    }
    .frame(width: 32, height: 32)
    .opacity([.future, .inactive, .paused].contains(mark) ? 0.34 : 1)
    .help(label)
    .accessibilityElement()
    .accessibilityLabel("\(HabitDates.fullDateLabel(date)), \(label)")
  }

  private var label: String {
    switch mark {
    case .future: return "upcoming"
    case .inactive: return "not tracked"
    default: return mark.rawValue
    }
  }

  private var fill: Color {
    switch mark {
    case .complete: return Palette.completion
    case .partial: return Palette.completionTint
    case .missed: return Palette.overdueErrorTint
    case .frozen: return Palette.frozenInfoTint
    default: return .clear
    }
  }

  private var border: Color? {
    switch mark {
    case .partial: return Palette.completion
    case .missed: return Palette.overdueError
    case .pending: return Palette.surfaceStrong
    default: return nil
    }
  }

  private var foreground: Color {
    switch mark {
    case .complete: return Palette.onPrimary
    case .partial: return Palette.completion
    case .missed: return Palette.overdueError
    case .pending: return Palette.inkBody
    default: return Palette.inkMuted
    }
  }
}
