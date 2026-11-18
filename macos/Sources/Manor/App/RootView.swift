import ManorKit
import SwiftUI

struct RootView: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    ZStack {
      Palette.surfaceCanvas.ignoresSafeArea()
      if let message = model.configError {
        EmptyState(systemImage: "exclamationmark.triangle", title: "Manor can't start", message: message)
      } else if let session = model.session {
        content(session)
          .onChange(of: session.state, initial: true) { _, state in model.sync(with: state) }
      }
      ToastHost()
    }
    .font(.ui())
    .foregroundStyle(Palette.ink)
    .tint(Palette.primary)
  }

  @ViewBuilder
  private func content(_ session: ManorSession) -> some View {
    switch session.state {
    case .starting:
      ManorLogo(width: 56).opacity(0.9).frame(maxWidth: .infinity, maxHeight: .infinity)
    case .signedOut(let message):
      AccessView(session: session, initialError: message).transition(.opacity)
    case .signedIn:
      if let context = model.context {
        // Each account gets fresh page state: stores hold that account's gateway.
        MainView().environment(context).id(context.account.id).transition(.opacity)
      }
    }
  }
}
