import ManorKit
import SwiftUI

extension JobFlowStage {
  /// The node and ribbon color of a stage.
  var tone: Color {
    switch self {
    case .applied, .noResponse: return Palette.scaleResting
    case .responded, .offer: return Palette.completion
    case .oa: return Palette.chartOa
    case .interview1, .interview2, .interview3: return Palette.thisWeekPlum
    case .rejected: return Palette.overdueError
    }
  }
}

/// The Sankey of every tracked application: Applied splits into No response yet and Responded, then
/// responded roles flow through the stages they reached. Ribbon widths are role counts.
struct JobsFlowView: View {
  let data: JobFlowData
  @State private var hover: (target: JobFlowLayout.HitTarget, point: CGPoint)?
  /// Holds the laid-out chart so hovering never recomputes it; it rebuilds only for new data or a new size.
  @State private var cache = FlowLayoutCache()

  var body: some View {
    VStack(alignment: .leading, spacing: Space.s4) {
      header
      if data.isEmpty {
        VStack(spacing: Space.s1) {
          Text("No applications yet").font(.ui(Typography.Size.body, weight: .medium)).foregroundStyle(Palette.inkBody)
          Text("Move a role to Applied to see where your applications go.")
            .font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, minHeight: 160)
        .background(
          RoundedRectangle(cornerRadius: Radius.card, style: .continuous)
            .strokeBorder(Palette.hairlineStrong, style: StrokeStyle(lineWidth: 1, dash: [5, 4]))
        )
      } else {
        GeometryReader { proxy in
          let layout = cache.layout(for: data, size: proxy.size)
          chart(layout)
            .overlay(alignment: .topLeading) { tooltip(in: proxy.size) }
            .onContinuousHover { phase in
              switch phase {
              case .active(let point): hover = layout.hit(point).map { ($0, point) }
              case .ended: hover = nil
              }
            }
        }
        .frame(height: chartHeight)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Application stage flow")
        .accessibilityValue("\(data.applicationTotal). " + data.links.map(\.summary).joined(separator: ". "))
        .accessibilityChildren {
          ForEach(data.links) { link in
            Text(link.summary)
          }
        }
      }
    }
  }

  /// The section title with the application total, and a legend of the stage colors the chart uses.
  private var header: some View {
    ViewThatFits(in: .horizontal) {
      HStack(alignment: .firstTextBaseline, spacing: Space.s4) {
        title
        Spacer(minLength: Space.s4)
        legend
      }
      VStack(alignment: .leading, spacing: Space.s2) {
        title
        legend
      }
    }
  }

  private var title: some View {
    HStack(alignment: .firstTextBaseline, spacing: Space.s2) {
      Text("Flow").font(.display(Typography.Size.lg)).foregroundStyle(Palette.ink)
      if !data.isEmpty {
        Text(data.applicationTotal).font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted).tabular()
      }
    }
    .fixedSize()
  }

  private static let legendEntries: [(label: String, stage: JobFlowStage)] = [
    ("Waiting", .noResponse), ("Responded", .responded), ("OA", .oa), ("Interviews", .interview1), ("Rejected", .rejected),
  ]

  private var legend: some View {
    HStack(spacing: Space.s3) {
      ForEach(Self.legendEntries, id: \.label) { entry in
        HStack(spacing: 6) {
          RoundedRectangle(cornerRadius: 2, style: .continuous).fill(entry.stage.tone).frame(width: 8, height: 8)
          Text(entry.label).font(.ui(Typography.Size.xs)).foregroundStyle(Palette.inkMuted)
        }
      }
    }
    .fixedSize()
    .opacity(data.isEmpty ? 0 : 1)
    .accessibilityHidden(true)
  }

  private var chartHeight: CGFloat { max(220, min(560, CGFloat(data.appliedCount) * 22 + 120)) }

  private func isHighlighted(_ link: JobFlowLink) -> Bool? {
    guard let hover else { return nil }
    switch hover.target {
    case .ribbon(let ribbon): return ribbon.link == link
    case .node(let node): return link.source == node.stage || link.target == node.stage
    }
  }

  private func chart(_ layout: JobFlowLayout) -> some View {
    Canvas { context, _ in
      for ribbon in layout.ribbons {
        let path = Path(JobFlowLayout.path(for: ribbon))
        let emphasis = isHighlighted(ribbon.link)
        let opacity = emphasis == nil ? 0.28 : (emphasis! ? 0.5 : 0.12)
        context.fill(path, with: .color(ribbon.link.target.tone.opacity(opacity)))
      }
      for node in layout.nodes {
        context.fill(Path(roundedRect: node.rect, cornerRadius: 3), with: .color(node.stage.tone))
      }
    }
    .overlay { labels(layout) }
  }

  /// Node names and counts beside each bar. The first column reads to its left, in the chart's margin; nodes near
  /// the right edge also read leftward. A canvas-colored plate keeps a label legible where it crosses a ribbon.
  private func labels(_ layout: JobFlowLayout) -> some View {
    let firstX = layout.nodes.map(\.rect.minX).min() ?? 0
    return ZStack(alignment: .topLeading) {
      ForEach(layout.nodes) { node in
        let leading = node.rect.minX <= firstX + 1 || node.rect.maxX + 120 > layout.size.width
        VStack(alignment: leading ? .trailing : .leading, spacing: 1) {
          Text(node.stage.label).font(.ui(Typography.Size.xs, weight: .semibold)).foregroundStyle(Palette.ink)
          Text("\(node.value) \(node.stage.unit(node.value))").font(.ui(Typography.Size.xs)).foregroundStyle(Palette.inkMuted).tabular()
        }
        .multilineTextAlignment(leading ? .trailing : .leading)
        .padding(.horizontal, Space.s1)
        .padding(.vertical, 2)
        .background(RoundedRectangle(cornerRadius: Radius.chip, style: .continuous).fill(Palette.surfaceCanvas.opacity(0.88)))
        .fixedSize()
        .frame(width: 200, alignment: leading ? .trailing : .leading)
        .position(x: leading ? node.rect.minX - 4 - 100 : node.rect.maxX + 4 + 100, y: node.rect.midY)
        .allowsHitTesting(false)
      }
    }
    .frame(width: layout.size.width, height: layout.size.height, alignment: .topLeading)
  }

  @ViewBuilder
  private func tooltip(in size: CGSize) -> some View {
    if let hover {
      let text: String = {
        switch hover.target {
        case .ribbon(let ribbon): return ribbon.link.summary
        case .node(let node): return "\(node.stage.label): \(node.value) \(node.stage.unit(node.value))"
        }
      }()
      let width: CGFloat = 240
      let x = min(max(0, hover.point.x + 14), max(0, size.width - width))
      let y = min(max(0, hover.point.y + 14), max(0, size.height - 36))
      Text(text)
        .font(.ui(Typography.Size.xs, weight: .medium))
        .foregroundStyle(Palette.inkBody)
        .tabular()
        .padding(.horizontal, Space.s2 + 2)
        .padding(.vertical, 6)
        .background(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).fill(Palette.surfaceCard))
        .overlay(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).strokeBorder(Palette.hairline))
        .shadow(color: .black.opacity(0.1), radius: 8, y: 3)
        .fixedSize()
        .offset(x: x, y: y)
        .allowsHitTesting(false)
        .transition(.opacity)
    }
  }
}

/// The last flow layout, keyed by its data and size. A reference type, so reading it never invalidates the view.
final class FlowLayoutCache {
  private var key: (data: JobFlowData, size: CGSize)?
  private var value: JobFlowLayout?

  func layout(for data: JobFlowData, size: CGSize) -> JobFlowLayout {
    if let key, let value, key.size == size, key.data == data { return value }
    let layout = JobFlowLayout(data: data, size: size, horizontalInset: min(132, max(108, size.width * 0.11)))
    key = (data, size)
    value = layout
    return layout
  }
}
