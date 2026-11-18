import AppKit
import ManorKit
import Observation
import SwiftUI

/// App-lifetime state: configuration, the session, theme, toasts, and the signed-in context.
@MainActor
@Observable
final class AppModel {
  let toasts = ToastCenter()
  let theme = ThemeController()
  let updater = Updater()
  private(set) var session: ManorSession?
  private(set) var configError: String?
  private(set) var context: AppContext?
  /// Whether the window is in full screen, where the window buttons are hidden.
  private(set) var isFullScreen = false
  @ObservationIgnored private var fullScreenObservers: [NSObjectProtocol] = []
  var sidebarDocked: Bool = UserDefaults.standard.object(forKey: "manor.sidebar.docked") as? Bool ?? true
  /// A deep link that arrived before sign-in finished; it opens once the account is ready.
  private var pendingLink: URL?

  var windowTitle: String {
    session?.config.environment == .staging ? "Manor Staging" : "Manor"
  }

  init() {
    do { session = ManorSession(config: try AppConfig.load()) }
    catch { configError = error.localizedDescription }
  }

  func start() async {
    for (name, value) in [(NSWindow.didEnterFullScreenNotification, true), (NSWindow.didExitFullScreenNotification, false)] {
      fullScreenObservers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
        MainActor.assumeIsolated { self?.isFullScreen = value }
      })
    }
    theme.apply()
    updater.start()
    guard let session else { return }
    ModuleBootstrap.install(on: session)
    await session.start()
  }

  /// Keeps `context` in step with the session: built on sign-in, dropped on sign-out.
  func sync(with state: ManorSession.State) {
    guard let session else { return }
    switch state {
    case .signedIn(let account):
      if let context, context.account.id == account.id {
        context.account = account
      } else if let gateway = session.gateway {
        context = AppContext(session: session, gateway: gateway, account: account, toasts: toasts)
        // Uploads interrupted by a quit or a dropped connection continue in the background.
        FileService.shared(for: gateway).resumePending()
        if let link = pendingLink { pendingLink = nil; handle(url: link) }
      }
    case .signedOut, .starting:
      context = nil
    }
  }

  /// Installs a ready update unless unsaved work would be lost; then it says why and waits.
  func restartToUpdate() async {
    if let session {
      for check in session.signOutGuards {
        if let message = await check() { toasts.show(message); return }
      }
    }
    AlfredBridge.shared.allowQuit()  // Alfred: an update install always quits, even in Prep mode
    do { try updater.installAndRelaunch() } catch { AlfredBridge.shared.allowQuit(false); toasts.showError(error) }
  }

  func toggleSidebar() {
    withAnimation(Motion.panel) { sidebarDocked.toggle() }
    UserDefaults.standard.set(sidebarDocked, forKey: "manor.sidebar.docked")
  }

  /// Routes a link on the build's scheme: sign-in callbacks, agent consent, and page links.
  func handle(url: URL) {
    guard let session, url.scheme == session.config.urlScheme else { return }
    let host = url.host() ?? ""
    let path = url.pathComponents.filter { $0 != "/" }
    if host == "auth" {
      Task { await session.completeSignIn(from: url) }
      return
    }
    guard let context else { pendingLink = url; return }
    var query: [String: String] = [:]
    for item in URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? [] { query[item.name] = item.value ?? "" }
    if host == "oauth", path.first == "consent" {
      context.consentAuthorizationId = query["authorization_id"]
      NSApp.activate()
      return
    }
    guard let route = Route(path: host) else { return }
    context.route = route
    context.linkTarget = (route, path, query)
    NSApp.activate()
  }
}
