import SwiftUI

/// Alfred's type follows Manor's: the system font for interface and answer text (Manor's `Font.ui`), SF Mono for
/// code and numbers (`Font.code`), and Outfit for display headings (`Font.display`, registered by Manor at launch).
extension Font {
    static func alfred(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        .system(size: size, weight: weight)
    }

    static func alfredMono(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        .system(size: size, weight: weight, design: .monospaced)
    }

    static func alfredDisplay(_ size: CGFloat, _ weight: Font.Weight = .semibold) -> Font {
        .custom("Outfit", size: size).weight(weight)
    }
}
