import AppKit
import Combine

struct Toast: Equatable, Identifiable {
    enum Style { case info, warning, error }
    let id = UUID()
    var message: String
    var style: Style = .info
}

/// Central coordinator. Owns the session's moving parts and turns hotkeys and UI intents into actions.
@MainActor
final class AlfredState: ObservableObject {
    let prefs: Preferences
    let knowledge: KnowledgeStore
    let transcript = Transcript()
    let listener: Listener
    let context: ContextEngine
    let answers = AnswerEngine()

    @Published private(set) var config = Config.load()
    @Published var overlayVisible = true
    @Published var answerVisible = false
    /// User expanded the card from the notch even with nothing to show yet.
    @Published var cardPinned = false
    @Published var askActive = false
    @Published var askText = ""
    @Published var toast: Toast?
    /// Monotonic nonce + direction; the answer view observes it to scroll.
    @Published private(set) var scrollRequest = (nonce: 0, direction: 0)

    private(set) var sessionID = UUID()
    private(set) var sessionStarted = Date.now
    /// Hotkey and prefetch answers.
    private var client: LLMClient?
    /// Always-on context pass (may run on a different provider).
    private var contextClient: LLMClient?
    /// One client per provider+key+endpoint, shared between roles (one warm connection).
    private var clients: [String: LLMClient] = [:]
    /// OpenAI client for the topic router (new problem → new chat).
    private var routerClient: LLMClient?
    private var askedForScreen = false
    private var askedForWindowText = false
    /// Tests feed screenshots here instead of capturing the display.
    var screenshotOverride: (() async throws -> String)?
    private var warmTimer: Timer?
    /// Held while listening: stops App Nap from throttling timers, audio queues and streams while the
    /// user is in another app (exactly when Alfred has to be instant).
    private var activity: NSObjectProtocol?
    private var toastTask: Task<Void, Never>?
    private var bag = Set<AnyCancellable>()

    /// Hooks installed by the host.
    var openSettings: () -> Void = {}
    var openManor: () -> Void = {}
    var onModeChange: (AlfredMode) -> Void = { _ in }
    var focusAskField: (Bool) -> Void = { _ in }

    var mode: AlfredMode { prefs.alfredMode }

    init(prefs: Preferences, knowledge: KnowledgeStore) {
        self.prefs = prefs
        self.knowledge = knowledge
        listener = Listener(transcript: transcript)
        context = ContextEngine(transcript: transcript)
        transcript.onFinalized = { [weak self] _ in self?.context.schedule() }
        listener.onTurnEvent = { [weak self] event, speaker in self?.route(event, from: speaker) }

        // Views observe the sub-objects directly (injected as environment objects) so that, e.g.,
        // 20 Hz audio-level updates only re-render the meter, not the answer card.
        // Profile edits flow into the engines (debounced so typing in Settings stays cheap).
        prefs.objectWillChange.merge(with: knowledge.objectWillChange)
            .debounce(for: .milliseconds(400), scheduler: RunLoop.main)
            .sink { [weak self] _ in self?.configureEngines() }
            .store(in: &bag)
        // Switching modes takes effect at once: listening stops in General and starts in Prep.
        prefs.$alfredMode.dropFirst().removeDuplicates()
            .sink { [weak self] mode in self?.apply(mode) }
            .store(in: &bag)

        configureEngines()
    }

    var profile: Prompts.Profile {
        Prompts.Profile(mode: prefs.mode, language: prefs.codingLanguage,
                        knowledge: KnowledgeStore.promptBlock(knowledge.docs),
                        role: prefs.roleContext, extra: prefs.extraInstructions,
                        assistant: prefs.alfredMode)
    }

    func bootstrap() {
        if ProcessInfo.processInfo.environment["ALFRED_DEMO"] != nil { loadDemo(); return }
        client?.warmUp()
        if mode == .interview && prefs.listenOnLaunch { startListening() }
    }

    func reloadConfig() {
        config = Config.load()
        configureEngines()
        client?.warmUp()
    }

    /// Opens the provider connection ahead of the first hotkey press (done automatically when listening starts).
    func warmUp() {
        client?.warmUp()
        if let contextClient, contextClient !== client { contextClient.warmUp() }
    }

    /// Re-applies config + profile to the engines. Clients (and their warm HTTP/2 connections) are only
    /// rebuilt when a provider's key or endpoint actually changes.
    private func configureEngines() {
        func clientFor(_ p: LLMProvider) -> LLMClient? {
            guard let id = config.clientID(for: p) else { return nil }
            if let c = clients[id] { return c }
            guard let c = config.makeClient(for: p) else { return nil }
            clients[id] = c
            return c
        }
        let answer = clientFor(.anthropic)
        // The background context pass only runs in Prep mode.
        let ctx = mode == .interview ? clientFor(.anthropic) : nil
        let router = config.routerModel == nil ? nil : clientFor(.openai)
        // Release clients no role uses any more.
        for (id, c) in clients where c !== answer && c !== ctx && c !== router { c.invalidate(); clients[id] = nil }
        client = answer
        contextClient = ctx
        routerClient = router
        context.configure(client: contextClient, config: config, profile: profile)
    }

    /// Idle HTTP/2 connections get reaped; while listening, keep one warm so ⌃⌥␣ skips the TLS handshake.
    private func setKeepWarm(_ on: Bool) {
        warmTimer?.invalidate()
        warmTimer = nil
        if let activity { ProcessInfo.processInfo.endActivity(activity); self.activity = nil }
        guard on else { return }
        activity = ProcessInfo.processInfo.beginActivity(options: [.userInitiated, .latencyCritical, .idleSystemSleepDisabled],
                                                         reason: "Listening to a live conversation")
        warmUp()
        warmTimer = Timer.scheduledTimer(withTimeInterval: 40, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.warmUp() }
        }
    }

    // MARK: - Mode

    private func apply(_ mode: AlfredMode) {
        switch mode {
        case .general:
            answers.cancelSpeculative()
            if listener.isActive || listener.status == .starting { stopListening() }
        case .interview:
            if config.hasDeepgram { startListening() }
            else { show(Toast(message: "Add a Deepgram key in Settings to listen", style: .warning), for: 4) }
        }
        onModeChange(mode)
        // The engines pick up the new prompt right away, not after the settings debounce.
        DispatchQueue.main.async { [weak self] in self?.configureEngines() }
    }

    // MARK: - Hotkeys

    func handle(_ action: HotkeyAction) {
        switch action {
        case .assist: assist()
        case .toggleListening: toggleListening()
        case .toggleMic: toggleMic()
        case .toggleOverlay: toggleOverlay()
        case .newSession: newSession()
        case .scrollUp: scroll(-1)
        case .scrollDown: scroll(1)
        case .previousChat: answers.stepThread(-1); answerVisible = true
        case .nextChat: answers.stepThread(1); answerVisible = true
        case .newChat: newChat()
        case .closeChat: closeChat(answers.active)
        case .settings: openSettings()
        case .stepBack: NotificationCenter.default.post(name: .alfredDiagramStep, object: -1)
        case .stepForward: NotificationCenter.default.post(name: .alfredDiagramStep, object: 1)
        }
    }

    // MARK: - Listening (Prep mode)

    func toggleListening() {
        if listener.isActive || listener.status == .starting { stopListening() } else { startListening() }
    }

    func startListening() {
        guard mode == .interview else {
            show(Toast(message: "Listening is part of Prep mode", style: .warning), for: 3)
            return
        }
        guard !listener.isActive else { return }
        Task {
            setKeepWarm(true)
            await listener.start(config: config, captureMic: prefs.captureMic,
                                 eagerThem: prefs.prefetchAnswers ? Self.eagerThreshold : nil)
            if case .failed(let reason) = listener.status {
                setKeepWarm(false)
                show(Toast(message: reason, style: .error), for: 6)
            }
        }
    }

    func stopListening() {
        Task {
            setKeepWarm(false)
            await listener.stop()
        }
    }

    func toggleMic() {
        guard mode == .interview else { return }
        let enabled = !prefs.captureMic
        prefs.captureMic = enabled
        Task { await listener.setMic(enabled: enabled) }
        show(Toast(message: enabled ? "Microphone on" : "Microphone muted. Alfred hears only the call"))
    }

    // MARK: - Answers

    func run(_ quick: QuickAction) {
        switch quick {
        case .assist: assist(forceScreen: mode == .general)
        default:
            assist(typed: quick.prompt, heading: quick.heading, forceScreen: quick.aboutScreen)
        }
    }

    /// Answers now. In Prep mode every answer gets the live conversation plus, when allowed, a screenshot;
    /// the model works out whether you need the problem on screen or the interviewer's question. In General mode
    /// it's the screen and the chat. A typed request overrides both.
    func assist(typed: String? = nil, heading customHeading: String? = nil, forceScreen: Bool = false) {
        overlayVisible = true
        answerVisible = true
        let general = mode == .general
        guard let client else {
            let id = answers.begin(heading: "Sign in to use Alfred", usedScreen: false, general: general)
            answers.fail("Alfred runs on your Manor account. Sign in to Manor, then ask again.", id: id)
            openSettings()
            return
        }
        let typed = typed?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
        let screen = screenContextReady(force: forceScreen || general)
        if !screen, typed == nil {
            if general {
                // Nothing to look at: open the ask box so the question can be typed.
                answerVisible = answers.current != nil
                beginAsk()
                return
            }
            if transcript.isEmpty {
                show(Toast(message: listener.isActive ? "Nothing heard yet. Alfred is listening"
                                                      : "Start listening with ⌃⌥L, or type a question",
                           style: .warning))
                answerVisible = answers.current != nil
                return
            }
        }

        // Fastest path: the answer was already being generated when the question ended.
        if !general, typed == nil, customHeading == nil, adoptPrefetchIfCurrent() { return }
        answers.cancelSpeculative()

        let (snapshot, briefQuestion) = makeSnapshot(typed: typed)
        // ⌃⌥Space answers from the running conversation + the current screen; the label is the interviewer's
        // open question when there is one (the model still decides what to answer).
        let heading = customHeading ?? typed
            ?? (general ? "What's on my screen?" : briefQuestion ?? transcript.latestThemPrompt ?? Answer.answerNow)
        let answerID = answers.begin(heading: heading, usedScreen: screen, prompt: typed, general: general)

        answers.run(answerID: answerID, client: client, config: config, profile: profile, sessionID: sessionID,
                    context: snapshot, screenshot: screen ? captureScreen : nil,
                    // Typed questions stay in the chat you're in (manual override); answers to the conversation or
                    // screen move to a new chat when the topic has really changed.
                    router: typed == nil && customHeading == nil ? makeTopicRouter() : nil,
                    onTabsFull: { [weak self] in
                        self?.show(Toast(message: "New topic, but \(AnswerEngine.maxThreads) chats are open. Close one with ⌃⌥W to split it off",
                                         style: .warning), for: 4)
                    })
    }

    /// Screen context is on and we can capture (asks for Screen Recording once if it isn't granted).
    private func screenContextReady(force: Bool = false) -> Bool {
        guard prefs.includeScreen || force else { return false }
        if screenshotOverride != nil { return true }
        if ScreenCapture.hasPermission {
            // Reading the window's text needs Accessibility; ask once, and answer from the image meanwhile.
            if prefs.includeWindowText, !WindowText.isTrusted, !askedForWindowText {
                askedForWindowText = true
                WindowText.requestTrust()
            }
            return true
        }
        if !askedForScreen {
            askedForScreen = true
            ScreenCapture.requestPermission()
            show(Toast(message: "Allow Screen Recording for Manor so Alfred can see your screen", style: .warning), for: 4)
        }
        return false
    }

    private var captureScreen: () async throws -> ScreenSnapshot {
        if let screenshotOverride { return { ScreenSnapshot(image: try await screenshotOverride()) } }
        let readText = prefs.includeWindowText
        return { try await WindowCapture.capture(readText: readText) }
    }

    /// For answers to the conversation or screen in a chat that already has history: a fast model (GPT-6 Luna,
    /// fast tier, no reasoning; ~0.7 s) decides whether the topic has completely changed, from the chat summary,
    /// the latest conversation and a low-detail screenshot. Any failure or a 2.5 s timeout keeps the chat.
    private func makeTopicRouter() -> AnswerEngine.TopicRouter? {
        guard let model = config.routerModel, let router = routerClient else { return nil }
        let history = answers.history()
        guard !history.isEmpty else { return nil }
        let asked = history.filter { $0.role == .user }.suffix(4).map { "- \($0.text.prefix(200))" }.joined(separator: "\n")
        let lastAnswer = history.last { $0.role == .assistant }.map { String($0.text.prefix(400)) } ?? ""
        var summary = """
        THE CHAT SO FAR. The user asked:
        \(asked)

        Latest answer begins:
        \(lastAnswer)
        """
        if mode == .interview {
            let live = Transcript.render(Array(transcript.turns.suffix(4)), live: transcript.live.values.sorted { $0.start < $1.start })
            summary += "\n\nLIVE CONVERSATION NOW (most recent last):\n\(live.isEmpty ? "(silence)" : String(live.suffix(900)))"
        }
        let config = config
        let instructions = mode == .interview ? Prompts.routerInstructions : Prompts.generalRouterInstructions
        return { [summary] shot in
            var parts: [OpenAIClient.Part] = [.text(summary)]
            if let shot { parts.append(.image(dataURL: shot, lowDetail: true)) }
            let request = OpenAIClient.Request(
                model: model, instructions: instructions,
                parts: parts,
                serviceTier: config.routerTier, effort: config.routerEffort, maxOutputTokens: 200,
                jsonSchema: (name: "alfred_route", schema: Prompts.routerSchema))
            let started = Date.now
            let verdict: Bool? = await withTaskGroup(of: Bool?.self) { group in
                group.addTask { (try? await router.complete(request)).flatMap(Self.parseRoute) }
                group.addTask { try? await Task.sleep(for: .seconds(2.5)); return nil }
                let first: Bool?? = await group.next()
                group.cancelAll()
                return first ?? nil
            }
            Log.llm.info("Router: new_topic=\(verdict.map(String.init) ?? "n/a", privacy: .public) in \(Int(Date.now.timeIntervalSince(started) * 1000)) ms")
            return verdict ?? false
        }
    }

    nonisolated static func parseRoute(_ json: String) -> Bool? {
        guard let data = json.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return obj["new_topic"] as? Bool
    }

    // MARK: - Turn routing & speculative answers

    /// Flux eager end-of-turn for the interviewer channel. Benchmarked on the same questions (8 each):
    /// eager 0.5 → first signal p50 0.15 s vs 0.33 s with eager off (up to 0.6 s sooner on long questions),
    /// final EndOfTurn unchanged. A mid-question pause can fire it early; TurnResumed cancels that
    /// prefetch cheaply. Override with DEEPGRAM_EAGER_EOT_THRESHOLD.
    static let eagerThreshold: Double? = 0.5
    /// If the user has said more than this since the prefetch started, regenerate instead of adopting.
    static let maxMeWordsSincePrefetch = 12

    /// Single entry point for STT turn events.
    func route(_ event: FluxStream.Event, from speaker: Speaker) {
        switch event {
        case .update(_, let text):
            transcript.partial(speaker, text)
        case .eagerEndOfTurn(_, let text):
            transcript.partial(speaker, text)
            if speaker == .them { prefetchIfQuestion() }
        case .turnResumed:
            // They kept talking: the question isn't finished, stop paying for an answer to half of it.
            if speaker == .them { answers.cancelSpeculative() }
        case .endOfTurn(_, let text):
            transcript.finalize(speaker, text)
            if speaker == .them { prefetchIfQuestion() }
        }
    }

    /// Starts a hidden answer when an interviewer turn ends with a question (≈1 call per question).
    private func prefetchIfQuestion() {
        guard mode == .interview, prefs.prefetchAnswers, let client else { return }
        let utterance = transcript.currentThemUtterance
        guard Transcript.looksLikeQuestion(utterance) else { return }
        // Same question already in flight (eager → final, or merged into the previous turn)?
        if let basis = answers.speculativeBasis, Self.matches(utterance, basis.themText) { return }
        let (snapshot, _) = makeSnapshot(typed: nil)
        let screen = prefs.includeScreen && (screenshotOverride != nil || ScreenCapture.hasPermission)
        answers.prefetch(heading: Transcript.lastQuestion(in: utterance),
                         basis: PrefetchBasis(themText: utterance, meWords: transcript.meWordCount),
                         client: client, config: config, profile: profile, sessionID: sessionID, context: snapshot,
                         screenshot: screen ? captureScreen : nil, router: makeTopicRouter())
    }

    /// Adopts the speculative answer if it still answers what's on the table.
    private func adoptPrefetchIfCurrent() -> Bool {
        guard let basis = answers.speculativeBasis else { return false }
        let current = transcript.currentThemUtterance
        guard Self.matches(current, basis.themText),
              transcript.meWordCount - basis.meWords <= Self.maxMeWordsSincePrefetch else { return false }
        return answers.adoptSpeculative()
    }

    /// True when `current` is the prefetched text, possibly with earlier same-turn speech merged in front.
    static func matches(_ current: String, _ prefetched: String) -> Bool {
        let a = Transcript.normalized(current), b = Transcript.normalized(prefetched)
        return !b.isEmpty && (a == b || a.hasSuffix(b))
    }

    /// Snapshot for an answer: memory + unfolded turns + live partials (+ the background brief when it
    /// still applies, i.e. THEM hasn't said anything new since it was computed). General mode carries no conversation.
    private func makeSnapshot(typed: String?) -> (AssistContext, briefQuestion: String?) {
        if mode == .general {
            let snapshot = AssistContext(memory: "", turns: [], live: [], brief: nil, briefIsFresh: false,
                                         history: answers.history(), typed: typed, screenshot: nil, general: true)
            return (snapshot, nil)
        }
        let liveThem = transcript.live[.them] != nil
        let briefApplies = context.brief.map { $0.revision >= transcript.lastThemRevision && !liveThem } ?? false
        let brief = briefApplies ? context.brief : nil
        let folded = min(context.foldedCount, transcript.turns.count)
        let snapshot = AssistContext(
            memory: context.memory,
            turns: Array(transcript.turns[folded...]),
            live: transcript.live.values.sorted { $0.start < $1.start },
            brief: brief, briefIsFresh: brief?.revision == transcript.revision,
            history: answers.history(),
            typed: typed, screenshot: nil)
        return (snapshot, brief?.openQuestion.nilIfEmpty)
    }

    /// The card is out of the notch: typing, an answer showing, or pinned open.
    var isCardOpen: Bool {
        cardPinned || askActive || (answerVisible && (answers.current != nil || answers.threads.count > 1))
    }

    /// ⌃⌥H: opens Alfred ready to type (the ask box focused); pressing again folds it flush into the notch.
    func toggleOverlay() {
        if overlayVisible && isCardOpen {
            collapseCard()
        } else {
            overlayVisible = true
            beginAsk()
        }
    }

    /// Folds the card back into the notch.
    func collapseCard() {
        endAsk()
        cardPinned = false
        answerVisible = false
    }

    func beginAsk() {
        overlayVisible = true
        answerVisible = true   // reopening brings the active chat back, not just an empty input
        askActive = true
        focusAskField(true)
    }

    func submitAsk() {
        let text = askText.trimmingCharacters(in: .whitespacesAndNewlines)
        askText = ""
        endAsk()
        guard !text.isEmpty else { return }
        assist(typed: text)
    }

    func endAsk() {
        askActive = false
        focusAskField(false)
    }

    func copyAnswer() {
        guard let text = answers.current?.text, !text.isEmpty else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        show(Toast(message: "Answer copied"))
    }

    private func scroll(_ direction: Int) {
        answerVisible = true
        scrollRequest = (scrollRequest.nonce + 1, direction)
    }

    // MARK: - Chats

    /// Opens a new chat (max `AnswerEngine.maxThreads`); earlier chats stay in their tabs.
    func newChat() {
        overlayVisible = true
        guard answers.newThread() else {
            show(Toast(message: "\(AnswerEngine.maxThreads) chats are open. Close one with ⌃⌥W to start another", style: .warning), for: 3.5)
            return
        }
        answerVisible = true
        beginAsk()
    }

    func closeChat(_ index: Int) {
        answers.closeThread(index)
        answerVisible = !answers.answers.isEmpty || answers.threads.count > 1
    }

    // MARK: - Session

    func newSession() {
        saveSession()
        answers.reset()
        context.reset()
        transcript.reset()
        sessionID = UUID()
        sessionStarted = .now
        answerVisible = false
        configureEngines()
        show(Toast(message: "New session"))
    }

    /// Writes transcript + answers to ~/Library/Application Support/Manor/Alfred/Sessions as Markdown.
    func saveSession() {
        let chats = answers.threads.filter { !$0.answers.isEmpty }
        guard prefs.saveSessions, !transcript.turns.isEmpty || !chats.isEmpty else { return }
        let fmt = DateFormatter()
        fmt.dateFormat = "yyyy-MM-dd HH.mm"
        var md = "# Alfred session, \(fmt.string(from: sessionStarted))\n\n"
        if !context.memory.isEmpty { md += "## Memory\n\n\(context.memory)\n\n" }
        if !transcript.turns.isEmpty { md += "## Transcript\n\n\(transcript.markdownExport())\n\n" }
        for (k, chat) in chats.enumerated() {
            md += "## Chat \(k + 1): \(chat.title)\n\n"
            md += chat.answers.map { "### \($0.prompt ?? $0.heading)\n\n\($0.text)" }.joined(separator: "\n\n") + "\n\n"
        }
        let url = Paths.sessions.appendingPathComponent("\(fmt.string(from: sessionStarted)).md")
        do { try md.write(to: url, atomically: true, encoding: .utf8) } catch {
            Log.app.error("Session save failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    // MARK: - Demo (UI review without provider keys: `ALFRED_DEMO=1`)

    func loadDemo() {
        transcript.finalize(.them, "Let's do a coding question. Given an array of integers and a target, return the indices of the two numbers that add up to the target.")
        let gallery = ProcessInfo.processInfo.environment["ALFRED_DEMO_KIND"] == "diagrams"
        if gallery {
            answers.begin(heading: "Show me every diagram type", usedScreen: false)
            answers.demoFill(DemoContent.gallery)
        } else {
            // Two chats: a system-design one in the background, and Two Sum with a follow-up in front.
            answers.begin(heading: DemoContent.otherChat.heading, usedScreen: false, prompt: DemoContent.otherChat.heading)
            answers.demoFill(DemoContent.otherChat.answer)
            answers.newThread()
            answers.begin(heading: DemoContent.heading, usedScreen: false)
            answers.demoFill(DemoContent.answer)
            answers.begin(heading: DemoContent.followUp.heading, usedScreen: false, prompt: DemoContent.followUp.heading)
            answers.demoFill(DemoContent.followUp.answer)
        }
        answerVisible = true
    }

    // MARK: - Toasts

    func show(_ toast: Toast, for seconds: Double = 2.5) {
        self.toast = toast
        toastTask?.cancel()
        toastTask = Task {
            try? await Task.sleep(for: .seconds(seconds))
            if !Task.isCancelled, self.toast?.id == toast.id { self.toast = nil }
        }
    }
}

/// One-click actions under the chat. Prep mode works from the conversation; General mode from the screen.
enum QuickAction: CaseIterable, Identifiable {
    case assist, diagram, followUps, recap, explain, summarize, visualize
    var id: Self { self }

    static func actions(for mode: AlfredMode) -> [QuickAction] {
        mode == .interview ? [.assist, .diagram, .followUps, .recap] : [.assist, .explain, .summarize, .visualize]
    }

    var title: String {
        switch self {
        case .assist: "Answer"
        case .diagram: "Diagram"
        case .followUps: "Follow-ups"
        case .recap: "Recap"
        case .explain: "Explain"
        case .summarize: "Summarize"
        case .visualize: "Visualize"
        }
    }

    /// The prompt bubble the action leaves in the chat.
    var heading: String {
        switch self {
        case .diagram: "Draw it"
        case .explain: "Explain my screen"
        case .summarize: "Summarize my screen"
        case .visualize: "Visualize my screen"
        default: title
        }
    }

    var icon: String {
        switch self {
        case .assist: "sparkles"
        case .diagram: "point.3.connected.trianglepath.dotted"
        case .followUps: "bubble.left"
        case .recap: "arrow.clockwise"
        case .explain: "text.magnifyingglass"
        case .summarize: "list.bullet"
        case .visualize: "chart.bar.xaxis"
        }
    }

    var hotkey: HotkeyAction? { self == .assist ? .assist : nil }

    /// Screen actions capture the screen even when screenshots are off in Settings.
    var aboutScreen: Bool { [.explain, .summarize, .visualize].contains(self) }

    var prompt: String? {
        switch self {
        case .diagram: "Draw the key data structure(s) for the current problem as a diagram block, showing the state at the most instructive step, then 2–3 bullets walking through it."
        case .followUps: "Suggest 3 sharp, specific questions I could ask them right now, based on the conversation. One line each."
        case .recap: "Recap the conversation so far: what they asked, what I said, what they seem to care about, and anything I still need to address. Tight bullets."
        case .explain: "Explain what's on my screen in plain language: what it is, what it means, and anything I should notice."
        case .summarize: "Summarize what's on my screen: the key points in a few tight bullets."
        case .visualize: "Show the key idea on my screen as a visual (a chart, table or diagram, whichever explains it best), with one line of takeaway."
        case .assist: nil
        }
    }
}

extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}
