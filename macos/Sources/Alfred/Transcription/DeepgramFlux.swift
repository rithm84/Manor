import Foundation

/// Streaming client for Deepgram Flux (`/v2/listen`), the turn-aware conversational STT model.
/// One instance per audio source. Handles chunking, reconnects with buffered replay, and keepalive.
final class FluxStream: @unchecked Sendable {
    enum State: Equatable { case idle, connecting, open, reconnecting, closed, failed(String) }

    enum Event {
        case update(turn: Int, transcript: String)
        case eagerEndOfTurn(turn: Int, transcript: String)
        case turnResumed(turn: Int)
        case endOfTurn(turn: Int, transcript: String)
    }

    struct Options {
        /// The Authorization header for one connection: "Token <key>" with a development key, or "Bearer <token>"
        /// with a short-lived token from Manor's proxy, fetched fresh for every connection and reconnection.
        var authorization: @Sendable () async throws -> String
        var model: String
        var eotThreshold: Double?
        var eagerEOTThreshold: Double?
        var eotTimeoutMs: Int?
        var languageHints: [String] = []
    }

    /// Callbacks are delivered on the main queue.
    var onEvent: ((Event) -> Void)?
    var onState: ((State) -> Void)?

    private let options: Options
    private let name: String
    private let q: DispatchQueue
    private let session: URLSession

    private var task: URLSessionWebSocketTask?
    private var state: State = .idle { didSet { if state != oldValue { let s = state; DispatchQueue.main.async { self.onState?(s) } } } }
    private var pending = Data()           // audio not yet framed into a chunk
    private var backlog: [Data] = []       // chunks queued while (re)connecting
    private var attempts = 0
    private var lastAudioIn = Date.distantPast
    private var lastPing = Date.now
    private var keepAlive: DispatchSourceTimer?
    private var generation = 0             // invalidates callbacks from stale sockets

    /// 80 ms of 16 kHz Int16 mono — Deepgram's recommended frame size.
    static let chunkBytes = 2_560
    /// Replay at most ~15 s of audio after a reconnect.
    static let maxBacklogChunks = 190

    init(name: String, options: Options) {
        self.name = name
        self.options = options
        q = DispatchQueue(label: "app.manor.alfred.flux.\(name)", qos: .userInitiated)
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        session = URLSession(configuration: config)
    }

    var url: URL {
        var c = URLComponents(string: "wss://api.deepgram.com/v2/listen")!
        var items = [
            URLQueryItem(name: "model", value: options.model),
            URLQueryItem(name: "encoding", value: "linear16"),
            URLQueryItem(name: "sample_rate", value: String(Int(PCMConverter.sampleRate))),
        ]
        if let v = options.eotThreshold { items.append(.init(name: "eot_threshold", value: String(v))) }
        if let v = options.eagerEOTThreshold { items.append(.init(name: "eager_eot_threshold", value: String(v))) }
        if let v = options.eotTimeoutMs { items.append(.init(name: "eot_timeout_ms", value: String(v))) }
        items += options.languageHints.map { URLQueryItem(name: "language_hint", value: $0) }
        c.queryItems = items
        return c.url!
    }

    func start() {
        q.async { [self] in
            guard state == .idle || state == .closed || isFailed else { return }
            attempts = 0
            connect()
            startKeepAlive()
        }
    }

    func send(_ pcm: Data) {
        q.async { [self] in
            guard state != .idle, state != .closed, !isFailed else { return }
            lastAudioIn = .now
            pending.append(pcm)
            while pending.count >= Self.chunkBytes {
                let chunk = pending.prefix(Self.chunkBytes)
                pending.removeFirst(Self.chunkBytes)
                transmit(Data(chunk))
            }
        }
    }

    func stop() {
        q.async { [self] in
            keepAlive?.cancel()
            keepAlive = nil
            generation += 1
            backlog.removeAll()
            pending.removeAll()
            if let task {
                // Ask Deepgram to flush the final turn, then close shortly after.
                task.send(.string(#"{"type":"CloseStream"}"#)) { _ in }
                q.asyncAfter(deadline: .now() + 1.0) { task.cancel(with: .normalClosure, reason: nil) }
            }
            task = nil
            state = .closed
        }
    }

    // MARK: - Internals (all on `q`)

    private var isFailed: Bool { if case .failed = state { true } else { false } }

    private func connect() {
        generation += 1
        let gen = generation
        state = attempts == 0 ? .connecting : .reconnecting
        let authorization = options.authorization
        Task { [weak self] in
            let header: Result<String, Error>
            do { header = .success(try await authorization()) } catch { header = .failure(error) }
            self?.q.async { [weak self] in
                guard let self, gen == self.generation, self.state != .closed else { return }
                switch header {
                case .success(let value): self.open(value, gen: gen)
                case .failure(let error):
                    // An account without access (signed out, or today's listening used up) won't fix itself.
                    if let error = error as? LLMError, [401, 403, 429].contains(error.status) {
                        self.state = .failed(error.message)
                    } else {
                        self.handleDisconnect(error, status: nil)
                    }
                }
            }
        }
    }

    private func open(_ authorization: String, gen: Int) {
        var request = URLRequest(url: url)
        request.setValue(authorization, forHTTPHeaderField: "Authorization")
        let task = session.webSocketTask(with: request)
        self.task = task
        task.resume()
        receive(task, gen: gen)
        Log.stt.info("[\(self.name, privacy: .public)] connecting (attempt \(self.attempts + 1))")
    }

    private func transmit(_ chunk: Data) {
        guard state == .open, let task else {
            backlog.append(chunk)
            if backlog.count > Self.maxBacklogChunks { backlog.removeFirst(backlog.count - Self.maxBacklogChunks) }
            return
        }
        task.send(.data(chunk)) { [weak self] error in
            guard let self, let error else { return }
            Log.stt.error("[\(self.name, privacy: .public)] send failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    private func receive(_ task: URLSessionWebSocketTask, gen: Int) {
        task.receive { [weak self] result in
            guard let self else { return }
            self.q.async {
                guard gen == self.generation else { return }
                switch result {
                case .success(let message):
                    switch message {
                    case .string(let text): self.handle(Data(text.utf8))
                    case .data(let data): self.handle(data)
                    @unknown default: break
                    }
                    self.receive(task, gen: gen)
                case .failure(let error):
                    self.handleDisconnect(error, status: (task.response as? HTTPURLResponse)?.statusCode)
                }
            }
        }
    }

    private func handle(_ data: Data) {
        guard let msg = try? JSONDecoder().decode(FluxMessage.self, from: data) else { return }
        switch msg.type {
        case "Connected":
            attempts = 0
            state = .open
            let queued = backlog
            backlog.removeAll()
            queued.forEach(transmit)
            Log.stt.info("[\(self.name, privacy: .public)] connected, replayed \(queued.count) chunks")
        case "TurnInfo":
            let turn = msg.turn_index ?? 0
            let text = msg.transcript ?? ""
            let event: Event? = switch msg.event {
            case "Update", "StartOfTurn": .update(turn: turn, transcript: text)
            case "EagerEndOfTurn": .eagerEndOfTurn(turn: turn, transcript: text)
            case "TurnResumed": .turnResumed(turn: turn)
            case "EndOfTurn": .endOfTurn(turn: turn, transcript: text)
            default: nil
            }
            if let event { DispatchQueue.main.async { self.onEvent?(event) } }
        case "Error", "FatalError":
            // The server closes the socket after errors; reconnect logic in handleDisconnect takes over.
            let reason = msg.description ?? msg.code ?? "Unknown Deepgram error"
            Log.stt.error("[\(self.name, privacy: .public)] \(reason, privacy: .public)")
        default:
            break
        }
    }

    private func handleDisconnect(_ error: Error, status: Int?) {
        guard state != .closed, state != .idle, !isFailed else { return }
        generation += 1  // ignore any further callbacks from the dead socket
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        // Auth / bad-request failures won't fix themselves; stop instead of hammering the API.
        if let status, [400, 401, 402, 403].contains(status) {
            let reason = status == 400 ? "Deepgram rejected the stream parameters (400)." : "Deepgram rejected the API key (\(status))."
            state = .failed(reason)
            return
        }
        // Transient network loss: keep retrying (capped backoff) for as long as the user is listening.
        attempts += 1
        let delay = min(8.0, 0.4 * pow(2.0, Double(attempts - 1)))
        Log.stt.error("[\(self.name, privacy: .public)] disconnected: \(error.localizedDescription, privacy: .public); retry in \(delay)s")
        state = .reconnecting
        q.asyncAfter(deadline: .now() + delay) { [self] in
            guard state == .reconnecting else { return }
            connect()
        }
    }

    /// Two jobs, on one 80 ms tick:
    /// - If the source stops delivering buffers (ScreenCaptureKit goes quiet when nothing plays), feed
    ///   silence at real-time rate. Flux's turn clock runs on audio time, so under-feeding would delay
    ///   EndOfTurn for the question that was just asked.
    /// - Ping every 10 s so a half-open socket is detected in seconds, not at the request timeout.
    private func startKeepAlive() {
        keepAlive?.cancel()
        let timer = DispatchSource.makeTimerSource(queue: q)
        timer.schedule(deadline: .now() + .milliseconds(80), repeating: .milliseconds(80), leeway: .milliseconds(10))
        timer.setEventHandler { [weak self] in
            guard let self, self.state == .open, let task = self.task else { return }
            if Date.now.timeIntervalSince(self.lastAudioIn) > 0.12 {
                self.transmit(Data(count: Self.chunkBytes))
            }
            if Date.now.timeIntervalSince(self.lastPing) > 10 {
                self.lastPing = .now
                let gen = self.generation
                task.sendPing { [weak self] error in
                    guard let self, let error else { return }
                    self.q.async {
                        guard gen == self.generation else { return }
                        self.handleDisconnect(error, status: nil)
                    }
                }
            }
        }
        timer.resume()
        keepAlive = timer
    }
}

private struct FluxMessage: Decodable {
    let type: String
    let event: String?
    let turn_index: Int?
    let transcript: String?
    let description: String?
    let code: String?
}
