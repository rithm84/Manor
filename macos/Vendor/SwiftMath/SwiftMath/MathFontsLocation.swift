import Foundation

/// Manor patch: the math fonts ship in the app's `Resources/MathFonts` folder instead of a SwiftPM resource
/// bundle, because SwiftPM's generated `Bundle.module` looks beside the app bundle, where a signed app cannot
/// hold anything. An unbundled development run finds them in the source tree.
enum MathFontsLocation {
  static let url: URL? = {
    if let resources = Bundle.main.resourceURL?.appendingPathComponent("MathFonts"),
       FileManager.default.fileExists(atPath: resources.appendingPathComponent("latinmodern-math.otf").path) {
      return resources
    }
    let source = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
      .appendingPathComponent("../../../Resources/MathFonts").standardized
    return FileManager.default.fileExists(atPath: source.path) ? source : nil
  }()
}
