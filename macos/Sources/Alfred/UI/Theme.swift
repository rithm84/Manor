import AppKit
import SwiftUI

/// The notch card's visual language. The card is deliberately black so it merges with the hardware notch; on
/// that black, text and accents follow Manor: the system font, Manor's plum for intent and focus, and Manor's
/// dark-theme roles for status colors. Values mirror Manor's `Palette` dark roles, since the card is always dark.
enum Theme {
    // Surfaces
    static let glassBase = Color(red: 24 / 255, green: 23 / 255, blue: 28 / 255)

    // Text and icons. The notch card is always dark; embedded views (Notes) follow the surrounding appearance,
    // so every role has a light value too (Manor's light Palette roles).
    static let ink = Color.adaptive(dark: (1, 1, 1), light: (0.1451, 0.1333, 0.1647))
    static let text = Color.adaptive(dark: (0.9529, 0.9373, 0.9686), light: (0.1451, 0.1333, 0.1647))    // Palette.ink
    static let icon = Color.adaptive(dark: (0.7255, 0.6863, 0.7686), light: (0.3843, 0.3529, 0.4235))    // Palette.inkMuted
    static let dim = Color.adaptive(dark: (0.6200, 0.5900, 0.6600), light: (0.3843, 0.3529, 0.4235))
    static let primaryText = text
    static let secondaryText = ink.opacity(0.62)
    static let tertiaryText = ink.opacity(0.45)
    static let hairline = ink.opacity(0.10)
    static let fill = ink.opacity(0.06)
    static let fillHover = text.opacity(0.10)
    /// The surface diagrams and panels are drawn on: near-black in the card, white in a light document.
    static let surface = Color.adaptive(dark: (0.11, 0.11, 0.11), light: (1, 1, 1))
    /// Shadows and inset wells.
    static let shade = Color.adaptive(dark: (0, 0, 0), light: (0.36, 0.32, 0.42))
    /// The diagram backdrop's gradient: a dark well in the card, a whisper of plum-gray on a light page.
    static let paperTop = Color.adaptive(dark: (0, 0, 0, 0.16), light: (0.36, 0.32, 0.42, 0.05))
    static let paperBottom = Color.adaptive(dark: (0, 0, 0, 0.24), light: (0.36, 0.32, 0.42, 0.08))
    static let codeBackground = Color.adaptive(dark: (0, 0, 0, 0.38), light: (0.9647, 0.9647, 0.9725, 1))
    static let inlineCode = Color.adaptive(dark: (0.92, 0.86, 0.97), light: (0.40, 0.25, 0.50))

    // Accent: Manor plum. `accent` is Palette.primary; the intent gradient (prompt bubble, send) runs from
    // Palette.primary (light) to Palette.primaryActive (light) so white text on it keeps 6:1 or better.
    static let accent = Color.adaptive(dark: (0.7608, 0.6078, 0.8627), light: (0.4588, 0.3137, 0.5608))
    static let intentTop = Color(red: 0.4588, green: 0.3137, blue: 0.5608)
    static let intentBottom = Color(red: 0.3333, green: 0.2000, blue: 0.4118)
    static let intentRing = Color(red: 0.5400, green: 0.3900, blue: 0.6400)
    static let intentHighlight = Color(red: 0.8196, green: 0.6784, blue: 0.9059)
    static let intent = LinearGradient(colors: [intentTop, intentBottom], startPoint: .top, endPoint: .bottom)

    // Status: Palette.overdueError, Palette.completion, and Palette.warning.
    static let live = Color.adaptive(dark: (1.0, 0.4706, 0.5098), light: (0.6235, 0.2157, 0.2588))
    static let me = Color.adaptive(dark: (0.6118, 0.8353, 0.6784), light: (0.1725, 0.3922, 0.2510))
    static let warning = Color.adaptive(dark: (0.8902, 0.7412, 0.4235), light: (0.4667, 0.3333, 0.0235))

    // Metrics
    static let cardRadius: CGFloat = 16
    static let cardWidth: CGFloat = 540
    static let answerSize: CGFloat = 13

    // Motion: Manor's panel spring and press timing; Reduce Motion swaps movement for a short fade.
    private static var reduced: Bool { NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }
    static var spring: Animation { reduced ? .linear(duration: 0.1) : .spring(response: 0.32, dampingFraction: 0.86) }
    static var snappy: Animation { reduced ? .linear(duration: 0.08) : .spring(response: 0.2, dampingFraction: 0.9) }
}

extension Color {
    /// A color that resolves per appearance (dark or light), like Manor's `Palette` roles.
    static func adaptive(dark: (Double, Double, Double), light: (Double, Double, Double)) -> Color {
        adaptive(dark: (dark.0, dark.1, dark.2, 1), light: (light.0, light.1, light.2, 1))
    }

    static func adaptive(dark: (Double, Double, Double, Double), light: (Double, Double, Double, Double)) -> Color {
        Color(nsColor: NSColor(name: nil) { appearance in
            let isDark = appearance.bestMatch(from: [.darkAqua, .aqua, .vibrantDark, .vibrantLight]).map { $0 == .darkAqua || $0 == .vibrantDark } ?? false
            let v = isDark ? dark : light
            return NSColor(srgbRed: v.0, green: v.1, blue: v.2, alpha: v.3)
        })
    }
}

/// Plum intent surface with a ring and an inner highlight (prompt bubble, send button).
struct IntentSurface<S: Shape>: View {
    var shape: S
    var body: some View {
        shape.fill(Theme.intent)
            .overlay(shape.stroke(Theme.intentRing, lineWidth: 0.5))
            .overlay(shape.stroke(LinearGradient(stops: [.init(color: Theme.intentHighlight, location: 0),
                                                         .init(color: Theme.intentHighlight.opacity(0), location: 0.2)],
                                                 startPoint: .top, endPoint: .bottom), lineWidth: 0.5))
    }
}

/// A key glyph for the ⌃⌥ shortcuts shown inside the card.
struct Keycap: View {
    let label: String
    var body: some View {
        Text(label)
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(Color.white.opacity(0.62))
            .frame(minWidth: 20, minHeight: 20)
            .padding(.horizontal, label.count > 1 ? 4 : 0)
            .background(RoundedRectangle(cornerRadius: 5, style: .continuous).fill(Color.white.opacity(0.06)))
            .overlay(RoundedRectangle(cornerRadius: 5, style: .continuous).strokeBorder(Color.white.opacity(0.18), lineWidth: 1))
    }
}

/// Text-only button that gains a #EDEEF2/10 capsule on hover (action chips, icon buttons).
struct GhostButtonStyle: ButtonStyle {
    var padding = EdgeInsets(top: 8, leading: 6, bottom: 8, trailing: 8)
    var radius: CGFloat = 999

    func makeBody(configuration: Configuration) -> some View {
        GhostButtonBody(configuration: configuration, padding: padding, radius: radius)
    }

    private struct GhostButtonBody: View {
        let configuration: Configuration
        let padding: EdgeInsets
        let radius: CGFloat
        @State private var hovering = false

        var body: some View {
            configuration.label
                .padding(padding)
                .background(RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .fill(configuration.isPressed ? Theme.fillHover.opacity(1.6) : hovering ? Theme.fillHover : .clear))
                .contentShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
                .animation(.easeOut(duration: 0.075), value: hovering)
                .onHover { hovering = $0 }
        }
    }
}
