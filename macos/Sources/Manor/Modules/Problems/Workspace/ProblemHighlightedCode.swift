import AppKit
import ManorKit
import SwiftUI

/// Read-only code in the editor's colors: statement fences, editorials, submitted code, and hover signatures.
struct WorkspaceCode: View {
  let code: String
  let language: ProblemLanguage?
  var size: CGFloat = Typography.Size.sm

  var body: some View {
    Text(WorkspaceCodeColorizer.attributed(code, language: language))
      .font(.code(size))
      .lineSpacing(3)
      .fixedSize(horizontal: true, vertical: true)
      .textSelection(.enabled)
  }
}

/// The syntax colors shared by the editor and read-only code.
enum WorkspaceCodeColorizer {
  static func color(_ kind: ProblemSyntax.Kind) -> Color {
    switch kind {
    case .keyword: return Palette.primary
    case .type: return Palette.secondary
    case .function: return Palette.frozenInfo
    case .string: return Palette.forest
    case .number: return Palette.amber
    case .comment: return Palette.inkMuted
    case .attribute: return Palette.thisWeekPlum
    case .constant: return Palette.amber
    }
  }

  static func attributed(_ code: String, language: ProblemLanguage?) -> AttributedString {
    func piece(_ text: String, _ color: Color) -> AttributedString {
      var value = AttributedString(text)
      value.foregroundColor = color
      return value
    }
    guard let language else { return piece(code, Palette.ink) }
    let source = code as NSString
    var result = AttributedString()
    var position = 0
    for token in ProblemSyntax.tokens(code, language: language) where token.range.location >= position {
      if token.range.location > position { result += piece(source.substring(with: NSRange(location: position, length: token.range.location - position)), Palette.ink) }
      result += piece(source.substring(with: token.range), color(token.kind))
      position = NSMaxRange(token.range)
    }
    if position < source.length { result += piece(source.substring(from: position), Palette.ink) }
    return result
  }
}
