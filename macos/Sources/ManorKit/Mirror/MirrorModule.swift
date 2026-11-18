import Foundation

/// Installs the local mirror on the session: the factory that builds it for each signed-in account and the
/// sign-out cleanup that wipes it.
public enum MirrorModule {
  @MainActor public static func install(on session: ManorSession) {
    session.mirrorFactory = { gateway in
      await MirrorSync.open(gateway: gateway)
    }
    let environment = session.config.environment
    session.signOutCleanups.append { accountId in
      // The session has already stopped the mirror; this closes its file and deletes it with its companions.
      let result = await Task.detached { () -> Result<Void, Error> in
        Result {
          if let store = MirrorRegistry.take(accountId) {
            try store.wipe()
          } else {
            let directory = try MirrorFiles.directory(bundleIdentifier: Bundle.main.bundleIdentifier, environment: environment)
            try MirrorFiles.remove(try MirrorFiles.file(in: directory, accountId: accountId))
          }
        }
      }.value
      if case .failure(let error) = result {
        mirrorLog.error("Manor could not delete the local mirror at sign-out: \(error.localizedDescription, privacy: .public)")
      }
    }
  }
}
