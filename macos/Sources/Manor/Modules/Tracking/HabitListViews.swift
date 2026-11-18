import ManorKit
import SwiftUI
import UniformTypeIdentifiers

/// A list container: the card surface with a hairline edge.
struct HabitListCard<Content: View>: View {
  @ViewBuilder let content: () -> Content
  var body: some View {
    VStack(spacing: 0) { content() }
      .background(RoundedRectangle(cornerRadius: Radius.card, style: .continuous).fill(Palette.surfaceCard))
      .clipShape(RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
      .overlay(RoundedRectangle(cornerRadius: Radius.card, style: .continuous).strokeBorder(Palette.hairline, lineWidth: 1))
  }
}

struct HabitDayStepButton: View {
  let systemImage: String
  let label: String
  let enabled: Bool
  let action: () -> Void
  @State private var hovering = false

  var body: some View {
    Button(action: action) {
      Image(systemName: systemImage).font(.system(size: 12, weight: .semibold))
        .foregroundStyle(hovering && enabled ? Palette.inkBody : Palette.inkMuted)
        .frame(width: 30, height: 30)
        .background(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).fill(hovering && enabled ? Palette.surfaceSoft : .clear))
        .contentShape(Rectangle())
    }
    .buttonStyle(HabitPressStyle())
    .disabled(!enabled)
    .opacity(enabled ? 1 : 0.32)
    .onHover { hovering = $0 }
    .help(label)
    .accessibilityLabel(label)
  }
}

// MARK: Reordering

/// The active habits, reorderable by dragging a row's grip. The drop line shows where the habit lands; the
/// order saves for every habit, so paused and archived ones keep their places.
struct ReorderableHabitList: View {
  let store: HabitsStore
  let daily: HabitsDailySnapshot
  let onOpen: (String) -> Void
  let onStatus: (String, HabitLifecycleStatus) -> Void
  let onRetire: (String) -> Void
  @State private var drag = HabitDragState()
  @State private var hoveredId: String?

  private var reservesFreezeSlot: Bool { daily.active.contains { $0.frozen || $0.canFreeze } }

  var body: some View {
    let ids = daily.active.map(\.id)
    HabitListCard {
      ForEach(Array(daily.active.enumerated()), id: \.element.id) { index, habit in
        if index > 0 { Hairline() }
        HabitRowView(
          habit: habit, isToday: daily.isToday, leadingInset: 16, reservesFreezeSlot: reservesFreezeSlot,
          onLog: { value in Task { await store.log(habitId: habit.id, value: value) } },
          onOpen: { onOpen(habit.id) },
          onResume: { onStatus(habit.id, .active) },
          onFreeze: { Task { _ = await store.freeze(habitId: habit.id) } },
          onUnfreeze: { Task { await store.unfreeze(habitId: habit.id) } }
        )
        .overlay(alignment: .leading) {
          HabitReorderGrip(id: habit.id, name: habit.definition.name, visible: hoveredId == habit.id, drag: $drag, onStep: { step in
            let target = index + step
            if ids.indices.contains(target) { Task { await store.move(habit.id, onto: ids[target]) } }
          }) { HabitDragPreview(name: habit.definition.name) }
        }
        .onHover { inside in
          if inside { hoveredId = habit.id } else if hoveredId == habit.id { hoveredId = nil }
        }
        .modifier(HabitReorderDropTarget(id: habit.id, ids: ids, drag: $drag) { dragId in Task { await store.move(dragId, onto: habit.id) } })
        .contextMenu {
          Button("Open details") { onOpen(habit.id) }
          Button("Move up") { if index > 0 { Task { await store.move(habit.id, onto: ids[index - 1]) } } }.disabled(index == 0)
          Button("Move down") { if index < ids.count - 1 { Task { await store.move(habit.id, onto: ids[index + 1]) } } }.disabled(index == ids.count - 1)
          Divider()
          Button("Pause") { onStatus(habit.id, .paused) }
          Button("Retire…") { onRetire(habit.id) }
        }
      }
    }
    .animation(Motion.settle, value: ids)
  }
}

struct HabitDragState: Equatable {
  var draggingId: String?
  var overId: String?
}

/// The drag handle that appears on hover. Only the grip starts a drag, so clicks on the row stay clicks.
struct HabitReorderGrip<Preview: View>: View {
  let id: String
  let name: String
  let visible: Bool
  @Binding var drag: HabitDragState
  /// Moves the habit one place earlier (-1) or later (1) from the keyboard.
  var onStep: ((Int) -> Void)?
  @ViewBuilder let preview: () -> Preview
  @State private var hovering = false

  var body: some View {
    Image(systemName: "line.3.horizontal")
      .font(.system(size: 11, weight: .semibold))
      .foregroundStyle(hovering ? Palette.inkBody : Palette.inkMuted)
      .frame(width: 22, height: 32)
      .contentShape(Rectangle())
      .opacity(visible || hovering ? 1 : 0.0001)
      .animation(Motion.fast, value: visible)
      .onHover { hovering = $0 }
      .pointerStyle(.grabIdle)
      .onDrag {
        drag.draggingId = id
        return NSItemProvider(object: id as NSString)
      } preview: {
        preview()
      }
      .padding(.leading, 2)
      .focusable(interactions: .activate)
      .onKeyPress(keys: [.upArrow, .downArrow, .leftArrow, .rightArrow]) { press in
        guard let onStep else { return .ignored }
        onStep(press.key == .upArrow || press.key == .leftArrow ? -1 : 1)
        return .handled
      }
      .help("Drag to reorder")
      .accessibilityLabel("Reorder \(name)")
      .accessibilityHint("Drag, or use the arrow keys, to move it.")
  }
}

/// Accepts a dragged habit and draws the line where it will land: above the target when moving up, below
/// it when moving down.
struct HabitReorderDropTarget: ViewModifier {
  let id: String
  let ids: [String]
  @Binding var drag: HabitDragState
  /// Draws the drop line on the leading or trailing edge, for tiles laid out in a row.
  var horizontal = false
  let onDrop: (String) -> Void

  func body(content: Content) -> some View {
    content
      .overlay(alignment: lineEdge) {
        if drag.overId == id, let dragging = drag.draggingId, dragging != id {
          Rectangle().fill(Palette.primary)
            .frame(width: horizontal ? 2 : nil, height: horizontal ? nil : 2)
            .transition(.opacity)
        }
      }
      .onDrop(of: [UTType.plainText], isTargeted: Binding(
        get: { drag.overId == id },
        set: { targeted in
          if targeted { drag.overId = id } else if drag.overId == id { drag.overId = nil }
        }
      )) { providers in
        guard let dragging = drag.draggingId, ids.contains(dragging), let provider = providers.first else { return false }
        provider.loadObject(ofClass: NSString.self) { object, _ in
          let dropped = object as? String
          Task { @MainActor in
            drag = HabitDragState()
            if dropped == dragging, dragging != id { onDrop(dragging) }
          }
        }
        return true
      }
  }

  private var lineEdge: Alignment {
    guard let dragging = drag.draggingId, let from = ids.firstIndex(of: dragging), let to = ids.firstIndex(of: id) else { return horizontal ? .leading : .top }
    if horizontal { return from < to ? .trailing : .leading }
    return from < to ? .bottom : .top
  }
}

/// What follows the pointer while a habit is dragged.
struct HabitDragPreview: View {
  let name: String
  var body: some View {
    HStack(spacing: Space.s2) {
      Image(systemName: "line.3.horizontal").font(.system(size: 11, weight: .semibold)).foregroundStyle(Palette.inkMuted)
      Text(name).font(.ui(Typography.Size.md, weight: .medium)).foregroundStyle(Palette.ink).lineLimit(1)
    }
    .padding(.horizontal, Space.s3)
    .frame(height: 36)
    .background(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).fill(Palette.surfaceCard))
    .overlay(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).strokeBorder(Palette.hairlineStrong, lineWidth: 1))
  }
}

// MARK: Status rail

/// The day's progress and the freeze pool.
struct HabitsStatusRail: View {
  let daily: HabitsDailySnapshot
  @State private var showInfo = false

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      if !daily.active.isEmpty {
        progress
        Hairline().padding(.vertical, Space.s4).padding(.horizontal, -Space.s4)
      }
      pool
    }
    .padding(Space.s4)
    .background(RoundedRectangle(cornerRadius: Radius.card, style: .continuous).fill(Palette.surfaceCard))
    .overlay(RoundedRectangle(cornerRadius: Radius.card, style: .continuous).strokeBorder(Palette.hairline, lineWidth: 1))
  }

  private var progress: some View {
    let total = daily.active.count
    let fraction = total == 0 ? 0 : CGFloat(daily.completed) / CGFloat(total)
    return VStack(alignment: .leading, spacing: Space.s2) {
      Text(HabitDates.dayLabel(daily.selectedDate, today: daily.today)).font(.ui(Typography.Size.sm, weight: .medium)).foregroundStyle(Palette.inkMuted)
      HStack(alignment: .firstTextBaseline, spacing: Space.s2) {
        HStack(alignment: .firstTextBaseline, spacing: 0) {
          Text("\(daily.completed)").font(.ui(Typography.Size.title, weight: .semibold)).foregroundStyle(Palette.ink)
            .contentTransition(.numericText(value: Double(daily.completed)))
          Text(" of \(total)").font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted)
        }
        .tabular()
        if daily.perfect {
          Text("A perfect day.").font(.display(Typography.Size.lg)).foregroundStyle(Palette.primary)
            .transition(.opacity.combined(with: .scale(scale: 0.96, anchor: .leading)))
        } else {
          Text(daily.uncovered > 0 ? "\(daily.uncovered) left." : "\(daily.frozen) frozen.")
            .font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted).tabular()
        }
      }
      GeometryReader { proxy in
        ZStack(alignment: .leading) {
          Capsule().fill(Palette.surfaceSoft)
          Capsule().fill(daily.perfect ? Palette.primary : Palette.completion).frame(width: proxy.size.width * fraction)
        }
      }
      .frame(height: 4)
      .accessibilityElement()
      .accessibilityLabel("\(daily.completed) of \(total) complete")
    }
    .animation(Motion.settle, value: daily.completed)
    .animation(Motion.base, value: daily.perfect)
  }

  private var pool: some View {
    let capacity = daily.pool?.capacity ?? 0
    let balance = daily.pool?.balance ?? 0
    return VStack(alignment: .leading, spacing: Space.s2) {
      HStack {
        HStack(spacing: 5) {
          HabitFreezeCrystal(size: 14)
          Text("Freeze pool").font(.ui(Typography.Size.sm, weight: .medium)).foregroundStyle(Palette.inkMuted)
        }
        Spacer()
        IconButton("info.circle", label: "About streak freezes", size: 24) { showInfo.toggle() }
          .popover(isPresented: $showInfo, arrowEdge: .bottom) {
            VStack(alignment: .leading, spacing: Space.s2) {
              Text("Keep a streak going").font(.ui(Typography.Size.body, weight: .semibold)).foregroundStyle(Palette.ink)
              Text("One freeze covers one habit missed yesterday. Checking it off later returns the freeze.")
              Text("Perfect days replenish the pool. Each month starts full, with one freeze per active habit.")
            }
            .font(.ui(Typography.Size.sm))
            .foregroundStyle(Palette.inkBody)
            .fixedSize(horizontal: false, vertical: true)
            .frame(width: 260, alignment: .leading)
            .padding(Space.s3 + 2)
          }
      }
      HStack(alignment: .firstTextBaseline, spacing: Space.s2) {
        Text("\(balance)").font(.ui(Typography.Size.title, weight: .semibold)).foregroundStyle(Palette.ink).tabular()
          .contentTransition(.numericText(value: Double(balance)))
        Text("of \(capacity) available this month").font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted).tabular()
      }
      HabitPoolDots(capacity: capacity, balance: balance)
    }
    .accessibilityElement(children: .contain)
    .animation(Motion.settle, value: balance)
  }
}

/// One pill per freeze in the month's pool, filled while it is still available.
private struct HabitPoolDots: View {
  let capacity: Int
  let balance: Int

  var body: some View {
    LazyVGrid(columns: [GridItem(.adaptive(minimum: 16, maximum: 16), spacing: 5, alignment: .leading)], alignment: .leading, spacing: 5) {
      ForEach(0..<capacity, id: \.self) { index in
        let left = index < balance
        RoundedRectangle(cornerRadius: 4, style: .continuous)
          .fill(left ? Palette.frozenInfo : Palette.surfaceSoft)
          .overlay(RoundedRectangle(cornerRadius: 4, style: .continuous).strokeBorder(left ? Palette.frozenInfo : Palette.hairlineStrong, lineWidth: 1))
          .frame(width: 16, height: 7)
      }
    }
    .accessibilityHidden(true)
  }
}
