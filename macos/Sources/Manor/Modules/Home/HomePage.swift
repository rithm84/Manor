import ManorKit
import SwiftUI

/// Home: the task board (Weekly) or table (Master) beside the Today timeline.
struct HomePage: View {
  @Environment(AppContext.self) private var context
  @State private var model: HomeModel?
  @State private var master = TaskMasterState()

  /// `model` lets a host supply Home's state (previews); the app lets the page make its own.
  init(model: HomeModel? = nil) { _model = State(initialValue: model) }

  var body: some View {
    Group {
      if let model {
        HomeContent(model: model, master: master)
          .environment(model)
          .environment(model.drag)
      } else {
        Color.clear
      }
    }
    .onAppear {
      if model == nil { model = HomeModel(context: context) }
    }
  }
}

private struct HomeContent: View {
  @Environment(AppContext.self) private var context
  @Environment(\.undoManager) private var undoManager
  @Bindable var model: HomeModel
  let master: TaskMasterState

  /// Board columns and the calendar share this minimum before the board scrolls: all five fit side by side in a
  /// 1280-point window with the sidebar open.
  private static let columnMinimum: CGFloat = 172
  private static let mainGap: CGFloat = Space.s4
  private static let stackBelow: CGFloat = 720

  var body: some View {
    let store = model.store
    VStack(alignment: .leading, spacing: 0) {
      header
      if let error = model.persistError {
        HomeErrorBanner(message: error) { withAnimation(Motion.base) { model.persistError = nil } }
          .padding(.horizontal, Space.s8)
          .padding(.bottom, Space.s3)
      }
      if !store.loaded {
        VStack(spacing: Space.s2) {
          ProgressView().controlSize(.small)
          Text("Loading tasks").font(.ui(Typography.Size.body)).foregroundStyle(Palette.inkMuted)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
      } else if let error = store.loadError, store.tasks.isEmpty, store.contexts.isEmpty {
        ErrorBanner("Tasks could not be loaded. \(error)") { Task { await store.load() } }
          .padding(.horizontal, Space.s8)
        Spacer()
      } else {
        main
          .padding(.horizontal, Space.s8)
          .padding(.bottom, Space.s6)
      }
    }
    .coordinateSpace(name: homeSpace)
    .overlay { TaskDragOverlay(contexts: store.contexts, today: model.today) }
    .homeDialog(item: $model.detail, width: 520, onDismiss: { model.dismissals += 1 }) { request in
      TaskDetailDialog(request: request).environment(model)
    }
    .homeDialog(item: $model.create, width: 520, onDismiss: { model.dismissals += 1 }) { request in
      TaskCreateDialog(request: request).environment(model)
    }
    .homeDialog(item: $model.blockDetail, width: 440, onDismiss: { model.dismissals += 1 }) { block in
      ScratchBlockDialog(blockId: block.value).environment(model)
    }
    .task { await store.run() }
    .task { await model.runClock() }
    .onAppear { model.undoManager = undoManager }
    .onChange(of: undoManager) { _, manager in model.undoManager = manager }
    .onChange(of: context.createRequests[.home]) { _, _ in model.openCreate(.today) }
    .onChange(of: store.blocks) { _, _ in updateBusy() }
    .onChange(of: model.calendarDay.events) { _, _ in updateBusy() }
    .onAppear(perform: updateBusy)
  }

  private func updateBusy() {
    let store = model.store
    let model = self.model
    model.drag.hourHeight = TodayTimelineView.hourHeight
    model.drag.busy = { [weak model] date in
      guard let model else { return [] }
      return ScratchTimeline.busy(on: date, blocks: store.blocks, events: model.eventSpans(on: date))
    }
  }

  // MARK: Header

  /// The greeting and date beside the view tabs and New task; narrow windows put the controls on a second line.
  private var header: some View {
    ViewThatFits(in: .horizontal) {
      HStack(alignment: .lastTextBaseline, spacing: Space.s4) {
        greeting(date: TaskDates.longDayLabel(model.today))
        Spacer(minLength: Space.s4)
        controls
      }
      VStack(alignment: .leading, spacing: Space.s3) {
        greeting(date: TaskDates.dayLabel(model.today))
        controls
      }
    }
    .padding(.horizontal, Space.s8)
    .padding(.top, Space.s6)
    .padding(.bottom, Space.s4)
  }

  private func greeting(date: String) -> some View {
    HStack(alignment: .firstTextBaseline, spacing: Space.s3) {
      Text("\(TaskRules.greeting(at: model.nowTime)).")
        .font(.display(Typography.Size.displayMD))
        .foregroundStyle(Palette.ink)
      Text(date)
        .font(.ui(Typography.Size.body))
        .foregroundStyle(Palette.inkMuted)
    }
    .lineLimit(1)
    .fixedSize()
  }

  private var controls: some View {
    HStack(spacing: Space.s2) {
      SegmentedTabs([(HomeModel.Mode.weekly, "Weekly"), (.master, "Master")], selection: $model.view)
        .fixedSize()
        .help("Task view")
      Button { model.openCreate(.today) } label: { Label("New task", systemImage: "plus") }
        .buttonStyle(.primary)
        .fixedSize()
        .help("New task (⌘N)")
        .disabled(!model.store.loaded)
    }
  }

  // MARK: Layout

  private var main: some View {
    GeometryReader { proxy in
      let width = proxy.size.width
      if width <= Self.stackBelow {
        ScrollView(.vertical) {
          VStack(spacing: Self.mainGap) {
            primary(columnWidth: Self.columnMinimum)
              .frame(height: max(360, proxy.size.height * 0.55))
            TodayTimelineView()
              .frame(height: max(420, proxy.size.height * 0.6))
          }
        }
        .scrollIndicators(.automatic)
      } else {
        let layout = widths(for: width)
        HStack(alignment: .top, spacing: Self.mainGap) {
          primary(columnWidth: layout.column)
            .frame(width: layout.primary)
          TodayTimelineView()
            .frame(width: layout.calendar)
        }
        .frame(maxHeight: .infinity)
      }
    }
  }

  /// Weekly: the calendar is a fifth column, and all five grow and shrink together down to the minimum, after
  /// which the board scrolls. Master: the table takes three quarters.
  private func widths(for width: CGFloat) -> (primary: CGFloat, calendar: CGFloat, column: CGFloat) {
    let gap = TaskBoardView.gap
    if model.view == .master {
      let calendar = max(Self.columnMinimum + 22, (width - Self.mainGap) / 4)
      return (width - Self.mainGap - calendar, calendar, Self.columnMinimum)
    }
    let calendar = max(Self.columnMinimum, (width - Self.mainGap - 3 * gap) / 5)
    let board = width - Self.mainGap - calendar
    let column = max(Self.columnMinimum, (board - 3 * gap) / 4)
    return (board, calendar, column)
  }

  @ViewBuilder
  private func primary(columnWidth: CGFloat) -> some View {
    switch model.view {
    case .weekly:
      let columns = TaskRules.board(model.store.tasks, today: model.today, now: model.nowTime, keeping: model.completing)
      if columns.values.allSatisfy(\.isEmpty) {
        EmptyState(systemImage: "sunrise", title: "No tasks on this board", message: "Create a task for today, tomorrow, or this week.") {
          Button { model.openCreate(.today) } label: { Label("New task", systemImage: "plus") }.buttonStyle(.primary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(RoundedRectangle(cornerRadius: Radius.card, style: .continuous).fill(Palette.surfacePaper))
      } else {
        TaskBoardView(columns: columns, columnWidth: columnWidth)
      }
    case .master:
      MasterTaskTable(state: master)
    }
  }
}
