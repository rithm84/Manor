import Foundation

/// Owns the live audio → transcript pipeline: system audio and microphone, each streamed
/// to its own Flux connection so speaker attribution is exact (no diarization guesswork).
@MainActor
final class Listener: ObservableObject {
    enum Status: Equatable {
        case off, starting, live, degraded(String), failed(String)
    }

    @Published private(set) var status: Status = .off
    @Published private(set) var themLevel: Float = 0
    @Published private(set) var meLevel: Float = 0
    @Published private(set) var micEnabled = true
    @Published private(set) var startedAt: Date?

    var isActive: Bool { status != .off && !isFailed }
    private var isFailed: Bool { if case .failed = status { true } else { false } }

    private let transcript: Transcript
    /// Turn events (partials, eager/final end-of-turn, resumes) — routed by AlfredState.
    var onTurnEvent: ((FluxStream.Event, Speaker) -> Void)?
    private var system: SystemAudioCapture?
    private var mic: MicrophoneCapture?
    private var themStream: FluxStream?
    private var meStream: FluxStream?
    private var streamStates: [Speaker: FluxStream.State] = [:]
    private let levels = LevelMeter()
    private var levelTimer: Timer?
    private var options: FluxStream.Options?
    /// Sticky, user-visible warning (mic denied, system audio restarting…) that survives stream updates.
    private var notice: String?
    /// Bumped on every start/stop so an in-flight start can tell it was superseded.
    private var generation = 0
    private var systemRestartAttempts = 0

    init(transcript: Transcript) {
        self.transcript = transcript
    }

    /// - Parameter eagerThem: Flux `eager_eot_threshold` for the interviewer channel (enables EagerEndOfTurn,
    ///   used to start answering speculatively a few hundred ms before the turn is confirmed).
    func start(config: Config, captureMic: Bool, eagerThem: Double? = nil) async {
        guard !isActive else { return }
        await teardown()  // clean up anything left from a failed session
        let authorization: @Sendable () async throws -> String
        if let key = config.deepgramKey, !key.isEmpty {
            authorization = { "Token \(key)" }
        } else if config.isHosted, let hosted = config.hosted {
            authorization = { try await hosted.deepgramAuthorization() }
        } else {
            status = .failed("Sign in to Manor to use Alfred's listening")
            return
        }
        generation += 1
        let gen = generation
        status = .starting
        notice = nil
        micEnabled = captureMic
        let options = FluxStream.Options(authorization: authorization, model: config.deepgramModel,
                                         eotThreshold: config.deepgramEOTThreshold,
                                         eagerEOTThreshold: config.deepgramEagerEOTThreshold,
                                         eotTimeoutMs: config.deepgramEOTTimeoutMs,
                                         languageHints: config.deepgramLanguageHints)
        self.options = options

        var themOptions = options
        themOptions.eagerEOTThreshold = config.deepgramEagerEOTThreshold ?? eagerThem
        themStream = makeStream(.them, options: themOptions)
        do {
            try await startSystemAudio()
        } catch {
            guard gen == generation else { return }
            await teardown()
            status = .failed(Self.describeCaptureError(error))
            return
        }
        guard gen == generation else { return }  // user pressed stop while we were starting

        if captureMic { await startMic() }
        guard gen == generation else { return }

        startedAt = .now
        startLevelTimer()
        refreshStatus()
    }

    func stop() async {
        generation += 1
        await teardown()
        status = .off
    }

    func setMic(enabled: Bool) async {
        guard enabled != micEnabled else { return }
        micEnabled = enabled
        guard isActive else { return }
        if enabled {
            await startMic()
        } else {
            stopMic()
        }
        refreshStatus()
    }

    // MARK: - Private

    private func teardown() async {
        levelTimer?.invalidate()
        levelTimer = nil
        stopMic()
        let system = self.system
        self.system = nil
        await system?.stop()
        themStream?.stop()
        themStream = nil
        streamStates = [:]
        if let live = transcript.live[.them] { transcript.finalize(.them, live.text) }  // keep mid-sentence text
        themLevel = 0
        startedAt = nil
        systemRestartAttempts = 0
    }

    private func startSystemAudio() async throws {
        let system = SystemAudioCapture()
        system.onAudio = { [levels, weak stream = self.themStream] data, level in
            stream?.send(data)
            levels.set(.them, level)
        }
        system.onStop = { [weak self] error in
            Task { @MainActor in self?.systemAudioStopped(error) }
        }
        try await system.start()
        self.system = system
    }

    /// ScreenCaptureKit streams die on display reconfiguration, lid close, etc. Restart with backoff.
    private func systemAudioStopped(_ error: Error?) {
        guard isActive else { return }
        system = nil
        systemRestartAttempts += 1
        let delay = min(10.0, Double(systemRestartAttempts))
        notice = "System audio paused. Reconnecting…"
        refreshStatus()
        let gen = generation
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(delay))
            guard let self, gen == self.generation, self.isActive, self.system == nil else { return }
            do {
                try await self.startSystemAudio()
                self.notice = nil
                self.systemRestartAttempts = 0
            } catch {
                self.notice = "System audio unavailable: \(error.localizedDescription)"
                self.systemAudioStopped(error)
            }
            self.refreshStatus()
        }
    }

    private func startMic() async {
        guard mic == nil, let options else { return }
        guard await MicrophoneCapture.requestAccess() else {
            micEnabled = false
            notice = "Microphone access is off, so Alfred hears only the call"
            refreshStatus()
            return
        }
        let stream = makeStream(.me, options: options)
        let mic = MicrophoneCapture()
        mic.onAudio = { [levels] data, level in
            stream.send(data)
            levels.set(.me, level)
        }
        do {
            try mic.start()
            self.mic = mic
            self.meStream = stream
        } catch {
            stream.stop()
            streamStates[.me] = nil
            micEnabled = false
            notice = "Microphone unavailable: \(error.localizedDescription)"
        }
    }

    private func stopMic() {
        mic?.stop(); mic = nil
        meStream?.stop(); meStream = nil
        streamStates[.me] = nil
        if let live = transcript.live[.me] { transcript.finalize(.me, live.text) }
        meLevel = 0
    }

    private func makeStream(_ speaker: Speaker, options: FluxStream.Options) -> FluxStream {
        let stream = FluxStream(name: speaker.rawValue, options: options)
        stream.onEvent = { [weak self] event in self?.handle(event, from: speaker) }
        stream.onState = { [weak self] state in self?.streamStateChanged(state, for: speaker) }
        stream.start()
        return stream
    }

    private func streamStateChanged(_ state: FluxStream.State, for speaker: Speaker) {
        guard isActive || status == .starting else { return }
        streamStates[speaker] = state
        if state == .reconnecting {
            // The old socket's in-progress turn will never finish.
            transcript.clearLive(speaker)
        }
        if case .failed(let reason) = state {
            // Unrecoverable (bad key / bad params): stop capturing entirely instead of leaking engines.
            generation += 1
            Task { await teardown(); status = .failed(reason) }
            return
        }
        refreshStatus()
    }

    private func handle(_ event: FluxStream.Event, from speaker: Speaker) {
        if let onTurnEvent { onTurnEvent(event, speaker); return }
        switch event {
        case .update(_, let text), .eagerEndOfTurn(_, let text): transcript.partial(speaker, text)
        case .turnResumed: break
        case .endOfTurn(_, let text): transcript.finalize(speaker, text)
        }
    }

    private func refreshStatus() {
        guard isActive || status == .starting, themStream != nil else { return }
        let states = streamStates.values
        if states.contains(.reconnecting) {
            status = .degraded("Reconnecting to Deepgram…")
        } else if let notice {
            status = .degraded(notice)
        } else if states.contains(.connecting) || states.isEmpty || system == nil {
            status = .starting
        } else {
            status = .live
        }
    }

    private func startLevelTimer() {
        levelTimer?.invalidate()
        levelTimer = Timer.scheduledTimer(withTimeInterval: 1.0 / 20.0, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                let (them, me) = self.levels.drain()
                // Fast attack, slow release for a calm meter.
                self.themLevel = them > self.themLevel ? them : self.themLevel * 0.82
                self.meLevel = me > self.meLevel ? me : self.meLevel * 0.82
            }
        }
    }

    private static func describeCaptureError(_ error: Error) -> String {
        let ns = error as NSError
        if ns.domain == "com.apple.ScreenCaptureKit.SCStreamErrorDomain" && ns.code == -3801 {
            return "Allow Screen & System Audio Recording for Manor in System Settings, then reopen Manor."
        }
        return "System audio capture failed: \(error.localizedDescription)"
    }
}

/// Lock-protected peak levels written from audio threads, drained on the main thread.
private final class LevelMeter: @unchecked Sendable {
    private let lock = NSLock()
    private var them: Float = 0
    private var me: Float = 0

    func set(_ speaker: Speaker, _ level: Float) {
        lock.lock(); defer { lock.unlock() }
        if speaker == .them { them = max(them, level) } else { me = max(me, level) }
    }

    func drain() -> (Float, Float) {
        lock.lock(); defer { lock.unlock() }
        defer { them = 0; me = 0 }
        return (them, me)
    }
}
