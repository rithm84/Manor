import ManorKit
import SwiftUI

/// The month as a Monday-first grid of days. Each day names its mood and focus beside toned swatches, the
/// mood tint fills the cell, and a bar along the bottom fills with the habits done that day. Any day up to
/// today opens its editor.
struct TrackingCalendar: View {
  let grid: MoodFocusMonthGrid
  let totals: [HabitDayTotal]
  let onOpen: (String) -> Void

  private let columns = Array(repeating: GridItem(.flexible(minimum: 40), spacing: Space.s1), count: 7)
  private static let weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

  var body: some View {
    let byDate = Dictionary(totals.map { ($0.date, $0) }, uniquingKeysWith: { first, _ in first })
    VStack(spacing: Space.s1) {
      LazyVGrid(columns: columns, spacing: Space.s1) {
        ForEach(Self.weekdays, id: \.self) { day in
          Text(day).font(.ui(Typography.Size.xs, weight: .medium)).foregroundStyle(Palette.inkMuted)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.leading, Space.s2)
        }
      }
      .accessibilityHidden(true)
      LazyVGrid(columns: columns, spacing: Space.s1) {
        ForEach(0..<grid.leadBlanks, id: \.self) { _ in Color.clear.frame(height: 1) }
        ForEach(grid.cells) { cell in
          TrackingDayCell(cell: cell, total: byDate[cell.date]) { onOpen(cell.date) }
        }
      }
    }
    .frame(maxWidth: .infinity)
  }
}

private struct TrackingDayCell: View {
  let cell: MoodFocusDayCell
  let total: HabitDayTotal?
  let action: () -> Void
  @State private var hovering = false
  @State private var width: CGFloat = 120

  private var entry: MoodFocusEntry? { cell.entry }
  private var shape: RoundedRectangle { RoundedRectangle(cornerRadius: Radius.control, style: .continuous) }

  var body: some View {
    Button(action: action) {
      VStack(alignment: .leading, spacing: 0) {
        dayNumber
        Spacer(minLength: Space.s1)
        if let entry {
          VStack(alignment: .leading, spacing: 3) {
            signal(level: entry.mood?.rawValue, color: entry.mood?.tone.strong, shape: .square, resting: false)
            signal(level: entry.focus?.rawValue, color: entry.focus?.tone.strong, shape: .circle, resting: entry.focus == .resting)
          }
        }
        habitBar.padding(.top, Space.s2)
      }
      .padding(.horizontal, Space.s2)
      .padding(.top, 6)
      .padding(.bottom, Space.s2)
      .frame(maxWidth: .infinity, minHeight: 78, alignment: .topLeading)
      .background(shape.fill(fill))
      .overlay(shape.strokeBorder(border, lineWidth: 1))
      .contentShape(shape)
    }
    .buttonStyle(HabitPressStyle(scale: 0.97))
    .disabled(cell.future)
    .onHover { hovering = $0 && !cell.future }
    .animation(Motion.fast, value: hovering)
    .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
    .help(cell.future ? "" : "Open \(HabitDates.fullDateLabel(cell.date))")
    .accessibilityLabel(accessibilityText)
  }

  private var dayNumber: some View {
    Text("\(cell.day)")
      .font(.ui(Typography.Size.xs, weight: cell.today ? .bold : .medium))
      .tabular()
      .foregroundStyle(cell.today ? Palette.onPrimary : (cell.future ? Palette.inkMuted.opacity(0.6) : (entry == nil ? Palette.inkMuted : Palette.ink)))
      .frame(minWidth: 20, minHeight: 20)
      .background { if cell.today { Circle().fill(Palette.primary) } }
  }

  private func signal(level: String?, color: Color?, shape: MoodFocusSwatch.Shape, resting: Bool) -> some View {
    HStack(spacing: 5) {
      MoodFocusSwatch(shape: shape, color: color, resting: resting, size: 7)
      Text(level ?? "Not logged")
        .font(.ui(Typography.Size.xs, weight: level == nil ? .regular : .medium))
        .foregroundStyle(level == nil ? Palette.inkMuted : Palette.ink)
        .lineLimit(1)
        .truncationMode(.tail)
    }
  }

  /// Habits done that day, full when every active habit was.
  @ViewBuilder
  private var habitBar: some View {
    if let total, total.active > 0, !cell.future {
      let fraction = CGFloat(total.completed) / CGFloat(total.active)
      Capsule()
        .fill(Palette.ink.opacity(0.08))
        .overlay(alignment: .leading) {
          GeometryReader { proxy in
            Capsule().fill(Palette.completion).frame(width: max(fraction > 0 ? 4 : 0, proxy.size.width * fraction))
          }
        }
        .frame(height: 4)
        .clipShape(Capsule())
    } else {
      Color.clear.frame(height: 4)
    }
  }

  private var fill: Color {
    if cell.future { return .clear }
    if let mood = entry?.mood { return mood.tone.tint }
    if entry != nil { return Palette.surfaceSoft }
    return hovering ? Palette.surfaceSoft : Palette.surfacePaper
  }

  private var border: Color {
    if cell.future { return .clear }
    if hovering { return entry?.mood?.tone.strong.opacity(0.6) ?? Palette.hairlineStrong }
    return .clear
  }

  private var accessibilityText: String {
    let date = HabitDates.fullDateLabel(cell.date)
    var parts = [date]
    if let entry {
      parts.append("Mood \(entry.mood?.rawValue ?? "not logged"). Focus \(entry.focus?.rawValue ?? "not logged").")
    } else if !cell.future {
      parts.append("No check-in.")
    }
    if let total, total.active > 0, !cell.future {
      parts.append(total.perfect ? "Perfect day." : "\(total.completed) of \(total.active) habits done.")
    }
    return parts.joined(separator: " ")
  }
}

// MARK: Distributions

/// The month's mix of mood and focus levels, highest first with Resting set apart.
struct TrackingDistributions: View {
  let moods: [MoodFocusDistributionRow<Mood>]
  let focuses: [MoodFocusDistributionRow<Focus>]

  var body: some View {
    VStack(alignment: .leading, spacing: Space.s3) {
      HistorySectionHead(title: "Mood and focus", subtitle: "How the month's days were rated.")
      VStack(alignment: .leading, spacing: Space.s5) {
        DistributionBlock(title: "Mood", rows: moods.map {
          DistributionLine(level: $0.level.rawValue, count: $0.count, share: $0.share, tone: $0.level.tone, round: false, resting: false)
        })
        DistributionBlock(title: "Focus", rows: focuses.map {
          DistributionLine(level: $0.level.rawValue, count: $0.count, share: $0.share, tone: $0.level.tone, round: true, resting: $0.level == .resting)
        })
      }
      .padding(.top, Space.s1)
    }
  }
}

private struct DistributionLine: Identifiable {
  let level: String
  let count: Int
  let share: Double
  let tone: MoodFocusTone
  let round: Bool
  let resting: Bool
  var id: String { level }
}

private struct DistributionBlock: View {
  let title: String
  let rows: [DistributionLine]

  var body: some View {
    let total = rows.reduce(0) { $0 + $1.count }
    VStack(alignment: .leading, spacing: 6) {
      HStack {
        Text(title).font(.ui(Typography.Size.xs, weight: .semibold)).foregroundStyle(Palette.inkMuted)
        Spacer()
        Text(total == 0 ? "No ratings" : "\(total) \(total == 1 ? "day" : "days")")
          .font(.ui(Typography.Size.xs)).foregroundStyle(Palette.inkMuted).tabular()
      }
      .padding(.bottom, 2)
      ForEach(rows) { row in
        VStack(spacing: 0) {
          if row.resting {
            Rectangle().fill(Palette.hairline).frame(height: 1).padding(.vertical, 4)
          }
          HStack(spacing: Space.s2) {
            MoodFocusSwatch(shape: row.round ? .circle : .square, color: row.tone.strong, resting: row.resting, size: 8)
            Text(row.level).font(.ui(Typography.Size.xs, weight: row.count > 0 ? .medium : .regular))
              .foregroundStyle(row.count > 0 ? Palette.inkBody : Palette.inkMuted)
              .lineLimit(1).frame(width: 70, alignment: .leading)
            GeometryReader { proxy in
              ZStack(alignment: .leading) {
                Capsule().fill(Palette.surfaceSoft)
                Capsule().fill(row.tone.strong).frame(width: row.count == 0 ? 0 : max(6, proxy.size.width * row.share))
              }
            }
            .frame(height: 6)
            Text("\(row.count)").font(.ui(Typography.Size.xs, weight: .medium))
              .foregroundStyle(row.count > 0 ? Palette.inkBody : Palette.inkMuted.opacity(0.7)).tabular()
              .frame(width: 18, alignment: .trailing)
          }
          .animation(Motion.base, value: row.share)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(row.level): \(row.count) \(row.count == 1 ? "day" : "days")")
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}
