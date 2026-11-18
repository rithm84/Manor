import SwiftUI

/// Root of the overlay panel: the notch surface, pinned to the top edge of the screen.
struct OverlayRoot: View {
    @EnvironmentObject private var state: AlfredState
    @EnvironmentObject private var answers: AnswerEngine
    let regions: HitRegions
    let size: CGSize

    /// Listening happens silently in the background; the card only opens when the user asks for help.
    private var mode: NotchMode { state.overlayVisible && state.isCardOpen ? .open : .flush }

    var body: some View {
        VStack(spacing: 0) {
            NotchSurface(mode: mode, regions: regions, maxAnswerHeight: max(240, size.height * 0.62))
            Spacer(minLength: 0)
        }
        .frame(width: size.width, height: size.height, alignment: .top)
        .environment(\.colorScheme, .dark)
    }
}

