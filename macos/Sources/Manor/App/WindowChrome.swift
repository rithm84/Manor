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
    override func viewDidMoveToWindow() {
      super.viewDidMoveToWindow()
      guard let window, window.toolbar == nil else { return }
      let toolbar = NSToolbar(identifier: "manor.main")
      toolbar.displayMode = .iconOnly
      toolbar.allowsUserCustomization = false
      window.toolbar = toolbar
      window.toolbarStyle = .unified
      window.titleVisibility = .hidden
      window.titlebarAppearsTransparent = true
      window.titlebarSeparatorStyle = .none
      window.styleMask.insert(.fullSizeContentView)
    }
  }
}

enum WindowChromeMetrics {
  /// The unified toolbar's height; the window buttons are centered in it.
  static let toolbarHeight: CGFloat = 52
}
