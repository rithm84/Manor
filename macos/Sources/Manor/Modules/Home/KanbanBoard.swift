import ManorKit
import SwiftUI

/// The card body: checkbox and title, then property chips that wrap under the whole card width. Shared by the
/// board and the lifted drag card.
struct TaskCardContent: View {
  let task: TaskItem
  let bucket: TaskBucket?
  let contexts: [TaskContext]
  let today: String
  let completing: Bool
  var preview = false
  /// Narrow columns use the short form of the lateness note.
  var compact = false
  var onToggle: (() -> Void)?

  var body: some View {
    VStack(alignment: .leading, spacing: Space.s2) {
      HStack(alignment: .firstTextBaseline, spacing: Space.s2) {
        TaskCheckbox(isOn: completing || task.status == .done, label: "Complete \(task.title)") { onToggle?() }
          .alignmentGuide(.firstTextBaseline) { $0[VerticalAlignment.center] + 4 }
          .allowsHitTesting(!preview)
        titleText
          .font(.ui(Typography.Size.body, weight: .medium))
          .foregroundStyle(completing ? Palette.inkMuted : Palette.ink)
          .strikethrough(completing, color: Palette.inkMuted)
          .lineSpacing(2)
          .frame(maxWidth: .infinity, alignment: .leading)
          .fixedSize(horizontal: false, vertical: true)
          .help(task.recurrence.map { "Repeats \(Recurrence.label($0).lowercased())" } ?? "")
      }
      HomeFlowLayout(spacing: Space.s1, lineSpacing: Space.s1) {
        deadline
        HomeContextPill(name: task.context, contexts: contexts)
        if let estimate = task.estimate { HomePill(text: estimate.label, tone: HomeTone(estimate)) }
        if let priority = task.priority { HomePill(text: priority.label, tone: HomeTone(priority)) }
        ForEach(task.tags, id: \.self) { HomePill(text: $0, tone: .neutral) }
        if bucket == .overdue {
          let late = TaskRules.daysLate(task, today: today)
          if late > 0 {
            Text(compact ? "\(late)d late" : (late == 1 ? "1 day late" : "\(late) days late"))
              .font(.ui(Typography.Size.xs, weight: .medium))
              .foregroundStyle(Palette.overdueError)
              .padding(.leading, 2)
              .frame(height: 22)
              .tabular()
              .help(late == 1 ? "1 day late" : "\(late) days late")
          }
        }
      }
    }
    .padding(.horizontal, Space.s2 + 2)
    .padding(.vertical, Space.s2 + 2)
  }

  /// The title, with a small repeat mark after the last word for a recurring task.
  private var titleText: Text {
    guard task.recurrence != nil else { return Text(task.title) }
    // No-break spaces keep the mark with the last word when the title wraps.
    return Text(task.title) + Text("\u{00A0}\u{00A0}") + Text(Image(systemName: "repeat"))
      .font(.ui(Typography.Size.xs, weight: .semibold))
      .foregroundColor(Palette.inkMuted)
  }

  /// Today and Tomorrow show only an optional time; This Week names the weekday; Overdue shows the date it was due,
  /// since the column already says it is late.
  @ViewBuilder private var deadline: some View {
    switch bucket {
    case .today, .tomorrow:
      if let time = task.dueTime { HomePill(text: TaskDates.clock(time), systemImage: "clock", tone: HomeTone(bucket)) }
    case .week:
      let weekday = TaskDates.weekdaysLong[TaskDates.weekday(task.due)]
      HomePill(text: task.dueTime.map { "\(TaskDates.weekdaysShort[TaskDates.weekday(task.due)]) \(TaskDates.clock($0))" } ?? weekday,
               tone: HomeTone(bucket))
        .help(TaskRules.dueLabel(task))
    case .overdue:
      HomePill(text: TaskDates.shortDate(task.due), tone: HomeTone(bucket))
        .help(TaskRules.dueLabel(task))
    case nil:
      HomePill(text: TaskRules.dueLabel(task), systemImage: "calendar", tone: HomeTone(bucket))
    }
  }
}

/// One board card: single click opens the detail dialog, the checkbox completes, dragging lifts it, and the
/// context menu holds every other action.
struct TaskCardView: View {
  @Environment(HomeModel.self) private var model
  let task: TaskItem
  let bucket: TaskBucket
  var compact = false
  var focused: FocusState<String?>.Binding
  @State private var hovering = false
  @State private var frame: CGRect = .zero

  var body: some View {
    let lifted = model.drag.isLifted(task.id)
    let completing = model.completing.contains(task.id)
    TaskCardContent(task: task, bucket: bucket, contexts: model.store.contexts, today: model.today, completing: completing, compact: compact) {
      model.toggleComplete(task.id)
    }
    .background(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).fill(Palette.surfaceCard))
    .overlay(
      RoundedRectangle(cornerRadius: Radius.control, style: .continuous)
        .strokeBorder(focused.wrappedValue == task.id ? Palette.focusBorder : (hovering ? Palette.hairlineStrong : Palette.hairline), lineWidth: focused.wrappedValue == task.id ? 1.5 : 1)
    )
    .shadow(color: .black.opacity(hovering && !lifted ? 0.06 : 0), radius: 6, y: 2)
    .opacity(lifted ? 0.25 : (completing ? 0.45 : 1))
    .contentShape(RoundedRectangle(cornerRadius: Radius.control, style: .continuous))
    .onHover { hovering = $0 }
    .animation(Motion.fast, value: hovering)
    .onGeometryChange(for: CGRect.self) { $0.frame(in: .named(homeSpace)) } action: { frame = $0 }
    .onTapGesture { model.openTask(task.id) }
    .gesture(
      DragGesture(minimumDistance: 4, coordinateSpace: .named(homeSpace))
        .onChanged { value in
          if !model.drag.isDragging { model.drag.begin(task, source: bucket, frame: frame, at: value.startLocation) }
          model.drag.move(to: value.location)
        }
        .onEnded { _ in
          if let landed = model.drag.end() { model.drop(task.id, on: landed.target, preview: landed.preview) }
        }
    )
    .focusable(interactions: .activate)
    .focusEffectDisabled()
    .focused(focused, equals: task.id)
    .onKeyPress(.return) {
      model.openTask(task.id)
      return .handled
    }
    .onKeyPress(.space) {
      model.toggleComplete(task.id)
      return .handled
    }
    .contextMenu { TaskActionsMenu(task: task) }
    .accessibilityElement(children: .combine)
    .accessibilityAddTraits(.isButton)
    .accessibilityHint("Opens the task")
    .accessibilityAction(named: "Complete") { model.toggleComplete(task.id) }
  }
}

/// The task actions shared by card and row context menus.
struct TaskActionsMenu: View {
  @Environment(HomeModel.self) private var model
  let task: TaskItem

  var body: some View {
    let bucket = TaskRules.bucket(for: task, today: model.today, now: model.nowTime)
    Button("Open details") { model.openTask(task.id) }
    if task.status == .done {
      Button("Mark not started") { Task { await model.setStatus(.notStarted, of: task.id, undoName: "Reopen Task") } }
    } else {
      Button("Mark complete") { model.toggleComplete(task.id) }
    }
    Divider()
    if let bucket {
      if TaskRules.canDrop(from: bucket, onto: .today) { Button("Move to Today") { model.moveTask(task.id, to: .today) } }
      if TaskRules.canDrop(from: bucket, onto: .tomorrow) { Button("Move to Tomorrow") { model.moveTask(task.id, to: .tomorrow) } }
    } else {
      Button("Move to Today") { model.moveTask(task.id, to: .today) }
    }
    Menu("Block time") {
      Button("Today") { model.scheduleOnTimeline(task.id, day: .today) }
      Button("Tomorrow") { model.scheduleOnTimeline(task.id, day: .tomorrow) }
    }
    Divider()
    Button("Duplicate") { Task { await model.duplicate(task) } }
    if task.isRecurring && task.status != .done {
      Button("Skip this occurrence") { model.skip(task.id) }
    }
    Divider()
    Button("Delete task", role: .destructive) { model.trash(task.id) }
  }
}

/// One due bucket: the group pill and count, cards, and the New entry point. Columns share one neutral surface;
/// the bucket's color lives in its pill and washes the column only while it is a legal drop target.
struct TaskColumnView: View {
  @Environment(HomeModel.self) private var model
  let bucket: TaskBucket
  let tasks: [TaskItem]
  var compact = false
  var focused: FocusState<String?>.Binding
  @State private var hovering = false
  @State private var moreBelow = false

  private var isTarget: Bool { model.drag.target == .bucket(bucket) && legal }
  private var surface: Color { isTarget ? HomeTone(bucket).tint : Palette.surfacePaper }

  var body: some View {
    let tone = HomeTone(bucket)
    let isTarget = self.isTarget
    let shape = RoundedRectangle(cornerRadius: Radius.card, style: .continuous)
    VStack(alignment: .leading, spacing: 0) {
      HStack(spacing: Space.s1) {
        HomeGroupPill(text: bucket.label, tone: tone, count: tasks.count)
        Spacer(minLength: 0)
        if bucket.allowsCreation {
          IconButton("plus", label: "New task in \(bucket.label)", size: 24) { model.openCreate(bucket) }
            .opacity(hovering ? 1 : 0)
        }
      }
      .frame(height: 28)
      .padding(.horizontal, Space.s1)
      .padding(.bottom, Space.s2)

      ScrollView(.vertical) {
        LazyVStack(spacing: Space.s2) {
          ForEach(tasks) { task in
            TaskCardView(task: task, bucket: bucket, compact: compact, focused: focused)
              .transition(.asymmetric(insertion: .opacity.combined(with: .scale(scale: 0.98)), removal: .opacity))
          }
          if bucket.allowsCreation {
            NewTaskRow { model.openCreate(bucket) }
          } else if tasks.isEmpty {
            Text("Nothing overdue")
              .font(.ui(Typography.Size.sm))
              .foregroundStyle(Palette.inkMuted)
              .frame(maxWidth: .infinity, alignment: .leading)
              .padding(.horizontal, Space.s2)
              .frame(height: 30)
          }
        }
        .padding(1)
        .padding(.bottom, Space.s2)
      }
      .scrollIndicators(.never)
      .scrollBounceBehavior(.basedOnSize)
      .onScrollGeometryChange(for: Bool.self) { geometry in
        geometry.contentOffset.y + geometry.containerSize.height < geometry.contentSize.height - 2
      } action: { _, more in
        withAnimation(Motion.fast) { moreBelow = more }
      }
      .overlay(alignment: .bottom) {
        LinearGradient(colors: [surface.opacity(0), surface], startPoint: .top, endPoint: .bottom)
          .frame(height: Space.s8)
          .opacity(moreBelow ? 1 : 0)
          .allowsHitTesting(false)
      }
    }
    .padding(Space.s2)
    .frame(maxHeight: .infinity, alignment: .top)
    .background(shape.fill(surface))
    .overlay(shape.strokeBorder(tone.foreground.opacity(isTarget ? 0.45 : 0), lineWidth: 1.5))
    .animation(Motion.fast, value: isTarget)
    .onHover { hovering = $0 }
    .onGeometryChange(for: CGRect.self) { $0.frame(in: .named(homeSpace)) } action: { model.drag.columnFrames[bucket] = $0 }
    .accessibilityElement(children: .contain)
    .accessibilityLabel(bucket.label)
  }

  private var legal: Bool {
    guard let source = model.drag.active?.source else { return false }
    return TaskRules.canDrop(from: source, onto: bucket)
  }
}

private struct NewTaskRow: View {
  let action: () -> Void
  @State private var hovering = false

  var body: some View {
    Button(action: action) {
      HStack(spacing: 6) {
        Image(systemName: "plus").font(.ui(Typography.Size.xs, weight: .medium))
        Text("New").font(.ui(Typography.Size.body, weight: .medium))
        Spacer()
      }
      .foregroundStyle(hovering ? Palette.inkBody : Palette.inkMuted)
      .padding(.horizontal, Space.s2)
      .frame(height: 30)
      .background(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).fill(hovering ? Palette.surfaceHover : .clear))
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .onHover { hovering = $0 }
    .animation(Motion.fast, value: hovering)
  }
}

/// The four columns in their own horizontal scroll region. Columns share the width down to a readable
/// minimum, then the board scrolls; edge fades mark columns beyond either edge.
struct TaskBoardView: View {
  @Environment(HomeModel.self) private var model
  let columns: [TaskBucket: [TaskItem]]
  let columnWidth: CGFloat
  @FocusState private var focused: String?
  @State private var moreLeft = false
  @State private var moreRight = false

  static let gap: CGFloat = Space.s2 + 2
  /// Columns narrower than this use the short lateness note so chip rows stay at two lines.
  static let compactBelow: CGFloat = 212

  var body: some View {
    ScrollView(.horizontal) {
      HStack(alignment: .top, spacing: Self.gap) {
        ForEach(TaskBucket.allCases) { bucket in
          TaskColumnView(bucket: bucket, tasks: columns[bucket] ?? [], compact: columnWidth < Self.compactBelow, focused: $focused)
            .frame(width: columnWidth)
        }
      }
      .frame(maxHeight: .infinity)
    }
    .scrollIndicators(.automatic)
    .onScrollGeometryChange(for: [Bool].self) { geometry in
      [geometry.contentOffset.x > 2, geometry.contentOffset.x < geometry.contentSize.width - geometry.containerSize.width - 2]
    } action: { _, edges in
      withAnimation(Motion.fast) {
        moreLeft = edges[0]
        moreRight = edges[1]
      }
    }
    .overlay(alignment: .leading) { fade(.leading).opacity(moreLeft ? 1 : 0) }
    .overlay(alignment: .trailing) { fade(.trailing).opacity(moreRight ? 1 : 0) }
    .onKeyPress(keys: [.upArrow, .downArrow, .leftArrow, .rightArrow]) { press in
      moveFocus(press.key) ? .handled : .ignored
    }
    .animation(Motion.settle, value: columns.mapValues { $0.map(\.id) })
  }

  private func fade(_ edge: HorizontalEdge) -> some View {
    LinearGradient(colors: [Palette.surfaceCanvas, Palette.surfaceCanvas.opacity(0)], startPoint: edge == .leading ? .leading : .trailing, endPoint: edge == .leading ? .trailing : .leading)
      .frame(width: 36)
      .allowsHitTesting(false)
  }

  /// Arrow keys walk the cards: up and down within a column, left and right to the nearest row of a neighbor.
  private func moveFocus(_ key: KeyEquivalent) -> Bool {
    let ordered = TaskBucket.allCases.map { columns[$0] ?? [] }
    guard let current = focused,
      let column = ordered.firstIndex(where: { $0.contains { $0.id == current } }),
      let row = ordered[column].firstIndex(where: { $0.id == current }) else {
      focused = ordered.first(where: { !$0.isEmpty })?.first?.id
      return focused != nil
    }
    switch key {
    case .upArrow: if row > 0 { focused = ordered[column][row - 1].id }
    case .downArrow: if row + 1 < ordered[column].count { focused = ordered[column][row + 1].id }
    case .leftArrow, .rightArrow:
      let step = key == .leftArrow ? -1 : 1
      var next = column + step
      while next >= 0 && next < ordered.count {
        if !ordered[next].isEmpty {
          focused = ordered[next][min(row, ordered[next].count - 1)].id
          break
        }
        next += step
      }
    default: return false
    }
    return true
  }
}
