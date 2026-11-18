import ManorKit

/// Installs launch-time hooks on the session: the local mirror, sign-out guards for unsynced drafts, and
/// sign-out cleanup. Each module owns its own `install` function; this file only calls them.
enum ModuleBootstrap {
  @MainActor static func install(on session: ManorSession) {
    MirrorModule.install(on: session)
    NotesModule.install(on: session)
    ProblemsModule.install(on: session)
    // Files still uploading (note attachments, resumes) keep the session, like unsynced drafts.
    session.signOutGuards.append { [weak session] in
      guard let gateway = session?.gateway else { return nil }
      let waiting = FileService.shared(for: gateway).pending.count
      return waiting == 0 ? nil : "\(waiting == 1 ? "A file is" : "\(waiting) files are") still uploading. Sign out once they finish."
    }
    session.signOutCleanups.append { accountId in FileService.discardPendingUploads(accountId: accountId) }
  }
}
