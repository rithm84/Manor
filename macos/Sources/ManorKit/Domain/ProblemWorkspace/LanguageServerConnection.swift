import Foundation
import Observation

/// A JSON-RPC message transport. The editor sandbox's bridge speaks one JSON message per WebSocket text frame.
public protocol LanguageServerTransport: AnyObject, Sendable {
  func send(_ text: String) async throws
  /// Every incoming text frame, in order; the stream finishes when the socket closes.
  var messages: AsyncThrowingStream<String, Error> { get }
  func close()
}

/// `URLSessionWebSocketTask` as a transport.
public final class WebSocketTransport: LanguageServerTransport, @unchecked Sendable {
  private let task: URLSessionWebSocketTask
  public let messages: AsyncThrowingStream<String, Error>

  public init(url: URL, session: URLSession = .shared) {
    let task = session.webSocketTask(with: url)
    task.maximumMessageSize = 16 * 1024 * 1024
    self.task = task
    messages = AsyncThrowingStream { continuation in
      @Sendable func receive() {
        task.receive { result in
          switch result {
          case .success(.string(let text)):
            continuation.yield(text)
            receive()
          case .success(.data(let data)):
            continuation.yield(String(decoding: data, as: UTF8.self))
            receive()
          case .success:
            receive()
          case .failure(let error):
            continuation.finish(throwing: error)
          }
        }
      }
      receive()
      continuation.onTermination = { _ in task.cancel(with: .normalClosure, reason: nil) }
    }
    task.resume()
  }

  public func send(_ text: String) async throws { try await task.send(.string(text)) }
  public func close() { task.cancel(with: .normalClosure, reason: nil) }
}

public enum LanguageServerState: Equatable, Sendable { case connecting, connected, offline }

public struct LanguageServerError: LocalizedError, Sendable {
  public let message: String
  public init(_ message: String) { self.message = message }
  public var errorDescription: String? { message }
}

/// One language-server connection over the editor sandbox's bridge: initialize, the single workspace document
/// (didOpen, then full-text didChange), completion, hover, signature help, and published diagnostics. The bridge
/// answers a reconnecting client's `initialize` from the server's first result, so reconnecting is cheap.
@MainActor
public final class LanguageServerConnection {
  public let language: ProblemLanguage
  public private(set) var state: LanguageServerState = .connecting
  public var onStateChange: (@MainActor (LanguageServerState) -> Void)?
  /// The newest diagnostics for the workspace document and the document version they describe.
  public var onDiagnostics: (@MainActor ([LSPDiagnostic], Int?) -> Void)?
  public private(set) var triggerCharacters: Set<String> = []
  public private(set) var signatureTriggerCharacters: Set<String> = ["(", ","]

  private let transport: LanguageServerTransport
  private var nextId = 1
  private var pending: [Int: CheckedContinuation<JSONValue, Error>] = [:]
  private var reader: Task<Void, Never>?
  private var documentOpen = false
  private var documentVersion = 0
  private var sentText: String?
  private let requestTimeout: Duration

  public init(language: ProblemLanguage, transport: LanguageServerTransport, requestTimeout: Duration = .seconds(15)) {
    self.language = language
    self.transport = transport
    self.requestTimeout = requestTimeout
  }

  public var version: Int { documentVersion }

  /// Initializes the session; resolves once the server can take requests.
  public func start(workspaceURI: String = "file:///workspace") async throws {
    reader = Task { [weak self, transport] in
      do {
        for try await text in transport.messages {
          let message = try? await Task.detached(priority: .userInitiated) {
            try ManorJSON.plainDecoder.decode(JSONValue.self, from: Data(text.utf8))
          }.value
          guard let self, let message else { continue }
          self.receive(message)
        }
        self?.closed(LanguageServerError("The language server closed the connection."))
      } catch {
        self?.closed(error)
      }
    }
    let result = try await request("initialize", [
      "processId": .null, "clientInfo": ["name": "Manor"], "rootUri": .string(workspaceURI),
      "workspaceFolders": [["uri": .string(workspaceURI), "name": "Problem"]], "capabilities": [:]
    ])
    let capabilities = result["capabilities"]
    triggerCharacters = Set(capabilities?["completionProvider"]?["triggerCharacters"]?.array?.compactMap(\.string) ?? [".", ":", ">"])
    if let signature = capabilities?["signatureHelpProvider"]?["triggerCharacters"]?.array?.compactMap(\.string), !signature.isEmpty {
      signatureTriggerCharacters = Set(signature)
    }
    try await notify("initialized", [:])
    setState(.connected)
  }

  public func close() {
    transport.close()
    closed(LanguageServerError("The language server connection closed."))
  }

  // MARK: Document

  /// Opens the workspace document with this text, or edits the open one to it. Moving to another problem in the same
  /// language edits the same document.
  public func sync(text: String) async throws {
    if documentOpen {
      guard text != sentText else { return }
      documentVersion += 1
      sentText = text
      try await notify("textDocument/didChange", [
        "textDocument": ["uri": .string(language.documentURI), "version": .number(Double(documentVersion))],
        "contentChanges": [["text": .string(text)]]
      ])
    } else {
      documentVersion += 1
      sentText = text
      documentOpen = true
      try await notify("textDocument/didOpen", [
        "textDocument": ["uri": .string(language.documentURI), "languageId": .string(language.rawValue), "version": .number(Double(documentVersion)), "text": .string(text)]
      ])
    }
  }

  public func completion(at position: LSPPosition, trigger: String?) async throws -> (items: [LSPCompletionItem], incomplete: Bool) {
    var context: JSONObject = ["triggerKind": .number(trigger == nil ? 1 : 2)]
    if let trigger { context["triggerCharacter"] = .string(trigger) }
    let result = try await request("textDocument/completion", documentParams(position, extra: ["context": .object(context)]))
    // Large lists decode off the main thread.
    return await Task.detached(priority: .userInitiated) { LSPCompletionItem.list(from: result) }.value
  }

  public func hover(at position: LSPPosition) async throws -> LSPHover? {
    LSPHover(try await request("textDocument/hover", documentParams(position)))
  }

  public func signatureHelp(at position: LSPPosition, trigger: String?) async throws -> LSPSignatureHelp? {
    var context: JSONObject = ["triggerKind": .number(trigger == nil ? 1 : 2), "isRetrigger": false]
    if let trigger { context["triggerCharacter"] = .string(trigger) }
    return LSPSignatureHelp(try await request("textDocument/signatureHelp", documentParams(position, extra: ["context": .object(context)])))
  }

  /// A tiny notification that keeps the preview WebSocket from idling out.
  public func keepAlive() async throws { try await notify("$/setTrace", ["value": "off"]) }

  private func documentParams(_ position: LSPPosition, extra: JSONObject = [:]) -> JSONObject {
    var params: JSONObject = ["textDocument": ["uri": .string(language.documentURI)], "position": position.json]
    params.merge(extra) { $1 }
    return params
  }

  // MARK: JSON-RPC

  public func request(_ method: String, _ params: JSONObject) async throws -> JSONValue {
    guard state != .offline else { throw LanguageServerError("The language server is offline.") }
    let id = nextId
    nextId += 1
    let timeout = requestTimeout
    let timer = Task { [weak self] in
      try? await Task.sleep(for: timeout)
      guard !Task.isCancelled else { return }
      self?.fail(id, LanguageServerError("The language server did not answer \(method)."))
    }
    defer { timer.cancel() }
    return try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { continuation in
        pending[id] = continuation
        Task {
          do { try await self.write(["jsonrpc": "2.0", "id": .number(Double(id)), "method": .string(method), "params": .object(params)]) }
          catch { self.fail(id, error) }
        }
      }
    } onCancel: {
      Task { @MainActor [weak self] in
        guard let self, self.pending[id] != nil else { return }
        self.fail(id, CancellationError())
        try? await self.notify("$/cancelRequest", ["id": .number(Double(id))])
      }
    }
  }

  public func notify(_ method: String, _ params: JSONObject) async throws {
    try await write(["jsonrpc": "2.0", "method": .string(method), "params": .object(params)])
  }

  private func write(_ message: JSONValue) async throws {
    let data = try ManorJSON.plainEncoder.encode(message)
    try await transport.send(String(decoding: data, as: UTF8.self))
  }

  private func fail(_ id: Int, _ error: Error) {
    pending.removeValue(forKey: id)?.resume(throwing: error)
  }

  private func receive(_ message: JSONValue) {
    let method = message["method"]?.string
    let id = message["id"]
    if method == nil, let number = id?.int {
      guard let continuation = pending.removeValue(forKey: number) else { return }
      if let error = message["error"], !error.isNull {
        continuation.resume(throwing: LanguageServerError(error["message"]?.string ?? "The language server refused the request."))
      } else {
        continuation.resume(returning: message["result"] ?? .null)
      }
      return
    }
    guard let method else { return }
    if let id, !id.isNull {
      // A server request; the editor answers as a client with no settings and one workspace folder.
      let result: JSONValue
      switch method {
      case "workspace/configuration": result = .array((message["params"]?["items"]?.array ?? []).map { _ in .null })
      case "workspace/workspaceFolders": result = [["uri": "file:///workspace", "name": "Problem"]]
      case "workspace/applyEdit": result = ["applied": false]
      default: result = .null
      }
      Task { try? await self.write(["jsonrpc": "2.0", "id": id, "result": result]) }
      return
    }
    if method == "textDocument/publishDiagnostics", message["params"]?["uri"]?.string == language.documentURI {
      let diagnostics = (message["params"]?["diagnostics"]?.array ?? []).compactMap(LSPDiagnostic.init)
      onDiagnostics?(diagnostics, message["params"]?["version"]?.int)
    }
  }

  private func closed(_ error: Error) {
    reader?.cancel()
    reader = nil
    let waiting = pending
    pending.removeAll()
    for continuation in waiting.values { continuation.resume(throwing: error) }
    setState(.offline)
  }

  private func setState(_ next: LanguageServerState) {
    guard state != next else { return }
    state = next
    onStateChange?(next)
  }
}
