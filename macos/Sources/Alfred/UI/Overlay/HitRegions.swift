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

/// Drag the whole panel from any non-interactive part of a view; a click without movement calls `onClick`.
struct WindowDragArea: NSViewRepresentable {
    var onClick: (() -> Void)?

    final class DragView: NSView {
        var onClick: (() -> Void)?
        private var startMouse: NSPoint = .zero
        private var startOrigin: NSPoint = .zero
        private var dragged = false

        override func mouseDown(with event: NSEvent) {
            startMouse = NSEvent.mouseLocation
            startOrigin = window?.frame.origin ?? .zero
            dragged = false
        }

        override func mouseDragged(with event: NSEvent) {
            let now = NSEvent.mouseLocation
            let dx = now.x - startMouse.x, dy = now.y - startMouse.y
            if !dragged, hypot(dx, dy) < 3 { return }
            dragged = true
            window?.setFrameOrigin(NSPoint(x: startOrigin.x + dx, y: startOrigin.y + dy))
        }

        override func mouseUp(with event: NSEvent) {
            if !dragged { onClick?() }
        }
        override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    }

    func makeNSView(context: Context) -> DragView {
        let v = DragView()
        v.onClick = onClick
        return v
    }

    func updateNSView(_ nsView: DragView, context: Context) { nsView.onClick = onClick }
}
