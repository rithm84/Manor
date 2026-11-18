import SwiftUI

/// Liquid Glass on macOS 26 and later, built only by a toolchain with the macOS 26 SDK; earlier systems and
/// older toolchains get the solid fill Manor used before. Glass is for chrome that floats over content (the
/// sidebar, segmented controls, toasts, floating notices), never for reading surfaces or dialogs.
public extension View {
  func glassSurface<S: Shape>(_ shape: S, fallback: Color, interactive: Bool = false, tint: Color? = nil) -> some View {
    modifier(GlassSurface(shape: shape, fallback: fallback, interactive: interactive, tint: tint))
  }

}

/// Whether this build draws Liquid Glass on the running system. The `manor.solidChrome` default turns it off so
/// the solid look of earlier systems can be checked on macOS 26.
public enum GlassSupport {
  public static let isActive: Bool = {
    if UserDefaults.standard.bool(forKey: "manor.solidChrome") { return false }
    #if compiler(>=6.2)
    if #available(macOS 26.0, *) { return true }
    #endif
    return false
  }()
}

/// Liquid Glass where the system and the person's settings allow it; with Reduce Transparency on, the solid
/// fill Manor uses on earlier systems.
private struct GlassSurface<S: Shape>: ViewModifier {
  let shape: S
  let fallback: Color
  let interactive: Bool
  let tint: Color?
  @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

  func body(content: Content) -> some View {
    #if compiler(>=6.2)
    if #available(macOS 26.0, *), GlassSupport.isActive, !reduceTransparency {
      let base: Glass = tint.map { Glass.regular.tint($0) } ?? .regular
      content.glassEffect(interactive ? base.interactive() : base, in: shape)
    } else {
      solid(content)
    }
    #else
    solid(content)
    #endif
  }

  private func solid(_ content: Content) -> some View {
    content.background(shape.fill(tint ?? fallback))
  }
}
