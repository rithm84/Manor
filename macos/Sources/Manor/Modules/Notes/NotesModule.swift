import Foundation
import ManorKit

/// Notes launch hooks: the sign-out guard for unsynced drafts and the cleanup of local Notes data, plus the
/// account-scoped services the page and the guard share.
enum NotesModule {
  @MainActor static func install(on session: ManorSession) {
    session.signOutGuards.append { [weak session] in
      guard let session, let gateway = session.gateway else { return nil }
      guard let service = NotesRuntime.service(for: gateway) else {
        return "Manor could not open the Notes drafts on this Mac, so sign-out was cancelled to keep them safe."
      }
      // Whatever the open note still holds in memory is protected (and sent, when the connection allows) first.
      await NotesRuntime.activeStore?.settleForSignOut()
      if let message = await service.prepareSignOut() { return message }
      // Another guard may still cancel this sign-out; edits resume if the session is still signed in shortly after.
      Task { @MainActor [weak session, weak service] in
        try? await Task.sleep(for: .seconds(3))
        if session?.account != nil { service?.cancelSignOut() }
      }
      return nil
    }
    session.signOutCleanups.append { accountId in
      try? await NotesRuntime.draftStore()?.clear(accountId: accountId)
      NotesRuntime.forget(accountId: accountId)
    }
  }
}

/// Account-scoped Notes services shared by the page and the sign-out guard.
@MainActor
enum NotesRuntime {
  private static var store: NoteDraftStore?
  private static var services: [String: NotesService] = [:]
  /// The open page's model, so the sign-out guard can settle its in-memory draft.
  static weak var activeStore: NotesStore?
  /// Where the reader was in Notes when they left. In memory on purpose: a relaunch starts with no note open.
  static var rememberedView: (accountId: String, scope: NotesScope, noteId: String?)?

  static var environment: AppConfig.Environment = .development

  static func draftStore() -> NoteDraftStore? {
    if let store { return store }
    guard let url = try? NoteDraftStore.defaultLocation(environment: environment), let opened = try? NoteDraftStore(path: url.path) else { return nil }
    store = opened
    return opened
  }

  static func service(for gateway: Gateway) -> NotesService? {
    environment = gateway.config.environment
    if let existing = services[gateway.accountId], existing.transport === gateway { return existing }
    guard let store = draftStore() else { return nil }
    let service = NotesService(transport: gateway, store: store)
    services[gateway.accountId] = service
    return service
  }

  static func forget(accountId: String) {
    services[accountId] = nil
    if rememberedView?.accountId == accountId { rememberedView = nil }
  }
}
