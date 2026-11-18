import AppKit
import SwiftUI

public extension View {
  /// For a graphical date picker in a popover: the calendar becomes first responder when the popover opens, and
  /// a square focus ring is drawn around the whole month. The selected day already shows where keyboard input
  /// goes, so the ring is hidden; arrow keys still move the selection.
  func calendarFocusRingHidden() -> some View { background(CalendarFocusRingOff()) }
}

private struct CalendarFocusRingOff: NSViewRepresentable {
  func makeNSView(context: Context) -> Probe { Probe() }
  func updateNSView(_ view: Probe, context: Context) { view.apply() }

  final class Probe: NSView {
    override func viewDidMoveToWindow() {
      super.viewDidMoveToWindow()
      guard window != nil else { return }
      apply()
      // The ring view is added once the picker takes focus, a moment after the popover appears.
      for delay in [0.0, 0.05, 0.2, 0.5] {
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in self?.apply() }
      }
      // macOS 26 draws the ring in its own layer whatever the view asks for, so the popover opens without the
      // calendar holding focus; a click or Tab gives it focus for the arrow keys.
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak self] in
        guard let window = self?.window, window.firstResponder is NSDatePicker else { return }
        window.makeFirstResponder(nil)
      }
    }

    /// Clears the date picker's own ring, and hides the separate ring view SwiftUI draws around a focused
    /// AppKit control (its class is private, so it is matched by name).
    func apply() {
      guard let root = window?.contentView else { return }
      var stack: [NSView] = [root]
      while let view = stack.popLast() {
        if view is NSDatePicker { view.focusRingType = .none }
        if String(describing: type(of: view)).contains("FocusRingView") { view.isHidden = true }
        stack.append(contentsOf: view.subviews)
      }
    }
  }
}
