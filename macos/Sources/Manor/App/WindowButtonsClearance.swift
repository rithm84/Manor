import SwiftUI

/// How much leading room a bar along the window's top edge leaves for the window buttons and the Show sidebar
/// toggle. It is zero while the sidebar is docked (the sidebar holds them) and in full screen (they hide).
private struct WindowButtonsClearanceKey: EnvironmentKey {
  static let defaultValue: CGFloat = 0
}

extension EnvironmentValues {
  var windowButtonsClearance: CGFloat {
    get { self[WindowButtonsClearanceKey.self] }
    set { self[WindowButtonsClearanceKey.self] = newValue }
  }
}

enum WindowButtonsMetrics {
  /// Where the Show sidebar toggle sits: just past the window buttons, which end about 78 pt in.
  static let toggleLeading: CGFloat = 88
  /// The window buttons plus the Show sidebar toggle beside them, with a little air.
  static let collapsedClearance: CGFloat = 128
}

/// Page headers start below the window buttons' row while the sidebar is hidden, as in system apps; with the
/// sidebar docked (or in full screen) the row is free and the header sits near the top.
struct PageHeaderInsets: ViewModifier {
  @Environment(\.windowButtonsClearance) private var clearance

  func body(content: Content) -> some View {
    content
      .padding(.horizontal, Space.s8)
      .padding(.top, clearance > 0 ? WindowChromeMetrics.toolbarHeight : Space.s6)
      .padding(.bottom, Space.s4)
      .animation(Motion.panel, value: clearance)
  }
}
