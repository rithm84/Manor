import AppKit
import ManorKit
import SwiftUI

/// The Today and Tomorrow schedule beside the board: 6 AM through midnight, connected-calendar events, scratch
/// blocks, and the now line. Drag a block to reschedule it, drag empty space to make one, and drop a task card
/// to block time for it.
struct TodayTimelineView: View {
  @Environment(HomeModel.self) private var model
  @Environment(AppContext.self) private var context

  /// The smallest hour row; a taller column stretches the hours so 6 AM to midnight fills it.
  static let hourHeight: CGFloat = 44
  static let gutter: CGFloat = 48
  private static let space = "timeline"

  /// A pointer drag inside the timeline: moving a block or sweeping a new one.
  private enum PointerDrag: Equatable {
    case move(id: String, grab: Int, duration: Int, start: Int)
    case create(anchor: Int, current: Int)
  }

  @State private var pointer: PointerDrag?
  @State private var scrolledToNow = false
  @State private var scroll = ScrollPosition(edge: .top)
  @State private var viewportHeight: CGFloat = 0
  @State private var scrolledDown = false

  private var hourHeight: CGFloat {
    let hours = CGFloat(ScratchTimeline.endMinutes - ScratchTimeline.startMinutes) / 60
    return max(Self.hourHeight, ((viewportHeight - 12) / hours).rounded(.down))
  }

  private struct Entry: Identifiable {
    let id: String
    let title: String
    let start: Int
    let end: Int
    let scratch: Bool
    let color: Color
  }

  var body: some View {
    VStack(alignment: .leading, spacing: Space.s3) {
      ViewThatFits(in: .horizontal) {
        HStack(spacing: Space.s2) {
          dayTabs
          Spacer(minLength: Space.s2)
          Text(TaskDates.dayLabel(model.scheduleDate)).font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted).lineLimit(1).fixedSize().tabular()
        }
        VStack(alignment: .leading, spacing: Space.s1) {
          dayTabs
          Text(TaskDates.dayLabel(model.scheduleDate)).font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted).lineLimit(1).tabular()
        }
      }
      if let error = model.calendarDay.error {
        Text(error).font(.ui(Typography.Size.xs)).foregroundStyle(Palette.overdueError).lineLimit(3)
      }
      timeline
    }
    .padding(Space.s2)
    .frame(maxHeight: .infinity, alignment: .top)
    .background(RoundedRectangle(cornerRadius: Radius.card, style: .continuous).fill(Palette.surfaceCard))
    .overlay(RoundedRectangle(cornerRadius: Radius.card, style: .continuous).strokeBorder(Palette.hairline))
    // Today and tomorrow load together, so the day toggle only changes which one shows.
    .task(id: model.today) { await loadEvents() }
    .task(id: model.today) {
      for await _ in context.gateway.changes(of: ["calendar_events", "calendars"]) { await loadEvents() }
    }
    .task(id: model.today) {
      while !Task.isCancelled {
        try? await Task.sleep(for: .seconds(60))
        await loadEvents()
      }
    }
    .onChange(of: model.scheduleDate, initial: true) { _, date in model.drag.timelineDate = date }
  }

  private var dayTabs: some View {
    SegmentedTabs([(HomeModel.ScheduleDay.today, "Today"), (.tomorrow, "Tomorrow")], selection: Binding(get: { model.scheduleDay }, set: { model.scheduleDay = $0 }))
      .fixedSize()
  }

  private func loadEvents() async {
    let today = model.today
    await model.calendarDay.load(dates: [today, TaskDates.adding(1, to: today)], gateway: context.gateway, timeZone: model.timeZone)
  }

  // MARK: Axis

  private var axisHeight: CGFloat { y(ScratchTimeline.endMinutes) }
  private func y(_ minutes: Int) -> CGFloat { CGFloat(minutes - ScratchTimeline.startMinutes) / 60 * hourHeight }

  private var entries: [Entry] {
    let date = model.scheduleDate
    let events = model.calendarDay.events.filter { $0.date == date && !$0.allDay }.compactMap { event -> Entry? in
      let start = max(TaskDates.minutes(event.start) ?? 0, ScratchTimeline.startMinutes)
      let end = min(TaskDates.minutes(event.end) ?? 0, ScratchTimeline.endMinutes)
      guard end > start else { return nil }
      return Entry(id: "event:\(event.calendarId):\(event.id)", title: event.title, start: start, end: end, scratch: false, color: Color(homeHex: event.color) ?? Palette.secondary)
    }
    let blocks = model.store.blocks.filter { $0.date == date }.map { block -> Entry in
      let title: String
      if let taskId = block.taskId {
        title = model.store.task(taskId)?.title ?? (block.portion.isEmpty ? "Time block" : block.portion)
      } else {
        title = block.portion.isEmpty ? "Time block" : block.portion
      }
      return Entry(id: block.id, title: title, start: block.startMinutes, end: block.endMinutes, scratch: true, color: Palette.scratch)
    }
    return events + blocks
  }

  private var timeline: some View {
    let entries = self.entries
    let nowMinutes = TaskDates.minutes(model.nowTime) ?? 0
    return Group {
      ScrollView(.vertical) {
        ZStack(alignment: .topLeading) {
          ForEach(6...24, id: \.self) { hour in
            HStack(spacing: Space.s1) {
              Text(TaskDates.hourLabel(hour))
                .font(.ui(Typography.Size.gutter))
                .foregroundStyle(Palette.inkMuted)
                .tabular()
                .frame(width: 40, alignment: .trailing)
              Rectangle().fill(isTimelineTarget ? Palette.scratch.opacity(0.22) : Palette.ink.opacity(0.06)).frame(height: 1)
            }
            .frame(height: 12)
            .offset(y: y(hour * 60) - 6)
            .allowsHitTesting(false)
          }

          Color.clear
            .frame(height: axisHeight)
            .frame(maxWidth: .infinity)
            .contentShape(Rectangle())
            .gesture(createGesture)

          ForEach(entries) { entry in
            block(entry, all: entries)
          }

          if case .create(let anchor, let current) = pointer, abs(current - anchor) >= ScratchTimeline.snap {
            ghost(start: min(anchor, current), end: max(anchor, current), title: "Time block", dashed: true)
          }

          if isTimelineTarget, let preview = model.drag.preview {
            if let start = preview.start, let end = preview.end {
              ghost(start: start, end: end, title: preview.title, dashed: false)
                .transition(.opacity)
            }
          }

          if model.scheduleDay == .today, nowMinutes >= ScratchTimeline.startMinutes, nowMinutes <= ScratchTimeline.endMinutes {
            HStack(spacing: 0) {
              Circle().fill(Palette.timelineNow).frame(width: 7, height: 7)
              Capsule().fill(Palette.timelineNow).frame(height: 1.5)
            }
            .padding(.leading, 44)
            .offset(y: y(nowMinutes) - 3.5)
            .zIndex(4)
            .allowsHitTesting(false)
            .accessibilityLabel("Now, \(TaskDates.clock(model.nowTime))")
          }
        }
        .frame(height: axisHeight, alignment: .top)
        .coordinateSpace(name: Self.space)
        .onGeometryChange(for: CGRect.self) { $0.frame(in: .named(homeSpace)) } action: { model.drag.timelineAxis = $0 }
        .padding(.vertical, 6)
      }
      .scrollIndicators(.never)
      .onScrollGeometryChange(for: Bool.self) { $0.contentOffset.y > 1 } action: { _, down in scrolledDown = down }
      .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { height in
        viewportHeight = height
        model.drag.hourHeight = hourHeight
      }
      .overlay(alignment: .top) {
        // Once scrolled, hour labels slide under the header instead of being cut by the scroll edge; at rest the
        // first hour shows in full.
        if scrolledDown {
          LinearGradient(colors: [Palette.surfaceCard, Palette.surfaceCard.opacity(0)], startPoint: .top, endPoint: .bottom)
            .frame(height: Space.s5)
            .allowsHitTesting(false)
            .transition(.opacity)
        }
      }
      .animation(Motion.fast, value: scrolledDown)
      .overlay(alignment: .top) {
        if isTimelineTarget, let error = model.drag.preview?.error {
          Text(error)
            .font(.ui(Typography.Size.xs, weight: .medium))
            .foregroundStyle(Palette.overdueError)
            .multilineTextAlignment(.center)
            .padding(Space.s2)
            .frame(maxWidth: .infinity)
            .background(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).fill(Palette.overdueErrorTint))
            .padding(.leading, Self.gutter)
            .padding(.top, Space.s2)
            .allowsHitTesting(false)
        }
      }
      .onGeometryChange(for: CGRect.self) { $0.frame(in: .named(homeSpace)) } action: { model.drag.timelineViewport = $0 }
      .scrollPosition($scroll)
      .task {
        guard !scrolledToNow else { return }
        scrolledToNow = true
        scroll.scrollTo(y: y(max(6, min(18, nowMinutes / 60 - 1)) * 60))
      }
      .onChange(of: model.scheduleDay) { _, day in
        withAnimation(Motion.base) { scroll.scrollTo(y: y((day == .today ? max(6, min(18, nowMinutes / 60 - 1)) : 8) * 60)) }
      }
    }
    .onExitCommand { pointer = nil }
    .animation(Motion.fast, value: model.drag.preview)
  }

  private var movingId: String? {
    if case .move(let id, _, _, _) = pointer { return id }
    return nil
  }

  private var isTimelineTarget: Bool {
    if case .timeline = model.drag.target { return true }
    return false
  }

  // MARK: Blocks

  @ViewBuilder
  private func block(_ entry: Entry, all: [Entry]) -> some View {
    let moving: (start: Int, moved: Bool)? = {
      if case .move(let id, _, _, let start) = pointer, id == entry.id { return (start, start != entry.start) }
      return nil
    }()
    let start = moving?.start ?? entry.start
    let end = start + (entry.end - entry.start)
    let invalid = moving?.moved == true && overlaps(entry.id, start, end, all)
    TaskTimelineBlockView(
      title: entry.title, start: start, end: end, scratch: entry.scratch, color: entry.color,
      height: y(end) - y(start), lifted: moving?.moved == true, invalid: invalid
    )
    .padding(.leading, Self.gutter)
    .offset(y: y(start))
    .zIndex(moving != nil ? 2 : (entry.scratch ? 1 : 0))
    .gesture(moveGesture(entry, all: all), including: entry.scratch ? .all : .subviews)
    .contextMenu {
      if entry.scratch {
        Button("Open details") { model.blockDetail = IdentifiedString(value: entry.id) }
        if let taskId = model.store.block(entry.id)?.taskId, model.store.task(taskId) != nil {
          Button("Open task") { model.openTask(taskId) }
        }
        Divider()
        Button("Delete block", role: .destructive) {
          Task {
            do { try await model.deleteBlock(entry.id) } catch { model.reportError("Could not delete time block", error) }
          }
        }
      }
    }
    .animation(moving == nil ? Motion.settle : nil, value: entry.start)
  }

  private func overlaps(_ id: String, _ start: Int, _ end: Int, _ all: [Entry]) -> Bool {
    all.contains { $0.id != id && start < $0.end && end > $0.start }
  }

  private func minute(at y: CGFloat) -> Int {
    let raw = Double(ScratchTimeline.startMinutes) + Double(y / hourHeight) * 60
    return ScratchTimeline.clamp(ScratchTimeline.snapped(raw), ScratchTimeline.startMinutes, ScratchTimeline.endMinutes)
  }

  /// A click opens the block; a vertical drag moves it in 15-minute steps and snaps back off another block.
  private func moveGesture(_ entry: Entry, all: [Entry]) -> some Gesture {
    DragGesture(minimumDistance: 0, coordinateSpace: .named(Self.space))
      .onChanged { value in
        let duration = entry.end - entry.start
        if movingId != entry.id {
          pointer = .move(id: entry.id, grab: minute(at: value.startLocation.y) - entry.start, duration: duration, start: entry.start)
        }
        guard case .move(let id, let grab, let duration, _) = pointer else { return }
        let next = ScratchTimeline.clamp(ScratchTimeline.snapped(Double(minute(at: value.location.y) - grab)), ScratchTimeline.startMinutes, ScratchTimeline.endMinutes - duration)
        if abs(value.translation.height) > 3 || abs(value.translation.width) > 3 {
          pointer = .move(id: id, grab: grab, duration: duration, start: next)
        }
      }
      .onEnded { value in
        defer { pointer = nil }
        guard case .move(let id, _, let duration, let start) = pointer else { return }
        let moved = abs(value.translation.height) > 3 || abs(value.translation.width) > 3
        if !moved {
          model.blockDetail = IdentifiedString(value: id)
        } else if start != entry.start, !overlaps(id, start, start + duration, all) {
          model.moveBlock(id, start: start, end: start + duration)
        }
      }
  }

  /// Sweeping empty space draws a block; releasing makes it and opens it to name.
  private var createGesture: some Gesture {
    DragGesture(minimumDistance: 2, coordinateSpace: .named(Self.space))
      .onChanged { value in
        let anchor = minute(at: value.startLocation.y)
        guard anchor < ScratchTimeline.endMinutes else { return }
        pointer = .create(anchor: anchor, current: minute(at: value.location.y))
      }
      .onEnded { _ in
        defer { pointer = nil }
        guard case .create(let anchor, let current) = pointer else { return }
        let start = min(anchor, current), end = max(anchor, current)
        if end - start >= ScratchTimeline.snap { model.createBlock(start: start, end: end) }
      }
  }

  private func ghost(start: Int, end: Int, title: String, dashed: Bool) -> some View {
    VStack(alignment: .leading, spacing: 1) {
      Text(title).font(.ui(Typography.Size.sm, weight: .semibold)).lineLimit(1)
      Text(TaskTimelineBlockView.range(start, end))
        .font(.ui(Typography.Size.xs)).tabular()
    }
    .foregroundStyle(Palette.scratch)
    .padding(.horizontal, Space.s2)
    .frame(maxWidth: .infinity, minHeight: max(22, y(end) - y(start)), maxHeight: max(22, y(end) - y(start)), alignment: .leading)
    .background(RoundedRectangle(cornerRadius: Radius.chip, style: .continuous).fill(Palette.scratchTint))
    .overlay(
      RoundedRectangle(cornerRadius: Radius.chip, style: .continuous)
        .strokeBorder(Palette.scratch, style: StrokeStyle(lineWidth: 1.5, dash: dashed ? [4, 3] : []))
    )
    .shadow(color: .black.opacity(dashed ? 0 : 0.1), radius: 6, y: 2)
    .padding(.leading, Self.gutter)
    .offset(y: y(start))
    .allowsHitTesting(false)
    .zIndex(3)
  }
}

/// One entry on the axis. Events carry their calendar's color as a rail; scratch blocks use the scratch tone.
private struct TaskTimelineBlockView: View {
  let title: String
  let start: Int
  let end: Int
  let scratch: Bool
  let color: Color
  let height: CGFloat
  let lifted: Bool
  let invalid: Bool
  @State private var hovering = false

  var body: some View {
    let slim = height < 34
    let timeText = TaskTimelineBlockView.range(start, end)
    HStack(spacing: 0) {
      if !scratch {
        Capsule().fill(color).frame(width: 3).padding(.vertical, 2)
      }
      VStack(alignment: .leading, spacing: 1) {
        Text(title)
          .font(.ui(Typography.Size.sm, weight: scratch ? .semibold : .medium))
          .foregroundStyle(Palette.ink)
          .lineLimit(max(1, Int((height - 20) / 16.5)))
        if !slim {
          Text(timeText).font(.ui(Typography.Size.xs)).foregroundStyle(Palette.inkMuted).lineLimit(1).tabular()
        }
      }
      .padding(.leading, scratch ? Space.s2 : 7)
      .padding(.trailing, Space.s2)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .frame(height: max(height - 1, 12))
    .background(
      RoundedRectangle(cornerRadius: Radius.chip, style: .continuous)
        .fill(scratch ? Palette.scratchTint : color.opacity(0.12))
        .background(RoundedRectangle(cornerRadius: Radius.chip, style: .continuous).fill(Palette.surfaceCanvas))
    )
    .overlay {
      if scratch {
        RoundedRectangle(cornerRadius: Radius.chip, style: .continuous)
          .strokeBorder(invalid ? Palette.overdueError : Palette.scratch.opacity(hovering || lifted ? 0.7 : 0.45), style: StrokeStyle(lineWidth: 1, dash: invalid ? [4, 3] : []))
      }
    }
    .clipShape(RoundedRectangle(cornerRadius: Radius.chip, style: .continuous))
    .opacity(invalid ? 0.65 : 1)
    .shadow(color: .black.opacity(lifted ? 0.16 : 0), radius: 10, y: 4)
    .scaleEffect(lifted ? 1.015 : 1)
    .onHover { hovering = $0 }
    .animation(Motion.fast, value: hovering)
    .animation(Motion.press, value: lifted)
    .help("\(title), \(timeText)")
    .accessibilityElement(children: .combine)
    .accessibilityLabel("\(title), \(timeText)")
    .onContinuousHover { phase in
      if scratch, case .active = phase { NSCursor.openHand.set() } else if case .ended = phase { NSCursor.arrow.set() }
    }
  }
}

extension TaskTimelineBlockView {
  /// "5:30 to 7:00 PM": the shared meridiem is said once so the range fits a narrow column.
  static func range(_ start: Int, _ end: Int) -> String {
    let from = TaskDates.clock(TaskDates.time(fromMinutes: start))
    let to = TaskDates.clock(TaskDates.time(fromMinutes: end))
    for suffix in [" AM", " PM"] where from.hasSuffix(suffix) && to.hasSuffix(suffix) {
      return "\(from.dropLast(suffix.count)) to \(to)"
    }
    return "\(from) to \(to)"
  }
}

extension Color {
  /// A `#RRGGBB` swatch, as Google calendars report them.
  init?(homeHex: String?) {
    guard var text = homeHex?.trimmingCharacters(in: .whitespaces), !text.isEmpty else { return nil }
    if text.hasPrefix("#") { text.removeFirst() }
    guard text.count == 6, let value = UInt32(text, radix: 16) else { return nil }
    self.init(red: Double((value >> 16) & 0xFF) / 255, green: Double((value >> 8) & 0xFF) / 255, blue: Double(value & 0xFF) / 255)
  }
}
