import AppKit
import ManorKit
import SwiftUI

/// The solving workspace for one problem: the reader (Description, Submissions, Solution) beside the code
/// editor and console. The library presents it when a problem opens; `onClose` returns to the library.
/// Read-only problems open here too, without execution controls.
struct ProblemWorkspaceView: View {
  let problemId: String
  let onClose: () -> Void
  @Environment(AppContext.self) private var context

  var body: some View {
    let services = ProblemWorkspaceWarmup.services(context.gateway)
    ProblemWorkspaceContent(model: ProblemWorkspaceStates.shared.model(problemId: problemId, services: services), onClose: onClose)
      .id("\(context.gateway.accountId)/\(problemId)")
  }
}

/// Warmups the library calls so an opened problem finds its editor ready: loading the library renews the account's
/// editor sandbox, and pointing at a problem connects the preferred language's server.
@MainActor
enum ProblemWorkspaceWarmup {
  static func services(_ gateway: Gateway) -> ProblemWorkspaceServices {
    let services = ProblemWorkspaceServices.shared(for: gateway)
    // Keep-alives stop while no Manor window is visible; the preview then idles out and reconnects on use.
    services.languageServers.isVisible = { NSApp.windows.contains { $0.isVisible && $0.occlusionState.contains(.visible) } }
    return services
  }

  /// Call once the library has loaded.
  static func libraryLoaded(gateway: Gateway) {
    services(gateway).warmEditorSandbox(language: ProblemWorkspacePreferences.language)
  }

  /// Call when the pointer rests on a problem row.
  static func pointing(gateway: Gateway) {
    services(gateway).warmLanguageServer(language: ProblemWorkspacePreferences.language)
  }
}

private struct ProblemWorkspaceContent: View {
  @Bindable var model: ProblemWorkspaceModel
  let onClose: () -> Void
  @Environment(AppContext.self) private var context
  @Environment(\.pageIsActive) private var isActive
  @Environment(\.windowButtonsClearance) private var buttonsClearance

  var body: some View {
    VStack(spacing: 0) {
      header
      Hairline()
      Group {
        if let detail = model.detail {
          if detail.canExecute {
            ProblemSolvingLayout(model: model, detail: detail, active: isActive)
          } else {
            WorkspaceReader(model: model, detail: detail)
          }
        } else if let error = model.loadError {
          VStack(spacing: Space.s4) {
            ErrorBanner(error) { Task { await model.load() } }
              .frame(maxWidth: 520)
          }
          .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
          ProgressView().controlSize(.small).frame(maxWidth: .infinity, maxHeight: .infinity)
        }
      }
    }
    .background(Palette.surfaceCanvas)
    .onAppear {
      model.timeZone = context.account.timeZone
      model.start()
    }
    .manorDialog(isPresented: $model.showConflict, width: 860) { conflictPanel }
    .manorDialog(isPresented: $model.confirmReset, width: 420) {
      ConfirmPanel(
        title: "Reset your code?",
        message: "Your \(model.language.map { "\($0.label) " } ?? "")code is replaced with the starter code. Earlier submissions keep their code.",
        confirmLabel: "Reset code", destructive: false,
        onCancel: { model.confirmReset = false }, onConfirm: { model.resetCode() }
      )
    }
    .manorDialog(item: $model.replacement, width: 420) { submission in
      ConfirmPanel(
        title: "Replace your code?",
        message: "Your \(submission.language.label) code is replaced with this submission's code. Earlier submissions keep their code.",
        confirmLabel: "Replace code", destructive: false,
        onCancel: { model.replacement = nil }, onConfirm: { model.useSubmissionCode(submission) }
      )
    }
  }

  private var header: some View {
    HStack(spacing: Space.s2) {
      Button { model.afterProtected(onClose) } label: {
        Label("Library", systemImage: "arrow.left").font(.ui(Typography.Size.sm, weight: .medium))
      }
      .buttonStyle(.manor(.ghost, size: .small))
      .help("Back to the library")
      if let detail = model.detail, model.readerTab != .description || detail.canExecute {
        Text(detail.problem.title)
          .font(.ui(Typography.Size.sm, weight: .semibold))
          .foregroundStyle(Palette.inkBody)
          .lineLimit(1)
      }
      Spacer()
    }
    .padding(.horizontal, Space.s3)
    .padding(.leading, buttonsClearance > 0 ? buttonsClearance - Space.s3 : 0)
    .frame(height: workspaceStripHeight - 1)
  }

  private var conflictPanel: some View {
    DialogPanel("Choose the code to keep", onClose: { model.showConflict = false }) {
      VStack(alignment: .leading, spacing: Space.s4) {
        Text("Your code has changed on another device. Choosing a draft replaces the other version.")
          .font(.ui()).foregroundStyle(Palette.inkBody)
        HStack(alignment: .top, spacing: Space.s4) {
          draftColumn("This Mac", code: model.code ?? "")
          draftColumn("Cloud", code: model.draftConflict?.source ?? "")
        }
      }
    } footer: {
      HStack(spacing: Space.s2) {
        Spacer()
        Button("Cancel") { model.showConflict = false }.buttonStyle(.ghost).disabled(model.resolvingConflict)
        Button("Use cloud draft") { Task { await model.useCloud() } }.buttonStyle(.secondary).disabled(model.resolvingConflict)
        Button("Keep this Mac's code") { Task { await model.keepLocal() } }.buttonStyle(.primary).disabled(model.resolvingConflict)
      }
    }
  }

  private func draftColumn(_ title: String, code: String) -> some View {
    VStack(alignment: .leading, spacing: Space.s2) {
      Text(title).font(.ui(Typography.Size.body, weight: .semibold)).foregroundStyle(Palette.ink)
      ScrollView([.horizontal, .vertical]) {
        WorkspaceCode(code: code, language: model.language).padding(Space.s3)
      }
      .frame(maxWidth: .infinity, minHeight: 240, maxHeight: 420, alignment: .topLeading)
      .background(Palette.surfacePaper, in: RoundedRectangle(cornerRadius: Radius.control))
      .overlay(RoundedRectangle(cornerRadius: Radius.control).strokeBorder(Palette.hairline))
    }
    .frame(maxWidth: .infinity)
  }
}

/// The LeetCode layout: the reader beside the solving column (editor toolbar, editor, console, action bar), with
/// draggable dividers whose sizes this Mac remembers.
private struct ProblemSolvingLayout: View {
  @Bindable var model: ProblemWorkspaceModel
  let detail: ProblemDetail
  let active: Bool
  @State private var readerFraction = ProblemWorkspacePreferences.readerFraction
  @State private var consoleFraction = ProblemWorkspacePreferences.consoleFraction

  var body: some View {
    GeometryReader { geometry in
      let width = geometry.size.width
      let reader = min(880, max(280, min(width - 360, width * readerFraction)))
      HStack(spacing: 0) {
        if !model.fullscreen {
          WorkspaceReader(model: model, detail: detail)
            .frame(width: reader)
          PaneDivider(axis: .vertical, fraction: $readerFraction, range: 0.25...0.70, length: width) {
            ProblemWorkspacePreferences.readerFraction = readerFraction
          }
        }
        solving
      }
    }
    .onExitCommand { if model.fullscreen { withAnimation(Motion.panel) { model.fullscreen = false } } }
  }

  private var solving: some View {
    VStack(spacing: 0) {
      WorkspaceEditorToolbar(model: model)
      Hairline()
      GeometryReader { geometry in
        let height = geometry.size.height
        VStack(spacing: 0) {
          editorPane
            .frame(maxHeight: .infinity)
          if model.consoleOpen {
            PaneDivider(axis: .horizontal, fraction: $consoleFraction, range: 0.15...0.75, length: height, reversed: true) {
              ProblemWorkspacePreferences.consoleFraction = consoleFraction
            }
            WorkspaceConsole(model: model, detail: detail)
              .frame(height: max(120, height * consoleFraction))
              .transition(.move(edge: .bottom).combined(with: .opacity))
          }
        }
      }
      Hairline()
      WorkspaceActionBar(model: model, active: active)
    }
    .frame(minWidth: 360)
  }

  @ViewBuilder private var editorPane: some View {
    if let language = model.language {
      if model.hasCode, model.codeLanguage == language {
        WorkspaceCodeEditor(
          model: model, language: language, revision: model.editorRevision, fontSize: model.fontSize, tabSize: model.tabSize,
          diagnostics: model.services.languageServers.diagnostics[language] ?? []
        )
        .id("\(model.problemId)-\(language.rawValue)")
        .overlay(alignment: .topTrailing) { LanguageServerDot(state: model.services.languageServers.state(language)) }
      } else {
        VStack(spacing: Space.s3) {
          if model.draftStatus == .failed {
            Text("Your code could not load.").font(.ui()).foregroundStyle(Palette.inkMuted)
            Button("Try again") { Task { await model.retryDraft() } }.buttonStyle(.manor(.secondary, size: .small))
          } else {
            ProgressView().controlSize(.small)
          }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
      }
    } else {
      Text("This problem has no starter code yet. Ask Codex to add its solving interface.")
        .font(.ui()).foregroundStyle(Palette.inkMuted)
        .multilineTextAlignment(.center)
        .padding(Space.s6)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
  }
}

/// A small dot in the editor corner while the language server is starting or offline; nothing once connected.
private struct LanguageServerDot: View {
  let state: LanguageServerState
  @State private var pulse = false

  var body: some View {
    if state != .connected {
      Circle()
        .fill(state == .connecting ? Palette.inkMuted : Palette.warning)
        .frame(width: 7, height: 7)
        .opacity(state == .connecting && pulse ? 0.35 : 1)
        .padding(Space.s3)
        .help(state == .connecting ? "Starting code intelligence" : "Code intelligence is offline. It reconnects when you type.")
        .onAppear { withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) { pulse = true } }
        .transition(.opacity)
    }
  }
}

/// A draggable separator between two panes. A vertical divider sizes the leading pane; a horizontal one sizes the
/// trailing pane when `reversed`, as a console below an editor does. The size is remembered once a drag ends.
private struct PaneDivider: View {
  enum Axis { case vertical, horizontal }
  let axis: Axis
  @Binding var fraction: Double
  let range: ClosedRange<Double>
  let length: CGFloat
  var reversed = false
  let commit: () -> Void
  @State private var start: Double?
  @State private var hovering = false

  var body: some View {
    ZStack {
      Rectangle().fill(hovering || start != nil ? Palette.hairlineStrong : Palette.hairline)
        .frame(width: axis == .vertical ? 1 : nil, height: axis == .horizontal ? 1 : nil)
    }
    .frame(width: axis == .vertical ? 1 : nil, height: axis == .horizontal ? 1 : nil)
    .overlay {
      Color.clear
        .frame(width: axis == .vertical ? 9 : nil, height: axis == .horizontal ? 9 : nil)
        .contentShape(Rectangle())
        .onHover { inside in
          hovering = inside
          if inside { (axis == .vertical ? NSCursor.resizeLeftRight : NSCursor.resizeUpDown).push() } else { NSCursor.pop() }
        }
        .gesture(
          DragGesture(minimumDistance: 1, coordinateSpace: .global)
            .onChanged { value in
              let origin = start ?? fraction
              if start == nil { start = fraction }
              let delta = Double(axis == .vertical ? value.translation.width : value.translation.height) / Double(max(1, length))
              fraction = min(range.upperBound, max(range.lowerBound, origin + (reversed ? -delta : delta)))
            }
            .onEnded { _ in start = nil; commit() }
        )
    }
    .zIndex(1)
    .accessibilityElement()
    .accessibilityLabel(axis == .vertical ? "Resize problem and editor" : "Resize editor and console")
    .accessibilityValue("\(Int((fraction * 100).rounded())) percent")
    .accessibilityAdjustableAction { direction in
      let step = direction == .increment ? 0.02 : -0.02
      fraction = min(range.upperBound, max(range.lowerBound, fraction + step))
      commit()
    }
  }
}
