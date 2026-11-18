import ManorKit

/// Problems launch hooks: the sign-out guard for unsynced code drafts and their cleanup.
enum ProblemsModule {
  @MainActor static func install(on session: ManorSession) {
    let environment = session.config.environment
    // Explicit sign-out first tries to save open code, then cancels while any code exists only on this Mac.
    session.signOutGuards.append { [weak session] in
      guard let accountId = session?.gateway?.accountId else { return nil }
      return await ProblemWorkspaceServices.signOutBlocker(accountId: accountId, environment: environment)
    }
    // Afterwards the account's language-server connections close and its synced drafts leave this Mac.
    session.signOutCleanups.append { accountId in
      await ProblemWorkspaceServices.signOutCleanup(accountId: accountId, environment: environment)
      ProblemWorkspaceStates.shared.forget(accountId: accountId)
    }
  }
}
