import Charts
import ManorKit
import SwiftUI

/// History: the month's statistics and chart, then every focus session of the month by day.
struct PomodoroHistoryView: View {
  @Environment(PomodoroStore.self) private var store
  @Binding var month: String
  /// Owned by the page so the confirmation centers over the whole page, not inside the session list.
  @Binding var confirmDelete: PomodoroSession?

  var body: some View {
    let stats = PomodoroStats.month(store.sessions, month: month, today: store.today)
    let days = PomodoroStats.sessionDays(store.sessions, month: month)
    ScrollView {
      VStack(alignment: .leading, spacing: Space.s8) {
        PomodoroMonthStatsView(stats: stats, month: $month)
        PomodoroSessionLog(days: days, confirmDelete: $confirmDelete)
      }
      .padding(.horizontal, Space.s8)
      .padding(.bottom, Space.s10)
      .centeredColumn()
    }
    .scrollBounceBehavior(.basedOnSize)
  }
}

// MARK: Month statistics

private struct PomodoroMonthStatsView: View {
  @Environment(PomodoroStore.self) private var store
  let stats: PomodoroMonthStats
  @Binding var month: String
  @State private var pop = false

  var body: some View {
    let label = PomodoroDates.monthLabel(stats.month)
    let currentMonth = PomodoroDates.monthOf(store.today)
    VStack(alignment: .leading, spacing: Space.s4) {
      // The month's name is the navigator itself (quiet chevrons after it), so the topline names it once.
      let nav = HistoryMonthNav(
        label: label,
        canMoveBack: month > PomodoroStats.earliestMonth(store.sessions, today: store.today),
        canMoveForward: month < currentMonth,
        onShift: { month = PomodoroDates.shiftMonth(month, by: $0) },
        onCurrent: month < currentMonth ? { month = currentMonth } : nil,
        style: .title
      )
      .fixedSize()
      let headline = Text(caption).font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted).lineLimit(1)
      VStack(alignment: .leading, spacing: 3) {
        nav
        headline
      }

      summary
        .onChange(of: store.ended?.id) { _, id in
          // A completed focus session nudges the month count once, then the count sits still.
          guard id != nil, store.ended?.kind == .focus, store.ended?.status == .completed, month == currentMonth else { return }
          withAnimation(.timingCurve(0.23, 1, 0.32, 1, duration: 0.15)) { pop = true }
          Task {
            try? await Task.sleep(for: .milliseconds(150))
            withAnimation(.timingCurve(0.23, 1, 0.32, 1, duration: 0.27)) { pop = false }
          }
        }

      PomodoroDayChart(days: stats.days, today: store.today)
        .frame(height: 196)
        .padding(.top, Space.s2)
        .accessibilityLabel("Minutes focused each day of \(label)")
    }
  }

  private var caption: String {
    if stats.completed == 0 { return "No completed sessions yet this month." }
    guard let best = stats.bestDay else { return "\(stats.completed) sessions." }
    return "Best day \(PomodoroDates.shortDayLabel(best.date)) with \(best.completed) \(best.completed == 1 ? "session" : "sessions")."
  }

  private var summary: some View {
    let perDay = stats.perActiveDay.map { $0.rounded() == $0 ? String(Int($0)) : String(format: "%.1f", $0) } ?? "0"
    return PomodoroSummaryStrip(cells: [
      .init(value: "\(stats.completed)", suffix: nil, label: "Sessions completed", weight: 1.35, primary: true),
      .init(value: Pomodoro.formatMinutes(stats.focusedSeconds), suffix: nil, label: "Focused", weight: 1, primary: false),
      .init(value: "\(stats.activeDays)", suffix: " of \(stats.elapsedDays)", label: "Active days", weight: 1, primary: false),
      .init(value: perDay, suffix: nil, label: "Per active day", weight: 1, primary: false),
      .init(value: "\(stats.streak)", suffix: nil, label: "Day streak", weight: 1, primary: false)
    ], pop: pop)
    .accessibilityElement(children: .combine)
    .accessibilityLabel("\(PomodoroDates.monthLabel(stats.month)) summary")
  }
}

private struct PomodoroSummaryStrip: View {
  struct Cell: Identifiable {
    let value: String
    let suffix: String?
    let label: String
    let weight: CGFloat
    let primary: Bool
    var id: String { label }
  }

  let cells: [Cell]
  let pop: Bool

  var body: some View {
    WeightedColumns {
      ForEach(Array(cells.enumerated()), id: \.element.id) { index, cell in
        VStack(alignment: .leading, spacing: 3) {
          HStack(alignment: .firstTextBaseline, spacing: 0) {
            Text(cell.value)
              .font(.display(Typography.Size.displayMD, weight: .semibold))
              .foregroundStyle(cell.primary ? Palette.primary : Palette.ink)
              .scaleEffect(cell.primary && pop ? 1.12 : 1, anchor: .leading)
            if let suffix = cell.suffix {
              Text(suffix).font(.ui(Typography.Size.sm, weight: .medium)).foregroundStyle(Palette.inkMuted)
            }
          }
          .tabular()
          .lineLimit(1)
          .minimumScaleFactor(0.7)
          Text(cell.label).font(.ui(Typography.Size.xs)).foregroundStyle(Palette.inkMuted).lineLimit(1)
        }
        .padding(.vertical, Space.s4)
        .padding(.leading, index == 0 ? 0 : Space.s5)
        .padding(.trailing, Space.s5)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .overlay(alignment: .leading) { if index > 0 { Rectangle().fill(Palette.hairline).frame(width: 1) } }
        .columnWeight(cell.weight)
      }
    }
    .overlay(alignment: .top) { Hairline() }
    .overlay(alignment: .bottom) { Hairline() }
  }
}

/// Minutes focused each day of the month; today in full plum, other days a step lighter.
private struct PomodoroDayChart: View {
  let days: [PomodoroDay]
  let today: String
  @State private var selected: String?

  var body: some View {
    let ticks = days.map(\.date).filter { day in
      let number = Int(day.suffix(2)) ?? 0
      return number == 1 || number % 5 == 0
    }
    Chart {
      ForEach(days) { day in
        BarMark(x: .value("Day", day.date), y: .value("Minutes", Int((Double(day.focusedSeconds) / 60).rounded())), width: .ratio(0.72))
          .foregroundStyle(day.date == today ? Palette.primary : Palette.primary.opacity(selected == day.date ? 0.8 : 0.58))
          .clipShape(UnevenRoundedRectangle(topLeadingRadius: 3, topTrailingRadius: 3, style: .continuous))
      }
      // Days still ahead have nothing to say yet.
      if let selected, selected <= today, let day = days.first(where: { $0.date == selected }) {
        RuleMark(x: .value("Day", selected))
          .foregroundStyle(.clear)
          .annotation(position: .top, spacing: 4, overflowResolution: .init(x: .fit(to: .chart), y: .disabled)) {
            PomodoroDayTip(day: day)
          }
      }
    }
    .chartXScale(domain: days.map(\.date))
    .chartXAxis {
      AxisMarks(values: ticks) { value in
        AxisValueLabel {
          if let date = value.as(String.self) {
            Text("\(Int(date.suffix(2)) ?? 0)").font(.ui(Typography.Size.xs)).foregroundStyle(Palette.inkMuted).tabular()
          }
        }
      }
    }
    .chartYAxis {
      AxisMarks(position: .leading) { value in
        AxisGridLine(stroke: StrokeStyle(lineWidth: 1, dash: [2, 4])).foregroundStyle(Palette.hairline)
        AxisValueLabel {
          if let minutes = value.as(Int.self) { Text("\(minutes)m").font(.ui(Typography.Size.xs)).foregroundStyle(Palette.inkMuted).tabular() }
        }
      }
    }
    .chartXSelection(value: $selected)
  }
}

private struct PomodoroDayTip: View {
  let day: PomodoroDay
  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(PomodoroDates.shortDayLabel(day.date)).font(.ui(Typography.Size.xs, weight: .semibold)).foregroundStyle(Palette.ink)
      Text(day.completed == 0 ? "No sessions" : "\(day.completed) \(day.completed == 1 ? "session" : "sessions")")
      if day.focusedSeconds >= 30 { Text("\(Pomodoro.formatMinutes(day.focusedSeconds)) focused") }
    }
    .font(.ui(Typography.Size.xs))
    .foregroundStyle(Palette.inkBody)
    .tabular()
    .padding(.horizontal, 10)
    .padding(.vertical, 8)
    .background(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).fill(Palette.surfaceCard))
    .overlay(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).strokeBorder(Palette.hairline))
    .shadow(color: .black.opacity(0.1), radius: 10, y: 4)
  }
}

// MARK: Session log

/// Every focus session of the month by day, newest first. Each day is a group: its name and totals beside a strip
/// of the day's hours that shows when you focused, then its sessions as rows on one quiet surface.
private struct PomodoroSessionLog: View {
  let days: [PomodoroSessionDay]
  @Binding var confirmDelete: PomodoroSession?
  @State private var expanded = false

  private let initialDays = 7

  var body: some View {
    let shown = expanded ? days : Array(days.prefix(initialDays))
    let hidden = days.count - shown.count
    VStack(alignment: .leading, spacing: Space.s4) {
      HistorySectionHead(title: "Sessions", subtitle: "Every focus session this month, newest first.")
      if days.isEmpty {
        EmptyState(systemImage: "timer", title: "No focus sessions yet", message: "Start the timer and finished sessions will collect here.")
          .frame(minHeight: 220)
      } else {
        LazyVStack(alignment: .leading, spacing: Space.s6) {
          ForEach(shown) { day in
            PomodoroSessionDayGroup(day: day, confirmDelete: $confirmDelete)
          }
        }
        if hidden > 0 {
          Button("Show \(hidden) more \(hidden == 1 ? "day" : "days")") { withAnimation(Motion.base) { expanded = true } }
            .buttonStyle(.secondary)
            .frame(maxWidth: .infinity)
            .padding(.top, Space.s2)
        }
      }
    }
  }
}

private struct PomodoroSessionDayGroup: View {
  @Environment(PomodoroStore.self) private var store
  let day: PomodoroSessionDay
  @Binding var confirmDelete: PomodoroSession?

  var body: some View {
    let shape = RoundedRectangle(cornerRadius: Radius.card, style: .continuous)
    VStack(alignment: .leading, spacing: Space.s2) {
      HStack(alignment: .center, spacing: Space.s4) {
        VStack(alignment: .leading, spacing: 1) {
          Text(PomodoroDates.dayHeading(day.date, today: store.today))
            .font(.ui(Typography.Size.body, weight: .semibold)).foregroundStyle(Palette.ink)
          Text(totals).font(.ui(Typography.Size.xs)).foregroundStyle(Palette.inkMuted).tabular().lineLimit(1)
        }
        .accessibilityElement(children: .combine)
        Spacer(minLength: Space.s4)
        PomodoroDayHours(sessions: day.sessions, timeZone: store.timeZone)
          .frame(width: 220, height: 20)
          .help("When you focused, midnight to midnight")
      }
      VStack(spacing: 0) {
        ForEach(Array(day.sessions.enumerated()), id: \.element.id) { index, session in
          if index > 0 { Hairline().padding(.leading, Space.s3 + 22 + Space.s3) }
          PomodoroSessionRow(session: session, onDelete: { confirmDelete = session })
        }
      }
      .background(shape.fill(Palette.surfacePaper))
      .overlay(shape.strokeBorder(Palette.hairline))
      .clipShape(shape)
    }
  }

  /// "2 completed, 1 stopped · 55m".
  private var totals: String {
    let completed = day.completedCount
    let stopped = day.sessions.count - completed
    let focused = day.sessions.reduce(0) { $0 + ($1.focusedSeconds ?? 0) }
    let counts = [completed > 0 ? "\(completed) completed" : nil, stopped > 0 ? "\(stopped) stopped" : nil].compactMap { $0 }
    return counts.joined(separator: ", ") + " · " + Pomodoro.formatMinutes(focused)
  }
}

/// The day from midnight to midnight as a thin track, with each session at the time it ran: completed sessions in
/// full plum, stopped ones lighter. Faint ticks mark 6 AM, noon, and 6 PM.
private struct PomodoroDayHours: View {
  let sessions: [PomodoroSession]
  let timeZone: TimeZone

  var body: some View {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = timeZone
    let spans = sessions.map { session -> (start: Double, length: Double, completed: Bool) in
      let start = session.startedAt.timeIntervalSince(calendar.startOfDay(for: session.startedAt))
      let end = session.endedAt ?? session.startedAt.addingTimeInterval(TimeInterval((session.focusedSeconds ?? 0) + session.pausedSeconds))
      return (start, max(0, end.timeIntervalSince(session.startedAt)), session.status == .completed)
    }
    return Canvas { context, size in
      let day: Double = 86_400
      let track = CGRect(x: 0, y: (size.height - 6) / 2, width: size.width, height: 6)
      context.fill(Path(roundedRect: track, cornerRadius: 3, style: .continuous), with: .color(Palette.surfaceSoft))
      for hour in [6.0, 12, 18] {
        let x = (size.width * hour / 24).rounded()
        context.fill(Path(CGRect(x: x - 0.5, y: (size.height - 12) / 2, width: 1, height: 12)), with: .color(Palette.hairlineStrong))
      }
      for span in spans {
        let x = size.width * span.start / day
        let width = min(max(3, size.width * span.length / day), size.width - x)
        let rect = CGRect(x: x, y: (size.height - 10) / 2, width: width, height: 10)
        context.fill(Path(roundedRect: rect, cornerRadius: min(3, width / 2), style: .continuous),
                     with: .color(span.completed ? Palette.primary : Palette.primary.opacity(0.4)))
      }
    }
    .accessibilityHidden(true)
  }
}

/// A completed session's filled mark with a check, or a stopped session's ring filled as far as it got.
private struct PomodoroSessionMark: View {
  let fraction: Double
  let completed: Bool

  var body: some View {
    ZStack {
      if completed {
        Circle().fill(Palette.primary)
        Image(systemName: "checkmark").font(.system(size: 10, weight: .bold)).foregroundStyle(Palette.onPrimary)
      } else {
        Circle().strokeBorder(Palette.surfaceStrong, lineWidth: 2.5)
        Circle()
          .inset(by: 1.25)
          .trim(from: 0, to: max(0.04, min(1, fraction)))
          .stroke(Palette.primary, style: StrokeStyle(lineWidth: 2.5, lineCap: .round))
          .rotationEffect(.degrees(-90))
      }
    }
    .frame(width: 22, height: 22)
    .accessibilityHidden(true)
  }
}

private struct PomodoroSessionRow: View {
  @Environment(PomodoroStore.self) private var store
  let session: PomodoroSession
  let onDelete: () -> Void
  @State private var hovering = false
  @State private var draft: String?
  @FocusState private var focused: Bool

  var body: some View {
    let completed = session.status == .completed
    let focusedSeconds = session.focusedSeconds ?? 0
    let time = PomodoroDates.startTimeLabel(session, timeZone: store.timeZone)
    HStack(spacing: Space.s3) {
      PomodoroSessionMark(fraction: Double(focusedSeconds) / Double(max(1, session.plannedSeconds)), completed: completed)
      VStack(alignment: .leading, spacing: 1) {
        if let draft {
          TextField("Session label", text: Binding(get: { draft }, set: { self.draft = String($0.prefix(PomodoroLimits.label)) }))
            .textFieldStyle(.plain)
            .font(.ui(Typography.Size.sm, weight: .medium))
            .padding(.horizontal, Space.s2)
            .frame(height: 26)
            .background(RoundedRectangle(cornerRadius: Radius.chip, style: .continuous).fill(Palette.surfaceCard))
            .overlay(RoundedRectangle(cornerRadius: Radius.chip, style: .continuous).strokeBorder(Palette.focusBorder, lineWidth: 1.5))
            .padding(.leading, -Space.s2)
            .focused($focused)
            .onAppear { focused = true }
            .onSubmit(commit)
            .onExitCommand { self.draft = nil }
            .onChange(of: focused) { _, isFocused in if !isFocused { commit() } }
            .accessibilityLabel("Session label")
        } else {
          Text(session.label ?? "Focus session")
            .font(.ui(Typography.Size.sm, weight: session.label == nil ? .regular : .medium))
            .foregroundStyle(session.label == nil ? Palette.inkMuted : Palette.ink)
            .lineLimit(1)
            .onTapGesture(count: 2) { startEditing() }
        }
        Text(timeRange).font(.ui(Typography.Size.xs)).foregroundStyle(Palette.inkMuted).tabular().lineLimit(1)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      HStack(spacing: 2) {
        IconButton("pencil", label: "Edit label", size: 26) { startEditing() }
        IconButton("trash", label: "Delete session", size: 26, action: onDelete)
      }
      .opacity(hovering || draft != nil ? 1 : 0)
      .disabled(store.busy)
      VStack(alignment: .trailing, spacing: 1) {
        Text(Pomodoro.formatMinutes(focusedSeconds))
          .font(.ui(Typography.Size.sm, weight: .semibold))
          .foregroundStyle(completed ? Palette.ink : Palette.inkBody)
        if !completed {
          Text("of \(Pomodoro.formatMinutes(session.plannedSeconds))").font(.ui(Typography.Size.xs)).foregroundStyle(Palette.inkMuted)
        }
      }
      .tabular()
      .frame(minWidth: 52, alignment: .trailing)
    }
    .padding(.horizontal, Space.s3)
    .padding(.vertical, Space.s2)
    .frame(minHeight: 52)
    .background(hovering ? Palette.surfaceSoft : .clear)
    .contentShape(Rectangle())
    .onHover { hovering = $0 }
    .animation(Motion.fast, value: hovering)
    .contextMenu {
      Button("Edit label", action: startEditing)
      Divider()
      Button("Delete session", role: .destructive, action: onDelete)
    }
    .accessibilityElement(children: .combine)
    .accessibilityLabel("\(time), \(session.label ?? "focus session"), \(completed ? "\(Pomodoro.formatMinutes(focusedSeconds)) completed" : "stopped after \(Pomodoro.formatMinutes(focusedSeconds)) of \(Pomodoro.formatMinutes(session.plannedSeconds))")")
    .accessibilityAction(named: "Edit label", startEditing)
    .accessibilityAction(named: "Delete session", onDelete)
  }

  /// "9:05 – 9:30 AM", or "11:40 AM – 12:05 PM" across noon.
  private var timeRange: String {
    let end = session.endedAt ?? session.startedAt.addingTimeInterval(TimeInterval((session.focusedSeconds ?? 0) + session.pausedSeconds))
    let zone = store.timeZone
    let endLabel = DisplayDates.string(end, "h:mm a", timeZone: zone)
    let sameHalf = DisplayDates.string(session.startedAt, "a", timeZone: zone) == DisplayDates.string(end, "a", timeZone: zone)
    let startLabel = DisplayDates.string(session.startedAt, sameHalf ? "h:mm" : "h:mm a", timeZone: zone)
    return "\(startLabel) – \(endLabel)"
  }

  private func startEditing() { draft = session.label ?? "" }

  private func commit() {
    guard let draft else { return }
    self.draft = nil
    let trimmed = draft.trimmingCharacters(in: .whitespacesAndNewlines)
    let next = trimmed.isEmpty ? nil : trimmed
    if next != session.label { store.relabel(session.id, label: next) }
  }
}

// MARK: Preferences

/// Lengths, the cycle, and auto-start. Changes apply to sessions started from now on.
struct PomodoroPreferencesPanel: View {
  @Binding var draft: PomodoroSettings
  let saved: PomodoroSettings
  let saving: Bool
  let onCancel: () -> Void
  let onSave: () -> Void

  var body: some View {
    DialogPanel("Timer preferences", onClose: onCancel) {
      VStack(spacing: 0) {
        row("Focus", "How long each focus session runs.") {
          PomodoroStepper(value: $draft.focusMinutes, range: 1...PomodoroLimits.minutes, step: 5, unit: "min", label: "Focus length")
        }
        row("Short break", "The break after most focus sessions.") {
          PomodoroStepper(value: $draft.shortBreakMinutes, range: 1...PomodoroLimits.minutes, step: 1, unit: "min", label: "Short break length")
        }
        row("Long break", "The longer break that closes a cycle.") {
          PomodoroStepper(value: $draft.longBreakMinutes, range: 1...PomodoroLimits.minutes, step: 5, unit: "min", label: "Long break length")
        }
        row("Cycle", "Focus sessions before a long break.") {
          PomodoroStepper(value: $draft.longBreakEvery, range: 1...PomodoroLimits.longBreakEvery, step: 1,
                          unit: draft.longBreakEvery == 1 ? "session" : "sessions", label: "Sessions per cycle")
        }
        row("Start breaks automatically", "A finished focus session flows straight into its break.") {
          Toggle("Start breaks automatically", isOn: $draft.autoStartBreaks).labelsHidden().toggleStyle(.switch).tint(Palette.primary)
        }
        row("Start focus automatically", "A finished break flows straight into the next focus session.") {
          Toggle("Start focus automatically", isOn: $draft.autoStartFocus).labelsHidden().toggleStyle(.switch).tint(Palette.primary)
        }
        Hairline()
        Text("Changes apply to sessions you start from now on.")
          .font(.ui(Typography.Size.xs))
          .foregroundStyle(Palette.inkMuted)
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(.top, Space.s4)
      }
    } footer: {
      Button("Cancel", action: onCancel).buttonStyle(.ghost).disabled(saving).keyboardShortcut(.cancelAction)
      Button(saving ? "Saving…" : "Save", action: onSave).buttonStyle(.primary).disabled(saving || draft == saved).keyboardShortcut(.defaultAction)
    }
  }

  private func row<Control: View>(_ label: String, _ description: String, @ViewBuilder control: () -> Control) -> some View {
    VStack(spacing: 0) {
      if label != "Focus" { Hairline() }
      HStack(spacing: Space.s5) {
        VStack(alignment: .leading, spacing: 2) {
          Text(label).font(.ui(Typography.Size.body, weight: .medium)).foregroundStyle(Palette.ink)
          Text(description).font(.ui(Typography.Size.xs)).foregroundStyle(Palette.inkMuted).fixedSize(horizontal: false, vertical: true)
        }
        Spacer(minLength: Space.s4)
        control()
      }
      .padding(.vertical, Space.s4)
    }
  }
}

/// Minus, the value with its unit, plus. The value is clamped to the server's limits.
private struct PomodoroStepper: View {
  @Binding var value: Int
  let range: ClosedRange<Int>
  let step: Int
  let unit: String
  let label: String

  var body: some View {
    HStack(spacing: 0) {
      button("minus", "Decrease \(label.lowercased())", enabled: value > range.lowerBound) { value = max(range.lowerBound, value - step) }
      HStack(spacing: 0) {
        Text("\(value)").font(.ui(Typography.Size.sm, weight: .semibold)).foregroundStyle(Palette.ink)
        Text(" \(unit)").font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted)
      }
      .tabular()
      .frame(minWidth: 96)
      button("plus", "Increase \(label.lowercased())", enabled: value < range.upperBound) { value = min(range.upperBound, value + step) }
    }
    .padding(2)
    .background(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).fill(Palette.surfaceCard))
    .overlay(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).strokeBorder(Palette.hairline))
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(label)
    .accessibilityValue("\(value) \(unit)")
    .accessibilityAdjustableAction { direction in
      switch direction {
      case .increment: value = min(range.upperBound, value + step)
      case .decrement: value = max(range.lowerBound, value - step)
      @unknown default: break
      }
    }
  }

  private func button(_ systemImage: String, _ label: String, enabled: Bool, action: @escaping () -> Void) -> some View {
    IconButton(systemImage, label: label, size: 28, action: action)
      .disabled(!enabled)
      .opacity(enabled ? 1 : 0.4)
  }
}
