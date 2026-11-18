import ManorKit
import SwiftUI

/// Master: every task in one table with title search, a fixed due-first order, an additive property filter,
/// saved views, By context grouping, and a Completed toggle. View state survives switching pages.
@MainActor
@Observable
final class TaskMasterState {
  var query = ""
  var rules: [MasterFilterRule] = []
  /// Opens grouped by context; turning grouping off or on is remembered on this Mac.
  var grouped = UserDefaults.standard.object(forKey: TaskMasterState.groupedKey) as? Bool ?? true {
    didSet { UserDefaults.standard.set(grouped, forKey: Self.groupedKey) }
  }
  var completed = false
  var activeViewId: String?

  private static let groupedKey = "home.master.grouped"
}

struct MasterTaskTable: View {
  @Environment(HomeModel.self) private var model
  @Bindable var state: TaskMasterState
  @State private var filterOpen = false
  @State private var viewsOpen = false

  /// Fixed property columns; the task title takes the rest, down to `titleMinimum`.
  fileprivate enum Column {
    static let context: CGFloat = 140
    static let due: CGFloat = 144
    static let estimate: CGFloat = 88
    static let priority: CGFloat = 80
    static let status: CGFloat = 96
    static let titleMinimum: CGFloat = 200
  }

  /// Below this width the table scrolls sideways; grouping drops the Context column, so it needs less.
  private var minimumWidth: CGFloat {
    let fixed = Column.due + Column.estimate + Column.priority + Column.status + Space.s3 * 4 + Space.s3 * 2
    return Column.titleMinimum + fixed + (state.grouped ? 0 : Column.context + Space.s3)
  }

  var body: some View {
    let visible = MasterFilters.visible(model.store.tasks, rules: state.rules, query: state.query, completed: state.completed)
    VStack(alignment: .leading, spacing: Space.s3) {
      toolbar(count: visible.count)
      GeometryReader { proxy in
        let width = max(proxy.size.width, minimumWidth)
        ScrollView(proxy.size.width < minimumWidth ? [.vertical, .horizontal] : .vertical) {
          LazyVStack(alignment: .leading, spacing: 0, pinnedViews: [.sectionHeaders]) {
            Section {
              rows(visible)
              if visible.isEmpty { empty }
            } header: {
              header
            }
          }
          .frame(width: width)
        }
      }
    }
  }

  // MARK: Toolbar

  private func toolbar(count: Int) -> some View {
    HStack(spacing: Space.s2) {
      SearchField(text: $state.query, prompt: "Search tasks").frame(maxWidth: 240)
      toolButton("Filter", systemImage: "line.3.horizontal.decrease", active: !state.rules.isEmpty, badge: state.rules.isEmpty ? nil : state.rules.count) {
        filterOpen.toggle()
      }
      .popover(isPresented: $filterOpen, arrowEdge: .bottom) {
        TaskFilterPopover(state: state).environment(model)
      }
      if !state.rules.isEmpty {
        Button {
          withAnimation(Motion.base) {
            state.rules = []
            state.activeViewId = nil
          }
        } label: { Label("Clear filters", systemImage: "arrow.counterclockwise").lineLimit(1).fixedSize() }
          .buttonStyle(.manor(.ghost, size: .small))
          .foregroundStyle(Palette.inkMuted)
      }
      toolButton("By context", systemImage: "square.stack.3d.up", active: state.grouped) { withAnimation(Motion.base) { state.grouped.toggle() } }
      toolButton("Completed", systemImage: "checkmark.circle", active: state.completed) { withAnimation(Motion.base) { state.completed.toggle() } }
      toolButton("Saved views", systemImage: "bookmark", active: state.activeViewId != nil) { viewsOpen.toggle() }
        .popover(isPresented: $viewsOpen, arrowEdge: .bottom) {
          TaskSavedViewsPopover(state: state) { viewsOpen = false }.environment(model)
        }
      Spacer()
      Text("\(count)").font(.ui(Typography.Size.sm, weight: .medium)).foregroundStyle(Palette.inkMuted).tabular()
        .accessibilityLabel("\(count) tasks")
    }
  }

  private func toolButton(_ title: String, systemImage: String, active: Bool, badge: Int? = nil, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      HStack(spacing: 5) {
        Image(systemName: systemImage).font(.system(size: 12, weight: .medium))
        Text(title).font(.ui(Typography.Size.sm, weight: .medium))
        if let badge { Text("\(badge)").font(.ui(Typography.Size.xs, weight: .semibold)).tabular() }
      }
      .foregroundStyle(active ? Palette.primary : Palette.inkBody)
      .padding(.horizontal, Space.s2 + 2)
      .frame(height: 28)
      .background(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).fill(active ? Palette.primaryTint : .clear))
      .overlay(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).strokeBorder(active ? Palette.primary.opacity(0.3) : Palette.hairlineStrong))
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityAddTraits(active ? .isSelected : [])
  }

  // MARK: Table

  private var header: some View {
    HStack(spacing: Space.s3) {
      column("Task").frame(maxWidth: .infinity, alignment: .leading)
      if !state.grouped { column("Context").frame(width: Column.context, alignment: .leading) }
      column("Due").frame(width: Column.due, alignment: .leading)
      column("Estimate").frame(width: Column.estimate, alignment: .leading)
      column("Priority").frame(width: Column.priority, alignment: .leading)
      column("Status").frame(width: Column.status, alignment: .leading)
    }
    .padding(.horizontal, Space.s3)
    .frame(height: 32)
    .background(Palette.surfaceCanvas)
    .overlay(alignment: .bottom) { Hairline() }
  }

  private func column(_ title: String) -> some View {
    Text(title).font(.ui(Typography.Size.xs, weight: .semibold)).foregroundStyle(Palette.inkMuted)
  }

  @ViewBuilder
  private func rows(_ tasks: [TaskItem]) -> some View {
    if state.grouped {
      ForEach(MasterFilters.groupedByContext(tasks), id: \.context) { group in
        let context = model.store.context(named: group.context)
        HomeGroupPill(text: group.context, systemImage: context?.icon.systemImage, tone: context.map { HomeTone($0.color) } ?? .neutral, count: group.tasks.count)
          .padding(.horizontal, Space.s3)
          .padding(.top, Space.s4)
          .padding(.bottom, Space.s2)
        ForEach(group.tasks) { TaskMasterRow(task: $0, showContext: false) }
      }
    } else {
      ForEach(tasks) { TaskMasterRow(task: $0, showContext: true) }
    }
  }

  private var empty: some View {
    VStack(spacing: Space.s2) {
      if model.store.tasks.isEmpty {
        Text("No tasks yet.").font(.ui(Typography.Size.body)).foregroundStyle(Palette.inkMuted)
      } else {
        Text(state.rules.isEmpty ? (state.completed ? "No completed tasks match." : "No tasks match this search.") : "No tasks match these filters.")
          .font(.ui(Typography.Size.body)).foregroundStyle(Palette.inkMuted)
        if !state.rules.isEmpty || !state.query.isEmpty {
          Button(state.rules.isEmpty ? "Clear search" : "Clear filters") {
            state.rules = []
            state.query = ""
            state.activeViewId = nil
          }
          .buttonStyle(.manor(.secondary, size: .small))
        }
      }
    }
    .frame(maxWidth: .infinity)
    .padding(.vertical, Space.s10)
  }
}

private struct TaskMasterRow: View {
  @Environment(HomeModel.self) private var model
  let task: TaskItem
  let showContext: Bool
  @State private var hovering = false

  var body: some View {
    let bucket = TaskRules.bucket(for: task, today: model.today, now: model.nowTime)
    HStack(spacing: Space.s3) {
      HStack(spacing: Space.s2) {
        Text(task.title).font(.ui(Typography.Size.body, weight: .medium)).foregroundStyle(Palette.ink).lineLimit(1)
          .truncationMode(.tail).help(task.title)
        if let recurrence = task.recurrence {
          Image(systemName: "repeat").font(.system(size: 10, weight: .semibold)).foregroundStyle(Palette.inkMuted).help(Recurrence.label(recurrence))
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      if showContext { HomeContextPill(name: task.context, contexts: model.store.contexts).frame(width: MasterTaskTable.Column.context, alignment: .leading) }
      HomePill(text: TaskRules.dueLabel(task), tone: HomeTone(bucket)).frame(width: MasterTaskTable.Column.due, alignment: .leading)
      Group {
        if let estimate = task.estimate { HomePill(text: estimate.label, tone: HomeTone(estimate)) } else { MasterUnsetValue(property: "estimate") }
      }
      .frame(width: MasterTaskTable.Column.estimate, alignment: .leading)
      Group {
        if let priority = task.priority { HomePill(text: priority.label, tone: HomeTone(priority)) } else { MasterUnsetValue(property: "priority") }
      }
      .frame(width: MasterTaskTable.Column.priority, alignment: .leading)
      HomePill(text: task.status.label, tone: HomeTone(task.status)).frame(width: MasterTaskTable.Column.status, alignment: .leading)
    }
    .padding(.horizontal, Space.s3)
    .frame(height: 40)
    .background(hovering ? Palette.surfaceHover.opacity(0.6) : .clear)
    .overlay(alignment: .bottom) { Hairline().opacity(0.7) }
    .contentShape(Rectangle())
    .onHover { hovering = $0 }
    .onTapGesture { model.openTask(task.id) }
    .contextMenu { TaskActionsMenu(task: task) }
    .accessibilityElement(children: .combine)
    .accessibilityAddTraits(.isButton)
    .accessibilityAction { model.openTask(task.id) }
  }
}

/// An unset property cell: left blank, so filled values stand out down the column.
private struct MasterUnsetValue: View {
  let property: String

  var body: some View {
    Color.clear
      .frame(height: 22)
      .accessibilityLabel("No \(property)")
  }
}

// MARK: Filter builder

private struct TaskFilterPopover: View {
  @Environment(HomeModel.self) private var model
  @Bindable var state: TaskMasterState

  var body: some View {
    VStack(alignment: .leading, spacing: Space.s2) {
      Text("Match all rules").font(.ui(Typography.Size.xs, weight: .semibold)).foregroundStyle(Palette.inkMuted)
      if state.rules.isEmpty {
        Text("No filters. Every task is shown.").font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted).padding(.vertical, Space.s1)
      }
      ForEach($state.rules) { $rule in
        TaskRuleRow(rule: $rule, onChange: { state.activeViewId = nil }) {
          state.rules.removeAll { $0.id == rule.id }
          state.activeViewId = nil
        }
      }
      Menu {
        ForEach(MasterFilterProperty.allCases, id: \.self) { property in
          Button(property.label) {
            state.rules.append(MasterFilterRule.make(property, today: model.today, firstContext: model.store.contexts.first?.name ?? ""))
            state.activeViewId = nil
          }
          .disabled(property == .context && model.store.contexts.isEmpty)
        }
      } label: {
        Label("Add filter", systemImage: "plus").font(.ui(Typography.Size.sm, weight: .medium))
      }
      .menuStyle(.borderlessButton)
      .menuIndicator(.hidden)
      .fixedSize()
      .padding(.top, Space.s1)
    }
    .padding(Space.s3)
    .frame(minWidth: 380, alignment: .leading)
  }
}

private struct TaskRuleRow: View {
  @Environment(HomeModel.self) private var model
  @Binding var rule: MasterFilterRule
  let onChange: () -> Void
  let onRemove: () -> Void

  var body: some View {
    let today = model.today
    let firstContext = model.store.contexts.first?.name ?? ""
    HStack(spacing: Space.s1) {
      HomePropertyMenu(accessibilityLabel: "Filter property") {
        ForEach(MasterFilterProperty.allCases, id: \.self) { property in
          Button(property.label) { set(rule.changingProperty(to: property, today: today, firstContext: firstContext)) }
            .disabled(property == .context && model.store.contexts.isEmpty)
        }
      } label: { valueText(rule.property.label) }
      .fixedSize()
      Text("is").font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted)
      switch rule.condition {
      case .context(let value):
        HomePropertyMenu(accessibilityLabel: "Context filter value") {
          ForEach(model.store.contexts) { context in Button(context.name) { set(MasterFilterRule(id: rule.id, condition: .context(context.name))) } }
        } label: { HomeContextPill(name: value, contexts: model.store.contexts) }
        .fixedSize()
      case .status(let value):
        HomePropertyMenu(accessibilityLabel: "Status filter value") {
          Button("All statuses") { onRemove() }
          Divider()
          ForEach([TaskStatus.notStarted, .inProgress], id: \.self) { status in
            Button(status.label) { set(MasterFilterRule(id: rule.id, condition: .status(status))) }
          }
        } label: { HomePill(text: value.label, tone: HomeTone(value)) }
        .fixedSize()
      case .priority(let value):
        HomePropertyMenu(accessibilityLabel: "Priority filter value") {
          ForEach(TaskPriority.allCases, id: \.self) { priority in Button(priority.label) { set(MasterFilterRule(id: rule.id, condition: .priority(priority))) } }
        } label: { HomePill(text: value.label, tone: HomeTone(value)) }
        .fixedSize()
      case .due(let op, let date):
        operatorMenu(op, today: today)
        HomeDateField(date: date, today: today, accessibilityLabel: "Due date filter") { set(MasterFilterRule(id: rule.id, condition: .due(op, date: $0))) }
      case .dueWithin(let from, let to):
        operatorMenu(.within, today: today)
        HomeDateField(date: from, today: today, accessibilityLabel: "Range start") { set(MasterFilterRule(id: rule.id, condition: .dueWithin(from: $0, to: max($0, to)))) }
        Text("to").font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted)
        HomeDateField(date: to, today: today, accessibilityLabel: "Range end") { set(MasterFilterRule(id: rule.id, condition: .dueWithin(from: min(from, $0), to: $0))) }
      }
      Spacer(minLength: 0)
      IconButton("xmark", label: "Remove filter", size: 22, action: onRemove)
    }
  }

  private func operatorMenu(_ op: DueFilterOperator, today: String) -> some View {
    HomePropertyMenu(accessibilityLabel: "Due date operator") {
      ForEach(DueFilterOperator.allCases, id: \.self) { candidate in Button(candidate.label) { set(rule.changingDueOperator(to: candidate, today: today)) } }
    } label: { valueText(op.label) }
    .fixedSize()
  }

  private func valueText(_ text: String) -> some View {
    Text(text).font(.ui(Typography.Size.sm)).foregroundStyle(Palette.ink)
  }

  private func set(_ next: MasterFilterRule) {
    rule = next
    onChange()
  }
}

// MARK: Saved views

private struct TaskSavedViewsPopover: View {
  @Environment(HomeModel.self) private var model
  @Bindable var state: TaskMasterState
  let close: () -> Void
  @State private var name = ""
  @State private var error: String?
  @State private var confirmingDelete: String?
  @State private var saving = false

  var body: some View {
    VStack(alignment: .leading, spacing: Space.s2) {
      Text("Saved views").font(.ui(Typography.Size.xs, weight: .semibold)).foregroundStyle(Palette.inkMuted)
      HStack(spacing: Space.s1) {
        TextField("View name", text: $name)
          .textFieldStyle(.manor)
          .onSubmit(save)
          .onChange(of: name) { _, value in
            if value.count > 48 { name = String(value.prefix(48)) }
            error = nil
          }
        Button("Save", action: save).buttonStyle(.manor(.primary, size: .small)).disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || saving)
      }
      if state.rules.isEmpty {
        Text("A view saves the current filters.").font(.ui(Typography.Size.xs)).foregroundStyle(Palette.inkMuted)
      }
      if let error { Text(error).font(.ui(Typography.Size.xs)).foregroundStyle(Palette.overdueError).fixedSize(horizontal: false, vertical: true) }
      Hairline().padding(.vertical, Space.s1)
      if model.store.views.isEmpty {
        Text("No saved views yet.").font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted)
      }
      ForEach(model.store.views) { view in
        if confirmingDelete == view.id {
          HStack(spacing: Space.s1) {
            Text("Delete \(view.name)?").font(.ui(Typography.Size.sm)).lineLimit(1)
            Spacer()
            Button("Cancel") { confirmingDelete = nil }.buttonStyle(.manor(.ghost, size: .small))
            Button("Delete") { delete(view.id) }.buttonStyle(.manor(.danger, size: .small))
          }
          .frame(height: 30)
        } else {
          TaskSavedViewRow(view: view, active: state.activeViewId == view.id, apply: {
            state.rules = view.rules
            state.activeViewId = view.id
            close()
          }, delete: { confirmingDelete = view.id })
        }
      }
    }
    .padding(Space.s3)
    .frame(width: 300, alignment: .leading)
  }

  private func save() {
    let trimmed = name.trimmingCharacters(in: .whitespaces)
    guard !trimmed.isEmpty, !saving else { return }
    let view = SavedTaskView(id: UUID().uuidString.lowercased(), name: trimmed, rules: state.rules)
    saving = true
    Task {
      defer { saving = false }
      do {
        try await model.store.saveView(view)
        name = ""
        state.activeViewId = view.id
      } catch {
        self.error = "Could not save this view. \(error.localizedDescription)"
      }
    }
  }

  private func delete(_ id: String) {
    Task {
      do {
        try await model.store.deleteView(id)
        confirmingDelete = nil
        if state.activeViewId == id { state.activeViewId = nil }
      } catch {
        self.error = "Could not delete this view. \(error.localizedDescription)"
      }
    }
  }
}

private struct TaskSavedViewRow: View {
  let view: SavedTaskView
  let active: Bool
  let apply: () -> Void
  let delete: () -> Void
  @State private var hovering = false

  var body: some View {
    HStack(spacing: Space.s1) {
      Button(action: apply) {
        HStack {
          Text(view.name).font(.ui(Typography.Size.sm, weight: active ? .semibold : .regular)).foregroundStyle(Palette.ink).lineLimit(1)
          Spacer()
          Text("\(view.rules.count)").font(.ui(Typography.Size.xs)).foregroundStyle(Palette.inkMuted).tabular()
        }
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      IconButton("trash", label: "Delete \(view.name)", size: 22, action: delete).opacity(hovering ? 1 : 0)
    }
    .padding(.horizontal, Space.s2)
    .frame(height: 30)
    .rowBackground(selected: active)
    .onHover { hovering = $0 }
    .contextMenu {
      Button("Apply view", action: apply)
      Divider()
      Button("Delete view…", role: .destructive, action: delete)
    }
  }
}
