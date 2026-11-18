import ManorKit
import SwiftUI

/// Jobs: the pipeline board with the To apply table, the application flow, and the listings catalog.
struct JobsPage: View {
  @Environment(AppContext.self) private var context
  @State private var store: JobsStore?

  var body: some View {
    Group {
      if let store {
        JobsContent(store: store)
      } else {
        Color.clear
      }
    }
    .task {
      if store == nil {
        let context = context
        let created = JobsStore(gateway: context.gateway, today: { context.today })
        store = created
        created.start()
      }
    }
  }
}

private struct JobsContent: View {
  @Environment(AppContext.self) private var context
  @Bindable var store: JobsStore
  @State private var dialog: RoleDialogTarget?
  @State private var removeCandidate: String?
  @State private var draggingId: String?
  /// Bumped by a backdrop click or Escape on the dialog, so the dialog can guard unsaved edits.
  @State private var closeRequests = 0

  private var today: String { store.state?.today ?? context.today }

  var body: some View {
    VStack(spacing: 0) {
      PageHeader("Jobs", subtitle: subtitle) {
        SegmentedTabs([(JobsView.pipeline, "Pipeline"), (JobsView.browse, "Listings")], selection: $store.view)
        Button { dialog = .create } label: { Label("Add role", systemImage: "plus") }
          .buttonStyle(.primary)
          .help("Add a role (Command-N)")
          .disabled(store.loading && store.state == nil)
      }
      if let error = store.persistError {
        ErrorBanner(error).padding(.horizontal, Space.s8).padding(.bottom, Space.s3)
          .onTapGesture { store.persistError = nil }
      }
      content
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }
    .manorDialog(item: $dialog, width: 720, onDismiss: { closeRequests += 1 }) { target in
      RoleDialog(target: target, store: store, today: today, closeRequests: closeRequests, openExternal: context.openExternal) { dialog = nil }
        .id(target.id)
    }
    .manorDialog(item: Binding(get: { removeCandidate.map(IdentifiedString.init) }, set: { removeCandidate = $0?.value }), width: 420) { candidate in
      ConfirmPanel(
        title: "Delete this role?",
        message: "\(store.role(candidate.value)?.company ?? "This role") comes off the board and moves to Trash, where it stays recoverable for seven days.",
        confirmLabel: "Delete",
        onCancel: { removeCandidate = nil },
        onConfirm: {
          let id = candidate.value
          removeCandidate = nil
          if case .edit(let roleId, _) = dialog, roleId == id { dialog = nil }
          Task { await store.trash(id, toasts: context.toasts) }
        }
      )
    }
    .onChange(of: context.createRequests[.jobs]) { _, _ in
      guard context.route == .jobs, store.state != nil else { return }
      dialog = .create
    }
  }

  private var subtitle: String? {
    guard let state = store.state else { return nil }
    let toApply = state.roles.filter { $0.stage == .toApply }.count
    let base = "\(state.roles.count) \(state.roles.count == 1 ? "role" : "roles") · \(toApply) to apply"
    return JobLabels.freshRolesNote(state).map { "\(base) · \($0)" } ?? base
  }

  private var actions: PipelineActions {
    PipelineActions(
      open: { id in dialog = .edit(roleId: id, request: nil) },
      move: { id, request in
        guard let role = store.role(id), request.moves(from: role.stage) else { return }
        dialog = .edit(roleId: id, request: request)
      },
      markOaDone: { id in Task { await store.markOaDone(id) } },
      remove: { id in removeCandidate = id }
    )
  }

  @ViewBuilder
  private var content: some View {
    if store.view == .browse {
      JobsBrowseView(store: store, today: today, openExternal: context.openExternal)
    } else if let state = store.state {
      if state.roles.isEmpty {
        EmptyState(systemImage: "briefcase", title: "No roles yet", message: "Add a role, or open Listings to pull one from the feed.") {
          HStack(spacing: Space.s2) {
            Button { dialog = .create } label: { Label("Add role", systemImage: "plus") }.buttonStyle(.primary)
            Button("Browse listings") { store.view = .browse }.buttonStyle(.secondary)
          }
        }
      } else {
        board(state)
      }
    } else if let error = store.loadError {
      ErrorBanner("Jobs could not be loaded. \(error)") { Task { await store.reload() } }
        .frame(maxWidth: 520)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    } else {
      ProgressView().controlSize(.small).frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityLabel("Loading roles")
    }
  }

  /// The pipeline: the board, then the flow of every tracked application below it.
  private func board(_ state: JobsState) -> some View {
    ScrollView(.vertical) {
      VStack(alignment: .leading, spacing: 0) {
        PipelineBoardView(grouped: store.columns, today: state.today, arrivedIds: store.arrivedIds, actions: actions, draggingId: $draggingId)
        Hairline()
          .padding(.horizontal, Space.s8)
          .padding(.top, Space.s8)
          .padding(.bottom, Space.s6)
        JobsFlowView(data: store.flowData)
          .padding(.horizontal, Space.s8)
      }
      .padding(.bottom, Space.s10)
    }
    .scrollIndicators(.automatic)
  }
}
