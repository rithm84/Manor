import Foundation
import Supabase

/// Calls the owner-authorized `problem-runner` endpoints. Full testsets and provider credentials never reach the
/// client; a failed submission discloses one counterexample. The runner makes several database and sandbox round
/// trips per request, so it runs in AWS us-east-1 beside the sandboxes rather than in the region nearest the caller.
@MainActor
public final class ProblemExecutionService {
  public let gateway: Gateway
  public init(gateway: Gateway) { self.gateway = gateway }

  public func execute(_ input: ExecuteProblemInput) async throws -> ProblemSubmission {
    try decode(ProblemSubmission.self, from: try await request(input.body))
  }

  public func submission(_ id: String) async throws -> ProblemSubmission {
    try decode(ProblemSubmission.self, from: try await request(["action": "submission", "submissionId": .string(id)]))
  }

  public func submissions(problemId: String) async throws -> [ProblemSubmission] {
    try decode([ProblemSubmission].self, from: try await request(["action": "submissions", "problemId": .string(problemId)]))
  }

  /// Renews the account's editor sandbox for the language, binding the open problem when there is one.
  public func editorSession(problemId: String?, language: ProblemLanguage) async throws -> ProblemEditorSession {
    try decode(ProblemEditorSession.self, from: try await request([
      "action": "editor-session", "problemId": problemId.map(JSONValue.string) ?? .null, "language": .string(language.rawValue)
    ]))
  }

  private func decode<T: Decodable>(_ type: T.Type, from value: JSONValue) throws -> T {
    do {
      return try ManorJSON.plainDecoder.decode(T.self, from: try ManorJSON.plainEncoder.encode(value))
    } catch {
      throw ManorRequestError(operation: "problem-runner", code: "decode", detail: "The runner's answer could not be read: \(error.localizedDescription)")
    }
  }

  private func request(_ body: JSONObject) async throws -> JSONValue {
    let name = "problem-runner"
    do {
      let options = FunctionInvokeOptions(method: .post, region: "us-east-1", body: body)
      let data: Data = try await gateway.client.functions.invoke(name, options: options) { data, _ in data }
      gateway.markConnected(true)
      return data.isEmpty ? .null : try ManorJSON.plainDecoder.decode(JSONValue.self, from: data)
    } catch FunctionsError.httpError(let code, let data) {
      gateway.markConnected(true)
      let body = try? ManorJSON.plainDecoder.decode(JSONValue.self, from: data)
      let message = body?["error"]?.string ?? body?["message"]?.string ?? String(decoding: data, as: UTF8.self)
      throw ManorRequestError(operation: name, code: String(code), detail: message.isEmpty ? "The request failed (\(code))." : message)
    } catch let error as URLError {
      gateway.markConnected(false)
      throw ManorConnectionError(operation: name, detail: error.localizedDescription)
    }
  }
}

/// The account's editor capability on this device. Prewarming, opening, and use renewals share one request at a time
/// and reuse a recent answer, so the server sees at most one renewal every few minutes while the editor is in use.
/// The server, not this cache, enforces one editor sandbox per account and removes stale ones.
@MainActor
public final class ProblemEditorSessions {
  /// A session this recent is reused; an older one is renewed, which also extends the sandbox's idle lease.
  public static let renewAfter: TimeInterval = 5 * 60

  private let fetch: @MainActor (String?, ProblemLanguage) async throws -> ProblemEditorSession
  private let now: () -> Date
  private var held: (problemId: String?, session: ProblemEditorSession, fetchedAt: Date)?
  private var pending: (problemId: String?, task: Task<ProblemEditorSession, Error>)?

  public init(now: @escaping () -> Date = Date.init, fetch: @escaping @MainActor (String?, ProblemLanguage) async throws -> ProblemEditorSession) {
    self.fetch = fetch
    self.now = now
  }

  public convenience init(service: ProblemExecutionService) {
    self.init { problemId, language in try await service.editorSession(problemId: problemId, language: language) }
  }

  /// The account's editor session; with a problem, the lease also protects that problem as the open one. A session
  /// addresses every language, so a recent one serves a language switch without asking the server.
  public func session(_ language: ProblemLanguage, problemId: String?) async throws -> ProblemEditorSession {
    func covers(_ value: String?) -> Bool { problemId == nil || value == problemId }
    if let pending, covers(pending.problemId) { return try await pending.task.value }
    if let held, covers(held.problemId), now().timeIntervalSince(held.fetchedAt) < Self.renewAfter { return held.session }
    let fetch = self.fetch
    let task = Task { @MainActor in try await fetch(problemId, language) }
    pending = (problemId, task)
    defer { if pending?.task == task { pending = nil } }
    let session = try await task.value
    // The server keeps the bound problem when a renewal names none.
    held = (problemId ?? held?.problemId, session, now())
    return session
  }

  /// Forgets the held session so the next use asks the server (after the server refused a token).
  public func invalidate() { held = nil }
}
