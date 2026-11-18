import Alfred
import AppKit
import ManorKit
import SwiftUI

/// In-app Alfred: when Manor is the frontmost window, Alfred's shortcut opens this centered dialog instead of the
/// notch overlay. Alfred answers from the page you're on and acts in Manor with its tools; each action shows as
/// a row with Undo, and actions that can't be undone ask first.
@MainActor @Observable
final class AlfredDialogModel {
  static let shared = AlfredDialogModel()

  var isOpen = false
  let assistant: AlfredAssistant
  @ObservationIgnored private weak var context: AppContext?

  private init() {
    let name = Bundle.main.object(forInfoDictionaryKey: "CFBundleName") as? String ?? "Manor"
    assistant = AlfredAssistant(appName: name)
  }

  /// Binds the assistant's tools to the signed-in account; a different account starts a new conversation.
  func attach(_ context: AppContext) {
    guard self.context !== context else { return }
    assistant.clear()
    self.context = context
    assistant.toolbox = ManorAlfredToolbox(context: context)
    #if DEBUG
    if NoteAlfredDemoWriter.isEnabled { assistant.script = AlfredDialogScript.turn(for:snapshot:) }
    #endif
  }

  func detach(_ context: AppContext) {
    guard self.context === context else { return }
    close()
    assistant.clear()
    assistant.toolbox = nil
    self.context = nil
  }

  func open() {
    guard context != nil else { return }
    isOpen = true
  }

  /// Closing while Alfred waits for a confirmation declines it; a running request finishes on its own.
  func close() {
    for entry in assistant.entries where entry.kind == .confirmation && entry.approved == nil {
      assistant.decide(entry, approved: false)
    }
    isOpen = false
  }

  func toggle() {
    if isOpen { close() } else { open() }
  }

  /// Alfred's hotkeys while Manor's own window is key: ⌃⌥H (and ⌃⌥Space in General mode) open this dialog.
  func handleHotkey(_ action: HotkeyAction) -> Bool {
    guard action == .toggleOverlay || (action == .assist && AlfredHost.shared.mode == .general) else { return false }
    guard context != nil, NSApp.isActive, let window = NSApp.keyWindow, window.isVisible, !(window is NSPanel), window.canBecomeMain else {
      return false
    }
    toggle()
    return true
  }
}

/// Opens in-app Alfred from the main window (attaches the account and presents the dialog).
struct AlfredDialogHost: ViewModifier {
  @Environment(AppContext.self) private var context
  @Bindable private var model = AlfredDialogModel.shared

  func body(content: Content) -> some View {
    content
      .overlay {
        Color.clear
          .manorDialog(isPresented: $model.isOpen, width: 620, onDismiss: { model.close() }) {
            AlfredDialog(model: model)
          }
          .allowsHitTesting(model.isOpen)
      }
      .onAppear { model.attach(context) }
      .onDisappear { model.detach(context) }
  }
}

struct AlfredDialog: View {
  let model: AlfredDialogModel
  @Environment(AppContext.self) private var context
  @State private var draft = ""
  @State private var width: CGFloat = 560
  @FocusState private var composerFocused: Bool

  private var assistant: AlfredAssistant { model.assistant }

  var body: some View {
    VStack(spacing: 0) {
      header
      conversation
      Divider().overlay(Palette.hairline)
      composer
    }
    .onAppear { composerFocused = true }
  }

  private var header: some View {
    HStack(spacing: Space.s2) {
      Image(systemName: "sparkles")
        .font(.system(size: 14, weight: .semibold))
        .foregroundStyle(Palette.primary)
        .accessibilityHidden(true)
      Text("Alfred").font(.dialogTitle).foregroundStyle(Palette.ink)
      Spacer()
      if !assistant.entries.isEmpty {
        Button("New chat") {
          assistant.clear()
          composerFocused = true
        }
        .buttonStyle(.manor(.ghost, size: .small))
        .help("Start a new conversation")
      }
      IconButton("xmark", label: "Close") { model.close() }
    }
    .padding(.horizontal, Space.s5)
    .padding(.top, Space.s4)
    .padding(.bottom, Space.s3)
  }

  // MARK: Conversation

  private var conversation: some View {
    ScrollViewReader { proxy in
      ScrollView {
        VStack(alignment: .leading, spacing: Space.s3) {
          if assistant.entries.isEmpty { emptyState }
          ForEach(assistant.entries) { entry in
            AlfredDialogEntryView(entry: entry, width: width, assistant: assistant, openSettings: openSettings)
          }
          if showsWorking {
            NoteAlfredThinking(request: assistant.phase == .acting ? "Working in Manor" : "Thinking", size: Typography.Size.body)
              .transition(.opacity)
          }
          Color.clear.frame(height: 1).id(Self.bottom)
        }
        .padding(.horizontal, Space.s5)
        .padding(.bottom, Space.s4)
        .onGeometryChange(for: CGFloat.self) { $0.size.width - Space.s5 * 2 } action: { width = max(200, $0) }
      }
      .scrollBounceBehavior(.basedOnSize)
      .frame(minHeight: 120, idealHeight: assistant.entries.isEmpty ? 160 : 420, maxHeight: 460)
      .onChange(of: assistant.entries.count) { scroll(proxy) }
      .onChange(of: assistant.entries.last?.text) { scroll(proxy) }
      .onChange(of: assistant.phase) { scroll(proxy) }
    }
  }

  private static let bottom = "alfred-bottom"

  private func scroll(_ proxy: ScrollViewProxy) {
    proxy.scrollTo(Self.bottom, anchor: .bottom)
  }

  private var showsWorking: Bool {
    switch assistant.phase {
    case .thinking: return true
    case .acting: return !assistant.entries.contains { $0.kind == .confirmation && $0.approved == nil }
    default: return false
    }
  }

  @ViewBuilder
  private var emptyState: some View {
    if !assistant.isAvailable {
      VStack(alignment: .leading, spacing: Space.s3) {
        Text(AlfredAssistant.missingKeyMessage)
          .font(.ui(Typography.Size.body))
          .foregroundStyle(Palette.inkBody)
        Button("Open Settings", action: openSettings).buttonStyle(.manor(.secondary, size: .small))
      }
      .padding(.vertical, Space.s2)
    } else {
      VStack(alignment: .leading, spacing: Space.s3) {
        Text("Ask about your day, or tell Alfred what to change.")
          .font(.ui(Typography.Size.body))
          .foregroundStyle(Palette.inkMuted)
        FlowChips(items: suggestions) { suggestion in send(suggestion) }
      }
      .padding(.vertical, Space.s2)
    }
  }

  private var suggestions: [String] {
    switch context.route {
    case .home: ["What's due today?", "Move my overdue tasks to today", "Add a task to call the bank tomorrow"]
    case .tracking: ["Which habits are left today?", "Log today's mood as good"]
    case .pomodoro: ["Start a 25 minute focus session", "How many sessions did I finish today?"]
    case .jobs: ["Which roles have an OA due?", "What should I follow up on?"]
    case .notes: ["Summarize this note", "Add a checklist of next steps to this note"]
    default: ["What's due today?", "Start a focus session"]
    }
  }

  // MARK: Composer

  private var composer: some View {
    HStack(alignment: .bottom, spacing: Space.s2) {
      TextField("Ask Alfred, or tell it what to do", text: $draft, axis: .vertical)
        .textFieldStyle(.plain)
        .font(.ui(Typography.Size.md))
        .foregroundStyle(Palette.ink)
        .lineLimit(1...6)
        .focused($composerFocused)
        .onSubmit { send(draft) }
        .disabled(!assistant.isAvailable)
        .padding(.vertical, 6)
        .accessibilityLabel("Message Alfred")
      if assistant.isWorking {
        IconButton("stop.fill", label: "Stop", size: 28) { assistant.stop() }
      } else {
        Button { send(draft) } label: {
          Image(systemName: "arrow.up")
            .font(.system(size: 13, weight: .bold))
            .foregroundStyle(Palette.onPrimary)
            .frame(width: 28, height: 28)
            .background(Circle().fill(canSend ? Palette.primary : Palette.primary.opacity(0.35)))
        }
        .buttonStyle(.plain)
        .disabled(!canSend)
        .help("Send (Return)")
        .accessibilityLabel("Send")
      }
    }
    .padding(.horizontal, Space.s5)
    .padding(.vertical, Space.s3)
  }

  private var canSend: Bool {
    assistant.isAvailable && !assistant.isWorking && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }

  private func send(_ text: String) {
    guard assistant.isAvailable, !assistant.isWorking, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
    assistant.send(text)
    draft = ""
    composerFocused = true
  }

  private func openSettings() {
    model.close()
    context.navigate(to: .settings)
    context.linkTarget = (.settings, ["alfred"], [:])
  }
}

/// One entry of the conversation: the request, Alfred's reply, an action with Undo, a confirmation, or a failure.
struct AlfredDialogEntryView: View {
  let entry: AlfredAssistant.Entry
  let width: CGFloat
  let assistant: AlfredAssistant
  let openSettings: () -> Void

  var body: some View {
    switch entry.kind {
    case .request:
      HStack {
        Spacer(minLength: Space.s10)
        Text(entry.text)
          .font(.ui(Typography.Size.body))
          .foregroundStyle(Palette.ink)
          .textSelection(.enabled)
          .padding(.horizontal, Space.s3)
          .padding(.vertical, Space.s2)
          .background(Palette.surfaceSoft, in: RoundedRectangle(cornerRadius: Radius.control, style: .continuous))
      }
    case .answer:
      AlfredContentView(source: entry.text, width: width, isComplete: entry.isComplete, scale: Typography.Size.body / 13)
        .textSelection(.enabled)
    case .action:
      action
    case .confirmation:
      confirmation
    case .failure:
      HStack(alignment: .firstTextBaseline, spacing: Space.s2) {
        Image(systemName: "exclamationmark.circle").foregroundStyle(Palette.overdueError)
        Text(entry.text).font(.ui(Typography.Size.body)).foregroundStyle(Palette.ink)
        Spacer(minLength: 0)
        if entry.needsKey { Button("Open Settings", action: openSettings).buttonStyle(.manor(.secondary, size: .small)) }
      }
      .padding(.horizontal, Space.s3)
      .padding(.vertical, Space.s2)
      .background(Palette.overdueErrorTint.opacity(0.6), in: RoundedRectangle(cornerRadius: Radius.control, style: .continuous))
    }
  }

  private var undone: String? {
    if case .done(let summary) = entry.undoState { return summary }
    return nil
  }

  private var action: some View {
    HStack(alignment: .center, spacing: Space.s2) {
      Image(systemName: entry.isError ? "exclamationmark.circle" : undone != nil ? "arrow.uturn.backward.circle" : "checkmark.circle.fill")
        .font(.system(size: 14))
        .foregroundStyle(entry.isError ? Palette.overdueError : undone != nil ? Palette.inkMuted : Palette.completion)
        .accessibilityHidden(true)
      // Undoing swaps the line in place, so the rows below never move under the pointer.
      Text(undone ?? entry.text)
        .font(.ui(Typography.Size.body, weight: undone == nil ? .medium : .regular))
        .foregroundStyle(undone != nil ? Palette.inkMuted : Palette.ink)
        .lineLimit(2)
      if case .failed(let message) = entry.undoState {
        Image(systemName: "exclamationmark.circle")
          .foregroundStyle(Palette.overdueError)
          .help(message)
          .accessibilityLabel(message)
      }
      Spacer(minLength: Space.s2)
      switch entry.undoState {
      case .available, .failed:
        Button("Undo") { assistant.undo(entry) }
          .buttonStyle(.manor(.secondary, size: .small))
          .disabled(entry.undoState != .available)
      case .working:
        ProgressView().controlSize(.small)
      default:
        EmptyView()
      }
    }
    .padding(.horizontal, Space.s3)
    .padding(.vertical, Space.s2)
    .background(Palette.surfaceSoft, in: RoundedRectangle(cornerRadius: Radius.control, style: .continuous))
    .overlay(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).strokeBorder(Palette.hairline))
    .accessibilityElement(children: .combine)
  }

  @ViewBuilder
  private var confirmation: some View {
    if let approved = entry.approved {
      HStack(spacing: Space.s2) {
        Image(systemName: approved ? "checkmark" : "xmark").font(.system(size: 12, weight: .semibold)).foregroundStyle(Palette.inkMuted)
        Text(approved ? entry.actionLabel : "Cancelled").font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted)
      }
    } else {
      VStack(alignment: .leading, spacing: Space.s3) {
        Text(entry.text).font(.ui(Typography.Size.body, weight: .medium)).foregroundStyle(Palette.ink)
        HStack(spacing: Space.s2) {
          Button(entry.actionLabel) { assistant.decide(entry, approved: true) }
            .buttonStyle(.manor(.danger, size: .small))
          Button("Cancel") { assistant.decide(entry, approved: false) }
            .buttonStyle(.manor(.secondary, size: .small))
        }
      }
      .padding(Space.s3)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(Palette.surfaceSoft, in: RoundedRectangle(cornerRadius: Radius.control, style: .continuous))
      .overlay(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).strokeBorder(Palette.hairlineStrong))
    }
  }
}

#if DEBUG
/// Scripted turns for reviewing the dialog without a key (`ALFRED_NOTES_DEMO=1`). They call Manor's real tools
/// against the signed-in (staging) account.
enum AlfredDialogScript {
  static func turn(for prompt: String, snapshot: AlfredAppSnapshot?) -> AlfredAssistant.ScriptedTurn {
    let lower = prompt.lowercased()
    if lower.hasPrefix("done ") || lower.hasPrefix("check off ") {
      let title = prompt.split(separator: " ", maxSplits: lower.hasPrefix("done ") ? 1 : 2).last.map(String.init) ?? ""
      return .init(calls: [("set_tasks_done", ["tasks": [title], "done": true])], reply: "")
    }
    if lower.hasPrefix("add ") {
      return .init(calls: [("create_task", ["title": String(prompt.dropFirst(4)), "context": "Personal"])], reply: "Added it for today.")
    }
    if lower.contains("stop") {
      return .init(calls: [("stop_pomodoro", [:])], reply: "")
    }
    if lower.contains("focus") {
      return .init(calls: [("start_pomodoro", ["kind": "focus", "label": "Writing"])], reply: "")
    }
    if lower.hasPrefix("open ") {
      return .init(calls: [("open_page", ["page": String(lower.dropFirst(5))])], reply: "")
    }
    let page = snapshot?.page ?? "Manor"
    return .init(reply: "You're on **\(page)**. Here is what I can see:\n\n\(snapshot?.details.split(separator: "\n").prefix(4).map { "- \($0)" }.joined(separator: "\n") ?? "")")
  }
}
#endif
