import SwiftUI

/// The overlay panel is a large transparent window; only the drawn surfaces should take clicks.
/// Views register their frames here and the panel toggles `ignoresMouseEvents` as the cursor moves.
@MainActor
final class HitRegions {
    private var rects: [String: CGRect] = [:]

    func set(_ id: String, _ rect: CGRect?) { rects[id] = rect }

    func contains(_ point: CGPoint) -> Bool {
        rects.values.contains { $0.insetBy(dx: -4, dy: -4).contains(point) }
    }
}

extension View {
    /// Registers the view's frame as clickable. `enabled: false` (an invisible surface) lets clicks pass through.
    func hitRegion(_ id: String, in regions: HitRegions, enabled: Bool = true) -> some View {
        onGeometryChange(for: CGRect?.self) { enabled ? $0.frame(in: .global) : nil } action: { regions.set(id, $0) }
            .onDisappear { regions.set(id, nil) }
    }
}

