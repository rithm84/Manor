import ManorKit
import Observation
import SwiftUI

/// The coordinate space every Home drag measures in.
let homeSpace = "home"

/// Where a dragged task card can land.
enum HomeDropTarget: Equatable {
  case bucket(TaskBucket)
  case timeline(date: String)
}

/// The block a task would make on the timeline at the pointer, or why it cannot.
struct TaskTimelineDropPreview: Equatable {
  var start: Int?
  var end: Int?
  var title: String
  var error: String?
}

/// A task card being dragged across the board or onto the timeline. Cards lift under the pointer, columns and
/// the timeline report their frames, and the drop settles into its target or springs back home.
@MainActor
@Observable
final class HomeDrag {
  enum Phase: Equatable { case dragging, landing, returning }

  struct Active: Equatable {
    var task: TaskItem
    var source: TaskBucket?
    var origin: CGRect
    var grab: CGSize
    var location: CGPoint
    var phase: Phase
  }

  private(set) var active: Active?
  private(set) var target: HomeDropTarget?
  private(set) var preview: TaskTimelineDropPreview?

  @ObservationIgnored var columnFrames: [TaskBucket: CGRect] = [:]
  /// The scroll viewport of the timeline and the frame of its 6 AM to midnight axis.
  @ObservationIgnored var timelineViewport: CGRect = .zero
  @ObservationIgnored var timelineAxis: CGRect = .zero
  @ObservationIgnored var timelineDate = ""
  @ObservationIgnored var hourHeight: CGFloat = 44
  @ObservationIgnored var busy: (String) -> [ClosedRange<Int>] = { _ in [] }

  var isDragging: Bool { active?.phase == .dragging }
  func isLifted(_ id: String) -> Bool { active?.task.id == id }

  func begin(_ task: TaskItem, source: TaskBucket?, frame: CGRect, at start: CGPoint) {
    guard active == nil || active?.phase != .dragging else { return }
    active = Active(task: task, source: source, origin: frame, grab: CGSize(width: start.x - frame.minX, height: start.y - frame.minY), location: start, phase: .dragging)
    target = nil
    preview = nil
  }

  func move(to location: CGPoint) {
    guard var drag = active, drag.phase == .dragging else { return }
    drag.location = location
    active = drag
    let hit = hitTest(location)
    if hit != target { target = hit }
    if case .timeline = hit { preview = timelinePreview(for: drag) } else if preview != nil { preview = nil }
  }

  /// The card's top-left while dragging.
  var cardOrigin: CGPoint {
    guard let active else { return .zero }
    switch active.phase {
    case .returning: return active.origin.origin
    default: return CGPoint(x: active.location.x - active.grab.width, y: active.location.y - active.grab.height)
    }
  }

  /// Ends the drag. Returns where it landed when the target accepts it; otherwise the card springs back.
  func end() -> (target: HomeDropTarget, preview: TaskTimelineDropPreview?)? {
    guard let drag = active, drag.phase == .dragging else { return nil }
    let landing = target
    let landedPreview = preview
    target = nil
    preview = nil
    let accepted: Bool
    switch landing {
    case .bucket(let bucket): accepted = drag.source.map { TaskRules.canDrop(from: $0, onto: bucket) } ?? false
    case .timeline: accepted = landedPreview?.error == nil && landedPreview?.start != nil
    case nil: accepted = false
    }
    withAnimation(accepted ? Motion.fast : Motion.settle) { active?.phase = accepted ? .landing : .returning }
    let id = drag.task.id
    Task { @MainActor [weak self] in
      try? await Task.sleep(for: .milliseconds(accepted ? 160 : 340))
      if self?.active?.task.id == id, self?.active?.phase != .dragging { self?.active = nil }
    }
    guard accepted, let landing else { return nil }
    return (landing, landedPreview)
  }

  func cancel() {
    guard active?.phase == .dragging else { return }
    target = nil
    preview = nil
    withAnimation(Motion.settle) { active?.phase = .returning }
    let id = active?.task.id
    Task { @MainActor [weak self] in
      try? await Task.sleep(for: .milliseconds(340))
      if self?.active?.task.id == id, self?.active?.phase == .returning { self?.active = nil }
    }
  }

  private func hitTest(_ point: CGPoint) -> HomeDropTarget? {
    if timelineViewport.contains(point), !timelineDate.isEmpty { return .timeline(date: timelineDate) }
    for (bucket, frame) in columnFrames where frame.contains(point) { return .bucket(bucket) }
    return nil
  }

  /// The block the task would make: its center snapped to 15 minutes, pushed to the next free slot.
  private func timelinePreview(for drag: Active) -> TaskTimelineDropPreview {
    let title = drag.task.title
    guard timelineAxis.height > 0 else { return TaskTimelineDropPreview(title: title, error: "Could not place this time block.") }
    let center = cardOrigin.y + drag.origin.height / 2
    let raw = Double(ScratchTimeline.startMinutes) + Double((center - timelineAxis.minY) / hourHeight) * 60
    let requested = max(ScratchTimeline.startMinutes, ScratchTimeline.snapped(raw))
    let minutes = ScratchTimeline.blockMinutes(for: drag.task.estimate)
    do {
      let start = TaskDates.minutes(try ScratchTimeline.freeStart(minutes: minutes, after: requested, busy: busy(timelineDate))) ?? requested
      return TaskTimelineDropPreview(start: start, end: start + minutes, title: title, error: nil)
    } catch {
      return TaskTimelineDropPreview(title: title, error: "No open slot before midnight fits this task.")
    }
  }
}

/// The lifted card that follows the pointer, drawn above the whole page.
struct TaskDragOverlay: View {
  @Environment(HomeDrag.self) private var drag
  let contexts: [TaskContext]
  let today: String
  @State private var raised = false

  /// Over the timeline the card turns translucent so the block it would make shows through.
  private var overTimeline: Bool {
    if case .timeline = drag.target { return true }
    return false
  }

  var body: some View {
    if let active = drag.active {
      let lifted = active.phase == .dragging && raised
      TaskCardContent(task: active.task, bucket: active.source, contexts: contexts, today: today, completing: false, preview: true, compact: active.origin.width < TaskBoardView.compactBelow)
        .frame(width: active.origin.width, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).fill(Palette.surfaceCard))
        .overlay(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).strokeBorder(Palette.focusBorder.opacity(lifted ? 0.45 : 0.2), lineWidth: 1))
        .shadow(color: .black.opacity(lifted ? 0.18 : 0.04), radius: lifted ? 18 : 4, y: lifted ? 10 : 1)
        .scaleEffect(lifted ? 1.03 : (active.phase == .landing ? 0.96 : 1))
        .rotationEffect(.degrees(lifted ? 1.2 : 0))
        .opacity(active.phase == .landing ? 0 : (overTimeline ? 0.55 : 1))
        .animation(Motion.fast, value: overTimeline)
        .offset(x: drag.cardOrigin.x, y: drag.cardOrigin.y)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .allowsHitTesting(false)
        .transition(.identity)
        .id(active.task.id)
        .onAppear {
          raised = false
          Task { @MainActor in withAnimation(Motion.press) { raised = true } }
        }
    }
  }
}
