import AppKit
import ManorKit
import SwiftUI

/// One habit on the daily list: its check-off control, name, week strip with the streak flame, and the
/// Freeze control on a missed row the day after.
struct HabitRowView: View {
  let habit: HabitViewModel
  let isToday: Bool
  /// Room on the leading edge for a drag grip.
  var leadingInset: CGFloat = 0
  /// Keeps the Freeze slot's width on every row of a list where any row shows it, so week strips align.
  var reservesFreezeSlot = false
  var onLog: (Int) -> Void = { _ in }
  var onOpen: () -> Void
  var onResume: () -> Void = {}
  var onFreeze: () -> Void = {}
  var onUnfreeze: () -> Void = {}
  @State private var hovering = false

  private var definition: HabitDefinition { habit.definition }
  private var isPaused: Bool { habit.selectedStatus == .paused }
  private var atRisk: Bool { isToday && !habit.isComplete && habit.metrics.currentStreak > 0 && habit.selectedStatus == .active }

  var body: some View {
    HStack(spacing: 10) {
      completion.frame(width: 28, height: 28)
      nameButton
      if habit.selectedStatus == .active {
        HabitWeekStrip(habit: habit, atRisk: atRisk, onOpen: onOpen)
      } else {
        pausedMeta
      }
      if habit.frozen || habit.canFreeze {
        freezeButton.fixedSize().frame(minWidth: reservesFreezeSlot ? 92 : nil, alignment: .trailing)
      } else if reservesFreezeSlot {
        Color.clear.frame(width: 92, height: 1)
      }
    }
    .padding(.leading, Space.s3 + leadingInset)
    .padding(.trailing, Space.s3)
    .frame(minHeight: 48)
    .background(hovering ? Palette.surfacePaper : .clear)
    .opacity(isPaused ? 0.64 : 1)
    .contentShape(Rectangle())
    .onHover { hovering = $0 }
    .animation(Motion.fast, value: hovering)
  }

  @ViewBuilder
  private var completion: some View {
    if isPaused {
      Circle().strokeBorder(Palette.surfaceStrong, style: StrokeStyle(lineWidth: 1.5, dash: [3, 2.5])).frame(width: 22, height: 22)
        .accessibilityHidden(true)
    } else if definition.kind == .binary {
      HabitCheck(isOn: habit.isComplete, label: "\(habit.isComplete ? "Clear" : "Complete") \(definition.name)") {
        onLog(habit.isComplete ? 0 : 100)
      }
    } else {
      HabitQuantizedControl(name: definition.name, targetLabel: definition.targetLabel ?? "", value: habit.value, onChange: onLog)
    }
  }

  private var nameButton: some View {
    Button(action: onOpen) {
      VStack(alignment: .leading, spacing: 2) {
        Text(definition.name)
          .font(.ui(Typography.Size.md, weight: atRisk ? .semibold : .medium))
          .foregroundStyle(habit.frozen ? Palette.frozenInfo : habit.isComplete ? Palette.inkMuted : Palette.ink)
          .lineLimit(1)
          .truncationMode(.tail)
        if isPaused {
          Text("Paused").font(.ui(Typography.Size.xs)).foregroundStyle(Palette.inkMuted)
        }
      }
      .frame(maxWidth: .infinity, minHeight: 36, alignment: .leading)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .frame(minWidth: 100)
    .accessibilityLabel("Open \(definition.name) details")
  }

  private var pausedMeta: some View {
    HStack(spacing: 6) {
      HStack(spacing: 3) {
        HabitStreakFlame(state: .ember, size: 16)
        Text("\(habit.metrics.currentStreak)").font(.ui(Typography.Size.sm, weight: .semibold)).tabular().foregroundStyle(Palette.inkMuted)
      }
      .accessibilityElement(children: .ignore)
      .accessibilityLabel("\(habit.metrics.currentStreak) day streak")
      if isToday {
        IconButton("play.fill", label: "Resume today", size: 24, action: onResume)
      } else {
        IconButton("chevron.right", label: "Open \(definition.name) details", size: 24, action: onOpen)
      }
    }
  }

  private var freezeButton: some View {
    HabitFreezeToggle(isSpent: habit.frozen, name: definition.name) {
      habit.frozen ? onUnfreeze() : onFreeze()
    }
  }
}

/// The Freeze control: an outlined capsule that covers yesterday's miss, and a filled one that gives it back.
private struct HabitFreezeToggle: View {
  let isSpent: Bool
  let name: String
  let action: () -> Void
  @State private var hovering = false

  var body: some View {
    Button(action: action) {
      HStack(spacing: 5) {
        HabitFreezeCrystal(size: 13, color: isSpent || hovering ? Palette.frozenInfo : Palette.inkMuted)
        Text(isSpent ? "Frozen" : "Freeze").font(.ui(Typography.Size.sm, weight: .medium))
      }
      .foregroundStyle(isSpent || hovering ? Palette.frozenInfo : Palette.inkMuted)
      .padding(.horizontal, Space.s2)
      .frame(height: 24)
      .background(Capsule().fill(isSpent ? Palette.frozenInfoTint : .clear))
      .overlay(Capsule().strokeBorder(isSpent ? .clear : (hovering ? Palette.frozenInfo : Palette.hairlineStrong), lineWidth: 1))
      .contentShape(Capsule())
    }
    .buttonStyle(HabitPressStyle())
    .onHover { hovering = $0 }
    .animation(Motion.fast, value: hovering)
    .animation(Motion.base, value: isSpent)
    .help(isSpent ? "Give the freeze back" : "Cover this miss with a freeze")
    .accessibilityLabel("\(isSpent ? "Return the freeze on" : "Use a freeze on") \(name)")
    .accessibilityAddTraits(isSpent ? .isSelected : [])
  }
}

/// A plain button that settles slightly while pressed.
struct HabitPressStyle: ButtonStyle {
  var scale: CGFloat = 0.94
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .scaleEffect(configuration.isPressed ? scale : 1)
      .animation(Motion.press, value: configuration.isPressed)
  }
}

/// The round one-tap check-off, sized for the habit list.
struct HabitCheck: View {
  let isOn: Bool
  let label: String
  let action: () -> Void
  @State private var hovering = false

  var body: some View {
    Button(action: action) {
      ZStack {
        Circle().fill(isOn ? Palette.completion : Palette.surfaceCard)
        Circle().strokeBorder(isOn ? Palette.completion : (hovering ? Palette.controlBorder : Palette.surfaceStrong), lineWidth: 1.5)
        if isOn {
          Image(systemName: "checkmark")
            .font(.system(size: 11, weight: .bold))
            .foregroundStyle(Palette.onPrimary)
            .transition(.scale(scale: 0.4).combined(with: .opacity))
        }
      }
      .frame(width: 26, height: 26)
      .contentShape(Circle())
    }
    .buttonStyle(HabitPressStyle())
    .onHover { hovering = $0 }
    .animation(Motion.settle, value: isOn)
    .animation(Motion.fast, value: hovering)
    .accessibilityLabel(label)
    .accessibilityAddTraits(isOn ? .isSelected : [])
  }
}

/// A quantized habit's control: one ring that fills along the habit's step ladder. Click steps forward,
/// Shift-click steps back, and the Up and Down arrows step while it has keyboard focus.
struct HabitQuantizedControl: View {
  let name: String
  let targetLabel: String
  let value: Int
  let onChange: (Int) -> Void

  private var ladder: [Int] { HabitRules.ladder(targetLabel) }
  private var shown: Int { HabitRules.nearestStep(ladder, value) }
  private var forward: Int { HabitRules.shifted(ladder, from: shown, by: 1) }
  private var backward: Int { HabitRules.shifted(ladder, from: shown, by: -1) }

  var body: some View {
    ZStack {
      Circle().fill(Palette.surfaceSoft)
      Circle()
        .trim(from: 0, to: CGFloat(shown) / 100)
        .stroke(Palette.completion, style: StrokeStyle(lineWidth: 6, lineCap: .butt))
        .rotationEffect(.degrees(-90))
        .padding(1.5)
      Circle().fill(Palette.surfaceCard).padding(4.5)
      Circle().strokeBorder(shown == 100 ? Palette.completion : Palette.surfaceStrong, lineWidth: 1.5)
      Group {
        if shown == 100 {
          Image(systemName: "checkmark").font(.system(size: 10, weight: .bold))
        } else {
          Text("\(shown)").font(.ui(Typography.Size.xs, weight: .semibold)).tabular().minimumScaleFactor(0.8)
        }
      }
      .foregroundStyle(Palette.completion)
    }
    .frame(width: 26, height: 26)
    .animation(Motion.base, value: shown)
    .contentShape(Circle())
    .onTapGesture { step(NSEvent.modifierFlags.contains(.shift) ? backward : forward) }
    .focusable(interactions: .activate)
    .onKeyPress(.upArrow) { step(forward); return .handled }
    .onKeyPress(.downArrow) { step(backward); return .handled }
    .help("Click to log \(forward)%. Shift-click to go back.")
    .accessibilityElement(children: .ignore)
    .accessibilityAddTraits(.isButton)
    .accessibilityLabel(name)
    .accessibilityValue("\(shown)% complete, \(HabitRules.stepAmountLabel(targetLabel, shown))")
    .accessibilityAdjustableAction { direction in
      switch direction {
      case .increment: step(forward)
      case .decrement: step(backward)
      @unknown default: break
      }
    }
    .accessibilityAction { step(forward) }
  }

  private func step(_ next: Int) { onChange(next) }
}

/// The Monday-to-Sunday rail of day states with the streak flame; opens the habit's details.
struct HabitWeekStrip: View {
  let habit: HabitViewModel
  let atRisk: Bool
  let onOpen: () -> Void
  @State private var hovering = false

  private var flame: HabitFlameState { .of(streak: habit.metrics.currentStreak, atRisk: atRisk, gold: habit.metrics.gold) }

  var body: some View {
    Button(action: onOpen) {
      HStack(spacing: 8) {
        HStack(spacing: 1) {
          ForEach(habit.week) { day in
            VStack(spacing: 4) {
              Text(day.letter)
                .font(.ui(Typography.Size.xs, weight: day.selected ? .semibold : .medium))
                .foregroundStyle(day.selected ? Palette.inkBody : Palette.inkMuted)
              HabitWeekSegment(mark: day.mark, selected: day.selected)
            }
            .frame(width: 21)
          }
        }
        HStack(spacing: 4) {
          HabitStreakFlame(state: flame, size: 22)
          HabitStreakNumber(streak: habit.metrics.currentStreak, state: flame)
        }
        .frame(minWidth: 48, alignment: .trailing)
        Image(systemName: "chevron.right").font(.system(size: 10, weight: .semibold)).foregroundStyle(Palette.inkMuted)
      }
      .padding(.leading, 6)
      .padding(.trailing, 4)
      .frame(minHeight: 40)
      .background(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).fill(hovering ? Palette.surfaceSoft : .clear))
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .onHover { hovering = $0 }
    .animation(Motion.fast, value: hovering)
    .accessibilityLabel(accessibilityText)
  }

  private var accessibilityText: String {
    let days = habit.week.map { "\($0.letter) \($0.mark == .future ? "upcoming" : $0.mark.rawValue)\($0.selected ? ", selected" : "")" }.joined(separator: "; ")
    let gold = habit.metrics.gold ? " Freeze-free week." : ""
    return "\(habit.definition.name). This week: \(days). \(habit.metrics.currentStreak)-day streak.\(gold)\(atRisk ? " At risk today." : "") Open details."
  }
}

/// One day's chip on the week strip.
struct HabitWeekSegment: View {
  let mark: HabitDayMark
  let selected: Bool

  var body: some View {
    let shape = RoundedRectangle(cornerRadius: 3, style: .continuous)
    ZStack {
      shape.fill(fill)
      if mark == .partial {
        shape.fill(Palette.completion).mask(alignment: .leading) { Rectangle().frame(width: 8) }
      }
      shape.strokeBorder(border, lineWidth: 1)
    }
    .frame(width: 16, height: 10)
    .padding(2)
    .overlay {
      if selected {
        RoundedRectangle(cornerRadius: 5, style: .continuous).strokeBorder(Palette.inkMuted, lineWidth: 1)
      }
    }
    .animation(Motion.base, value: mark)
  }

  private var fill: Color {
    switch mark {
    case .complete: return Palette.completion
    case .partial: return Palette.completionTint
    case .missed: return Palette.overdueErrorTint
    case .frozen: return Palette.frozenInfoTint
    case .pending: return Palette.surfaceCard
    case .future, .paused, .inactive: return Palette.surfaceSoft
    }
  }

  private var border: Color {
    switch mark {
    case .complete, .partial: return Palette.completion
    case .missed: return Palette.overdueError
    case .frozen: return Palette.frozenInfo
    case .pending: return Palette.surfaceStrong
    case .future, .paused, .inactive: return Palette.surfaceSoft
    }
  }
}
