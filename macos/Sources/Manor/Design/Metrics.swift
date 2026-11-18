import AppKit
import SwiftUI

/// Spacing, radii, and motion from the token system. Views never carry literal values for these.
public enum Space {
  public static let s1: CGFloat = 4
  public static let s2: CGFloat = 8
  public static let s3: CGFloat = 12
  public static let s4: CGFloat = 16
  public static let s5: CGFloat = 20
  public static let s6: CGFloat = 24
  public static let s8: CGFloat = 32
  public static let s10: CGFloat = 40
  public static let s12: CGFloat = 48
}

/// Continuous-corner radii, rounder than the web build to sit alongside macOS 26's Liquid Glass.
public enum Radius {
  public static let chip: CGFloat = 7
  public static let control: CGFloat = 10
  public static let card: CGFloat = 14
  public static let cardLarge: CGFloat = 20
}

public enum Motion {
  /// Reduce Motion replaces movement with a near-instant fade everywhere Manor animates.
  private static var reduced: Bool { NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }
  private static func curve(_ duration: Double) -> Animation {
    reduced ? .linear(duration: 0.08) : .timingCurve(0.23, 1, 0.32, 1, duration: duration)
  }
  /// Presses and hovers.
  public static var press: Animation { curve(0.14) }
  public static var fast: Animation { curve(0.16) }
  public static var base: Animation { curve(0.2) }
  /// Dialogs and panels entering.
  public static var panel: Animation { reduced ? .linear(duration: 0.1) : .spring(response: 0.32, dampingFraction: 0.86) }
  /// Layout that should feel physical (reordering, drags settling).
  public static var settle: Animation { reduced ? .linear(duration: 0.1) : .spring(response: 0.36, dampingFraction: 0.82) }
  public static var isReduced: Bool { reduced }
}

public enum ShellMetrics {
  public static let sidebarWidth: CGFloat = 224
}
