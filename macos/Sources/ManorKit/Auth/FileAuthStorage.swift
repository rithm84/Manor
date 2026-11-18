import Auth
import Foundation

/// Keeps the Supabase session in a file only this user can read, under Application Support. The Keychain asks
/// for permission again after every rebuild or update of an app signed with a self-signed certificate, so the
/// session lives beside the app's other account data instead (the webview shell kept it the same way).
public struct FileAuthStorage: AuthLocalStorage {
  private let directory: URL

  public init(bundleIdentifier: String = Bundle.main.bundleIdentifier ?? "app.manor.desktop.dev") {
    directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appendingPathComponent(bundleIdentifier, isDirectory: true)
      .appendingPathComponent("Session", isDirectory: true)
  }

  public func store(key: String, value: Data) throws {
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    let file = url(for: key)
    try value.write(to: file, options: [.atomic, .completeFileProtection])
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
  }

  public func retrieve(key: String) throws -> Data? {
    let file = url(for: key)
    return FileManager.default.fileExists(atPath: file.path) ? try Data(contentsOf: file) : nil
  }

  public func remove(key: String) throws {
    try? FileManager.default.removeItem(at: url(for: key))
  }

  private func url(for key: String) -> URL {
    let safe = key.map { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "." ? $0 : "_" }
    return directory.appendingPathComponent(String(safe))
  }
}
