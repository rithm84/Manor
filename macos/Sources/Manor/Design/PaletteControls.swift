import SwiftUI

/// Hand-tuned roles for form controls, beside the generated `Palette`. Inputs sit slightly inset from the
/// canvas in both themes, and focus reads as a plum ring with a soft halo rather than a hard color swap.
public extension Palette {
  /// A text field or search field at rest.
  static let fieldFill = Color.manorPair(light: (1.0, 1.0, 1.0, 1), dark: (0.141, 0.133, 0.161, 1))
  /// The field's resting edge: visible on white, quiet on dark.
  static let fieldBorder = Color.manorPair(light: (0.827, 0.808, 0.859, 1), dark: (0.255, 0.235, 0.286, 1))
  /// A search field's fill, a touch deeper than a form field so it reads as a tool, not a form.
  static let searchFill = Color.manorPair(light: (0.937, 0.929, 0.949, 1), dark: (0.169, 0.157, 0.192, 1))
  /// The selected segment of a segmented control: lifted above its track in both themes (white in light, a
  /// raised gray in dark, never darker than the track).
  static let segmentSelected = Color.manorPair(light: (1.0, 1.0, 1.0, 1), dark: (0.290, 0.275, 0.325, 1))
  static let segmentSelectedEdge = Color.manorPair(light: (0.0, 0.0, 0.0, 0.08), dark: (1.0, 1.0, 1.0, 0.10))
  /// The soft glow around a focused control.
  static let focusHalo = Color.manorPair(light: (0.459, 0.314, 0.561, 0.20), dark: (0.761, 0.608, 0.863, 0.28))
}

extension Color {
  static func manorPair(light: (Double, Double, Double, Double), dark: (Double, Double, Double, Double)) -> Color {
    Color(nsColor: NSColor(name: nil) { appearance in
      let v = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? dark : light
      return NSColor(srgbRed: v.0, green: v.1, blue: v.2, alpha: v.3)
    })
  }
}

/// The focus treatment shared by every Manor input: a plum edge plus a halo that eases in.
struct FocusRing<S: InsettableShape>: ViewModifier {
  let shape: S
  let focused: Bool
  let border: Color

  func body(content: Content) -> some View {
    content
      .overlay(shape.strokeBorder(focused ? Palette.focusBorder : border, lineWidth: focused ? 1.5 : 1))
      .background(shape.stroke(Palette.focusHalo, lineWidth: focused ? 6 : 0).opacity(focused ? 1 : 0))
      .animation(Motion.fast, value: focused)
  }
}
