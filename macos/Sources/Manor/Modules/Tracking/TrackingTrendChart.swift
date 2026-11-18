import Charts
import ManorKit
import SwiftUI

/// The shared trend: habit completion above, mood and focus below, on one month axis with one hover. The
/// readout above the plots names the hovered month's values, or the shown month's when nothing is hovered.
struct TrackingTrendSection: View {
  let habits: HabitsHistoryData?
  let mood: MoodFocusMonthData?
  @Binding var range: Int
  @Binding var pickedHabitId: String?
  let habitOptions: [(id: String, name: String)]
  @State private var selected: String?

  private var months: [String] {
    habits?.trend.map(\.month) ?? mood?.trend.map(\.month) ?? []
  }

  var body: some View {
    VStack(alignment: .leading, spacing: Space.s3) {
      header
      readout
      VStack(spacing: Space.s4) {
        HabitCompletionPane(points: habits?.trendPoints ?? [], months: months, selected: $selected)
          .frame(height: 112)
        MoodFocusPane(points: mood?.trend ?? [], months: months, selected: $selected)
          .frame(height: 132)
      }
      .accessibilityElement(children: .ignore)
      .accessibilityLabel(accessibilitySummary)
    }
  }

  private var header: some View {
    HStack(alignment: .lastTextBaseline, spacing: Space.s4) {
      HistorySectionHead(title: "Trend", subtitle: "How each month went.")
      Spacer(minLength: Space.s3)
      HStack(spacing: Space.s2) {
        if !habitOptions.isEmpty {
          Picker("Habits in the trend", selection: Binding(get: { habits?.trendHabitId ?? "all" }, set: { pickedHabitId = $0 == "all" ? nil : $0 })) {
            Text("All habits").tag("all")
            Divider()
            ForEach(habitOptions, id: \.id) { option in Text(option.name).tag(option.id) }
          }
          .labelsHidden()
          .pickerStyle(.menu)
          .fixedSize()
          .frame(maxWidth: 200)
        }
        HistoryRangeTabs(range: $range)
      }
    }
  }

  /// The values for the hovered month, or the last month in range.
  private var readout: some View {
    let month = selected ?? months.last ?? ""
    let habitMonth = habits?.trend.first { $0.month == month }
    let point = mood?.trend.first { $0.month == month }
    let moodWord = MoodFocusHistory.moodLabel(average: point?.mood)
    let focusWord = MoodFocusHistory.focusLabel(average: point?.focus)
    return HStack(spacing: Space.s5) {
      Text(month.isEmpty ? "" : HabitDates.monthLabel(month))
        .font(.ui(Typography.Size.sm, weight: .semibold)).foregroundStyle(Palette.ink)
        .frame(minWidth: 112, alignment: .leading)
        .contentTransition(.opacity)
      readoutItem(color: Palette.completion, name: habits?.trendHabitName ?? "Habits") {
        if let rate = habitMonth?.completionRate {
          Text("\(rate)%").fontWeight(.semibold).foregroundStyle(Palette.ink)
          Text("\(habitMonth?.completedDays ?? 0) of \(habitMonth?.trackedDays ?? 0) days").foregroundStyle(Palette.inkMuted)
        } else {
          Text("No days").foregroundStyle(Palette.inkMuted)
        }
      }
      readoutItem(color: MoodFocusSeries.mood, name: "Mood") {
        if let value = point?.mood, let moodWord {
          Text(moodWord.rawValue).fontWeight(.semibold).foregroundStyle(Palette.ink)
          Text(String(format: "%.1f", value)).foregroundStyle(Palette.inkMuted)
        } else {
          Text("No ratings").foregroundStyle(Palette.inkMuted)
        }
      }
      readoutItem(color: MoodFocusSeries.focus, name: "Focus") {
        if let value = point?.focus, let focusWord {
          Text(focusWord.rawValue).fontWeight(.semibold).foregroundStyle(Palette.ink)
          Text(String(format: "%.1f", value)).foregroundStyle(Palette.inkMuted)
        } else {
          Text("No ratings").foregroundStyle(Palette.inkMuted)
        }
      }
      Spacer(minLength: 0)
    }
    .font(.ui(Typography.Size.sm))
    .tabular()
    .lineLimit(1)
    .frame(minHeight: 22)
    .animation(Motion.fast, value: selected)
  }

  private func readoutItem<Value: View>(color: Color, name: String, @ViewBuilder value: () -> Value) -> some View {
    HStack(spacing: 6) {
      Capsule().fill(color).frame(width: 10, height: 3)
      Text(name).foregroundStyle(Palette.inkMuted).lineLimit(1).truncationMode(.tail).frame(maxWidth: 140, alignment: .leading).fixedSize()
      value()
    }
    .accessibilityElement(children: .combine)
  }

  private var accessibilitySummary: String {
    let label = months.last.map(HabitDates.monthLabel) ?? ""
    return "\(range)-month trend of habit completion, mood, and focus ending \(label)"
  }
}

/// Fixed-width y labels so the two plots share one plot width and their months line up.
private let trendAxisWidth: CGFloat = 36

private func trendAxisLabel(_ text: String) -> some View {
  Text(text).font(.ui(Typography.Size.xs)).foregroundStyle(Palette.inkMuted).tabular()
    .frame(width: trendAxisWidth, alignment: .trailing)
}

/// Habit completion per month: an area under a smoothed line, broken where a month has no tracked days.
private struct HabitCompletionPane: View {
  let points: [HabitTrendPoint]
  let months: [String]
  @Binding var selected: String?

  var body: some View {
    let fill = LinearGradient(colors: [Palette.completion.opacity(0.22), Palette.completion.opacity(0.02)], startPoint: .top, endPoint: .bottom)
    Chart {
      ForEach(points) { point in
        AreaMark(
          x: .value("Month", point.month.month), yStart: .value("Floor", 0), yEnd: .value("Completed", point.rate),
          series: .value("Run", point.run)
        )
        .interpolationMethod(.monotone)
        .foregroundStyle(fill)
        LineMark(x: .value("Month", point.month.month), y: .value("Completed", point.rate), series: .value("Run", point.run))
          .interpolationMethod(.monotone)
          .foregroundStyle(Palette.completion)
          .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
        PointMark(x: .value("Month", point.month.month), y: .value("Completed", point.rate))
          .symbol { TrendDot(color: Palette.completion, emphasized: point.month.month == selected) }
      }
      if let selected {
        RuleMark(x: .value("Month", selected)).foregroundStyle(Palette.hairlineStrong).lineStyle(StrokeStyle(lineWidth: 1))
      }
    }
    .chartXScale(domain: months)
    .chartYScale(domain: 0...100, range: .plotDimension(startPadding: 0, endPadding: 6))
    .chartXSelection(value: $selected)
    .chartXAxis {
      AxisMarks(values: months) { _ in
        AxisGridLine(stroke: StrokeStyle(lineWidth: 1)).foregroundStyle(Palette.hairline.opacity(0.6))
      }
    }
    .chartYAxis {
      AxisMarks(position: .leading, values: [0, 50, 100]) { value in
        AxisGridLine(stroke: StrokeStyle(lineWidth: 1, dash: [2, 4])).foregroundStyle(Palette.hairline)
        AxisValueLabel {
          if let number = value.as(Int.self) { trendAxisLabel("\(number)%") }
        }
      }
    }
    .animation(Motion.base, value: points.map(\.rate))
  }
}

/// Mood and focus monthly averages on the 1 to 5 scale. A month without ratings leaves a gap the line bridges.
private struct MoodFocusPane: View {
  let points: [MoodFocusTrendPoint]
  let months: [String]
  @Binding var selected: String?

  private struct Sample: Identifiable {
    let month: String
    let series: String
    let value: Double
    var id: String { month + series }
  }

  var body: some View {
    let samples = points.flatMap { point -> [Sample] in
      var list: [Sample] = []
      if let mood = point.mood { list.append(Sample(month: point.month, series: "Mood", value: mood)) }
      if let focus = point.focus { list.append(Sample(month: point.month, series: "Focus", value: focus)) }
      return list
    }
    Chart {
      ForEach(samples) { sample in
        let color = sample.series == "Mood" ? MoodFocusSeries.mood : MoodFocusSeries.focus
        LineMark(x: .value("Month", sample.month), y: .value("Average", sample.value), series: .value("Signal", sample.series))
          .foregroundStyle(color)
          .interpolationMethod(.monotone)
          .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
        PointMark(x: .value("Month", sample.month), y: .value("Average", sample.value))
          .symbol { TrendDot(color: color, emphasized: sample.month == selected, square: sample.series == "Mood") }
      }
      if let selected {
        RuleMark(x: .value("Month", selected)).foregroundStyle(Palette.hairlineStrong).lineStyle(StrokeStyle(lineWidth: 1))
      }
    }
    .chartXScale(domain: months)
    .chartYScale(domain: 1...5, range: .plotDimension(startPadding: 0, endPadding: 6))
    .chartXSelection(value: $selected)
    .chartXAxis {
      AxisMarks(values: months) { value in
        AxisGridLine(stroke: StrokeStyle(lineWidth: 1)).foregroundStyle(Palette.hairline.opacity(0.6))
        AxisValueLabel {
          if let month = value.as(String.self) {
            Text(HabitDates.shortMonthLabel(month)).font(.ui(Typography.Size.xs, weight: month == selected ? .semibold : .regular))
              .foregroundStyle(month == selected ? Palette.ink : Palette.inkMuted)
          }
        }
      }
    }
    .chartYAxis {
      AxisMarks(position: .leading, values: [1, 3, 5]) { value in
        AxisGridLine(stroke: StrokeStyle(lineWidth: 1, dash: [2, 4])).foregroundStyle(Palette.hairline)
        AxisValueLabel {
          if let level = value.as(Int.self) { trendAxisLabel("\(level)") }
        }
      }
    }
  }
}

/// A trend point: hollow, a little larger on the hovered month. Mood points are square, as in the calendar.
private struct TrendDot: View {
  let color: Color
  let emphasized: Bool
  var square = false

  var body: some View {
    let size: CGFloat = emphasized ? 9 : 6
    Group {
      if square {
        RoundedRectangle(cornerRadius: 1.5, style: .continuous).fill(Palette.surfaceCanvas)
          .overlay(RoundedRectangle(cornerRadius: 1.5, style: .continuous).strokeBorder(color, lineWidth: emphasized ? 2 : 1.5))
      } else {
        Circle().fill(Palette.surfaceCanvas).overlay(Circle().strokeBorder(color, lineWidth: emphasized ? 2 : 1.5))
      }
    }
    .frame(width: size, height: size)
  }
}
