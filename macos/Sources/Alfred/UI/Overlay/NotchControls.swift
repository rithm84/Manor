import AppKit
import SwiftUI

/// Four soft bars driven by the louder of the two sources.
struct Meter: View {
    let level: Float
    private let weights: [CGFloat] = [0.55, 1.0, 0.75, 0.45]
    var body: some View {
        HStack(spacing: 2) {
            ForEach(0..<4, id: \.self) { i in
                Capsule().fill(Color.white.opacity(0.85))
                    .frame(width: 2, height: 3 + 9 * CGFloat(level) * weights[i])
            }
        }
        .frame(height: 12)
        .animation(.easeOut(duration: 0.09), value: level)
    }
}

/// Start (waveform) / stop (square) listening.
struct ListenButton: View {
    @EnvironmentObject private var state: AlfredState
    @EnvironmentObject private var listener: Listener
    var size: CGFloat = 26

    var body: some View {
        Button { state.toggleListening() } label: {
            Group {
                if listener.isActive {
                    RoundedRectangle(cornerRadius: 2).fill(.white).frame(width: size * 0.36, height: size * 0.36)
                } else if case .failed = listener.status {
                    Image(systemName: "exclamationmark").font(.system(size: size * 0.42, weight: .bold)).foregroundStyle(Theme.warning)
                } else {
                    Image(systemName: "waveform").font(.system(size: size * 0.46, weight: .semibold)).foregroundStyle(.white)
                }
            }
            .frame(width: size, height: size)
            .background(Circle().fill(Color.white.opacity(listener.isActive ? 0.16 : 0.10)))
            .contentShape(Circle())
            .contentTransition(.opacity)
        }
        .buttonStyle(PressScaleStyle())
        .help(listener.isActive ? "Stop listening (⌃⌥L)" : "Start listening (⌃⌥L)")
        .accessibilityLabel(listener.isActive ? "Stop listening" : "Start listening")
    }
}

struct PulsingDot: View {
    var color: Color
    @State private var pulse = false
    var body: some View {
        Circle()
            .fill(color)
            .frame(width: 7, height: 7)
            .background(Circle().fill(color.opacity(0.45)).scaleEffect(pulse ? 2.4 : 1).opacity(pulse ? 0 : 1))
            .onAppear {
                // A recording light keeps its meaning without the pulse when Reduce Motion is on.
                guard !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion else { return }
                withAnimation(.easeOut(duration: 1.4).repeatForever(autoreverses: false)) { pulse = true }
            }
    }
}
