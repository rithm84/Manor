import AppKit
import SwiftUI

/// Gives the main window the chrome of a system sidebar app: an empty, transparent unified toolbar with no
/// title. The toolbar moves the window buttons in from the corner and centers them in a 52-point bar, where they
/// sit inside the sidebar panel's top corner, and on macOS 26 it gives the window the larger corner radius the
/// inset panel's corners are concentric with. Content still runs to the window's top edge.
struct WindowChrome: NSViewRepresentable {
  func makeNSView(context: Context) -> NSView { ChromeView() }
  func updateNSView(_ view: NSView, context: Context) {}

  final class ChromeView: NSView {
    private var observers: [NSObjectProtocol] = []
    private weak var configured: NSWindow?

    override func viewDidMoveToWindow() {
      super.viewDidMoveToWindow()
      guard let window, configured !== window else { return }
      configured = window
      window.titleVisibility = .hidden
      window.titlebarAppearsTransparent = true
      window.titlebarSeparatorStyle = .none
      window.styleMask.insert(.fullSizeContentView)
      if !window.styleMask.contains(.fullScreen) { Self.installToolbar(in: window) }
      // Full screen hides the window buttons, and a toolbar there would sit over the top of every page.
      let center = NotificationCenter.default
      observers.forEach(center.removeObserver)
      observers = [
        center.addObserver(forName: NSWindow.willEnterFullScreenNotification, object: window, queue: .main) { note in
          if let window = note.object as? NSWindow { MainActor.assumeIsolated { window.toolbar = nil } }
        },
        center.addObserver(forName: NSWindow.didExitFullScreenNotification, object: window, queue: .main) { note in
          if let window = note.object as? NSWindow { MainActor.assumeIsolated { Self.installToolbar(in: window) } }
        },
      ]
    }

    private static func installToolbar(in window: NSWindow) {
      guard window.toolbar == nil else { return }
      let toolbar = NSToolbar(identifier: "manor.main")
      toolbar.displayMode = .iconOnly
      toolbar.allowsUserCustomization = false
      window.toolbar = toolbar
      window.toolbarStyle = .unified
    }

    deinit { observers.forEach(NotificationCenter.default.removeObserver) }
  }
}

/// Empty space that moves the window when dragged. Window dragging by the content background is off, so controls
/// along the top edge take their clicks and drags; regions like this keep the empty top band draggable.
struct WindowDragRegion: View {
  var body: some View {
    Color.clear
      .contentShape(Rectangle())
      .gesture(WindowDragGesture())
      .allowsWindowActivationEvents(true)
      .accessibilityHidden(true)
  }
}

enum WindowChromeMetrics {
  /// The unified toolbar's height; the window buttons are centered in it.
  static let toolbarHeight: CGFloat = 52
  /// The top band the window toolbar covers and takes clicks in; content that must be seen and clicked starts
  /// below it.
  static let titlebarBand: CGFloat = 32
}
