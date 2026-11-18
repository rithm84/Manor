import ManorKit
import SwiftUI

/// History for habits, mood, and focus as one page under one month navigator: the month in numbers, a
/// shared trend, the month as a calendar of days, and each habit's month beside the mood and focus mix.
struct TrackingHistoryView: View {
  let habits: HabitsStore
  let moodFocus: MoodFocusStore
  let today: String
  let onOpenHabit: (String) -> Void
  let onOpenDay: (String) -> Void
  let onAddDay: () -> Void
  @AppStorage("tracking.history.range") private var range = 6
  @AppStorage("tracking.history.sort") private var sortRaw = HabitTileSort.order.rawValue
  @AppStorage("tracking.history.archived") private var showArchived = false
  @State private var pickedHabitId: String?
  @State private var width: CGFloat = 900

  private var month: String { habits.historyMonth }
  private var sort: HabitTileSort { HabitTileSort(rawValue: sortRaw) ?? .order }
  private var currentMonth: String { HabitDates.monthKey(today) }

  var body: some View {
    let habitData = habits.history(HabitsStore.HistoryKey(month: month, range: range, habitId: pickedHabitId, showArchived: showArchived, sort: sort))
    let moodData = moodFocus.loaded ? moodFocus.month(month, range: range) : nil
    VStack(alignment: .leading, spacing: Space.s8) {
      topline(habitData, moodData)
      TrackingSummaryStrip(habits: habitData, mood: moodData, dayCount: dayCount, wide: width >= 940)
      TrackingTrendSection(
        habits: habitData, mood: moodData, range: $range, pickedHabitId: $pickedHabitId,
        habitOptions: habitData?.visibleRows.map { ($0.habit.id, $0.habit.name) } ?? []
      )
      calendarSection(habitData, moodData)
      breakdown(habitData, moodData)
    }
    .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
  }

  /// Days of the shown month that have happened so far.
  private var dayCount: Int {
    month == currentMonth ? (Int(today.suffix(2)) ?? 0) : HabitDates.daysInMonth(month)
  }

  // MARK: Topline

  private func topline(_ habitData: HabitsHistoryData?, _ moodData: MoodFocusMonthData?) -> some View {
    let earliest = [habitData?.earliestMonth, moodData?.earliestMonth].compactMap { $0 }.min() ?? month
    return HStack(alignment: .center, spacing: Space.s4) {
      HistoryMonthNav(
        label: HabitDates.monthLabel(month),
        canMoveBack: month > earliest,
        canMoveForward: month < currentMonth,
        onShift: { step in withAnimation(Motion.base) { habits.historyMonth = HabitDates.monthShift(month, step) } },
        onCurrent: month == currentMonth ? nil : { withAnimation(Motion.base) { habits.historyMonth = currentMonth } },
        style: .title
      )
      Spacer(minLength: Space.s4)
      Button(action: onAddDay) { Label("Log a past day", systemImage: "plus") }
        .buttonStyle(.secondary)
        .help("Add or change mood and focus for an earlier day")
        .disabled(!moodFocus.loaded)
    }
  }

  // MARK: Calendar

  private func calendarSection(_ habitData: HabitsHistoryData?, _ moodData: MoodFocusMonthData?) -> some View {
    VStack(alignment: .leading, spacing: Space.s3) {
      HStack(alignment: .lastTextBaseline, spacing: Space.s4) {
        HistorySectionHead(title: "Days", subtitle: "Open a day to see it or change its check-in.")
        Spacer(minLength: Space.s4)
        if width >= 640 { calendarLegend }
      }
      if let moodData {
        TrackingCalendar(grid: moodData.grid, totals: habitData?.dayTotals ?? [], onOpen: onOpenDay)
      } else {
        TrackingCalendar(grid: MoodFocusHistory.monthGrid([], month: month, today: today), totals: habitData?.dayTotals ?? [], onOpen: onOpenDay)
          .disabled(true)
      }
    }
  }

  private var calendarLegend: some View {
    HStack(spacing: Space.s4) {
      HistoryLegendItem(label: "Mood") { MoodFocusSwatch(shape: .square, color: Palette.inkMuted) }
      HistoryLegendItem(label: "Focus") { MoodFocusSwatch(shape: .circle, color: Palette.inkMuted) }
      HistoryLegendItem(label: "Habits done") {
        Capsule().fill(Palette.completion).frame(width: 14, height: 4)
      }
    }
    .accessibilityHidden(true)
  }

  // MARK: Breakdown

  @ViewBuilder
  private func breakdown(_ habitData: HabitsHistoryData?, _ moodData: MoodFocusMonthData?) -> some View {
    let habitsColumn = habitSection(habitData)
    let mix = TrackingDistributions(moods: moodData?.moods ?? [], focuses: moodData?.focuses ?? [])
    if width >= 760 {
      HStack(alignment: .top, spacing: Space.s8) {
        habitsColumn.frame(maxWidth: .infinity, alignment: .topLeading)
        mix.frame(width: width >= 960 ? 260 : 224)
      }
    } else {
      VStack(alignment: .leading, spacing: Space.s8) {
        habitsColumn
        mix
      }
    }
  }

  private func habitSection(_ data: HabitsHistoryData?) -> some View {
    VStack(alignment: .leading, spacing: Space.s3) {
      HStack(alignment: .lastTextBaseline, spacing: Space.s4) {
        HistorySectionHead(title: "Habits", subtitle: "Each habit's month, day by day.")
        Spacer(minLength: Space.s3)
        if let data {
          HStack(spacing: Space.s2) {
            if data.archivedCount > 0 || showArchived {
              ArchivedToggle(isOn: $showArchived, count: data.archivedCount)
            }
            Picker("Sort habits", selection: $sortRaw) {
              ForEach(HabitTileSort.allCases) { option in Text(option.label).tag(option.rawValue) }
            }
            .labelsHidden()
            .pickerStyle(.menu)
            .fixedSize()
          }
        }
      }
      if let data {
        HabitMonthTable(store: habits, data: data, sort: sort, onOpen: onOpenHabit)
      } else if habits.loading {
        Text("Loading habits…").font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted)
      }
    }
  }
}

// MARK: Summary

/// The month in numbers, in two groups: habits, then mood and focus. Averages read as scale words first.
private struct TrackingSummaryStrip: View {
  let habits: HabitsHistoryData?
  let mood: MoodFocusMonthData?
  let dayCount: Int
  /// One row of seven cells; otherwise each group gets its own row.
  let wide: Bool

  var body: some View {
    let summary = habits?.summary
    let moodSummary = mood?.summary
    let tracked = summary?.rows.reduce(0) { $0 + $1.trackedDays } ?? 0
    let moodWord = MoodFocusHistory.moodLabel(average: moodSummary?.moodAverage)
    let focusWord = MoodFocusHistory.focusLabel(average: moodSummary?.focusAverage)
    let habitCells = Group {
      cell(first: true) {
        value(tracked == 0 ? "None" : "\(summary?.completionRate ?? 0)%", color: tracked == 0 ? Palette.inkMuted : Palette.completion)
        caption("Completed")
      }
      cell {
        value("\(summary?.perfectDays ?? 0)", color: Palette.ink)
        caption("Perfect days")
      }
      cell {
        HStack(alignment: .firstTextBaseline, spacing: 5) {
          value("\(summary?.frozenDays ?? 0)", color: Palette.ink)
          if (summary?.frozenDays ?? 0) > 0 { HabitFreezeCrystal(size: 14) }
        }
        caption("Freezes used")
      }
    }
    let rest = moodSummary?.restDays ?? 0
    let moodCells = Group {
      cell(first: !wide) {
        value(moodWord?.rawValue ?? "No ratings", color: moodWord?.tone.strong ?? Palette.inkMuted)
        average("Mood", moodSummary?.moodAverage)
      }
      .columnWeight(1.3)
      cell {
        value(focusWord?.rawValue ?? "No ratings", color: focusWord?.tone.strong ?? Palette.inkMuted)
        average("Focus", moodSummary?.focusAverage)
      }
      .columnWeight(1.3)
      cell {
        HStack(alignment: .firstTextBaseline, spacing: 0) {
          value("\(moodSummary?.loggedDays ?? 0)", color: Palette.ink)
          Text(" of \(dayCount)").font(.ui(Typography.Size.sm, weight: .medium)).foregroundStyle(Palette.inkMuted).tabular()
        }
        caption("Check-ins")
      }
      cell {
        HStack(alignment: .firstTextBaseline, spacing: 5) {
          value("\(rest)", color: Palette.ink)
          if rest > 0 { MoodFocusSwatch(shape: .circle, color: Focus.resting.tone.strong, resting: true, size: 10) }
        }
        caption("Rest days")
      }
      .columnWeight(0.8)
    }
    return Group {
      if wide {
        VStack(alignment: .leading, spacing: 0) {
          WeightedColumns {
            group("Habits", first: true).columnWeight(3)
            group("Mood and focus").columnWeight(4.4)
          }
          WeightedColumns { habitCells; moodCells }
            .overlay(alignment: .top) { Hairline() }
            .overlay(alignment: .bottom) { Hairline() }
        }
      } else {
        VStack(alignment: .leading, spacing: Space.s4) {
          VStack(alignment: .leading, spacing: 0) {
            group("Habits", first: true)
            WeightedColumns { habitCells }
              .overlay(alignment: .top) { Hairline() }
              .overlay(alignment: .bottom) { Hairline() }
          }
          VStack(alignment: .leading, spacing: 0) {
            group("Mood and focus", first: true)
            WeightedColumns { moodCells }
              .overlay(alignment: .top) { Hairline() }
              .overlay(alignment: .bottom) { Hairline() }
          }
        }
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Month summary")
  }

  private func group(_ title: String, first: Bool = false) -> some View {
    Text(title)
      .font(.ui(Typography.Size.xs, weight: .semibold))
      .foregroundStyle(Palette.inkMuted)
      .padding(.leading, first ? 0 : Space.s5)
      .padding(.bottom, Space.s2)
      .frame(maxWidth: .infinity, alignment: .leading)
      .accessibilityAddTraits(.isHeader)
  }

  private func cell<Content: View>(first: Bool = false, @ViewBuilder content: () -> Content) -> some View {
    VStack(alignment: .leading, spacing: 4) { content() }
      .padding(.vertical, Space.s4)
      .padding(.leading, first ? 0 : Space.s5)
      .padding(.trailing, Space.s3)
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
      .overlay(alignment: .leading) {
        if !first {
          Rectangle().fill(Palette.hairline).frame(width: 1)
        }
      }
      .accessibilityElement(children: .combine)
  }

  private func value(_ text: String, color: Color) -> some View {
    Text(text)
      .font(.display(Typography.Size.title, weight: .semibold))
      .foregroundStyle(color)
      .tabular()
      .lineLimit(1)
      .minimumScaleFactor(0.7)
      .contentTransition(.numericText())
  }

  private func caption(_ text: String) -> some View {
    Text(text).font(.ui(Typography.Size.xs)).foregroundStyle(Palette.inkMuted).lineLimit(1)
  }

  private func average(_ label: String, _ number: Double?) -> some View {
    HStack(spacing: 4) {
      Text("Average \(label.lowercased())")
      if let number {
        Text(String(format: "%.1f", number)).fontWeight(.semibold).foregroundStyle(Palette.inkBody).tabular()
      }
    }
    .font(.ui(Typography.Size.xs))
    .foregroundStyle(Palette.inkMuted)
    .lineLimit(1)
  }
}

// MARK: Habit month table

/// One compact row per habit for the shown month: its ring, name, every day as a small mark, and the
/// month's counts. Rows open the habit's details and, in your order, drag to reorder.
private struct HabitMonthTable: View {
  let store: HabitsStore
  let data: HabitsHistoryData
  let sort: HabitTileSort
  let onOpen: (String) -> Void
  @State private var drag = HabitDragState()
  @State private var hoveredId: String?

  var body: some View {
    let rows = data.rankedRows
    let ids = rows.map(\.id)
    let canDrag = sort == .order && rows.count > 1
    if rows.isEmpty {
      Text(data.summary.rows.isEmpty ? "No habits were tracked this month." : "Every habit this month is archived.")
        .font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted)
        .padding(.vertical, Space.s2)
    } else {
      VStack(spacing: 0) {
        HabitMonthRowLayout {
          Text("Habit").font(.ui(Typography.Size.xs, weight: .medium)).foregroundStyle(Palette.inkMuted)
        } strip: {
          HabitStripDayAxis(month: data.summary.month)
        } stats: {
          Text("Done").font(.ui(Typography.Size.xs, weight: .medium)).foregroundStyle(Palette.inkMuted)
        }
        .frame(height: 24)
        .accessibilityHidden(true)
        ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
          Hairline()
          HabitMonthTableRow(row: row) { onOpen(row.habit.id) }
            .overlay(alignment: .leading) {
              if canDrag {
                HabitReorderGrip(id: row.id, name: row.habit.name, visible: hoveredId == row.id, drag: $drag, onStep: { step in
                  let target = index + step
                  if ids.indices.contains(target) { Task { await store.move(row.id, onto: ids[target]) } }
                }) { HabitDragPreview(name: row.habit.name) }
                .offset(x: -26)
              }
            }
            .onHover { inside in
              if inside { hoveredId = row.id } else if hoveredId == row.id { hoveredId = nil }
            }
            .modifier(HabitReorderDropTarget(id: row.id, ids: ids, drag: $drag) { dragId in
              if canDrag { Task { await store.move(dragId, onto: row.id) } }
            })
            .contextMenu {
              Button("Open details") { onOpen(row.habit.id) }
              if canDrag {
                Button("Move up") { if index > 0 { Task { await store.move(row.id, onto: ids[index - 1]) } } }.disabled(index == 0)
                Button("Move down") { if index < ids.count - 1 { Task { await store.move(row.id, onto: ids[index + 1]) } } }.disabled(index == ids.count - 1)
              }
            }
        }
        Hairline()
        HabitMonthLegend().padding(.top, Space.s3)
      }
      .animation(Motion.settle, value: ids)
    }
  }
}

/// The three columns every habit row shares, so the day strips line up down the table.
private struct HabitMonthRowLayout<Name: View, Strip: View, Stats: View>: View {
  @ViewBuilder let name: () -> Name
  @ViewBuilder let strip: () -> Strip
  @ViewBuilder let stats: () -> Stats

  var body: some View {
    HStack(spacing: Space.s4) {
      name().frame(width: 172, alignment: .leading)
      strip().frame(maxWidth: .infinity)
      stats().frame(width: 92, alignment: .trailing)
    }
  }
}

private struct HabitMonthTableRow: View {
  let row: HabitMonthRow
  let onOpen: () -> Void
  @State private var hovering = false

  var body: some View {
    Button(action: onOpen) {
      HabitMonthRowLayout {
        HStack(spacing: Space.s2) {
          HabitCompletionRing(row: row, diameter: 20, lineWidth: 4, showsRate: false)
          VStack(alignment: .leading, spacing: 0) {
            Text(row.habit.name).font(.ui(Typography.Size.body, weight: .medium)).foregroundStyle(row.status == .retired ? Palette.inkMuted : Palette.ink)
              .lineLimit(1).truncationMode(.tail)
            if let lifecycle = row.lifecycleLabel {
              Text(lifecycle).font(.ui(Typography.Size.xs)).foregroundStyle(Palette.inkMuted)
            }
          }
        }
      } strip: {
        HabitDayStrip(days: row.days).frame(height: 14)
      } stats: {
        HStack(alignment: .firstTextBaseline, spacing: Space.s2) {
          Text(row.trackedDays == 0 ? "" : "\(row.completedDays)/\(row.trackedDays)")
            .font(.ui(Typography.Size.xs)).foregroundStyle(Palette.inkMuted)
          Text(row.trackedDays == 0 ? "None" : "\(row.completionRate)%")
            .font(.ui(Typography.Size.body, weight: .semibold))
            .foregroundStyle(row.trackedDays == 0 ? Palette.inkMuted : Palette.ink)
            .frame(minWidth: 38, alignment: .trailing)
        }
        .tabular()
      }
      .padding(.vertical, Space.s2)
      .frame(minHeight: 44)
      .background(hovering ? Palette.surfacePaper : .clear)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .onHover { hovering = $0 }
    .animation(Motion.fast, value: hovering)
    .accessibilityLabel(row.accessibilityLabel)
  }
}

/// A habit's month as one small mark per day, drawn in a single pass.
struct HabitDayStrip: View {
  let days: [HabitDayMark]

  var body: some View {
    Canvas { context, size in
      guard !days.isEmpty else { return }
      let gap: CGFloat = size.width / CGFloat(days.count) > 9 ? 2 : 1
      let cell = (size.width - gap * CGFloat(days.count - 1)) / CGFloat(days.count)
      let height = min(size.height, max(cell * 1.4, 8))
      let y = (size.height - height) / 2
      for (index, mark) in days.enumerated() {
        let rect = CGRect(x: CGFloat(index) * (cell + gap), y: y, width: cell, height: height)
        let radius = min(2.5, cell / 3)
        let path = Path(roundedRect: rect, cornerRadius: radius, style: .continuous)
        let style = HabitDayStrip.style(mark)
        context.fill(path, with: .color(style.fill))
        if let border = style.border {
          context.stroke(Path(roundedRect: rect.insetBy(dx: 0.5, dy: 0.5), cornerRadius: radius, style: .continuous), with: .color(border), lineWidth: 1)
        }
      }
    }
    .accessibilityHidden(true)
  }

  static func style(_ mark: HabitDayMark) -> (fill: Color, border: Color?) {
    switch mark {
    case .complete: return (Palette.completion, nil)
    case .partial: return (Palette.completionSoft, nil)
    case .frozen: return (Palette.frozenInfo, nil)
    case .missed: return (Palette.overdueErrorTint, Palette.overdueError.opacity(0.7))
    case .pending: return (.clear, Palette.surfaceStrong)
    case .future, .paused, .inactive: return (Palette.surfaceSoft, nil)
    }
  }
}

/// Day numbers above the strips: the first of the month and every Monday.
private struct HabitStripDayAxis: View {
  let month: String

  var body: some View {
    let dates = HabitDates.dates(inMonth: month)
    Canvas { context, size in
      guard !dates.isEmpty else { return }
      let gap: CGFloat = size.width / CGFloat(dates.count) > 9 ? 2 : 1
      let cell = (size.width - gap * CGFloat(dates.count - 1)) / CGFloat(dates.count)
      // Mondays, plus the 1st when the first Monday is not right beside it.
      let firstMonday = dates.firstIndex { HabitDates.weekdayIndex($0) == 0 } ?? 0
      for (index, date) in dates.enumerated() where (index == 0 && firstMonday > 2) || HabitDates.weekdayIndex(date) == 0 {
        let x = CGFloat(index) * (cell + gap) + cell / 2
        let text = context.resolve(Text("\(index + 1)").font(.ui(Typography.Size.xs)).foregroundStyle(Palette.inkMuted))
        let half = text.measure(in: size).width / 2
        context.draw(text, at: CGPoint(x: min(max(x, half), size.width - half), y: size.height / 2), anchor: .center)
      }
    }
  }
}

private struct HabitMonthLegend: View {
  var body: some View {
    HStack(spacing: Space.s4) {
      key("Complete", HabitDayMark.complete)
      key("Partial", .partial)
      key("Freeze", .frozen)
      key("Missed", .missed)
      key("Not tracked", .inactive)
    }
    .accessibilityHidden(true)
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private func key(_ label: String, _ mark: HabitDayMark) -> some View {
    let style = HabitDayStrip.style(mark)
    return HistoryLegendItem(label: label) {
      RoundedRectangle(cornerRadius: 2.5, style: .continuous).fill(style.fill)
        .overlay { if let border = style.border { RoundedRectangle(cornerRadius: 2.5, style: .continuous).strokeBorder(border, lineWidth: 1) } }
        .frame(width: 9, height: 12)
    }
  }
}
