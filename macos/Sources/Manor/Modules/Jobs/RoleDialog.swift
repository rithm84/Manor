import ManorKit
import SwiftUI

/// What the role dialog is open for.
enum RoleDialogTarget: Identifiable, Equatable {
  /// A new role, typed by hand.
  case create
  /// An existing role. A stage request makes the dialog a move draft that leads with the destination.
  case edit(roleId: String, request: JobStageRequest?)

  var id: String {
    switch self {
    case .create: return "create"
    case .edit(let roleId, let request): return "edit:\(roleId):\(String(describing: request))"
    }
  }
}

/// The centered role dialog. Nothing is stored until Save, which applies the stage and every date together;
/// Cancel, Escape, or a backdrop click with unsaved edits asks before discarding them.
struct RoleDialog: View {
  let target: RoleDialogTarget
  let store: JobsStore
  let today: String
  /// Increments when the backdrop or Escape asks the dialog to close.
  let closeRequests: Int
  let openExternal: (URL) -> Void
  let close: () -> Void

  @State private var fields: JobRoleFields
  @State private var stage: JobStage?
  private let initialFields: JobRoleFields
  private let initialStage: JobStage?
  private let role: JobRole?
  private let request: JobStageRequest?
  @State private var confirmDiscard = false
  @State private var submitting = false
  @State private var submitError: String?
  @FocusState private var focus: Field?

  enum Field: Hashable { case company, role }

  init(target: RoleDialogTarget, store: JobsStore, today: String, closeRequests: Int, openExternal: @escaping (URL) -> Void, close: @escaping () -> Void) {
    self.target = target
    self.store = store
    self.today = today
    self.closeRequests = closeRequests
    self.openExternal = openExternal
    self.close = close
    switch target {
    case .create:
      role = nil
      request = nil
      initialFields = .empty()
      initialStage = .toApply
    case .edit(let roleId, let request):
      let role = store.role(roleId)
      self.role = role
      self.request = request
      initialFields = role?.fields ?? .empty()
      initialStage = request.map { $0.initialStage } ?? role?.stage
    }
    _fields = State(initialValue: initialFields)
    _stage = State(initialValue: initialStage)
  }

  private var isCreate: Bool { role == nil }
  private var dirty: Bool { stage != initialStage || fields != initialFields }
  private var ready: Bool {
    stage != nil && !fields.company.trimmingCharacters(in: .whitespaces).isEmpty && !fields.role.trimmingCharacters(in: .whitespaces).isEmpty
  }

  /// The date a move leads with: the destination's own date, and for an OA both of its dates.
  private var leadDates: [JobDateField] {
    guard let stage else { return [] }
    if request == nil && !isCreate { return [] }
    if isCreate && stage == .toApply { return [] }
    return stage == .oa ? [.oaDueDate, .oaCompletedDate] : [stage.dateField]
  }

  private var otherDates: [JobDateField] {
    if isCreate { return [.datePosted] }
    return JobDateField.allCases.filter { !leadDates.contains($0) }
  }

  private var stageOptions: [JobStage] { request?.options ?? JobStage.allCases }

  func requestClose() {
    if submitting { return }
    if dirty { withAnimation(Motion.fast) { confirmDiscard = true } } else { close() }
  }

  var body: some View {
    VStack(spacing: 0) {
      header
      if !isCreate && role == nil {
        Text("This role is no longer on the board.").font(.ui(Typography.Size.body)).foregroundStyle(Palette.inkMuted).padding(Space.s6)
      } else {
        ScrollView {
          VStack(alignment: .leading, spacing: Space.s5) {
            if request != nil { moveSection }
            roleSection
            datesSection
          }
          .padding(.horizontal, Space.s6)
          .padding(.bottom, Space.s5)
        }
        .scrollBounceBehavior(.basedOnSize)
      }
      Hairline()
      footer
    }
    .overlay { if confirmDiscard { discardOverlay } }
    .onAppear { if request == nil { focus = .company } }
    .onExitCommand { if confirmDiscard { confirmDiscard = false } else { requestClose() } }
    .onChange(of: closeRequests) { _, _ in if !confirmDiscard { requestClose() } }
    .accessibilityLabel(isCreate ? "Add a role" : "\(role?.company ?? "Role") details")
  }

  // MARK: Sections

  private var header: some View {
    HStack(alignment: .top) {
      VStack(alignment: .leading, spacing: 2) {
        if !isCreate {
          Text(request == nil ? "Role details" : "Move role").font(.ui(Typography.Size.xs, weight: .medium)).foregroundStyle(Palette.inkMuted)
        }
        Text(isCreate ? "Add a role" : (role?.company ?? "Role")).font(.dialogTitle).foregroundStyle(Palette.ink).lineLimit(1)
      }
      Spacer()
      IconButton("xmark", label: isCreate ? "Close role editor" : "Close role details") { requestClose() }
        .disabled(submitting)
    }
    .padding(.horizontal, Space.s6)
    .padding(.top, Space.s5)
    .padding(.bottom, Space.s4)
  }

  private var moveSection: some View {
    VStack(alignment: .leading, spacing: Space.s3) {
      sectionTitle("Move to")
      HStack(alignment: .top, spacing: Space.s4) {
        stageField
        ForEach(leadDates) { field in dateField(field) }
        if leadDates.count < 2 { Color.clear.frame(maxWidth: .infinity, maxHeight: 1) }
      }
    }
    .padding(Space.s4)
    .background(RoundedRectangle(cornerRadius: Radius.card, style: .continuous).fill(Palette.surfacePaper))
    .padding(.horizontal, -Space.s2)
  }

  private var roleSection: some View {
    VStack(alignment: .leading, spacing: Space.s3) {
      sectionTitle("Role")
      HStack(alignment: .top, spacing: Space.s4) {
        LabeledField("Company") {
          TextField(isCreate ? "Anthropic" : "Company", text: $fields.company).textFieldStyle(.manor).focused($focus, equals: .company)
        }
        LabeledField("Role") {
          TextField(isCreate ? "SWE Intern" : "Role", text: $fields.role).textFieldStyle(.manor).focused($focus, equals: .role)
        }
      }
      LabeledField("Location") {
        TextField(isCreate ? "San Francisco, CA" : "Not set", text: $fields.location, axis: .vertical).lineLimit(1...4).textFieldStyle(.manor)
      }
      HStack(alignment: .top, spacing: Space.s4) {
        LabeledField("Hiring cycle") {
          TextField(isCreate ? "Summer 2027" : "Not set", text: Binding(get: { fields.term ?? "" }, set: { fields.term = $0.isEmpty ? nil : $0 }))
            .textFieldStyle(.manor)
        }
        if request == nil { stageField } else { Color.clear.frame(maxWidth: .infinity, maxHeight: 1) }
      }
      LabeledField("Posting link") {
        HStack(spacing: Space.s2) {
          TextField(isCreate ? "https://" : "Not set", text: $fields.postingLink).textFieldStyle(.manor)
          if let url = postingURL {
            IconButton("arrow.up.forward.square", label: "Open posting", size: 30) { openExternal(url) }
          }
        }
      }
      LabeledField("Resume") {
        ResumeField(selection: $fields.resumeId, store: store, openExternal: openExternal)
      }
    }
  }

  private var datesSection: some View {
    VStack(alignment: .leading, spacing: Space.s3) {
      sectionTitle("Dates")
      let dates = isCreate ? otherDates + leadDates : otherDates
      LazyVGrid(columns: [GridItem(.flexible(), spacing: Space.s4, alignment: .top), GridItem(.flexible(), alignment: .top)],
                alignment: .leading, spacing: Space.s3) {
        ForEach(dates) { field in dateField(field) }
      }
    }
  }

  private var stageField: some View {
    LabeledField(isCreate ? "Initial stage" : "Stage") {
      MenuField(options: stageOptions.map { ($0, $0.label) }, selection: $stage,
                placeholder: request?.choicePrompt ?? "Select stage", tone: { $0.tone }, accessibilityLabel: "Stage")
    }
  }

  private func dateField(_ field: JobDateField) -> some View {
    LabeledField(field.label) {
      OptionalDateField(value: Binding(get: { fields[date: field] }, set: { fields[date: field] = $0 }), label: field.label, suggested: today)
    }
  }

  private func sectionTitle(_ text: String) -> some View {
    Text(text).font(.ui(Typography.Size.sm, weight: .semibold)).foregroundStyle(Palette.ink).accessibilityAddTraits(.isHeader)
  }

  private var postingURL: URL? {
    let text = fields.postingLink.trimmingCharacters(in: .whitespaces)
    guard let url = URL(string: text), let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http", url.host != nil else { return nil }
    return url
  }

  private var footer: some View {
    HStack(spacing: Space.s2) {
      if let submitError {
        Text(submitError).font(.ui(Typography.Size.sm)).foregroundStyle(Palette.overdueError).lineLimit(3)
          .frame(maxWidth: .infinity, alignment: .leading)
      } else {
        Spacer()
      }
      Button("Cancel") { requestClose() }.buttonStyle(.secondary).disabled(submitting)
      Button(isCreate ? "Add role" : "Save changes") { submit() }
        .buttonStyle(.primary)
        .disabled(!ready || submitting)
        .keyboardShortcut(.defaultAction)
    }
    .padding(.horizontal, Space.s6)
    .padding(.vertical, Space.s3)
  }

  private var discardOverlay: some View {
    ZStack {
      Palette.overlayBackdrop.opacity(0.6).onTapGesture { confirmDiscard = false }
      ConfirmPanel(
        title: isCreate ? "Discard this role?" : "Discard changes?",
        message: isCreate ? "It has not been added yet." : "Your edits to this role have not been saved.",
        confirmLabel: "Discard", destructive: true,
        onCancel: { withAnimation(Motion.fast) { confirmDiscard = false } },
        onConfirm: { confirmDiscard = false; close() }
      )
      .frame(width: 360)
      .background(RoundedRectangle(cornerRadius: Radius.cardLarge, style: .continuous).fill(Palette.surfaceCard))
      .overlay(RoundedRectangle(cornerRadius: Radius.cardLarge, style: .continuous).strokeBorder(Palette.hairline))
      .shadow(color: .black.opacity(0.14), radius: 24, y: 10)
    }
    .transition(.opacity)
  }

  // MARK: Saving

  private func submit() {
    guard ready, let stage, !submitting else { return }
    var draft = fields
    draft.stage = stage
    submitting = true
    submitError = nil
    Task {
      do {
        if let role {
          try await store.save(roleId: role.id, fields: draft, expectedRevision: role.revision)
        } else {
          try await store.create(draft)
        }
        close()
      } catch let error as ManorRequestError where error.isConflict {
        submitError = "This role changed somewhere else. Close the dialog and open it again to see the latest."
      } catch {
        submitError = "Could not \(isCreate ? "add the role" : "save the changes"). \(error.localizedDescription)"
      }
      submitting = false
    }
  }
}
