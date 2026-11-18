import Foundation

/// Background analysis produced by the always-on context model.
struct Brief: Equatable {
    var openQuestion: String
    var kind: String
    /// Transcript revision this brief was computed from.
    var revision: Int
    var updatedAt: Date
}

/// Always-on "regular tier" worker. After each finalized speaker turn it:
///   1. folds old turns into a compact rolling memory (keeps hotkey prompts small → low TTFT),
///   2. detects the open question directed at the user,
/// so hotkey prompts stay small, headings are right, and long sessions keep their facts. (Answer
/// pre-generation is done by the AnswerEngine's speculative lane, not here.)
@MainActor
final class ContextEngine: ObservableObject {
    @Published private(set) var brief: Brief?
    @Published private(set) var isAnalyzing = false
    @Published private(set) var lastError: String?

    /// Rolling memory covering `transcript.turns[..<foldedCount]`.
    private(set) var memory = ""
    private(set) var foldedCount = 0

    /// Verbatim tail kept outside of memory (characters / minimum turns).
    nonisolated static let recentCharBudget = 6_000
    nonisolated static let minRecentTurns = 6
    static let debounce: Duration = .milliseconds(150)

    private let transcript: Transcript
    private var client: LLMClient?
    private var config: Config?
    private var profile: Prompts.Profile?
    private var debounceTask: Task<Void, Never>?
    private var runTask: Task<Void, Never>?
    private var epoch = 0  // bumps on reset; drops results from a previous session

    init(transcript: Transcript) {
        self.transcript = transcript
    }

    func configure(client: LLMClient?, config: Config, profile: Prompts.Profile) {
        self.client = client
        self.config = config
        self.profile = profile
    }

    /// Call whenever a turn is finalized.
    func schedule() {
        guard client != nil else { return }
        debounceTask?.cancel()
        debounceTask = Task { [weak self] in
            try? await Task.sleep(for: Self.debounce)
            guard !Task.isCancelled else { return }
            self?.runIfNeeded()
        }
    }

    func reset() {
        epoch += 1
        debounceTask?.cancel()
        runTask?.cancel()
        runTask = nil
        isAnalyzing = false
        brief = nil
        memory = ""
        foldedCount = 0
        lastError = nil
    }

    /// Index where the verbatim tail starts: everything before it is eligible for folding.
    nonisolated static func tailStart(_ turns: [Turn]) -> Int {
        var chars = 0
        var index = turns.count
        while index > 0 {
            let next = turns[index - 1].text.count
            if turns.count - index >= minRecentTurns && chars + next > recentCharBudget { break }
            chars += next
            index -= 1
        }
        return index
    }

    // MARK: - Private

    private func runIfNeeded() {
        guard runTask == nil, let client, let config, let profile else { return }
        let turns = transcript.turns
        guard !turns.isEmpty else { return }
        let revision = transcript.revision
        if let brief, brief.revision == revision { return }

        let foldEnd = max(foldedCount, Self.tailStart(turns))
        let toFold = turns[min(foldedCount, foldEnd)..<foldEnd]
        let recent = turns[foldEnd...]

        let input = """
        ## Previous memory
        \(memory.isEmpty ? "(empty)" : memory)

        ## Older turns to fold into memory
        \(toFold.isEmpty ? "(none)" : Transcript.render(toFold))

        ## Recent conversation (most recent last)
        \(Transcript.render(recent))
        """

        let request = OpenAIClient.Request(
            model: config.contextModel,
            instructions: Prompts.contextInstructions(profile),
            parts: [.text(input)],
            serviceTier: config.contextTier,
            effort: config.contextEffort,
            maxOutputTokens: 4_000,
            promptCacheKey: "alfred-context",
            jsonSchema: (name: "alfred_context", schema: Prompts.contextSchema))

        isAnalyzing = true
        let epoch = epoch
        let started = Date.now
        runTask = Task { [weak self] in
            let result: Result<String, Error>
            do { result = .success(try await client.complete(request)) } catch { result = .failure(error) }
            guard let self, epoch == self.epoch else { return }
            self.runTask = nil
            self.isAnalyzing = false

            switch result {
            case .success(let text):
                guard let parsed = Self.parse(text) else {
                    self.lastError = "Context model returned unreadable JSON"
                    break
                }
                // Empty summary = "nothing folded, keep memory" (saves ~300 output tokens per pass).
                if !parsed.summary.isEmpty { self.memory = parsed.summary }
                self.foldedCount = foldEnd
                self.brief = Brief(openQuestion: parsed.openQuestion, kind: parsed.kind, revision: revision, updatedAt: .now)
                self.lastError = nil
                Log.llm.info("Context updated in \(Int(Date.now.timeIntervalSince(started) * 1000))ms (rev \(revision))")
            case .failure(let error):
                if error is CancellationError { return }
                self.lastError = error.localizedDescription
                Log.llm.error("Context update failed: \(error.localizedDescription, privacy: .public)")
                return  // don't loop on persistent failures; the next finalized turn retries
            }
            // Turns arrived while we were thinking — go again.
            if self.transcript.revision != revision { self.schedule() }
        }
    }

    struct Parsed: Equatable {
        var summary: String
        var openQuestion: String
        var kind: String
    }

    nonisolated static func parse(_ text: String) -> Parsed? {
        guard let data = text.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return Parsed(summary: json["summary"] as? String ?? "",
                      openQuestion: json["open_question"] as? String ?? "",
                      kind: json["kind"] as? String ?? "none")
    }
}
