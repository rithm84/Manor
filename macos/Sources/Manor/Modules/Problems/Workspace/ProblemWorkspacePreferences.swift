import Foundation
import ManorKit

/// Workspace choices remembered on this Mac: the solution language, editor font and indentation, the console's
/// visibility, and pane sizes.
enum ProblemWorkspacePreferences {
  private static let defaults = UserDefaults.standard

  static var language: ProblemLanguage {
    get { defaults.string(forKey: "problems.language").flatMap(ProblemLanguage.init(rawValue:)) ?? .defaultLanguage }
    set { defaults.set(newValue.rawValue, forKey: "problems.language") }
  }

  static let fontSizes: [Int] = [12, 13, 14, 15, 16, 17, 18, 20, 22, 24]
  static let tabSizes: [Int] = [2, 4, 8]

  static var fontSize: Int {
    get { let value = defaults.integer(forKey: "problems.editor-font-size"); return fontSizes.contains(value) ? value : 14 }
    set { defaults.set(newValue, forKey: "problems.editor-font-size") }
  }

  static var tabSize: Int {
    get { let value = defaults.integer(forKey: "problems.editor-tab-size"); return tabSizes.contains(value) ? value : 4 }
    set { defaults.set(newValue, forKey: "problems.editor-tab-size") }
  }

  static var consoleOpen: Bool {
    get { defaults.object(forKey: "problems.console-open") as? Bool ?? true }
    set { defaults.set(newValue, forKey: "problems.console-open") }
  }

  /// The reader's share of the workspace width, 0.25 to 0.70.
  static var readerFraction: Double {
    get { let value = defaults.double(forKey: "problems.reader-fraction"); return value == 0 ? 0.44 : min(0.70, max(0.25, value)) }
    set { defaults.set(min(0.70, max(0.25, newValue)), forKey: "problems.reader-fraction") }
  }

  /// The console's share of the solving column's height, 0.15 to 0.75.
  static var consoleFraction: Double {
    get { let value = defaults.double(forKey: "problems.console-fraction"); return value == 0 ? 0.34 : min(0.75, max(0.15, value)) }
    set { defaults.set(min(0.75, max(0.15, newValue)), forKey: "problems.console-fraction") }
  }
}
