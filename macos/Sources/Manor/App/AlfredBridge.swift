import Alfred
import AppKit
import Carbon.HIToolbox
import SwiftUI

/// Connects Alfred to Manor's lifecycle. Alfred starts at launch and keeps its menu bar item for the life of the
/// process. In Prep mode, quitting Manor from the Dock or with Command-Q only hides Manor: its windows go
/// away, the Dock icon goes away (`.accessory`), and Alfred keeps listening. "Open Manor" in Alfred's menu brings
/// the window and Dock icon back; "Quit Manor" really quits. Logout, restart, shutdown, and update installs
/// always quit.
@MainActor
final class AlfredBridge {
  static let shared = AlfredBridge()

  private weak var model: AppModel?
  private var openWindow: OpenWindowAction?
  /// Set by "Quit Manor" and the updater so the next terminate goes through.
  private var allowsQuit = false
  /// Windows hidden by a Dock quit, shown again by "Open Manor".
  private var hiddenWindows: [NSWindow] = []

  private init() {}

  func start() {
    let name = Bundle.main.object(forInfoDictionaryKey: "CFBundleName") as? String ?? "Manor"
    AlfredHost.shared.start(.init(
      appName: name,
      openManor: { [weak self] in self?.openManor() },
      openSettings: { [weak self] in self?.openSettings() },
      quitManor: { [weak self] in self?.quit() },
      handleInApp: { action in AlfredDialogModel.shared.handleHotkey(action) }
    ))
  }

  /// The main window registers itself so Alfred can reopen it and navigate to Settings.
  func attach(model: AppModel, openWindow: OpenWindowAction) {
    self.model = model
    self.openWindow = openWindow
  }

  /// Lets the next terminate through (the updater's relaunch); `false` withdraws it if the install failed.
  func allowQuit(_ allowed: Bool = true) { allowsQuit = allowed }

  func quit() {
    allowsQuit = true
    NSApp.terminate(nil)
  }

  // MARK: Termination

  func terminateReply() -> NSApplication.TerminateReply {
    guard !allowsQuit, AlfredHost.shared.keepsRunningWhenManorQuits, !Self.isSystemQuit else { return .terminateNow }
    hideManor()
    return .terminateCancel
  }

  /// Logout, restart, and shutdown send a quit Apple event with a reason; a Dock quit and Command-Q don't.
  private static var isSystemQuit: Bool {
    guard let event = NSAppleEventManager.shared().currentAppleEvent,
          event.eventClass == kCoreEventClass, event.eventID == kAEQuitApplication else { return false }
    return event.attributeDescriptor(forKeyword: AEKeyword(kAEQuitReason)) != nil
  }

  private func hideManor() {
    hiddenWindows = NSApp.windows.filter { $0.isVisible && !($0 is NSPanel) && $0.canBecomeMain }
    for window in hiddenWindows { window.orderOut(nil) }
    NSApp.setActivationPolicy(.accessory)
  }

  // MARK: Reopening

  func openManor() {
    if NSApp.activationPolicy() != .regular { NSApp.setActivationPolicy(.regular) }
    let windows = hiddenWindows.isEmpty ? NSApp.windows.filter { !($0 is NSPanel) && $0.canBecomeMain } : hiddenWindows
    hiddenWindows = []
    if !windows.isEmpty {
      windows.forEach { $0.makeKeyAndOrderFront(nil) }
    } else {
      openWindow?(id: "main")
    }
    NSApp.activate()
  }

  /// Opening Manor again (Finder, Spotlight, or the Dock) while it's hidden brings the window back.
  func handleReopen() -> Bool {
    guard NSApp.activationPolicy() != .regular || !hiddenWindows.isEmpty else { return true }
    openManor()
    return false
  }

  private func openSettings() {
    openManor()
    guard let context = model?.context else { return }
    context.navigate(to: .settings)
    context.linkTarget = (.settings, ["alfred"], [:])
  }
}

/// Hands the main window's `openWindow` action and the app model to the bridge.
struct AlfredWindowHook: View {
  let model: AppModel
  @Environment(\.openWindow) private var openWindow

  var body: some View {
    Color.clear.frame(width: 0, height: 0)
      .onAppear { AlfredBridge.shared.attach(model: model, openWindow: openWindow) }
  }
}
