import ManorKit
import SwiftUI

// MARK: Property rows

/// A compact property row: icon and label in a stable column, the control beside it.
struct HomePropertyRow<Control: View>: View {
  let systemImage: String
  let label: String
  var required = false
  @ViewBuilder let control: () -> Control
  @State private var hovering = false

  var body: some View {
    HStack(spacing: Space.s2) {
      Image(systemName: systemImage).font(.system(size: 12, weight: .medium)).foregroundStyle(Palette.inkMuted).frame(width: 20)
      HStack(spacing: 2) {
        Text(label).font(.ui(Typography.Size.sm, weight: .medium)).foregroundStyle(Palette.inkMuted)
        if required { Text("*").font(.ui(Typography.Size.sm, weight: .medium)).foregroundStyle(Palette.inkMuted).accessibilityHidden(true) }
      }
      .frame(width: 92, alignment: .leading)
      control().frame(maxWidth: .infinity, alignment: .leading)
    }
    .padding(.horizontal, Space.s2)
    .frame(minHeight: 36)
    .background(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).fill(hovering ? Palette.surfaceSoft : .clear))
    .onHover { hovering = $0 }
    .animation(Motion.fast, value: hovering)
  }
}

/// The title row and close control every task dialog shares.
struct TaskDialogHeader: View {
  let title: String
  let closeLabel: String
  let onClose: () -> Void

  var body: some View {
    HStack {
      Text(title).font(.dialogTitle).foregroundStyle(Palette.ink)
      Spacer()
      IconButton("xmark", label: closeLabel, action: onClose)
    }
    .padding(.leading, Space.s5)
    .padding(.trailing, Space.s4)
    .frame(height: 44)
    .overlay(alignment: .bottom) { Hairline() }
  }
}

/// Due date with an optional time: date-only stays available, and a time can be added or removed.
struct TaskDeadlineControl: View {
  let date: String?
  let time: String?
  let today: String
  var minimum: String?
  let onDate: (String) -> Void
  let onTime: (String?) -> Void

  var body: some View {
    HStack(spacing: Space.s1) {
      HomeDateField(date: date, minimum: minimum, today: today, accessibilityLabel: "Due date", onChange: onDate)
      if let time {
        HomeTimeField(time: time) { onTime($0) }
        IconButton("xmark", label: "Remove due time", size: 22) { onTime(nil) }
      } else {
        Button { onTime("12:00") } label: {
          Label("Add time", systemImage: "clock").font(.ui(Typography.Size.sm, weight: .medium)).foregroundStyle(Palette.inkMuted)
        }
        .buttonStyle(.manor(.ghost, size: .small))
      }
    }
  }
}

/// Estimate, Priority, and Status pickers.
struct TaskEstimateMenu: View {
  let value: TaskEstimate?
  var placeholder = "None"
  let onChange: (TaskEstimate?) -> Void
  var body: some View {
    HomePropertyMenu(accessibilityLabel: "Time estimate") {
      ForEach(TaskEstimate.allCases, id: \.self) { option in CheckedMenuItem(option.label, selected: value == option) { onChange(option) } }
      if value != nil {
        Divider()
        Button("Clear") { onChange(nil) }
      }
    } label: {
      if let value { HomePill(text: value.label, tone: HomeTone(value)) } else { HomeEmptyValue(text: placeholder) }
    }
  }
}

struct TaskPriorityMenu: View {
  let value: TaskPriority?
  var placeholder = "None"
  let onChange: (TaskPriority?) -> Void
  var body: some View {
    HomePropertyMenu(accessibilityLabel: "Priority") {
      ForEach(TaskPriority.allCases, id: \.self) { option in CheckedMenuItem(option.label, selected: value == option) { onChange(option) } }
      if value != nil {
        Divider()
        Button("Clear") { onChange(nil) }
      }
    } label: {
      if let value { HomePill(text: value.label, tone: HomeTone(value)) } else { HomeEmptyValue(text: placeholder) }
    }
  }
}

struct TaskStatusMenu: View {
  let value: TaskStatus
  let onChange: (TaskStatus) -> Void
  var body: some View {
    HomePropertyMenu(accessibilityLabel: "Status") {
      ForEach(TaskStatus.allCases, id: \.self) { option in CheckedMenuItem(option.label, selected: value == option) { onChange(option) } }
    } label: {
      HomePill(text: value.label, tone: HomeTone(value))
    }
  }
}

/// The Repeats row: a summary that expands the editor in place.
struct TaskRepeatsRow: View {
  let value: String?
  let today: String
  @Binding var expanded: Bool
  let onChange: (String?) -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HomePropertyRow(systemImage: "repeat", label: "Repeats") {
        Button { withAnimation(Motion.base) { expanded.toggle() } } label: {
          HStack {
            Text(value.map(Recurrence.label) ?? "Doesn't repeat").font(.ui(Typography.Size.sm)).foregroundStyle(value == nil ? Palette.inkMuted : Palette.ink).lineLimit(1)
            Spacer()
            Image(systemName: "chevron.down").font(.system(size: 9, weight: .semibold)).foregroundStyle(Palette.inkMuted)
              .rotationEffect(.degrees(expanded ? 180 : 0))
          }
          .padding(.horizontal, Space.s2)
          .frame(height: 30)
          .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityValue(expanded ? "Expanded" : "Collapsed")
      }
      if expanded {
        TaskRecurrenceEditor(value: value, today: today, onChange: onChange)
          .padding(.leading, 20 + 92 + Space.s2 * 3)
          .padding(.vertical, Space.s2)
          .transition(.opacity)
      }
    }
  }
}

// MARK: Task detail

/// The centered task detail. Edits form a local draft; Save changes or closing commits it, and a failed save
/// keeps it with the error. Completion stays on the card.
struct TaskDetailDialog: View {
  @Environment(HomeModel.self) private var model
  let request: HomeModel.DetailRequest

  @State private var draft: TaskItem?
  @State private var baseline: TaskItem?
  @State private var saving = false
  @State private var error: String?
  @State private var repeatsOpen = false
  @FocusState private var titleFocused: Bool
  /// The caret lands after the title instead of selecting all of it, so a stray keystroke never replaces it.
  @State private var titleSelection: TextSelection?

  var body: some View {
    VStack(spacing: 0) {
      TaskDialogHeader(title: "Task", closeLabel: "Close task details") { close() }
      if let draft = Binding($draft) {
        HomeFittedScroll {
          VStack(alignment: .leading, spacing: 0) {
            TextField("Task title", text: draft.title, selection: $titleSelection, axis: .vertical)
              .textFieldStyle(.plain)
              .font(.ui(21, weight: .semibold))
              .foregroundStyle(Palette.ink)
              .focused($titleFocused)
              .onSubmit { close() }
              .padding(.horizontal, Space.s5)
              .padding(.top, Space.s5)
              .padding(.bottom, Space.s3)
            if request.dueAttention {
              Text("Choose an exact date in the next seven days.")
                .font(.ui(Typography.Size.sm, weight: .medium))
                .foregroundStyle(Palette.pillWeek)
                .padding(.horizontal, Space.s3)
                .padding(.vertical, Space.s2)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).fill(Palette.pillWeekTint))
                .padding(.horizontal, Space.s4)
                .padding(.bottom, Space.s2)
            }
            properties(draft)
              .padding(.horizontal, Space.s3)
              .padding(.bottom, Space.s3)
            if let error {
              Text(error).font(.ui(Typography.Size.sm)).foregroundStyle(Palette.overdueError)
                .padding(.horizontal, Space.s5).padding(.bottom, Space.s3)
                .fixedSize(horizontal: false, vertical: true)
            }
          }
        }
        .scrollBounceBehavior(.basedOnSize)
        Hairline()
        footer(draft.wrappedValue)
      } else {
        EmptyState(systemImage: "checklist", title: "This task is no longer here", message: "It may have been deleted or completed elsewhere.")
          .frame(height: 220)
      }
    }
    .onAppear(perform: reset)
    .onChange(of: request.id) { _, _ in reset() }
    .onChange(of: model.dismissals) { _, _ in close() }
  }

  private func reset() {
    let task = model.store.task(request.id)
    draft = task
    baseline = task
    error = nil
    repeatsOpen = false
    titleFocused = !request.dueAttention
    if let title = task?.title {
      DispatchQueue.main.async { titleSelection = TextSelection(insertionPoint: title.endIndex) }
    }
  }

  @ViewBuilder
  private func properties(_ draft: Binding<TaskItem>) -> some View {
    let today = model.today
    VStack(alignment: .leading, spacing: 0) {
      if draft.wrappedValue.isRecurring {
        HomePropertyRow(systemImage: "repeat.circle", label: "Apply to") {
          HomePropertyMenu(accessibilityLabel: "Recurring task edit scope") {
            CheckedMenuItem("This occurrence", selected: draft.wrappedValue.recurrenceScope != .future) { draft.wrappedValue.recurrenceScope = .this }
            CheckedMenuItem("This and future occurrences", selected: draft.wrappedValue.recurrenceScope == .future) { draft.wrappedValue.recurrenceScope = .future }
          } label: {
            Text(draft.wrappedValue.recurrenceScope == .future ? "This and future occurrences" : "This occurrence")
              .font(.ui(Typography.Size.sm)).foregroundStyle(Palette.ink)
          }
        }
      }
      HomePropertyRow(systemImage: "checkmark.circle", label: "Status") {
        TaskStatusMenu(value: draft.wrappedValue.status) { draft.wrappedValue.status = $0 }
      }
      HomePropertyRow(systemImage: "calendar", label: "Due") {
        TaskDeadlineControl(date: draft.wrappedValue.due, time: draft.wrappedValue.dueTime, today: today,
          onDate: { draft.wrappedValue.due = $0 }, onTime: { draft.wrappedValue.dueTime = $0 })
      }
      HomePropertyRow(systemImage: "square.stack.3d.up", label: "Context") {
        TaskContextPicker(value: draft.wrappedValue.context, onChange: { draft.wrappedValue.context = $0 }, onRenamed: { old, new in
          if draft.wrappedValue.context == old { draft.wrappedValue.context = new }
          if baseline?.context == old { baseline?.context = new }
          if let fresh = model.store.task(request.id) {
            draft.wrappedValue.revision = fresh.revision
            baseline?.revision = fresh.revision
          }
        })
      }
      HomePropertyRow(systemImage: "clock", label: "Estimate") {
        TaskEstimateMenu(value: draft.wrappedValue.estimate) { draft.wrappedValue.estimate = $0 }
      }
      HomePropertyRow(systemImage: "flag", label: "Priority") {
        TaskPriorityMenu(value: draft.wrappedValue.priority) { draft.wrappedValue.priority = $0 }
      }
      TaskRepeatsRow(value: draft.wrappedValue.recurrence, today: today, expanded: $repeatsOpen) { draft.wrappedValue.recurrence = $0 }
    }
  }

  private var dirty: Bool {
    guard var draft, let baseline else { return false }
    draft.title = draft.title.trimmingCharacters(in: .whitespacesAndNewlines)
    return !draft.sameContent(as: baseline)
  }

  private func footer(_ task: TaskItem) -> some View {
    HStack(spacing: Space.s2) {
      Button { delete(task) } label: { Label("Delete", systemImage: "trash").foregroundStyle(Palette.overdueError) }
        .buttonStyle(.manor(.ghost, size: .small))
      Button { duplicate() } label: { Label("Duplicate", systemImage: "plus.square.on.square") }
        .buttonStyle(.manor(.ghost, size: .small))
        .disabled(saving)
      if task.isRecurring && task.status != .done {
        Button { model.skip(task.id) } label: { Label("Skip", systemImage: "forward") }
          .buttonStyle(.manor(.ghost, size: .small))
          .help("Skip this occurrence")
      }
      Spacer()
      Button { close() } label: { Label(saving ? "Saving" : "Save changes", systemImage: "checkmark") }
        .buttonStyle(.primary)
        .keyboardShortcut(.defaultAction)
        .disabled(!dirty || saving)
    }
    .padding(.horizontal, Space.s5)
    .padding(.vertical, Space.s3)
  }

  private func validated() throws -> TaskItem? {
    guard var draft else { return nil }
    draft.title = draft.title.trimmingCharacters(in: .whitespacesAndNewlines)
    if draft.title.isEmpty { throw TaskRecordError("Enter a task title") }
    return draft
  }

  /// Closing commits the draft; a failed save keeps the dialog open with the error.
  func close() {
    guard !saving else { return }
    guard dirty else {
      model.detail = nil
      return
    }
    commit { model.detail = nil }
  }

  private func commit(then: @escaping () -> Void) {
    do {
      guard let task = try validated() else { return then() }
      saving = true
      error = nil
      Task {
        defer { saving = false }
        do {
          try await model.save(task)
          then()
        } catch {
          self.error = error.localizedDescription
        }
      }
    } catch {
      self.error = error.localizedDescription
    }
  }

  private func duplicate() {
    guard !saving else { return }
    let finish = {
      if let task = try? validated() { Task { await model.duplicate(task) } }
      model.detail = nil
    }
    if dirty { commit(then: finish) } else { finish() }
  }

  private func delete(_ task: TaskItem) {
    model.trash(task.id)
  }
}

// MARK: Task creation

/// The shared creation dialog for every creatable entry point. Context begins unset and must be chosen or
/// created; Today and Tomorrow seed their date, This Week needs an exact one. Repeats creates the series.
struct TaskCreateDialog: View {
  @Environment(HomeModel.self) private var model
  let request: HomeModel.CreateRequest

  @State private var draft = Draft()
  @State private var initial = Draft()
  @State private var saving = false
  @State private var error: String?
  @State private var repeatsOpen = false
  @State private var confirmDiscard = false
  @FocusState private var titleFocused: Bool

  struct Draft: Equatable {
    var title = ""
    var context: String?
    var due: String?
    var dueTime: String?
    var estimate: TaskEstimate?
    var priority: TaskPriority?
    var recurrence: String?
  }

  var body: some View {
    let today = model.today
    VStack(spacing: 0) {
      TaskDialogHeader(title: "New task", closeLabel: "Close new task") { requestClose() }
      HomeFittedScroll {
        VStack(alignment: .leading, spacing: 0) {
          TextField("What needs doing?", text: $draft.title, axis: .vertical)
            .textFieldStyle(.plain)
            .font(.ui(21, weight: .semibold))
            .foregroundStyle(Palette.ink)
            .focused($titleFocused)
            .onSubmit(submit)
            .onChange(of: draft.title) { _, value in if value.count > 160 { draft.title = String(value.prefix(160)) } }
            .padding(.horizontal, Space.s5)
            .padding(.top, Space.s5)
            .padding(.bottom, Space.s3)
          VStack(alignment: .leading, spacing: 0) {
            HomePropertyRow(systemImage: "square.stack.3d.up", label: "Context", required: true) {
              TaskContextPicker(value: draft.context, placeholder: "Choose or add Context", onChange: { draft.context = $0 },
                onRemoved: { name in if draft.context == name { draft.context = nil } },
                onRenamed: { old, new in if draft.context == old { draft.context = new } })
            }
            HomePropertyRow(systemImage: "calendar", label: "Due", required: true) {
              TaskDeadlineControl(date: draft.due, time: draft.dueTime, today: today, minimum: today,
                onDate: { draft.due = $0 }, onTime: { draft.dueTime = $0 })
            }
            HomePropertyRow(systemImage: "clock", label: "Estimate") {
              TaskEstimateMenu(value: draft.estimate, placeholder: "None") { draft.estimate = $0 }
            }
            HomePropertyRow(systemImage: "flag", label: "Priority") {
              TaskPriorityMenu(value: draft.priority, placeholder: "None") { draft.priority = $0 }
            }
            TaskRepeatsRow(value: draft.recurrence, today: today, expanded: $repeatsOpen) { draft.recurrence = $0 }
          }
          .padding(.horizontal, Space.s3)
          if request.bucket == .week && draft.due == nil {
            Text("Choose an exact date in the next seven days.")
              .font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted)
              .padding(.horizontal, Space.s5).padding(.top, Space.s2)
          }
          if let error {
            Text(error).font(.ui(Typography.Size.sm)).foregroundStyle(Palette.overdueError)
              .padding(.horizontal, Space.s5).padding(.top, Space.s2)
              .fixedSize(horizontal: false, vertical: true)
          }
        }
        .padding(.bottom, Space.s3)
      }
      .scrollBounceBehavior(.basedOnSize)
      Hairline()
      HStack(spacing: Space.s2) {
        Text("Return to create").font(.ui(Typography.Size.xs)).foregroundStyle(Palette.inkMuted)
        Spacer()
        Button("Cancel") { requestClose() }.buttonStyle(.secondary)
        Button(saving ? "Creating" : "Create task", action: submit)
          .buttonStyle(.primary)
          .keyboardShortcut(confirmDiscard ? nil : .defaultAction)
          .disabled(!canSubmit)
      }
      .padding(.horizontal, Space.s5)
      .padding(.vertical, Space.s3)
    }
    .overlay { if confirmDiscard { discardConfirmation } }
    .onChange(of: model.dismissals) { _, _ in if !confirmDiscard { requestClose() } }
    .animation(Motion.fast, value: confirmDiscard)
    .onAppear {
      let fresh = Draft(due: TaskRules.creationDefaultDue(for: request.bucket, today: model.today))
      draft = fresh
      initial = fresh
      titleFocused = true
    }
  }

  private var canSubmit: Bool {
    !draft.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && draft.context != nil && draft.due != nil && !saving
  }

  /// Escape, the backdrop, and Cancel ask before discarding typed work.
  func requestClose() {
    if draft != initial { confirmDiscard = true } else { model.create = nil }
  }

  private func submit() {
    guard canSubmit, let context = draft.context else { return }
    do {
      let due = try TaskRules.dueForCreation(bucket: request.bucket, today: model.today, selected: draft.due)
      let task = TaskItem(
        id: UUID().uuidString.lowercased(), title: draft.title.trimmingCharacters(in: .whitespacesAndNewlines), context: context,
        estimate: draft.estimate, priority: draft.priority, status: .notStarted, due: due, dueTime: draft.dueTime, recurrence: draft.recurrence
      )
      saving = true
      error = nil
      Task {
        defer { saving = false }
        do {
          try await model.store.saveTask(task)
          model.create = nil
        } catch {
          self.error = error.localizedDescription
        }
      }
    } catch {
      self.error = error.localizedDescription
    }
  }

  private var discardConfirmation: some View {
    ZStack {
      Palette.overlayBackdrop.opacity(0.6)
        .onTapGesture { confirmDiscard = false }
      ConfirmPanel(title: "Discard this task?", message: "It has not been created yet.", confirmLabel: "Discard", destructive: true,
        onCancel: { confirmDiscard = false }, onConfirm: {
          confirmDiscard = false
          model.create = nil
        })
        .frame(width: 340)
        .background(RoundedRectangle(cornerRadius: Radius.cardLarge, style: .continuous).fill(Palette.surfaceCard))
        .overlay(RoundedRectangle(cornerRadius: Radius.cardLarge, style: .continuous).strokeBorder(Palette.hairline))
        .shadow(color: .black.opacity(0.16), radius: 20, y: 8)
    }
    .transition(.opacity)
  }
}

// MARK: Scratch block detail

/// A time block's dialog: date, start, duration, and the portion label (or its own title when freestanding).
/// Closing saves; Delete removes the block and leaves its task untouched.
struct ScratchBlockDialog: View {
  @Environment(HomeModel.self) private var model
  let blockId: String

  @State private var draft: ScratchBlock?
  @State private var baseline: ScratchBlock?
  @State private var saving = false
  @State private var error: String?
  @FocusState private var titleFocused: Bool

  var body: some View {
    VStack(spacing: 0) {
      if let draft = Binding($draft) {
        let task = draft.wrappedValue.taskId.flatMap(model.store.task)
        HStack(alignment: .center) {
          if let task {
            Text(task.title).font(.ui(Typography.Size.emphasis, weight: .semibold)).foregroundStyle(Palette.ink).lineLimit(2)
          } else {
            TextField("What is this time for?", text: draft.portion)
              .textFieldStyle(.plain)
              .font(.ui(Typography.Size.emphasis, weight: .semibold))
              .focused($titleFocused)
              .onChange(of: draft.wrappedValue.portion) { _, value in if value.count > 80 { draft.wrappedValue.portion = String(value.prefix(80)) } }
              .accessibilityLabel("Time block title")
          }
          Spacer()
          IconButton("xmark", label: "Close time block") { close() }
        }
        .padding(.leading, Space.s5)
        .padding(.trailing, Space.s4)
        .padding(.vertical, Space.s3)
        .overlay(alignment: .bottom) { Hairline() }

        VStack(alignment: .leading, spacing: 0) {
          HomePropertyRow(systemImage: "calendar", label: "Date") {
            HomeDateField(date: draft.wrappedValue.date, today: model.today, accessibilityLabel: "Block date") { date in
              draft.wrappedValue.date = date
              draft.wrappedValue.expiresAt = ScratchTimeline.expiry(date: date, end: draft.wrappedValue.end, timeZone: model.timeZone)
            }
          }
          if task != nil {
            HomePropertyRow(systemImage: "text.alignleft", label: "Portion") {
              TextField("Portion", text: draft.portion).textFieldStyle(.manor).accessibilityLabel("Time block portion")
            }
          }
          HomePropertyRow(systemImage: "clock", label: "Starts") {
            HomePropertyMenu(accessibilityLabel: "Block start time") {
              ForEach(Array(stride(from: ScratchTimeline.startMinutes, to: ScratchTimeline.endMinutes, by: ScratchTimeline.snap)), id: \.self) { minute in
                CheckedMenuItem(TaskDates.clock(TaskDates.time(fromMinutes: minute)), selected: draft.wrappedValue.startMinutes == minute) { schedule(draft, start: minute, minutes: duration(draft.wrappedValue)) }
              }
            } label: {
              Text(TaskDates.clock(draft.wrappedValue.start)).font(.ui(Typography.Size.sm)).foregroundStyle(Palette.ink).tabular()
            }
          }
          HomePropertyRow(systemImage: "hourglass", label: "Duration") {
            HomePropertyMenu(accessibilityLabel: "Block duration") {
              ForEach(ScratchTimeline.durationOptions(current: duration(draft.wrappedValue)), id: \.self) { minutes in
                CheckedMenuItem(ScratchTimeline.durationLabel(minutes), selected: duration(draft.wrappedValue) == minutes) { schedule(draft, start: draft.wrappedValue.startMinutes, minutes: minutes) }
              }
            } label: {
              Text(ScratchTimeline.durationLabel(duration(draft.wrappedValue))).font(.ui(Typography.Size.sm)).foregroundStyle(Palette.ink).tabular()
            }
          }
          if let error {
            Text(error).font(.ui(Typography.Size.sm)).foregroundStyle(Palette.overdueError).padding(.horizontal, Space.s2).padding(.top, Space.s2)
              .fixedSize(horizontal: false, vertical: true)
          }
        }
        .padding(Space.s3)

        Hairline()
        HStack {
          Button { delete() } label: { Label("Delete block", systemImage: "trash").foregroundStyle(Palette.overdueError) }
            .buttonStyle(.manor(.ghost, size: .small))
            .disabled(saving)
          Spacer()
          Button(saving ? "Saving" : "Done") { close() }
            .buttonStyle(.primary)
            .keyboardShortcut(.defaultAction)
            .disabled(saving)
        }
        .padding(.horizontal, Space.s5)
        .padding(.vertical, Space.s3)
      } else {
        EmptyState(systemImage: "clock", title: "This time block is gone").frame(height: 180)
      }
    }
    .onChange(of: model.dismissals) { _, _ in close() }
    .onAppear {
      draft = model.store.block(blockId)
      baseline = draft
      titleFocused = draft?.taskId == nil && draft?.portion.isEmpty == true
    }
  }

  private func duration(_ block: ScratchBlock) -> Int { block.endMinutes - block.startMinutes }

  private func schedule(_ draft: Binding<ScratchBlock>, start: Int, minutes: Int) {
    guard ScratchTimeline.isValidSpan(start: start, minutes: minutes) else {
      error = "Choose a 15-minute boundary between 6 AM and midnight."
      return
    }
    error = nil
    draft.wrappedValue.start = TaskDates.time(fromMinutes: start)
    draft.wrappedValue.end = TaskDates.time(fromMinutes: start + minutes)
    draft.wrappedValue.expiresAt = ScratchTimeline.expiry(date: draft.wrappedValue.date, end: draft.wrappedValue.end, timeZone: model.timeZone)
  }

  func close() {
    guard !saving else { return }
    guard let draft, draft != baseline else {
      model.blockDetail = nil
      return
    }
    saving = true
    Task {
      defer { saving = false }
      do {
        try await model.store.saveBlock(draft)
        model.blockDetail = nil
      } catch {
        self.error = "Could not save the time block. \(error.localizedDescription)"
      }
    }
  }

  private func delete() {
    saving = true
    Task {
      defer { saving = false }
      do {
        try await model.deleteBlock(blockId)
        model.blockDetail = nil
      } catch {
        self.error = "Could not delete the time block. \(error.localizedDescription)"
      }
    }
  }
}
