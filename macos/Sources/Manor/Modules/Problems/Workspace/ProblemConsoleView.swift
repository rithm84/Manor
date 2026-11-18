import ManorKit
import SwiftUI

/// The console under the editor: Testcase and Test Result tabs. Both stay alive so a result keeps its selected case.
struct WorkspaceConsole: View {
  @Bindable var model: ProblemWorkspaceModel
  let detail: ProblemDetail

  var body: some View {
    VStack(spacing: 0) {
      HStack(spacing: Space.s1) {
        WorkspaceStripTab(title: "Testcase", selected: model.consoleTab == .testcase) { model.consoleTab = .testcase }
        WorkspaceStripTab(title: "Test Result", selected: model.consoleTab == .result) { model.consoleTab = .result }
        Spacer(minLength: 0)
      }
      .padding(.horizontal, Space.s3)
      .frame(height: workspaceStripHeight - 1)
      Hairline()
      ScrollView {
        VStack(alignment: .leading, spacing: Space.s3) {
          notices
          ZStack(alignment: .topLeading) {
            testcases.opacity(model.consoleTab == .testcase ? 1 : 0).allowsHitTesting(model.consoleTab == .testcase)
              .accessibilityHidden(model.consoleTab != .testcase)
            result.opacity(model.consoleTab == .result ? 1 : 0).allowsHitTesting(model.consoleTab == .result)
              .accessibilityHidden(model.consoleTab != .result)
          }
        }
        .padding(.horizontal, Space.s4)
        .padding(.top, Space.s3)
        .padding(.bottom, Space.s8)
        .frame(maxWidth: .infinity, alignment: .leading)
      }
    }
    .background(Palette.surfaceCanvas)
  }

  @ViewBuilder private var notices: some View {
    if let error = model.error {
      VStack(alignment: .leading, spacing: Space.s2) {
        ErrorBanner(error)
        HStack(spacing: Space.s2) {
          if let pending = model.pendingExecution {
            Button("Retry previous \(pending.mode == .run ? "run" : "submission")") { model.retryExecution() }
              .buttonStyle(.manor(.secondary, size: .small)).disabled(model.busy)
          }
          if model.draftConflict != nil {
            Button("Compare drafts") { model.showConflict = true }.buttonStyle(.manor(.secondary, size: .small))
          } else if model.draftStatus == .failed, model.hasCode {
            Button("Retry saving code") { Task { await model.retryDraft() } }.buttonStyle(.manor(.secondary, size: .small))
          }
        }
      }
    }
    if let resultError = model.resultError {
      ErrorBanner(resultError) { model.retryResults() }
    }
  }

  @ViewBuilder private var testcases: some View {
    VStack(alignment: .leading, spacing: Space.s3) {
      if !detail.gradingAvailable {
        Text("This problem has no tests yet. Run your code with your own input, or ask Codex to add tests.")
          .font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted)
      }
      if let fields = model.fields {
        TestcaseEditorView(model: model, fields: fields)
      } else {
        VStack(alignment: .leading, spacing: Space.s1) {
          Text("Input").font(.ui(Typography.Size.xs, weight: .medium)).foregroundStyle(Palette.inkMuted)
          WorkspaceConsoleField(text: $model.stdinInput, placeholder: detail.gradingAvailable ? "Leave empty to run the examples" : "Input sent to stdin", minLines: 4, invalid: false)
        }
      }
    }
  }

  @ViewBuilder private var result: some View {
    let pending = model.running ?? (model.submission?.isPending == true ? model.submission?.mode : nil)
    if let pending {
      WorkspacePendingVerdict(mode: pending)
    } else if let submission = model.submission {
      WorkspaceTestResult(submission: submission, fields: model.fields).id(submission.id)
    } else {
      Text("Run your code to see results here.").font(.ui()).foregroundStyle(Palette.inkMuted)
    }
  }
}

/// One labeled field per parameter, in cases the user can add, edit, and remove before a Run.
private struct TestcaseEditorView: View {
  @Bindable var model: ProblemWorkspaceModel
  let fields: [TestcaseField]

  var body: some View {
    let selected = min(model.selectedCase, max(0, model.cases.count - 1))
    VStack(alignment: .leading, spacing: Space.s3) {
      HStack(spacing: Space.s2) {
        ForEach(Array(model.cases.enumerated()), id: \.element.id) { index, _ in
          WorkspaceCaseChip(
            title: "Case \(index + 1)", selected: selected == index, invalid: model.invalidCase?.caseIndex == index,
            onRemove: model.cases.count > 1 && !model.busy ? { model.removeCase(index) } : nil
          ) { model.selectedCase = index }
        }
        IconButton("plus", label: "Add a case", size: 28) { model.addCase() }
          .disabled(model.busy)
      }
      if model.cases.indices.contains(selected) {
        VStack(alignment: .leading, spacing: Space.s3) {
          ForEach(Array(fields.enumerated()), id: \.offset) { index, field in
            VStack(alignment: .leading, spacing: Space.s1) {
              Text(field.label).font(.ui(Typography.Size.xs, weight: .medium)).foregroundStyle(Palette.inkMuted)
              WorkspaceConsoleField(
                text: Binding(
                  get: { model.cases.indices.contains(selected) && model.cases[selected].values.indices.contains(index) ? model.cases[selected].values[index] : "" },
                  set: { model.editCase(field: index, value: $0) }
                ),
                placeholder: nil, minLines: 1,
                invalid: model.invalidCase.map { $0.caseIndex == selected && $0.fieldIndex == index } ?? false
              )
              .disabled(model.busy)
            }
          }
        }
        .id(model.cases[selected].id)
      }
    }
  }
}

/// A monospaced field that grows with its lines.
struct WorkspaceConsoleField: View {
  @Binding var text: String
  let placeholder: String?
  let minLines: Int
  let invalid: Bool
  @FocusState private var focused: Bool

  var body: some View {
    TextField(placeholder ?? "", text: $text, axis: .vertical)
      .textFieldStyle(.plain)
      .font(.code(Typography.Size.sm))
      .foregroundStyle(Palette.ink)
      .lineLimit(minLines...12)
      .focused($focused)
      .autocorrectionDisabled()
      .padding(.horizontal, Space.s3)
      .padding(.vertical, Space.s2)
      .background(Palette.surfacePaper, in: RoundedRectangle(cornerRadius: Radius.control))
      .overlay(
        RoundedRectangle(cornerRadius: Radius.control)
          .strokeBorder(invalid ? Palette.overdueError : focused ? Palette.focusBorder : Palette.hairline, lineWidth: focused || invalid ? 1.5 : 1)
      )
  }
}

/// The bar under the console: the Console toggle on the left, Run and Submit on the right, each with its own spinner.
struct WorkspaceActionBar: View {
  @Bindable var model: ProblemWorkspaceModel
  /// Shortcuts apply only while this workspace is the visible page.
  let active: Bool

  var body: some View {
    HStack(spacing: Space.s3) {
      Button { withAnimation(Motion.base) { model.consoleOpen.toggle() } } label: {
        HStack(spacing: Space.s1) {
          Text("Console")
          Image(systemName: model.consoleOpen ? "chevron.down" : "chevron.up").font(.system(size: 11, weight: .semibold))
        }
        .font(.ui(Typography.Size.sm, weight: .medium))
      }
      .buttonStyle(.manor(.ghost, size: .small))
      .help(model.consoleOpen ? "Hide the console" : "Show the console")
      Spacer()
      Button(action: model.run) {
        HStack(spacing: Space.s1) {
          if model.running == .run { ProgressView().controlSize(.mini) } else { Image(systemName: "play.fill") }
          Text("Run")
        }
      }
      .buttonStyle(.manor(.secondary, size: .small))
      .disabled(model.running != nil || !model.canRun)
      .keyboardShortcut(active ? KeyboardShortcut(.return, modifiers: [.command]) : nil)
      .help("Run (⌘↩)")
      Button(action: model.submit) {
        HStack(spacing: Space.s1) {
          if model.running == .submit { ProgressView().controlSize(.mini) } else { Image(systemName: "icloud.and.arrow.up") }
          Text("Submit")
        }
      }
      .buttonStyle(.manor(.primary, size: .small))
      .disabled(model.running != nil || !model.canSubmit)
      .keyboardShortcut(active ? KeyboardShortcut(.return, modifiers: [.command, .shift]) : nil)
      .help("Submit (⇧⌘↩)")
    }
    .padding(.horizontal, Space.s3)
    .frame(height: workspaceStripHeight - 1)
  }
}
