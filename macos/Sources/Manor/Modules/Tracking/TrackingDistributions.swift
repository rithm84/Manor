import ManorKit
import SwiftUI

/// The month's mood and focus, one block each: the level most days landed on (or Mixed on a tie), the month as a single bar split by
/// level, and each level's days and share. Rest days sit apart from focus's rated levels and never count toward
/// its shares, so a rest day never reads as a low score.
struct TrackingDistributions: View {
  let moods: [MoodFocusDistributionRow<Mood>]
  let focuses: [MoodFocusDistributionRow<Focus>]

  var body: some View {
    VStack(alignment: .leading, spacing: Space.s3) {
      HistorySectionHead(title: "Mood and focus", subtitle: "How the month's days were rated.")
      VStack(alignment: .leading, spacing: 0) {
        RatingMix(
          title: "Mood",
          levels: moods.map { RatingLevel(name: $0.level.rawValue, count: $0.count, tone: $0.level.tone, shape: .square, glyph: .mood($0.level)) },
          restDays: nil
        )
        Hairline().padding(.vertical, Space.s5)
        RatingMix(
          title: "Focus",
          levels: focuses.filter { !$0.level.isRest }.map {
            RatingLevel(name: $0.level.rawValue, count: $0.count, tone: $0.level.tone, shape: .circle, glyph: .focus($0.level))
          },
          restDays: focuses.first { $0.level.isRest }?.count ?? 0
        )
      }
      .padding(.top, Space.s1)
    }
  }
}

private struct RatingLevel: Identifiable {
  let name: String
  let count: Int
  let tone: MoodFocusTone
  let shape: MoodFocusSwatch.Shape
  let glyph: CheckInGlyph.Value
  var id: String { name }
}

/// One signal's month: a headline naming the most common level, the month as one segmented bar, and the levels.
private struct RatingMix: View {
  let title: String
  /// Rated levels, best first.
  let levels: [RatingLevel]
  /// Focus only: days logged as rest.
  let restDays: Int?

  var body: some View {
    let rated = levels.reduce(0) { $0 + $1.count }
    // The most common level, only when one level leads outright; a tie reads as mixed.
    let most = levels.map(\.count).max() ?? 0
    let leaders = levels.filter { $0.count == most && most > 0 }
    let top = leaders.count == 1 ? leaders.first : nil
    VStack(alignment: .leading, spacing: Space.s3) {
      HStack(spacing: Space.s3) {
        if top == nil, leaders.count > 1 {
          MixedGlyph(colors: leaders.map(\.tone.strong)).frame(width: 30, height: 30)
        } else {
          CheckInGlyph(value: top?.glyph ?? (title == "Mood" ? .mood(nil) : .focus(nil)), size: 30)
        }
        VStack(alignment: .leading, spacing: 1) {
          Text(title).font(.ui(Typography.Size.xs, weight: .semibold)).foregroundStyle(Palette.inkMuted)
          Text(top.map { "Mostly \($0.name)" } ?? (rated == 0 ? "No ratings yet" : "Mixed"))
            .font(.ui(Typography.Size.body, weight: .semibold))
            .foregroundStyle(top?.tone.strong ?? (rated == 0 ? Palette.inkMuted : Palette.ink))
            .lineLimit(1)
        }
        Spacer(minLength: Space.s2)
        Text(rated == 1 ? "1 day" : "\(rated) days")
          .font(.ui(Typography.Size.xs, weight: .medium)).foregroundStyle(Palette.inkMuted).tabular()
      }
      .accessibilityElement(children: .combine)

      RatingBar(levels: levels, total: rated)
        .frame(height: 10)
        .accessibilityHidden(true)

      VStack(alignment: .leading, spacing: 5) {
        ForEach(levels) { level in
          row(level, total: rated)
        }
        if let restDays {
          HStack(spacing: Space.s2) {
            MoodFocusSwatch(shape: .circle, color: Focus.resting.tone.strong, resting: true, size: 8)
            Text("Rest days").font(.ui(Typography.Size.sm)).foregroundStyle(restDays > 0 ? Palette.inkBody : Palette.inkMuted)
            Spacer(minLength: Space.s2)
            Text("\(restDays)").font(.ui(Typography.Size.sm, weight: .medium))
              .foregroundStyle(restDays > 0 ? Palette.ink : Palette.inkMuted).tabular()
            Color.clear.frame(width: 38, height: 1)
          }
          .padding(.top, Space.s1)
          .accessibilityElement(children: .ignore)
          .accessibilityLabel("Rest days: \(restDays)")
        }
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private func row(_ level: RatingLevel, total: Int) -> some View {
    let share = total == 0 ? 0 : Int((Double(level.count) / Double(total) * 100).rounded())
    let any = level.count > 0
    return HStack(spacing: Space.s2) {
      MoodFocusSwatch(shape: level.shape, color: any ? level.tone.strong : Palette.surfaceStrong, size: 8)
      Text(level.name)
        .font(.ui(Typography.Size.sm, weight: any ? .medium : .regular))
        .foregroundStyle(any ? Palette.inkBody : Palette.inkMuted)
        .lineLimit(1)
      Spacer(minLength: Space.s2)
      Text("\(level.count)")
        .font(.ui(Typography.Size.sm, weight: .medium))
        .foregroundStyle(any ? Palette.ink : Palette.inkMuted)
        .tabular()
      Text(any ? "\(share)%" : "")
        .font(.ui(Typography.Size.xs))
        .foregroundStyle(Palette.inkMuted)
        .tabular()
        .frame(width: 38, alignment: .trailing)
    }
    .animation(Motion.base, value: level.count)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("\(level.name): \(level.count) \(level.count == 1 ? "day" : "days")\(any ? ", \(share) percent" : "")")
  }
}

/// The month as one bar: a segment per rated level, sized by its days, in the level's color. An empty track
/// while nothing is rated.
private struct RatingBar: View {
  let levels: [RatingLevel]
  let total: Int

  var body: some View {
    GeometryReader { proxy in
      let shown = levels.filter { $0.count > 0 }
      let gap: CGFloat = 2
      let available = max(0, proxy.size.width - gap * CGFloat(max(0, shown.count - 1)))
      HStack(spacing: gap) {
        if shown.isEmpty {
          Capsule().fill(Palette.surfaceSoft)
        } else {
          ForEach(shown) { level in
            Rectangle()
              .fill(level.tone.strong)
              .frame(width: available * CGFloat(level.count) / CGFloat(max(total, 1)))
          }
        }
      }
      .clipShape(Capsule())
    }
    .animation(Motion.base, value: levels.map(\.count))
  }
}

/// A tie between levels: the circle split evenly among the tied levels' colors.
private struct MixedGlyph: View {
  let colors: [Color]

  var body: some View {
    Canvas { context, size in
      let center = CGPoint(x: size.width / 2, y: size.height / 2)
      let radius = min(size.width, size.height) / 2
      let step = 360.0 / Double(max(colors.count, 1))
      for (index, color) in colors.enumerated() {
        var slice = Path()
        slice.move(to: center)
        slice.addArc(center: center, radius: radius, startAngle: .degrees(-90 + step * Double(index)),
                     endAngle: .degrees(-90 + step * Double(index + 1)), clockwise: false)
        slice.closeSubpath()
        context.fill(slice, with: .color(color.opacity(0.85)))
        // A hairline gap between slices.
        context.stroke(slice, with: .color(Palette.surfaceCanvas), lineWidth: 1.5)
      }
    }
    .accessibilityHidden(true)
  }
}
