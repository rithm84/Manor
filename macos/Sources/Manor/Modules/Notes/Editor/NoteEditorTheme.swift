import AppKit
import ManorKit
import SwiftUI

/// Typography, spacing, and colors of the note document. Reading text has its own comfortable scale
/// (16 pt at 1.5 line height on a ~700 pt measure); controls around it use the product UI scale.
enum NoteTheme {
  // MARK: Measure

  /// The reading column's widest text measure.
  static let maxContentWidth: CGFloat = 720
  /// The gutter left of the column that holds the block handle. Inside a page, the text starts this far from
  /// the editor's leading edge (the Notes page aligns the title to it).
  static let handleGutter: CGFloat = 38
  static let minSideMargin: CGFloat = 24
  /// Indentation of nested children.
  static let childIndent: CGFloat = 26
  /// The column for list markers (bullets, numbers, checkboxes, toggles).
  static let markerWidth: CGFloat = 26
  static let columnGap: CGFloat = 28

  // MARK: Fonts

  static let bodySize: CGFloat = 16

  static func font(family: String, size: CGFloat, weight: NSFont.Weight = .regular, italic: Bool = false) -> NSFont {
    var traits: [NSFontDescriptor.TraitKey: Any] = [.weight: weight]
    if italic { traits[.symbolic] = NSFontDescriptor.SymbolicTraits.italic.rawValue }
    let descriptor = NSFontDescriptor(fontAttributes: [.family: family, .traits: traits])
    if let font = NSFont(descriptor: descriptor, size: size), font.familyName == family {
      return italic ? NSFontManager.shared.convert(font, toHaveTrait: .italicFontMask) : font
    }
    let system = NSFont.systemFont(ofSize: size, weight: weight)
    return italic ? NSFontManager.shared.convert(system, toHaveTrait: .italicFontMask) : system
  }

  /// The system font (SF Pro), matching the app's `Font.ui`.
  static func ui(_ size: CGFloat, _ weight: NSFont.Weight = .regular, italic: Bool = false) -> NSFont {
    let system = NSFont.systemFont(ofSize: size, weight: weight)
    guard italic else { return system }
    let descriptor = system.fontDescriptor.withSymbolicTraits(.italic)
    return NSFont(descriptor: descriptor, size: size) ?? system
  }

  static func display(_ size: CGFloat, _ weight: NSFont.Weight = .semibold) -> NSFont {
    font(family: "Outfit", size: size, weight: weight)
  }

  static func mono(_ size: CGFloat, _ weight: NSFont.Weight = .regular) -> NSFont {
    NSFont.monospacedSystemFont(ofSize: size, weight: weight)
  }

  // MARK: Colors

  static func ns(_ color: Color) -> NSColor { NSColor(color) }

  static var ink: NSColor { ns(Palette.ink) }
  static var inkBody: NSColor { ns(Palette.inkBody) }
  static var inkMuted: NSColor { ns(Palette.inkMuted) }
  static var hairline: NSColor { ns(Palette.hairline) }
  static var primary: NSColor { ns(Palette.primary) }
  static var primaryTint: NSColor { ns(Palette.primaryTint) }
  static var link: NSColor { ns(Palette.link) }
  static var surfaceSoft: NSColor { ns(Palette.surfaceSoft) }
  static var surfaceHover: NSColor { ns(Palette.surfaceHover) }
  static var surfaceCard: NSColor { ns(Palette.surfaceCard) }
  static var selection: NSColor { ns(Palette.selection) }
  static var error: NSColor { ns(Palette.overdueError) }

  /// Block selection fill: the plum selection tint, translucent so text stays legible over it.
  static var blockSelection: NSColor {
    NSColor(name: nil) { appearance in
      appearance.noteIsDark ? NSColor(srgbRed: 0.76, green: 0.61, blue: 0.86, alpha: 0.20) : NSColor(srgbRed: 0.46, green: 0.31, blue: 0.56, alpha: 0.12)
    }
  }

  static var findMatch: NSColor {
    NSColor(name: nil) { appearance in
      appearance.noteIsDark ? NSColor(srgbRed: 0.89, green: 0.74, blue: 0.42, alpha: 0.30) : NSColor(srgbRed: 0.96, green: 0.86, blue: 0.55, alpha: 0.75)
    }
  }

  static var findActive: NSColor {
    NSColor(name: nil) { appearance in
      appearance.noteIsDark ? NSColor(srgbRed: 0.89, green: 0.74, blue: 0.42, alpha: 0.70) : NSColor(srgbRed: 0.95, green: 0.72, blue: 0.25, alpha: 0.95)
    }
  }

  static var codeInlineBackground: NSColor {
    NSColor(name: nil) { appearance in
      appearance.noteIsDark ? NSColor(white: 1, alpha: 0.08) : NSColor(srgbRed: 0.46, green: 0.31, blue: 0.56, alpha: 0.07)
    }
  }

  static var codeInlineText: NSColor {
    NSColor(name: nil) { appearance in
      appearance.noteIsDark ? NSColor(srgbRed: 1.0, green: 0.67, blue: 0.71, alpha: 1) : NSColor(srgbRed: 0.62, green: 0.22, blue: 0.26, alpha: 1)
    }
  }

  private static let highlightPairs: [String: (lightText: UInt32, lightBackground: UInt32, darkText: UInt32, darkBackground: UInt32)] = [
    "gray": (0x625e66, 0xefedea, 0xc7c2ca, 0x37343a),
    "brown": (0x765548, 0xf1e7e2, 0xd7ad91, 0x46362f),
    "red": (0xa63f47, 0xf7e1e2, 0xffaaa3, 0x512e31),
    "orange": (0x985b24, 0xf8e7d5, 0xf6bc83, 0x4c3829),
    "yellow": (0x79610d, 0xf5edc9, 0xe8d17a, 0x443d25),
    "green": (0x356b4b, 0xdceee3, 0x8fd3aa, 0x293f32),
    "blue": (0x32658c, 0xdeebf5, 0x8fc5ed, 0x293b4b),
    "purple": (0x684b91, 0xebe3f5, 0xc6aff0, 0x3b304c),
    "pink": (0x914269, 0xf5e0e9, 0xeda9c8, 0x4c2f3d)
  ]

  private static func hex(_ value: UInt32) -> NSColor {
    NSColor(srgbRed: CGFloat((value >> 16) & 0xff) / 255, green: CGFloat((value >> 8) & 0xff) / 255, blue: CGFloat(value & 0xff) / 255, alpha: 1)
  }

  /// The text color for a block color name, or a CSS hex color a document already holds.
  static func textColor(named name: String?) -> NSColor? {
    guard let name, name != "default" else { return nil }
    if let pair = highlightPairs[name] {
      return NSColor(name: nil) { $0.noteIsDark ? hex(pair.darkText) : hex(pair.lightText) }
    }
    return cssColor(name)
  }

  static func backgroundColor(named name: String?) -> NSColor? {
    guard let name, name != "default" else { return nil }
    if let pair = highlightPairs[name] {
      return NSColor(name: nil) { $0.noteIsDark ? hex(pair.darkBackground) : hex(pair.lightBackground) }
    }
    return cssColor(name)
  }

  private static func cssColor(_ value: String) -> NSColor? {
    let trimmed = value.trimmingCharacters(in: .whitespaces)
    guard trimmed.hasPrefix("#"), let number = UInt32(trimmed.dropFirst(), radix: 16) else { return nil }
    if trimmed.count == 7 { return hex(number) }
    if trimmed.count == 4 {
      let r = (number >> 8) & 0xf, g = (number >> 4) & 0xf, b = number & 0xf
      return hex((r * 17) << 16 | (g * 17) << 8 | (b * 17))
    }
    return nil
  }

  static let colorLabels: [(name: String, label: String)] = [
    ("default", "Default"), ("gray", "Gray"), ("brown", "Brown"), ("red", "Red"), ("orange", "Orange"), ("yellow", "Yellow"),
    ("green", "Green"), ("blue", "Blue"), ("purple", "Purple"), ("pink", "Pink")
  ]

  /// Callout tones map to Manor's semantic tints.
  static func calloutColors(_ tone: String) -> (icon: NSColor, fill: NSColor) {
    switch tone {
    case "info": return (ns(Palette.frozenInfo), ns(Palette.frozenInfoTint))
    case "warning": return (ns(Palette.todayWarning), ns(Palette.todayWarningTint))
    case "success": return (ns(Palette.completion), ns(Palette.completionTint))
    default: return (ns(Palette.primary), ns(Palette.primaryTint))
    }
  }

  static func calloutSymbol(_ tone: String) -> String {
    switch tone {
    case "warning": "exclamationmark.triangle"
    case "success": "checkmark.circle"
    case "info": "info.circle"
    default: "lightbulb"
    }
  }
}

extension NSAppearance {
  var noteIsDark: Bool { bestMatch(from: [.darkAqua, .aqua]) == .darkAqua }
}
