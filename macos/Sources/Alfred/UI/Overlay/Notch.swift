import AppKit
import SwiftUI

// The overlay lives in the notch: one black surface that sits flush with the hardware notch while you work
// and springs down into the full chat card when opened (toasts briefly grow it, Dynamic-Island style). Same idea as
// notch utilities like boring.notch / DynamicNotchKit (solid black so it merges with the cut-out, concave
// top "ears" that melt into the menu bar, rounded bottom corners), written for Alfred.

/// Where the notch is on the overlay's screen. Screens without a notch get a menu-bar-high stub of width 0,
/// so the surface hangs from the top edge like a small tab instead.
struct NotchGeometry: Equatable {
    var hasNotch: Bool
    var notch: CGSize

    static func of(_ screen: NSScreen) -> NotchGeometry {
        let top = screen.safeAreaInsets.top
        if top > 0, let left = screen.auxiliaryTopLeftArea?.width, let right = screen.auxiliaryTopRightArea?.width {
            return NotchGeometry(hasNotch: true, notch: CGSize(width: screen.frame.width - left - right, height: top))
        }
        let menuBar = max(24, screen.frame.maxY - screen.visibleFrame.maxY)
        return NotchGeometry(hasNotch: false, notch: CGSize(width: 0, height: menuBar))
    }

    /// The screen the overlay belongs on: the one with a notch, else the main screen.
    /// Nil only while no display is attached (all displays disconnected or reconfiguring).
    static var preferredScreen: NSScreen? {
        NSScreen.screens.first { $0.safeAreaInsets.top > 0 } ?? NSScreen.main ?? NSScreen.screens.first
    }
}

/// Published so the view tree follows display changes (lid closed, external monitor) without a rebuild.
@MainActor
final class NotchModel: ObservableObject {
    @Published var geometry: NotchGeometry
    init(_ geometry: NotchGeometry) { self.geometry = geometry }
}

/// `flush`: exactly the hardware notch (nothing showing). `open`: the chat card.
enum NotchMode: Equatable { case flush, open }

/// Notch outline: concave quarter "ears" of radius `top` flare into the menu bar at the top corners; the body
/// (inset by `top` on each side) ends in rounded bottom corners of radius `bottom`. Both radii animate.
struct NotchShape: Shape {
    var top: CGFloat
    var bottom: CGFloat

    var animatableData: AnimatablePair<CGFloat, CGFloat> {
        get { AnimatablePair(top, bottom) }
        set { top = newValue.first; bottom = newValue.second }
    }

    func path(in r: CGRect) -> Path {
        let t = min(top, r.width / 4), b = min(bottom, (r.width - 2 * t) / 2, r.height / 2)
        var p = Path()
        p.move(to: CGPoint(x: r.minX, y: r.minY))
        p.addQuadCurve(to: CGPoint(x: r.minX + t, y: r.minY + t), control: CGPoint(x: r.minX + t, y: r.minY))
        p.addLine(to: CGPoint(x: r.minX + t, y: r.maxY - b))
        p.addQuadCurve(to: CGPoint(x: r.minX + t + b, y: r.maxY), control: CGPoint(x: r.minX + t, y: r.maxY))
        p.addLine(to: CGPoint(x: r.maxX - t - b, y: r.maxY))
        p.addQuadCurve(to: CGPoint(x: r.maxX - t, y: r.maxY - b), control: CGPoint(x: r.maxX - t, y: r.maxY))
        p.addLine(to: CGPoint(x: r.maxX - t, y: r.minY + t))
        p.addQuadCurve(to: CGPoint(x: r.maxX, y: r.minY), control: CGPoint(x: r.maxX - t, y: r.minY))
        p.closeSubpath()
        return p
    }
}

extension Theme {
    /// Opening overshoots a touch; closing is critically damped (no bounce back into the notch).
    static var notchOpen: Animation {
        NSWorkspace.shared.accessibilityDisplayShouldReduceMotion ? .easeOut(duration: 0.12) : .spring(response: 0.42, dampingFraction: 0.8)
    }
    static var notchClose: Animation {
        NSWorkspace.shared.accessibilityDisplayShouldReduceMotion ? .easeOut(duration: 0.1) : .spring(response: 0.45, dampingFraction: 1.0)
    }
    static let notchRadii: [NotchMode: (top: CGFloat, bottom: CGFloat)] = [
        .flush: (6, 12), .open: (18, 26),
    ]
    /// Side padding inside the open surface (on top of the ears).
    static let notchInset: CGFloat = 12
}

/// The whole overlay surface. Resting the pointer on the notch opens Alfred (or tapping it, in click mode); tapping
/// the notch opens it ready to type, and tapping it again folds Alfred away.
struct NotchSurface: View {
    @EnvironmentObject private var state: AlfredState
    @EnvironmentObject private var listener: Listener
    @EnvironmentObject private var notchModel: NotchModel
    let mode: NotchMode
    let regions: HitRegions
    let maxAnswerHeight: CGFloat


    private var notch: NotchGeometry { notchModel.geometry }
    private var radii: (top: CGFloat, bottom: CGFloat) { Theme.notchRadii[mode]! }
    private var listening: Bool { listener.isActive || listener.status == .starting }
    /// No notch to sit in: nothing to show until the card opens.
    private var hidden: Bool { mode == .flush && !notch.hasNotch && state.toast == nil }

    private var width: CGFloat {
        switch mode {
        case .flush: notch.notch.width + 2 * radii.top
        case .open: max(Theme.cardWidth, notch.notch.width + 2 * 120) + 2 * (radii.top + Theme.notchInset)
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            // The strip level with the camera stays clean black, flush with the notch, open or not.
            Color.clear.frame(height: notch.notch.height)

            if let toast = state.toast, mode != .open {
                NotchToast(toast: toast)
                    .padding(.horizontal, 12)
                    .padding(.bottom, 9)
                    .transition(.opacity.combined(with: .scale(scale: 0.9, anchor: .top)))
                    .id(toast.id)
            }

            if mode == .open {
                VStack(spacing: 0) {
                    if let toast = state.toast {
                        NotchToast(toast: toast).padding(.top, 6).id(toast.id)
                            .transition(.opacity.combined(with: .move(edge: .top)))
                    }
                    AssistCard(regions: regions, maxAnswerHeight: maxAnswerHeight)
                }
                .padding(.horizontal, Theme.notchInset)
                .transition(.asymmetric(
                    insertion: .opacity.combined(with: .scale(scale: 0.96, anchor: .top)).animation(.easeOut(duration: 0.22).delay(0.06)),
                    removal: .opacity.animation(.easeIn(duration: 0.1))))
            }
        }
        .padding(.horizontal, radii.top)
        .frame(width: width)
        .fixedSize(horizontal: false, vertical: true)
        .clipShape(NotchShape(top: radii.top, bottom: radii.bottom))
        // Solid black with no shadow, so the card reads as part of the hardware notch.
        .background { NotchShape(top: radii.top, bottom: radii.bottom).fill(Color.black) }
        .overlay {
            // A hairline rim below the menu bar so the open card reads as a surface on dark wallpapers too.
            NotchShape(top: radii.top, bottom: radii.bottom)
                .stroke(Color.white.opacity(mode == .open ? 0.10 : 0), lineWidth: 0.75)
                .mask(LinearGradient(colors: [.clear, .white], startPoint: .top, endPoint: .init(x: 0.5, y: 0.25)))
                .allowsHitTesting(false)
        }
        .contentShape(NotchShape(top: radii.top, bottom: radii.bottom))
        .onTapGesture(coordinateSpace: .local) { location in
            switch mode {
            case .flush: state.beginAsk()
            // The strip level with the camera is the notch itself. Clicking it folds an open card back in, the way
            // a click there opened it; on a card that hover opened, it means "I want to type" instead. Clicks on
            // the card below keep working as usual.
            case .open:
                guard location.y <= notch.notch.height else { break }
                if state.hoverPeek { state.beginAsk() } else { state.collapseCard() }
            }
        }
        .opacity(hidden ? 0 : 1)
        // Hidden on a screen without a notch: nothing there may catch clicks meant for the menu bar.
        .hitRegion("notch", in: regions, enabled: !hidden)
        .animation(mode == .open ? Theme.notchOpen : Theme.notchClose, value: mode)
        .animation(Theme.notchOpen, value: listening)
        .animation(Theme.notchOpen, value: state.toast?.id)
    }
}

private struct NotchToast: View {
    let toast: Toast
    var body: some View {
        HStack(spacing: 7) {
            Image(systemName: icon).font(.system(size: 11, weight: .semibold)).foregroundStyle(color)
            Text(toast.message).font(.alfred(12, .medium)).foregroundStyle(Theme.text)
                .lineLimit(2).multilineTextAlignment(.leading)
        }
        .frame(maxWidth: Theme.cardWidth - 40)
        .fixedSize(horizontal: false, vertical: true)
    }

    private var icon: String {
        switch toast.style {
        case .info: "checkmark.circle.fill"
        case .warning: "exclamationmark.circle.fill"
        case .error: "xmark.octagon.fill"
        }
    }

    private var color: Color {
        switch toast.style {
        case .info: Theme.me
        case .warning: Theme.warning
        case .error: Theme.live
        }
    }
}

/// Recording dot, elapsed time and a level meter; idle shows a dim mic glyph.
struct LiveStatus: View {
    @EnvironmentObject private var listener: Listener
    var compact = false

    var body: some View {
        HStack(spacing: 6) {
            switch listener.status {
            case .starting:
                ProgressView().controlSize(.mini).tint(.white)
                if !compact { Text("Connecting").font(.alfred(12, .medium)).foregroundStyle(Theme.icon) }
            case _ where listener.isActive:
                PulsingDot(color: listener.status == .live ? Theme.live : Theme.warning)
                if let started = listener.startedAt {
                    TimelineView(.periodic(from: started, by: 1)) { ctx in
                        Text(Self.elapsed(from: started, to: ctx.date))
                            .font(.alfred(12, .medium)).monospacedDigit()
                            .foregroundStyle(Theme.text)
                    }
                }
                Meter(level: max(listener.themLevel, listener.micEnabled ? listener.meLevel : 0))
                if !listener.micEnabled {
                    Image(systemName: "mic.slash.fill").font(.system(size: 9.5)).foregroundStyle(Theme.dim)
                }
            default:
                // Same footprint as the listen button on the other side, so the pair looks balanced.
                Image(systemName: "mic.fill").font(.system(size: 10, weight: .semibold)).foregroundStyle(Theme.icon)
                    .frame(width: 22, height: 22)
                    .background(Circle().fill(Color.white.opacity(0.10)))
            }
        }
        .help(helpText)
    }

    private var helpText: String {
        switch listener.status {
        case .degraded(let r), .failed(let r): r
        case .live: "Listening. Press ⌃⌥␣ to answer."
        case .starting: "Connecting…"
        default: "Not listening. Press ⌃⌥L to start"
        }
    }

    static func elapsed(from start: Date, to now: Date) -> String {
        let s = max(0, Int(now.timeIntervalSince(start)))
        return s >= 3600 ? String(format: "%d:%02d:%02d", s / 3600, (s / 60) % 60, s % 60)
                         : String(format: "%02d:%02d", s / 60, s % 60)
    }
}
