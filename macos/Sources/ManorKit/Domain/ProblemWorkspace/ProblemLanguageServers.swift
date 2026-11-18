import Foundation
import Observation

/// The app's language-server connections, one per language, shared by every problem editor. The account's editor
/// sandbox keeps a server running for every language, so a connection outlives editors: moving between problems
/// reuses it, and switching languages attaches to that language's open connection or opens one to its warm server.
@MainActor
@Observable
public final class ProblemLanguageServers {
  /// Blaxel closes a preview WebSocket after about a minute without traffic, so a used connection sends a small
  /// notification this often.
  public static let keepAliveInterval: Duration = .seconds(25)
  /// A connection stays open this long after its language was last used; afterwards it closes and the sandbox can
  /// stand by. The next use reconnects.
  public static let retain: TimeInterval = 10 * 60
  /// Use reports are coalesced to this interval.
  public static let useInterval: TimeInterval = 2
  /// An offline server is retried on use at most this often.
  public static let retryInterval: TimeInterval = 5

  public typealias SessionSource = @MainActor () async throws -> ProblemEditorSession

  public private(set) var states: [ProblemLanguage: LanguageServerState] = [:]
  /// The newest diagnostics per language, with the document version they describe.
  public private(set) var diagnostics: [ProblemLanguage: [LSPDiagnostic]] = [:]

  @ObservationIgnored private var connections: [ProblemLanguage: Entry] = [:]
  @ObservationIgnored private var keepAlive: Task<Void, Never>?
  @ObservationIgnored private let makeTransport: @MainActor (URL) -> LanguageServerTransport
  @ObservationIgnored private let now: () -> Date
  @ObservationIgnored public var isVisible: @MainActor () -> Bool = { true }
  /// The open editor's current text per language, so a (re)connection attaches to the document on screen.
  @ObservationIgnored private var documents: [ProblemLanguage: @MainActor () -> String?] = [:]
  @ObservationIgnored public var onFailure: (@MainActor (ProblemLanguage, Error) -> Void)?

  private final class Entry {
    var connection: LanguageServerConnection?
    var ready: Task<LanguageServerConnection, Error>
    var lastUse: Date
    var lastAttempt: Date
    init(ready: Task<LanguageServerConnection, Error>, now: Date) { self.ready = ready; lastUse = now; lastAttempt = now }
  }

  public init(now: @escaping () -> Date = Date.init, makeTransport: @escaping @MainActor (URL) -> LanguageServerTransport = { WebSocketTransport(url: $0) }) {
    self.now = now
    self.makeTransport = makeTransport
  }

  public func state(_ language: ProblemLanguage) -> LanguageServerState { states[language] ?? .offline }

  /// The connected server for the language, if any.
  public func connection(_ language: ProblemLanguage) -> LanguageServerConnection? {
    guard let entry = connections[language], let connection = entry.connection, connection.state == .connected else { return nil }
    return connection
  }

  /// Registers the editor whose document the language's server should see; nil detaches it.
  public func attachDocument(_ language: ProblemLanguage, text: (@MainActor () -> String?)?) {
    documents[language] = text
    guard let text, let connection = connection(language), let current = text() else { return }
    Task { try? await connection.sync(text: current) }
  }

  /// Connects the language, or returns the connection already open or opening for it.
  @discardableResult
  public func connect(_ language: ProblemLanguage, session: @escaping SessionSource) -> Task<LanguageServerConnection, Error> {
    let time = now()
    if let entry = connections[language], state(language) != .offline {
      entry.lastUse = time
      return entry.ready
    }
    let previous = connections[language]?.connection
    let makeTransport = self.makeTransport
    let task = Task { @MainActor [weak self] () throws -> LanguageServerConnection in
      previous?.close()
      let value = try await session()
      guard let url = value.webSocketURL(for: language) else { throw LanguageServerError("The editor session has no \(language.label) server.") }
      let connection = LanguageServerConnection(language: language, transport: makeTransport(url))
      guard let self else { throw CancellationError() }
      self.connections[language]?.connection = connection
      connection.onStateChange = { [weak self, weak connection] next in
        guard let self, let connection, self.connections[language]?.connection === connection else { return }
        self.states[language] = next
        if next == .offline { self.diagnostics[language] = nil }
      }
      connection.onDiagnostics = { [weak self, weak connection] items, version in
        guard let self, let connection, version == nil || version == connection.version else { return }
        self.diagnostics[language] = items
      }
      try await connection.start(workspaceURI: value.workspaceUri)
      guard self.connections[language]?.connection === connection else {
        connection.close()
        throw CancellationError()
      }
      self.states[language] = .connected
      if let text = self.documents[language]?() { try await connection.sync(text: text) }
      self.startKeepAlive()
      return connection
    }
    connections[language] = Entry(ready: task, now: time)
    states[language] = .connecting
    Task { [weak self] in
      do { _ = try await task.value } catch {
        guard let self, self.connections[language]?.ready == task else { return }
        self.connections[language]?.connection?.close()
        self.states[language] = .offline
        if !(error is CancellationError) { self.onFailure?(language, error) }
      }
    }
    return task
  }

  /// Editor use keeps the language's connection open, renews the account sandbox's lease through the session source
  /// (which asks the server only when its session is a few minutes old), and reconnects an offline server.
  public func noteUse(_ language: ProblemLanguage, session: @escaping SessionSource) {
    let time = now()
    let entry = connections[language]
    if let entry, time.timeIntervalSince(entry.lastUse) < Self.useInterval { return }
    entry?.lastUse = time
    if state(language) == .offline {
      if entry == nil || time.timeIntervalSince(entry!.lastAttempt) >= Self.retryInterval { connect(language, session: session) }
      return
    }
    Task { [weak self] in
      do { _ = try await session() } catch { self?.onFailure?(language, error) }
    }
  }

  /// Closes every connection (sign-out).
  public func closeAll() {
    keepAlive?.cancel()
    keepAlive = nil
    for entry in connections.values { entry.ready.cancel(); entry.connection?.close() }
    connections.removeAll()
    states.removeAll()
    diagnostics.removeAll()
    documents.removeAll()
  }

  /// One keep-alive pass: used connections send a notification while the window is visible; connections idle past
  /// the retention window close so the sandbox can stand by.
  public func tick() {
    let time = now()
    for (language, entry) in connections {
      guard let connection = entry.connection, connection.state == .connected else { continue }
      if time.timeIntervalSince(entry.lastUse) > Self.retain {
        connection.close()
        states[language] = .offline
        continue
      }
      guard isVisible() else { continue }
      Task { try? await connection.keepAlive() }
    }
  }

  private func startKeepAlive() {
    guard keepAlive == nil else { return }
    keepAlive = Task { [weak self] in
      while !Task.isCancelled {
        try? await Task.sleep(for: Self.keepAliveInterval)
        guard let self else { return }
        self.tick()
      }
    }
  }
}
