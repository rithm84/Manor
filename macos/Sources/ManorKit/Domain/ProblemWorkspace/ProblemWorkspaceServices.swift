import Foundation

/// The account's solving services on this device: execution, the editor capability, the shared language-server
/// connections, and code-draft protection. One instance lives per signed-in account; every workspace shares it.
@MainActor
public final class ProblemWorkspaceServices {
  public let gateway: Gateway
  public let execution: ProblemExecutionService
  public let editorSessions: ProblemEditorSessions
  public let languageServers: ProblemLanguageServers
  public let cloud: GatewayDraftCloud
  public let details: ProblemDetailLoader
  /// Open draft sessions, so sign-out can flush them before it checks for unsynced code.
  private var drafts: [ObjectIdentifier: () -> ProblemDraftSession?] = [:]

  public var accountId: String { gateway.accountId }

  private static var current: ProblemWorkspaceServices?
  /// Shared across accounts: entries carry their account, and a failed write keeps its source here until recovered.
  public static let boundary = CodeDraftProtectionBoundary()
  private static var stores: [AppConfig.Environment: CodeDraftStore] = [:]

  private init(gateway: Gateway) {
    self.gateway = gateway
    execution = ProblemExecutionService(gateway: gateway)
    editorSessions = ProblemEditorSessions(service: execution)
    languageServers = ProblemLanguageServers()
    cloud = GatewayDraftCloud(gateway: gateway)
    details = ProblemDetailLoader(gateway: gateway)
  }

  /// The services for the gateway's account, replacing any held for an earlier account.
  public static func shared(for gateway: Gateway) -> ProblemWorkspaceServices {
    if let current, current.gateway === gateway { return current }
    current?.languageServers.closeAll()
    let created = ProblemWorkspaceServices(gateway: gateway)
    current = created
    return created
  }

  /// The services already created for an account, if any.
  public static func existing(accountId: String) -> ProblemWorkspaceServices? {
    current?.accountId == accountId ? current : nil
  }

  /// The device's code-draft file for this build's environment.
  public static func draftStore(environment: AppConfig.Environment) throws -> CodeDraftStore {
    if let store = stores[environment] { return store }
    let store = try CodeDraftStore(path: try CodeDraftStore.defaultLocation(environment: environment).path)
    stores[environment] = store
    return store
  }

  public func draftStore() throws -> CodeDraftStore { try Self.draftStore(environment: gateway.config.environment) }

  /// Starts a draft session tracked for sign-out.
  public func register(_ session: ProblemDraftSession) {
    drafts[ObjectIdentifier(session)] = { [weak session] in session }
  }

  public func unregister(_ session: ProblemDraftSession) { drafts[ObjectIdentifier(session)] = nil }

  /// Loading the library renews the sandbox in one request so opening a problem finds it warm.
  public func warmEditorSandbox(language: ProblemLanguage) {
    Task { _ = try? await editorSessions.session(language, problemId: nil) }
  }

  /// Pointing at a problem also connects the language server, so an opened problem finds it ready.
  public func warmLanguageServer(language: ProblemLanguage) {
    let sessions = editorSessions
    languageServers.connect(language) { try await sessions.session(language, problemId: nil) }
  }

  // MARK: Sign-out

  /// Before an explicit sign-out: tries to save every open draft, then refuses while any code is still only on this
  /// device. Returns the message that cancels sign-out, or nil.
  public static func signOutBlocker(accountId: String, environment: AppConfig.Environment, cloud: ProblemDraftCloud? = nil) async -> String? {
    if let services = existing(accountId: accountId) {
      for open in services.drafts.values {
        guard let session = open() else { continue }
        try? await session.protected()
        try? await session.sync()
      }
    }
    if boundary.hasUnprotected(accountId: accountId) {
      return "Some of your code hasn't been saved yet. Sign-out was cancelled so it isn't lost."
    }
    do {
      let store = try draftStore(environment: environment)
      var conflicted = false
      // Drafts no editor has open (an edit typed while its last save was in flight, then the problem closed) are
      // saved here, so they don't hold sign-out forever.
      if let cloud {
        for draft in try await store.drafts(accountId: accountId) where draft.pending {
          if await savePending(draft, cloud: cloud, store: store) == .conflict { conflicted = true }
        }
      }
      if try await store.hasPending(accountId: accountId) {
        if conflicted {
          return "Some of your code on this Mac differs from a newer saved copy. Open the problem to choose which to keep, then sign out again."
        }
        return "Some of your code is saved only on this Mac and couldn't sync just now. Check your connection, then sign out again."
      }
    } catch {
      return "Your saved code could not be checked, so sign-out was cancelled. \(error.localizedDescription)"
    }
    return nil
  }

  enum PendingSave { case saved, conflict, failed }

  /// Saves one pending draft that no editor holds. A draft whose cloud copy moved on since it was edited is left for
  /// the editor to resolve, where you choose which version to keep.
  static func savePending(_ draft: LocalCodeDraft, cloud: ProblemDraftCloud, store: CodeDraftStore) async -> PendingSave {
    guard let language = ProblemLanguage(rawValue: draft.language) else { return .failed }
    do {
      let receipt = try await cloud.saveDraft(draft)
      try await store.acknowledge(accountId: draft.accountId, problemId: draft.problemId, language: language, source: draft.code, revision: receipt.revision)
      return .saved
    } catch {
      guard let latest = try? await cloud.loadDraft(problemId: draft.problemId, language: language) else { return .failed }
      if latest.source == draft.code, latest.contentVersion == draft.contentVersion {
        try? await store.acknowledge(accountId: draft.accountId, problemId: draft.problemId, language: language, source: draft.code, revision: latest.revision)
        return .saved
      }
      return latest.revision != draft.cloudRevision ? .conflict : .failed
    }
  }

  /// After sign-out: closes the account's connections and removes its synced drafts from this device.
  public static func signOutCleanup(accountId: String, environment: AppConfig.Environment) async {
    if let services = existing(accountId: accountId) {
      services.languageServers.closeAll()
      current = nil
    }
    try? await draftStore(environment: environment).clearSynced(accountId: accountId)
  }
}
