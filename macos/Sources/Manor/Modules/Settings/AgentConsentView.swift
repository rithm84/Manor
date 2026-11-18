import ManorKit
import Supabase
import SwiftUI

/// Where an agent's request for access is decided. The consent page in the agent's browser window opens
/// Manor with the request; the decision goes to Supabase Auth, and the address it answers with is handed back
/// to that browser page, which continues in the agent's own window.
struct AgentConsentView: View {
  let authorizationId: String
  let onClose: () -> Void

  @Environment(AppContext.self) private var context
  @State private var stage: Stage = .loading
  @State private var allowWrites = true
  @State private var busy = false
  @State private var error: String?

  enum Stage: Equatable {
    case loading
    case deciding(clientId: String, clientName: String)
    case returning(clientName: String?)
  }

  var body: some View {
    VStack(alignment: .leading, spacing: Space.s4) {
      HStack(spacing: Space.s3) {
        ManorLogo(width: 28)
        Text("Connect to Manor").font(.dialogTitle).foregroundStyle(Palette.ink)
        Spacer()
        IconButton("xmark", label: "Close", action: onClose).disabled(busy)
      }
      content
      if let error { SettingsNotice(text: error, failed: true) }
      actions
    }
    .padding(Space.s6)
    .task(id: authorizationId) { await load() }
  }

  @ViewBuilder
  private var content: some View {
    switch stage {
    case .loading:
      if error == nil {
        HStack(spacing: Space.s2) {
          ProgressView().controlSize(.small)
          Text("Loading the request").font(.ui(Typography.Size.body)).foregroundStyle(Palette.inkMuted)
        }
        .frame(maxWidth: .infinity, minHeight: 60, alignment: .leading)
      }
    case .deciding(_, let clientName):
      VStack(alignment: .leading, spacing: Space.s3) {
        (Text(clientName).font(.ui(Typography.Size.md, weight: .semibold)).foregroundColor(Palette.ink)
          + Text(" is asking for access to your Manor account.").font(.ui(Typography.Size.md)).foregroundColor(Palette.inkBody))
          .fixedSize(horizontal: false, vertical: true)
        Label {
          Text("Read your tasks, habits, notes, mood, focus, job applications, and weekly reviews.")
            .font(.ui(Typography.Size.body)).foregroundStyle(Palette.inkBody)
            .fixedSize(horizontal: false, vertical: true)
        } icon: {
          Image(systemName: "eye").foregroundStyle(Palette.inkMuted)
        }
        Toggle(isOn: $allowWrites) {
          VStack(alignment: .leading, spacing: 2) {
            Text("Allow updates when I ask").font(.ui(Typography.Size.body, weight: .medium)).foregroundStyle(Palette.ink)
            Text("The agent can create and change records on your behalf.").font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted)
          }
        }
        .toggleStyle(.checkbox)
        .disabled(busy)
        Text("You can remove this connection in Settings.").font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted)
      }
    case .returning(let clientName):
      HStack(alignment: .firstTextBaseline, spacing: Space.s2) {
        Image(systemName: "checkmark.circle.fill").foregroundStyle(Palette.completion)
        Text(SettingsDomain.agentReturnMessage(clientName: clientName))
          .font(.ui(Typography.Size.md)).foregroundStyle(Palette.ink)
          .fixedSize(horizontal: false, vertical: true)
      }
    }
  }

  @ViewBuilder
  private var actions: some View {
    HStack(spacing: Space.s2) {
      Spacer()
      switch stage {
      case .deciding(let clientId, let clientName):
        Button("Cancel") { answer(clientName: clientName) { try await deny() } }
          .buttonStyle(.secondary)
          .keyboardShortcut(.cancelAction)
        Button(busy ? "Connecting" : "Allow access") { answer(clientName: clientName) { try await approve(clientId: clientId) } }
          .buttonStyle(.primary)
          .keyboardShortcut(.defaultAction)
      case .returning, .loading:
        if case .returning = stage {
          Button("Back to Manor", action: onClose).buttonStyle(.primary).keyboardShortcut(.defaultAction)
        } else if error != nil {
          Button("Back to Manor", action: onClose).buttonStyle(.secondary).keyboardShortcut(.cancelAction)
        }
      }
    }
    .disabled(busy)
  }

  // MARK: Flow

  private var oauth: AuthOAuthServer { context.gateway.client.auth.oauthServer }

  private func load() async {
    stage = .loading
    error = nil
    guard let id = SettingsDomain.validAuthorizationId(authorizationId) else {
      error = "This connection request is not valid. Ask the app to connect again."
      return
    }
    do {
      switch try await oauth.getAuthorizationDetails(authorizationId: id) {
      case .details(let details):
        stage = .deciding(clientId: details.client.id.uuidString.lowercased(), clientName: details.client.name)
      case .redirect(let redirect):
        // This account already allowed the agent, so there is nothing to decide.
        try await handOff(redirect.redirectURL)
        stage = .returning(clientName: nil)
      }
    } catch {
      self.error = Self.message(error, fallback: "This connection request could not be read.")
    }
  }

  private func answer(clientName: String, _ decide: @escaping () async throws -> URL) {
    busy = true
    error = nil
    Task {
      do {
        try await handOff(try await decide())
        stage = .returning(clientName: clientName)
      } catch {
        self.error = Self.message(error, fallback: "The connection could not be completed.")
      }
      busy = false
    }
  }

  /// Records the grant against the OAuth client, then approves the authorization.
  private func approve(clientId: String) async throws -> URL {
    try await context.gateway.rpc("manor_authorize_mcp_client", ["p_client_id": .string(clientId), "p_write": .bool(allowWrites)])
    return try await oauth.approveAuthorization(authorizationId: authorizationId).redirectURL
  }

  private func deny() async throws -> URL {
    try await oauth.denyAuthorization(authorizationId: authorizationId).redirectURL
  }

  /// Gives the return address to the consent page waiting in the agent's browser window.
  private func handOff(_ redirect: URL) async throws {
    guard redirect.scheme != nil else {
      throw ManorRequestError(operation: "manor_oauth_handoff_save", code: "url", detail: "The agent's return address is not valid.")
    }
    try await context.gateway.rpc("manor_oauth_handoff_save", ["p_authorization_id": .string(authorizationId), "p_redirect_url": .string(redirect.absoluteString)])
  }

  private static func message(_ error: Error, fallback: String) -> String {
    let text = error.localizedDescription
    return text.isEmpty ? fallback : text
  }
}
