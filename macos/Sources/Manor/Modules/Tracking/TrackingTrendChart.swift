import Charts
import ManorKit
import SwiftUI

/// Monthly trends as two charts under one range control: habit completion, and mood and focus. Each chart has its
/// own readout (the hovered month's values, or the last month's) and its own hover, so neither crowds the other.
/// Side by side when there's room, stacked otherwise.
struct TrackingTrendSection: View {
  let habits: HabitsHistoryData?
  let mood: MoodFocusMonthData?
  @Binding var range: Int
  @Binding var pickedHabitId: String?
  let habitOptions: [(id: String, name: String)]
  /// Room for the two charts side by side.
  var wide = true

  private var months: [String] {
    habits?.trend.map(\.month) ?? mood?.trend.map(\.month) ?? []
  }

  var body: some View {
    VStack(alignment: .leading, spacing: Space.s4) {
      HStack(alignment: .lastTextBaseline, spacing: Space.s4) {
        HistorySectionHead(title: "Trends", subtitle: "How each month went.")
        Spacer(minLength: Space.s3)
        HistoryRangeTabs(range: $range)
      }
      if wide {
        HStack(alignment: .top, spacing: Space.s6) {
          habitTrend.frame(maxWidth: .infinity)
          Rectangle().fill(Palette.hairline).frame(width: 1).padding(.vertical, Space.s1)
          moodTrend.frame(maxWidth: .infinity)
        }
      } else {
        VStack(alignment: .leading, spacing: Space.s6) {
          habitTrend
          moodTrend
        }
      }
    }
  }

  private var habitTrend: some View {
    HabitTrendChart(habits: habits, months: months, range: range, pickedHabitId: $pickedHabitId, habitOptions: habitOptions)
  }

  private var moodTrend: some View {
    MoodFocusTrendChart(points: mood?.trend ?? [], months: months, range: range)
  }
}

/// The month a chart reads out: the hovered one, or the last in range.
private func readoutMonth(_ selected: String?, _ months: [String]) -> String {
  selected ?? months.last ?? ""
}

/// A chart's title row: its name and, on the right, its control or legend.
private struct TrendChartHead<Trailing: View>: View {
  let title: String
  @ViewBuilder let trailing: () -> Trailing

  var body: some View {
    HStack(alignment: .center, spacing: Space.s3) {
      Text(title).font(.ui(Typography.Size.body, weight: .semibold)).foregroundStyle(Palette.ink)
        .accessibilityAddTraits(.isHeader)
      Spacer(minLength: Space.s2)
      trailing()
    }
    .frame(minHeight: 28)
  }
}

/// The readout under a chart's title: the month, then each value.
private struct TrendReadout<Values: View>: View {
  let month: String
  @ViewBuilder let values: () -> Values

  var body: some View {
    HStack(spacing: Space.s4) {
      Text(month.isEmpty ? " " : HabitDates.monthLabel(month))
        .font(.ui(Typography.Size.sm, weight: .medium)).foregroundStyle(Palette.inkMuted)
        .contentTransition(.opacity)
      values()
      Spacer(minLength: 0)
    }
    .font(.ui(Typography.Size.sm))
    .tabular()
    .lineLimit(1)
    .frame(minHeight: 20)
  }
}

private let trendChartHeight: CGFloat = 168

/// Habit completion: which habits (all, or one) and how much of each month's tracked days they were done.
private struct HabitTrendChart: View {
  let habits: HabitsHistoryData?
  let months: [String]
  let range: Int
  @Binding var pickedHabitId: String?
  let habitOptions: [(id: String, name: String)]
  @State private var selected: String?

  var body: some View {
    let month = readoutMonth(selected, months)
    let value = habits?.trend.first { $0.month == month }
    VStack(alignment: .leading, spacing: Space.s2) {
      TrendChartHead(title: "Habit completion") {
        if !habitOptions.isEmpty {
          ManorSelect("Habits in the trend", selection: Binding(get: { habits?.trendHabitId }, set: { pickedHabitId = $0 }),
                      options: habitOptions.map { ManorSelectOption($0.id, $0.name) }, noneLabel: "All habits", style: .toolbar)
            .frame(maxWidth: 200)
            .fixedSize()
        }
      }
      TrendReadout(month: month) {
        if let rate = value?.completionRate {
          Text("\(rate)%").font(.ui(Typography.Size.sm, weight: .semibold)).foregroundStyle(Palette.ink)
          Text("\(value?.completedDays ?? 0) of \(value?.trackedDays ?? 0) days").foregroundStyle(Palette.inkMuted)
        } else {
          Text("No tracked days").foregroundStyle(Palette.inkMuted)
        }
      }
      .animation(Motion.fast, value: selected)
      HabitCompletionPane(points: habits?.trendPoints ?? [], months: months, selected: $selected)
        .frame(height: trendChartHeight)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(range)-month trend of \(habits?.trendHabitName ?? "habit") completion ending \(months.last.map(HabitDates.monthLabel) ?? "")")
    }
  }
}

/// Mood and focus: each month's average on the 1 to 5 scale, as two lines.
private struct MoodFocusTrendChart: View {
  let points: [MoodFocusTrendPoint]
  let months: [String]
  let range: Int
  @State private var selected: String?

  var body: some View {
    let month = readoutMonth(selected, months)
    let point = points.first { $0.month == month }
    VStack(alignment: .leading, spacing: Space.s2) {
      TrendChartHead(title: "Mood and focus") { EmptyView() }
      TrendReadout(month: month) {
        signal(name: "Mood", square: true, color: MoodFocusSeries.mood, value: point?.mood,
               word: MoodFocusHistory.moodLabel(average: point?.mood)?.rawValue)
        signal(name: "Focus", square: false, color: MoodFocusSeries.focus, value: point?.focus,
               word: MoodFocusHistory.focusLabel(average: point?.focus)?.rawValue)
      }
      .animation(Motion.fast, value: selected)
      MoodFocusPane(points: points, months: months, selected: $selected)
        .frame(height: trendChartHeight)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(range)-month trend of mood and focus ending \(months.last.map(HabitDates.monthLabel) ?? "")")
    }
  }

  /// The series key and its value, so the readout doubles as the legend.
  private func signal(name: String, square: Bool, color: Color, value: Double?, word: String?) -> some View {
    HStack(spacing: 6) {
      MoodFocusSwatch(shape: square ? .square : .circle, color: color)
      Text(name).foregroundStyle(Palette.inkMuted)
      if let value, let word {
        Text(word).font(.ui(Typography.Size.sm, weight: .semibold)).foregroundStyle(Palette.ink)
        Text(String(format: "%.1f", value)).foregroundStyle(Palette.inkMuted)
      } else {
        Text("No ratings").foregroundStyle(Palette.inkMuted)
      }
    }
    .accessibilityElement(children: .combine)
  }
}

/// A month on a chart's axis, emphasized while hovered.
@ViewBuilder
private func trendMonthLabel(_ month: String?, selected: String?) -> some View {
  if let month {
    Text(HabitDates.shortMonthLabel(month)).font(.ui(Typography.Size.xs, weight: month == selected ? .semibold : .regular))
      .foregroundStyle(month == selected ? Palette.ink : Palette.inkMuted)
  }
}

/// Fixed-width y labels so the axis doesn't shift as values change.
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
      AxisMarks(values: months) { value in
        AxisGridLine(stroke: StrokeStyle(lineWidth: 1)).foregroundStyle(Palette.hairline.opacity(0.6))
        AxisValueLabel { trendMonthLabel(value.as(String.self), selected: selected) }
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
        AxisValueLabel { trendMonthLabel(value.as(String.self), selected: selected) }
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
