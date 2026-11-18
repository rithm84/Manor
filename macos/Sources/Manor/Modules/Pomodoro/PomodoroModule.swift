import AppKit
import ManorKit
import SwiftUI

/// App-wide Pomodoro behavior applied once to the signed-in window: the running timer, the sidebar badge
/// (`AppContext.pomodoroBadge`), the Space shortcut, and the completion chime. Owned by the Pomodoro module.
struct PomodoroAppHook: ViewModifier {
  @Environment(AppContext.self) private var context
  @State private var store = PomodoroStore()
  @State private var keyMonitor: Any?

  func body(content: Content) -> some View {
    content
      .environment(store)
      .task(id: context.gateway.accountId) { await store.run(context: context) }
      .onAppear { installSpaceShortcut() }
      .onDisappear { removeSpaceShortcut() }
  }

  /// Space starts, pauses, or resumes the timer from anywhere in the window, unless the key belongs to
  /// something else: a text field or editor, a focused control Space already activates, or a Pomodoro dialog.
  private func installSpaceShortcut() {
    guard keyMonitor == nil else { return }
    let store = self.store
    keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
      guard event.keyCode == 49, !event.isARepeat,
            event.modifierFlags.intersection([.command, .control, .option, .shift]).isEmpty,
            let window = event.window, window.isKeyWindow, !(window is NSPanel), window.attachedSheet == nil,
            PomodoroSpaceShortcut.keyIsFree(in: window), store.openDialogs == 0, !DialogPresence.shared.isAnyOpen
      else { return event }
      store.toggleFromKeyboard()
      return nil
    }
  }

  private func removeSpaceShortcut() {
    if let keyMonitor { NSEvent.removeMonitor(keyMonitor) }
    keyMonitor = nil
  }
}

enum PomodoroSpaceShortcut {
  /// Whether nothing focused in `window` wants the Space key for itself.
  @MainActor
  static func keyIsFree(in window: NSWindow) -> Bool {
    guard let responder = window.firstResponder else { return true }
    if responder is NSText || responder is NSTextView { return false }
    if let field = responder as? NSTextField, field.isEditable { return false }
    if responder is NSButton || responder is NSPopUpButton || responder is NSSegmentedControl || responder is NSSlider { return false }
    if let view = responder as? NSView, view.enclosingMenuItem != nil { return false }
    // Custom editors (the code editor) take text input without being an NSTextView.
    if responder is NSTextInputClient { return false }
    return true
  }
}
