import AppKit
import AuthenticationServices
import Foundation

/// Runs the system web sign-in sheet for an OAuth URL and returns the callback URL.
///
/// The sheet reports back on a background queue. Its completion handler is built outside any actor so the
/// runtime's isolation checks never trap when it runs there (the Supabase helper builds it inside a main-actor
/// closure, which crashes on macOS 27). The sheet attaches to Manor's key window.
@MainActor
final class OAuthWebSession: NSObject, ASWebAuthenticationPresentationContextProviding {
  private var session: ASWebAuthenticationSession?

  static func run(_ url: URL, callbackScheme: String, ephemeral: Bool = false) async throws -> URL {
    try await OAuthWebSession().start(url, callbackScheme: callbackScheme, ephemeral: ephemeral)
  }

  private func start(_ url: URL, callbackScheme: String, ephemeral: Bool) async throws -> URL {
    defer { session = nil }
    return try await withCheckedThrowingContinuation { continuation in
      let session = ASWebAuthenticationSession(url: url, callbackURLScheme: callbackScheme, completionHandler: Self.completion(continuation))
      session.presentationContextProvider = self
      session.prefersEphemeralWebBrowserSession = ephemeral
      self.session = session
      // When the sheet can't start, it never calls back.
      if !session.start() { continuation.resume(throwing: ASWebAuthenticationSessionError(.presentationContextInvalid)) }
    }
  }

  private nonisolated static func completion(_ continuation: CheckedContinuation<URL, Error>) -> @Sendable (URL?, Error?) -> Void {
    { url, error in
      if let error { continuation.resume(throwing: error) }
      else if let url { continuation.resume(returning: url) }
      else { continuation.resume(throwing: URLError(.badServerResponse)) }
    }
  }

  nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
    let anchor: @MainActor () -> ASPresentationAnchor = { NSApp.keyWindow ?? NSApp.mainWindow ?? NSApp.windows.first ?? ASPresentationAnchor() }
    if Thread.isMainThread { return MainActor.assumeIsolated(anchor) }
    return DispatchQueue.main.sync { MainActor.assumeIsolated(anchor) }
  }
}
