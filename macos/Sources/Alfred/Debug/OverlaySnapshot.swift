import AppKit
import SwiftUI

/// Offscreen renders of the notch card for design review (no window is shown, nothing is captured).
public enum AlfredSnapshot {
    /// Renders the overlay with sample chats to a PNG.
    /// - Parameters:
    ///   - mode: General or Prep (changes the card's controls and copy).
    ///   - open: the opened card, or the surface folded flush into the notch.
    ///   - notch: draw as on a notched screen (`true`) or a screen without one.
    @MainActor
    public static func renderOverlay(to url: URL, mode: AlfredMode, open: Bool = true, notch: Bool = true,
                                     askText: String = "", dark: Bool = false) {
        let prefs = Preferences(defaults: UserDefaults(suiteName: "manor.alfred.snapshot") ?? .standard)
        prefs.alfredMode = mode
        let state = AlfredState(prefs: prefs, knowledge: KnowledgeStore(url: FileManager.default.temporaryDirectory.appendingPathComponent("alfred-snapshot-knowledge.json")))
        if open {
            state.loadDemo()
            state.askText = askText
        }
        let geometry = notch ? NotchGeometry(hasNotch: true, notch: CGSize(width: 185, height: 32))
                             : NotchGeometry(hasNotch: false, notch: CGSize(width: 0, height: 24))
        let size = CGSize(width: OverlayController.size.width, height: 760)
        let root = OverlayRoot(regions: HitRegions(), size: size)
            .environmentObject(NotchModel(geometry))
            .environmentObject(state)
            .environmentObject(state.prefs)
            .environmentObject(state.listener)
            .environmentObject(state.answers)
            .environmentObject(state.context)
            .environmentObject(state.transcript)
            .environment(\.diagramAnimation, false)
        let hosting = NSHostingView(rootView: root)
        hosting.frame = NSRect(origin: .zero, size: size)
        hosting.appearance = NSAppearance(named: .darkAqua)
        let window = NSWindow(contentRect: hosting.frame, styleMask: [.borderless], backing: .buffered, defer: false)
        window.isOpaque = false
        window.backgroundColor = .clear
        window.contentView = hosting
        hosting.layoutSubtreeIfNeeded()
        RunLoop.main.run(until: Date().addingTimeInterval(0.6))
        OverlayController.writePNG(of: hosting, geometry: geometry, dark: dark, to: url)
    }
}
