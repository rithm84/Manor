import Alfred
import AppKit
import ManorKit
import SwiftUI

@main
struct ManorApp: App {
  @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
  @State private var model = AppModel()

  var body: some Scene {
    Window(model.windowTitle, id: "main") {
      RootView()
        .environment(model)
        .environment(model.toasts)
        .environment(model.theme)
        .frame(minWidth: 980, minHeight: 640)
        .onOpenURL { model.handle(url: $0) }
        .task { await model.start() }
        .background(AlfredWindowHook(model: model))  // Alfred: reopen and Settings ▸ Alfred
    }
    .windowStyle(.hiddenTitleBar)
    .defaultSize(width: 1360, height: 860)
    .commands { ManorCommands(model: model) }
  }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
  func applicationWillFinishLaunching(_ notification: Notification) {
    Typography.registerFonts()
  }

  /// Closing the window keeps Manor running so the Dock icon reopens it at once; Quit ends it.
  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

  // MARK: Alfred (see AlfredBridge): in Prep mode a Dock quit or Command-Q hides Manor and Alfred keeps running.
  func applicationDidFinishLaunching(_ notification: Notification) {
    MainActor.assumeIsolated { AlfredBridge.shared.start() }
  }

  func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
    MainActor.assumeIsolated { AlfredBridge.shared.terminateReply() }
  }

  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
    MainActor.assumeIsolated { AlfredBridge.shared.handleReopen() }
  }

  func applicationWillTerminate(_ notification: Notification) {
    MainActor.assumeIsolated { AlfredHost.shared.stop() }
  }
}

/// Menu commands: page switching, the sidebar toggle, and create.
struct ManorCommands: Commands {
  let model: AppModel

  var body: some Commands {
    CommandGroup(replacing: .newItem) {
      Button("New") { model.context?.requestCreate(on: model.context?.route ?? .home) }
        .keyboardShortcut("n")
        .disabled(!(model.context?.route.supportsCreate ?? false))
    }
    CommandGroup(replacing: .appSettings) {
      Button("Settings…") { model.context?.navigate(to: .settings) }.keyboardShortcut(",")
    }
    CommandGroup(before: .sidebar) {
      Button(model.sidebarDocked ? "Hide Sidebar" : "Show Sidebar") { model.toggleSidebar() }
        .keyboardShortcut("\\")
      Divider()
      Button("Ask Alfred") { AlfredDialogModel.shared.toggle() }
        .keyboardShortcut("h", modifiers: [.control, .option])
        .disabled(model.context == nil)
      Divider()
      ForEach(Array(Route.modules.enumerated()), id: \.element) { index, route in
        Button(route.title) { model.context?.navigate(to: route) }
          .keyboardShortcut(KeyEquivalent(Character(String(index + 1))))
          .disabled(model.context == nil)
      }
      Divider()
    }
  }
}
