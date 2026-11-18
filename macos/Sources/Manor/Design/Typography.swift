import AppKit
import CoreText
import SwiftUI

/// The system font (SF Pro) for interface and body text, Outfit for page titles and headings, SF Mono for code. Sizes follow the token scale;
/// nothing in product UI goes below 12 pt except the 11 pt time-grid gutter.
public enum Typography {
  /// Registers the bundled fonts. A bundle also lists them under `ATSApplicationFontsPath`; an unbundled
  /// development run finds them beside the sources.
  public static func registerFonts() {
    var directories: [URL] = []
    if let resources = Bundle.main.resourceURL { directories.append(resources.appendingPathComponent("Fonts")) }
    directories.append(URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../../../Resources/Fonts").standardized)
    for directory in directories {
      guard let files = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) else { continue }
      for file in files where file.pathExtension == "ttf" {
        CTFontManagerRegisterFontsForURL(file as CFURL, .process, nil)
      }
      return
    }
  }

  public enum Size {
    public static let gutter: CGFloat = 11
    public static let xs: CGFloat = 12
    public static let sm: CGFloat = 13
    public static let body: CGFloat = 14
    public static let md: CGFloat = 15
    public static let emphasis: CGFloat = 16
    public static let lg: CGFloat = 17
    public static let title: CGFloat = 22
    public static let displayMD: CGFloat = 28
    public static let displayLG: CGFloat = 40
  }
}

public extension Font {
  /// The system font at a token size: interface text, body copy, and controls. SF Pro's optical sizes and
  /// native rendering suit Liquid Glass and keep text crisp at every size.
  static func ui(_ size: CGFloat = Typography.Size.body, weight: Font.Weight = .regular) -> Font {
    .system(size: size, weight: weight)
  }

  /// Outfit for page titles and headings.
  static func display(_ size: CGFloat = Typography.Size.displayMD, weight: Font.Weight = .semibold) -> Font {
    .custom("Outfit", size: size).weight(weight)
  }

  /// Every dialog's title, whether a `DialogPanel`, a confirmation, or a custom object dialog: one recipe.
  static var dialogTitle: Font { .display(Typography.Size.lg, weight: .semibold) }

  /// Code and code-like values.
  static func code(_ size: CGFloat = Typography.Size.sm, weight: Font.Weight = .regular) -> Font {
    .system(size: size, weight: weight, design: .monospaced)
  }
}

public extension View {
  /// Tabular numerals for comparable statistics, times, and counts.
  func tabular() -> some View { monospacedDigit() }
}
