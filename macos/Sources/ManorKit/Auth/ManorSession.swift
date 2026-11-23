import AuthenticationServices
import Foundation
import Observation
import Supabase

/// The signed-in person as Manor knows them.
public struct ManorAccount: Codable, Hashable, Sendable {
  public let id: String
  public let email: String
  public var name: String
  /// The saved IANA time zone that governs today, streaks, and recurrence.
  public var timezone: String

  public var timeZone: TimeZone { TimeZone(identifier: timezone) ?? .current }
}

/// Sign-in state and the account-bound services. One instance lives for the app's lifetime.
@MainActor
@Observable
public final class ManorSession {
  public enum State: Equatable {
    case starting
    case signedOut(message: String?)
    case signedIn(ManorAccount)
  }

  public let config: AppConfig
  public let client: SupabaseClient
  public private(set) var state: State = .starting
  public private(set) var gateway: Gateway?
  /// Set while a sign-in sheet is open, so the panel can show progress.
  public private(set) var isAuthenticating = false

  /// Builds the account's local mirror once a gateway exists. The mirror module installs it at launch.
  @ObservationIgnored public var mirrorFactory: (@MainActor (Gateway) async -> LocalMirror?)?
  /// Checks run before an explicit sign-out; any that returns a message cancels it (unsynced drafts).
  @ObservationIgnored public var signOutGuards: [@MainActor () async -> String?] = []
  /// Runs after sign-out finished, to wipe local account data.
  @ObservationIgnored public var signOutCleanups: [@MainActor (String) async -> Void] = []

  public init(config: AppConfig) {
    self.config = config
    self.client = SupabaseClient(
      supabaseURL: config.supabaseURL,
      supabaseKey: config.supabaseKey,
      options: SupabaseClientOptions(
        auth: .init(
          storage: FileAuthStorage(), redirectToURL: config.authRedirectURL, flowType: .pkce,
          autoRefreshToken: true, emitLocalSessionAsInitialSession: true
        )
      )
    )
  }

  private var listening = false

  public var account: ManorAccount? {
    if case .signedIn(let account) = state { return account }
    return nil
  }

  /// Restores the stored session and follows auth changes for the rest of the run. Only the first call starts the
  /// listener; another would run every sign-in and sign-out twice.
  public func start() async {
    guard !listening else { return }
    listening = true
    Task { [weak self] in
      guard let self else { return }
      for await (event, session) in self.client.auth.authStateChanges {
        await self.handle(event: event, session: session)
      }
    }
  }

  private func handle(event: AuthChangeEvent, session: Session?) async {
    switch event {
    case .initialSession, .signedIn:
      guard let session, !session.isExpired || event == .signedIn else {
        if case .starting = state { state = .signedOut(message: nil) }
        return
      }
      if case .signedIn(let current) = state, current.id == session.user.id.uuidString.lowercased() { return }
      await open(session)
    case .signedOut:
      pendingInvitation = nil
      await closeAccount()
      state = .signedOut(message: nil)
    case .tokenRefreshed, .userUpdated:
      break
    default:
      break
    }
  }

  private func open(_ session: Session) async {
    pendingInvitation = nil
    let accountId = session.user.id.uuidString.lowercased()
    let email = session.user.email ?? ""
    let providerName = session.user.userMetadata["full_name"]?.stringValue ?? session.user.userMetadata["name"]?.stringValue ?? email
    // A sign-in for a different account replaces the open one; its mirror stops before the new one starts.
    if gateway != nil { await closeAccount() }
    let gateway = Gateway(client: client, accountId: accountId, config: config)
    self.gateway = gateway
    let cached = Self.cachedAccount(id: accountId, email: email)
    if let cached { state = .signedIn(cached) }
    if let factory = mirrorFactory, let mirror = await factory(gateway) { gateway.attachMirror(mirror) }
    do {
      let account = try await loadAccount(gateway: gateway, email: email, providerName: providerName)
      state = .signedIn(account)
    } catch {
      if cached == nil { state = .signedOut(message: error.localizedDescription) }
    }
  }

  private func loadAccount(gateway: Gateway, email: String, providerName: String) async throws -> ManorAccount {
    let rows = try await gateway.rows("profiles")
    let profile = rows.first
    let name = profile?["name"]?.string.flatMap { $0.isEmpty ? nil : $0 } ?? providerName
    let timezone = profile?["timezone"]?.string ?? TimeZone.current.identifier
    if profile == nil || profile?["timezone"]?.string == nil {
      try await gateway.command("save_profile", [
        "name": .string(name), "timezone": .string(timezone),
        "settings": profile?["settings"] ?? .object([:]), "expected_revision": .number(Double(profile?.revision ?? 0))
      ])
    }
    let account = ManorAccount(id: gateway.accountId, email: email, name: name, timezone: timezone)
    Self.storeAccount(account)
    return account
  }

  /// Applies a saved profile change (name or time zone) to the in-memory account.
  public func updateAccount(_ change: (inout ManorAccount) -> Void) {
    guard case .signedIn(var account) = state else { return }
    change(&account)
    state = .signedIn(account)
    Self.storeAccount(account)
  }

  // MARK: Sign-in

  /// Signs in with Apple through Apple's web sign-in page. A Developer ID app can't show the native Sign in with Apple
  /// sheet (that entitlement is only for App Store apps), so the page opens in a browser sheet and returns to the app.
  /// An Apple ID with no Manor account yet comes back refused with an invitation ticket, which sets `pendingInvitation`.
  public func signInWithApple() async throws {
    isAuthenticating = true
    defer { isAuthenticating = false }
    do {
      let scheme = config.authRedirectURL.scheme ?? config.urlScheme
      try await client.auth.signInWithOAuth(provider: .apple, redirectTo: config.authRedirectURL, scopes: "name email") { @MainActor url in
        try await OAuthWebSession.run(url, callbackScheme: scheme)
      }
      pendingInvitation = nil
    } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin {
      return
    } catch {
      let message = (error as? AuthError)?.message ?? error.localizedDescription
      if let ticket = Self.invitationTicket(in: message) { pendingInvitation = ticket; return }
      throw error
    }
  }

  /// Set when an Apple ID has no Manor account yet: the signed ticket Manor's backend returned, naming the email Apple
  /// shared (a Hide My Email address works too). `redeemInvitation(password:)` turns it into an account.
  public private(set) var pendingInvitation: String?

  /// Forgets a pending invitation, to start over with another Apple ID.
  public func cancelInvitation() { pendingInvitation = nil }

  /// Reads the ticket from the signup hook's refusal, `invitation_required <ticket>`.
  nonisolated static func invitationTicket(in message: String) -> String? {
    let prefix = "invitation_required "
    guard let range = message.range(of: prefix) else { return nil }
    let ticket = message[range.upperBound...].prefix { $0.isHexDigit || $0 == "." }
    return ticket.isEmpty ? nil : String(ticket)
  }

  /// Passes the invitation gate for the pending Apple ID, then signs in with it again to create the account.
  public func redeemInvitation(password: String) async throws {
    guard let ticket = pendingInvitation else { return }
    do {
      let data: Data = try await client.functions.invoke(
        "signup-gate", options: FunctionInvokeOptions(body: ["ticket": ticket, "password": password])
      ) { data, _ in data }
      let body = try ManorJSON.plainDecoder.decode(JSONValue.self, from: data)
      guard body["granted"]?.bool == true else { throw SignupError("That invitation could not be verified.") }
    } catch FunctionsError.httpError(let status, let data) {
      let body = try? ManorJSON.plainDecoder.decode(JSONValue.self, from: data)
      // An expired ticket needs a fresh Apple sign-in, which issues a new one.
      if status == 400 { pendingInvitation = nil }
      throw SignupError(body?["error"]?.string ?? "That invitation could not be verified.")
    }
    try await signInWithApple()
  }

  public struct SignupError: LocalizedError {
    public let errorDescription: String?
    init(_ message: String) { errorDescription = message }
  }

  /// Completes a sign-in that arrived as a deep link (`<scheme>://auth/callback?code=` or a token fragment).
  public func completeSignIn(from url: URL) async {
    var params: [String: String] = [:]
    for part in [url.query ?? "", url.fragment ?? ""] {
      for item in URLComponents(string: "?\(part)")?.queryItems ?? [] { params[item.name] = item.value ?? "" }
    }
    do {
      if let message = params["error_description"] ?? params["error"] {
        if let ticket = Self.invitationTicket(in: message) { pendingInvitation = ticket; return }
        state = .signedOut(message: message)
      } else if let access = params["access_token"], let refresh = params["refresh_token"] {
        // A verify link returns the session in the fragment, which the PKCE handler does not accept.
        _ = try await client.auth.setSession(accessToken: access, refreshToken: refresh)
      } else {
        _ = try await client.auth.session(from: url)
      }
    } catch {
      state = .signedOut(message: error.localizedDescription)
    }
  }

  // MARK: Sign-out

  /// Explicit sign-out. Cancels with a message while any guard reports unsynced work.
  public func signOut() async -> String? {
    for check in signOutGuards {
      if let message = await check() { return message }
    }
    let accountId = gateway?.accountId
    // Only this Mac's session ends. The default (every session) would also end agents' connections, which you manage
    // and revoke in Settings, so a sign-out here would silently disconnect ChatGPT or Codex.
    try? await client.auth.signOut(scope: .local)
    await closeAccount()
    if let accountId {
      for cleanup in signOutCleanups { await cleanup(accountId) }
      UserDefaults.standard.removeObject(forKey: Self.accountKey(accountId))
    }
    state = .signedOut(message: nil)
    return nil
  }

  private func closeAccount() async {
    await gateway?.stopMirror()
    gateway = nil
  }

  // MARK: Cached account

  private static func accountKey(_ id: String) -> String { "manor.account.\(id)" }

  private static func cachedAccount(id: String, email: String) -> ManorAccount? {
    guard let data = UserDefaults.standard.data(forKey: accountKey(id)),
          let account = try? JSONDecoder().decode(ManorAccount.self, from: data), account.email == email else { return nil }
    return account
  }

  private static func storeAccount(_ account: ManorAccount) {
    if let data = try? JSONEncoder().encode(account) { UserDefaults.standard.set(data, forKey: accountKey(account.id)) }
  }
}
