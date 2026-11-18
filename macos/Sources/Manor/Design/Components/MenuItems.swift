import SwiftUI

/// A pop-up menu choice that shows a checkmark beside the current value, as macOS menus do. Choosing the
/// current value again keeps it.
public struct CheckedMenuItem: View {
  let title: String
  let selected: Bool
  let action: () -> Void

  public init(_ title: String, selected: Bool, action: @escaping () -> Void) {
    self.title = title
    self.selected = selected
    self.action = action
  }

  public var body: some View {
    Toggle(title, isOn: Binding(get: { selected }, set: { _ in action() }))
  }
}
