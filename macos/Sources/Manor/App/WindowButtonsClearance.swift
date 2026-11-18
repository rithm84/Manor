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
  /// The window buttons plus the Show sidebar toggle beside them, with a little air.
  static let collapsedClearance: CGFloat = 112
}
