import AppKit
import CryptoKit
import Observation
import Security

/// Signed updates from Manor's GitHub Releases. The feed (`ManorUpdateFeed` in Info.plist) is a small JSON
/// manifest written by `scripts/release.sh`; the archive it names must carry an Ed25519 signature from the
/// update key (`ManorUpdatePublicKey`) and the app inside must satisfy this app's designated requirement
/// (same identifier, same signing certificate). Manor checks at launch, hourly, and when it becomes active
/// after an idle hour, downloads and verifies quietly, then offers a restart that waits for unsaved work.
@MainActor
@Observable
final class Updater {
  enum State: Equatable {
    case idle
    /// A verified update is unpacked and ready to install.
    case ready(version: String, app: URL)
    case failed(String)
  }

  private(set) var state: State = .idle
  @ObservationIgnored private var lastCheck = Date.distantPast
  @ObservationIgnored private var checking = false
  @ObservationIgnored private var timer: Task<Void, Never>?

  static var isAvailable: Bool {
    Bundle.main.bundleURL.pathExtension == "app" && publicKey != nil && feedURL != nil
  }

  private static var publicKey: Curve25519.Signing.PublicKey? {
    (Bundle.main.object(forInfoDictionaryKey: "ManorUpdatePublicKey") as? String)
      .flatMap { Data(base64Encoded: $0) }
      .flatMap { try? Curve25519.Signing.PublicKey(rawRepresentation: $0) }
  }

  private static var feedURL: URL? {
    (Bundle.main.object(forInfoDictionaryKey: "ManorUpdateFeed") as? String).flatMap(URL.init(string:))
  }

  static var currentBuild: Int { Int(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "") ?? 0 }

  func start() {
    guard Self.isAvailable, timer == nil else { return }
    timer = Task { [weak self] in
      while !Task.isCancelled {
        await self?.check()
        try? await Task.sleep(for: .seconds(3600))
      }
    }
    NotificationCenter.default.addObserver(forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
      Task { @MainActor in
        guard let self, Date().timeIntervalSince(self.lastCheck) > 3600 else { return }
        await self.check()
      }
    }
  }

  func check() async {
    guard Self.isAvailable, !checking, case .idle = state else { return }
    checking = true
    lastCheck = Date()
    defer { checking = false }
    do {
      guard let feed = Self.feedURL else { return }
      let (data, response) = try await URLSession.shared.data(from: feed)
      guard (response as? HTTPURLResponse)?.statusCode == 200, let release = try? JSONDecoder().decode(Release.self, from: data),
            release.build > Self.currentBuild, let archiveURL = URL(string: release.archive, relativeTo: feed) else { return }
      let app = try await prepare(release, from: archiveURL)
      state = .ready(version: release.version, app: app)
    } catch {
      // A failed background check stays quiet; the next one retries.
    }
  }

  /// Quits, swaps the bundle in place, and relaunches.
  func installAndRelaunch() throws {
    guard case .ready(_, let newApp) = state else { return }
    let dest = Bundle.main.bundleURL
    guard FileManager.default.isWritableFile(atPath: dest.deletingLastPathComponent().path) else {
      throw UpdateError("Manor can't write to \(dest.deletingLastPathComponent().path).")
    }
    let script = newApp.deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("install.sh")
    try """
    #!/bin/sh
    while kill -0 "$1" 2>/dev/null; do sleep 0.2; done
    rm -rf "$2.old"
    if mv "$2" "$2.old" && ditto "$3" "$2"; then rm -rf "$2.old"; else rm -rf "$2"; mv "$2.old" "$2"; fi
    open "$2"
    """.write(to: script, atomically: true, encoding: .utf8)
    let helper = Process()
    helper.executableURL = URL(fileURLWithPath: "/bin/sh")
    helper.arguments = [script.path, String(ProcessInfo.processInfo.processIdentifier), dest.path, newApp.path]
    try helper.run()
    NSApp.terminate(nil)
  }

  // MARK: Verification

  private func prepare(_ release: Release, from archiveURL: URL) async throws -> URL {
    let folder = FileManager.default.temporaryDirectory.appendingPathComponent("manor-update", isDirectory: true)
    try? FileManager.default.removeItem(at: folder)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    let (downloaded, _) = try await URLSession.shared.download(from: archiveURL)
    let zip = folder.appendingPathComponent("update.zip")
    try FileManager.default.moveItem(at: downloaded, to: zip)
    let data = try Data(contentsOf: zip)
    guard let key = Self.publicKey, let signature = Data(base64Encoded: release.signature), key.isValidSignature(signature, for: data) else {
      throw UpdateError("The download isn't signed with Manor's update key.")
    }
    let unpacked = folder.appendingPathComponent("unpacked", isDirectory: true)
    try Self.run("/usr/bin/ditto", ["-x", "-k", zip.path, unpacked.path])
    guard let app = try FileManager.default.contentsOfDirectory(at: unpacked, includingPropertiesForKeys: nil).first(where: { $0.pathExtension == "app" }),
          let info = Bundle(url: app)?.infoDictionary,
          info["CFBundleIdentifier"] as? String == Bundle.main.bundleIdentifier,
          Int(info["CFBundleVersion"] as? String ?? "") == release.build else {
      throw UpdateError("The downloaded app doesn't match its release.")
    }
    try Self.checkSameSigner(app)
    return app
  }

  /// Accepts the new app only when Apple's Developer ID chain signed it for the same bundle identifier and the same
  /// developer team as the running app. Pinning the team, not one certificate, keeps updates working when the
  /// certificate is renewed.
  private static func checkSameSigner(_ app: URL) throws {
    var running: SecCode?, mine: SecStaticCode?, info: CFDictionary?, theirs: SecStaticCode?, requirement: SecRequirement?
    guard SecCodeCopySelf([], &running) == errSecSuccess, let running,
          SecCodeCopyStaticCode(running, [], &mine) == errSecSuccess, let mine,
          SecCodeCopySigningInformation(mine, SecCSFlags(rawValue: kSecCSSigningInformation), &info) == errSecSuccess,
          SecStaticCodeCreateWithPath(app as CFURL, [], &theirs) == errSecSuccess, let theirs else {
      throw UpdateError("Couldn't read the app's code signature.")
    }
    guard let team = (info as? [String: Any])?[kSecCodeInfoTeamIdentifier as String] as? String,
          let identifier = Bundle.main.bundleIdentifier else {
      throw UpdateError("This copy of Manor isn't signed by its developer, so it can't update itself. Download the latest version instead.")
    }
    // Apple's Developer ID requirement: Apple-anchored chain, the Developer ID intermediate, a Developer ID leaf, and
    // the leaf's team.
    let text = "identifier \"\(identifier)\" and anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] exists"
      + " and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = \"\(team)\""
    guard SecRequirementCreateWithString(text as CFString, [], &requirement) == errSecSuccess, let requirement else {
      throw UpdateError("Couldn't read the app's code signature.")
    }
    let flags = SecCSFlags(rawValue: kSecCSCheckAllArchitectures | kSecCSCheckNestedCode | kSecCSStrictValidate)
    guard SecStaticCodeCheckValidity(theirs, flags, requirement) == errSecSuccess else {
      throw UpdateError("The new version isn't signed by Manor's developer.")
    }
  }

  private static func run(_ tool: String, _ args: [String]) throws {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: tool)
    process.arguments = args
    try process.run()
    process.waitUntilExit()
    guard process.terminationStatus == 0 else { throw UpdateError("\((tool as NSString).lastPathComponent) failed.") }
  }
}

struct UpdateError: LocalizedError {
  let errorDescription: String?
  init(_ message: String) { errorDescription = message }
}

/// The feed manifest written by `scripts/release.sh`.
struct Release: Decodable, Equatable {
  let version: String
  let build: Int
  let archive: String
  let signature: String
}
