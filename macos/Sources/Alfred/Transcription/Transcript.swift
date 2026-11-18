import Foundation

enum Speaker: String, Codable, CaseIterable {
    /// System audio — the interviewer / other participants.
    case them
    /// Microphone — the user.
    case me

    var label: String { self == .them ? "Them" : "You" }
    var promptTag: String { self == .them ? "THEM" : "ME" }
}

struct Turn: Identifiable, Equatable {
    let id: UUID
    let speaker: Speaker
    var text: String
    let start: Date
    var end: Date

    init(speaker: Speaker, text: String, start: Date = .now, end: Date = .now) {
        id = UUID()
        self.speaker = speaker
        self.text = text
        self.start = start
        self.end = end
    }
}

/// Speaker-labelled conversation, fed by two independent Flux streams.
@MainActor
final class Transcript: ObservableObject {
    @Published private(set) var turns: [Turn] = []
    @Published private(set) var live: [Speaker: Turn] = [:]
    /// Bumps whenever finalized content changes. Used to detect stale background analysis.
    private(set) var revision = 0
    /// Revision at which THEM last finalized a turn (a new question invalidates earlier prepared notes).
    private(set) var lastThemRevision = 0
    /// Mic turns dropped as speaker echo (diagnostics).
    private(set) var echoesDropped = 0

    /// Called after a turn is finalized (possibly merged into the previous one).
    var onFinalized: ((Turn) -> Void)?

    /// Same-speaker turns closer than this are merged into one paragraph.
    static let mergeGap: TimeInterval = 2.0

    var isEmpty: Bool { turns.isEmpty && live.isEmpty }

    func partial(_ speaker: Speaker, _ text: String) {
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { live[speaker] = nil; return }
        if var turn = live[speaker] {
            turn.text = text
            turn.end = .now
            live[speaker] = turn
        } else {
            live[speaker] = Turn(speaker: speaker, text: text)
        }
    }

    func finalize(_ speaker: Speaker, _ text: String) {
        var text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let started = live[speaker]?.start ?? .now
        live[speaker] = nil
        guard !text.isEmpty else { return }

        if speaker == .me {
            // Strip speaker echo of the interviewer; keep whatever the user actually said.
            let candidates = recentThemTexts()
            if !candidates.isEmpty {
                guard let cleaned = Self.stripEcho(text, against: candidates) else {
                    echoesDropped += 1
                    Log.stt.debug("Dropped mic echo: \(text, privacy: .private)")
                    return
                }
                if cleaned != text { echoesDropped += 1 }
                text = cleaned
            }
        }
        if speaker == .them { removeEchoes(of: text) }

        let now = Date.now
        if var last = turns.last, last.speaker == speaker, started.timeIntervalSince(last.end) < Self.mergeGap {
            last.text += " " + text
            last.end = now
            turns[turns.count - 1] = last
        } else {
            turns.append(Turn(speaker: speaker, text: text, start: started, end: now))
        }
        revision += 1
        if speaker == .them { lastThemRevision = revision }
        onFinalized?(turns[turns.count - 1])
    }

    func clearLive(_ speaker: Speaker) {
        live[speaker] = nil
    }

    func reset() {
        turns = []
        live = [:]
        revision += 1
    }

    // MARK: - Speaker echo (no headphones)
    //
    // Without headphones the mic also hears the call through the speakers. System audio is the clean,
    // authoritative copy of THEM, so a mic turn that mirrors recent system audio is dropped. This is
    // text-level only: Alfred never alters, ducks or processes anyone's audio. With headphones there is
    // no echo, so this never triggers.

    nonisolated static let echoWindow: TimeInterval = 6
    nonisolated static let echoThreshold = 0.6

    /// THEM speech recent enough to have leaked into the mic.
    private func recentThemTexts() -> [String] {
        let cutoff = Date.now.addingTimeInterval(-Self.echoWindow)
        var candidates = turns.suffix(4).filter { $0.speaker == .them && $0.end > cutoff }.map(\.text)
        if let liveThem = live[.them] { candidates.append(liveThem.text) }
        return candidates
    }

    /// Removes runs of ≥ 4 words that mirror the interviewer (speaker echo) from a mic utterance.
    /// Returns nil when what's left isn't real speech (< 3 words). A mic turn can mix the user's own words
    /// with echo when Flux doesn't end the turn between them — dropping it whole would lose the user's words.
    nonisolated static func stripEcho(_ text: String, against themTexts: [String]) -> String? {
        // Per-token normalization keeps contractions whole ("That's" → "thats") on both sides.
        func token(_ w: Substring) -> String { String(w.lowercased().unicodeScalars.filter { CharacterSet.alphanumerics.contains($0) }) }
        let tokens = text.split(separator: " ").map(String.init)
        let norm = tokens.map { token(Substring($0)) }
        let themWords = Set(themTexts.flatMap { $0.split(separator: " ").map(token) }.filter { !$0.isEmpty })
        guard !tokens.isEmpty, !themWords.isEmpty else { return text }
        // A word is echo-like if it, and most of its ±2 neighbourhood, appear in recent THEM speech.
        var flag = [Bool](repeating: false, count: tokens.count)
        for i in tokens.indices where themWords.contains(norm[i]) || norm[i].isEmpty {
            let window = norm[max(0, i - 2)...min(tokens.count - 1, i + 2)].filter { !$0.isEmpty }
            let hits = window.filter { themWords.contains($0) }.count
            flag[i] = !window.isEmpty && Double(hits) / Double(window.count) >= 0.8
        }
        // Only remove runs long enough to be echo rather than coincidental shared words.
        var keep = [Bool](repeating: true, count: tokens.count)
        var i = 0
        while i < tokens.count {
            guard flag[i] else { i += 1; continue }
            var j = i
            while j < tokens.count, flag[j] { j += 1 }
            if j - i >= 4 {
                // Extend over adjacent interviewer words at the edges (window ratios dip near boundaries).
                var a = i, b = j
                while a > 0, themWords.contains(norm[a - 1]) || norm[a - 1].isEmpty { a -= 1 }
                while b < tokens.count, themWords.contains(norm[b]) || norm[b].isEmpty { b += 1 }
                for k in a..<b { keep[k] = false }
                j = b
            }
            i = j
        }
        let kept = tokens.indices.filter { keep[$0] }.map { tokens[$0] }
            .filter { !["--", "—", "-"].contains($0) }
        guard kept.filter({ !normalized($0).isEmpty }).count >= 3 else { return nil }
        let result = kept.joined(separator: " ")
        // Whole-utterance mirror check (short echoes the run rule can't see).
        if themTexts.contains(where: { similarity(result, $0) > echoThreshold }) { return nil }
        return result.trimmingCharacters(in: CharacterSet(charactersIn: " -—,"))
    }

    /// Mic turn finalized *before* the matching system-audio turn: retract it now.
    private func removeEchoes(of themText: String) {
        let cutoff = Date.now.addingTimeInterval(-Self.echoWindow)
        let lower = max(0, turns.count - 4)
        for i in turns[lower...].indices.reversed() where turns[i].speaker == .me && turns[i].end > cutoff {
            guard let cleaned = Self.stripEcho(turns[i].text, against: [themText]) else {
                turns.remove(at: i)
                echoesDropped += 1
                continue
            }
            if cleaned != turns[i].text { turns[i].text = cleaned; echoesDropped += 1 }
        }
    }

    /// Fraction of the (shorter) mic utterance's words that also appear in the system-audio text.
    nonisolated static func similarity(_ a: String, _ b: String) -> Double {
        func words(_ s: String) -> Set<String> {
            Set(s.lowercased().split { !$0.isLetter && !$0.isNumber }.map(String.init))
        }
        let wa = words(a), wb = words(b)
        guard wa.count >= 3, !wb.isEmpty else { return 0 }
        return Double(wa.intersection(wb).count) / Double(wa.count)
    }

    /// The most recent thing THEM said (live partial first), reduced to its last question when there is one.
    var latestThemPrompt: String? {
        // Flux may split one question across turns ("…contains a cycle?" + "Walk me through your approach."),
        // so look at the last finalized THEM turn plus whatever is still being said.
        let last = turns.last(where: { $0.speaker == .them })?.text
        let combined = [last, live[.them]?.text].compactMap { $0 }.joined(separator: " ")
        return combined.isEmpty ? nil : Self.lastQuestion(in: combined)
    }

    nonisolated static func lastQuestion(in text: String) -> String {
        // Split into sentences; prefer the last one that is a question, plus the sentence before it if short.
        var sentences: [String] = []
        text.enumerateSubstrings(in: text.startIndex..., options: .bySentences) { s, _, _, _ in
            if let s = s?.trimmingCharacters(in: .whitespacesAndNewlines), !s.isEmpty { sentences.append(s) }
        }
        guard !sentences.isEmpty else { return text }
        if let qi = sentences.lastIndex(where: { $0.hasSuffix("?") }) {
            var q = sentences[qi]
            if qi > 0, sentences[qi - 1].count < 90, q.count < 60 { q = sentences[qi - 1] + " " + q }
            return q
        }
        return sentences.suffix(2).joined(separator: " ")
    }

    /// Last finalized THEM turn + whatever THEM is still saying: what an answer would respond to.
    var latestThemText: String {
        [turns.last(where: { $0.speaker == .them })?.text, live[.them]?.text].compactMap { $0 }.joined(separator: " ")
    }

    /// What THEM is saying now, or said last.
    var currentThemUtterance: String {
        live[.them]?.text ?? turns.last(where: { $0.speaker == .them })?.text ?? ""
    }

    /// Lowercased alphanumerics, single-spaced — for comparing transcript snapshots.
    nonisolated static func normalized(_ s: String) -> String {
        s.lowercased().unicodeScalars.map { CharacterSet.alphanumerics.contains($0) ? String($0) : " " }.joined()
            .split(separator: " ").joined(separator: " ")
    }

    /// Words the user has said so far (finalized + live).
    var meWordCount: Int {
        (turns.filter { $0.speaker == .me }.map(\.text) + [live[.me]?.text ?? ""])
            .reduce(0) { $0 + $1.split(separator: " ").count }
    }

    nonisolated private static let questionCues = [
        "how would you", "how do you", "how did you", "how does", "how can", "how to", "what is", "what's", "what are",
        "what would", "what do you", "what did you", "why", "can you", "could you", "would you", "walk me through",
        "talk me through", "tell me about", "tell me", "explain", "describe", "design", "implement", "write a", "write me",
        "given", "suppose", "imagine", "let's say", "have you", "do you", "did you", "which", "when would", "where would",
        "compare", "difference between", "optimize", "solve", "find the", "return the", "what happens",
    ]

    /// Cheap gate for speculative answering: does this THEM turn ask the user something?
    nonisolated static func looksLikeQuestion(_ text: String) -> Bool {
        let t = text.lowercased()
        guard t.split(separator: " ").count >= 4 else { return t.contains("?") && t.count > 8 }
        if t.contains("?") { return true }
        return questionCues.contains { t.contains($0) }
    }

    /// Plain-text rendering for prompts: `THEM: …` / `ME: …`, live partials marked.
    nonisolated static func render(_ turns: some Sequence<Turn>, live: [Turn] = []) -> String {
        var lines = turns.map { "\($0.speaker.promptTag): \($0.text)" }
        lines += live.map { "\($0.speaker.promptTag) (still speaking): \($0.text)" }
        return lines.joined(separator: "\n")
    }

    func markdownExport() -> String {
        let fmt = DateFormatter()
        fmt.timeStyle = .medium
        return turns.map { "**\($0.speaker.label)** · \(fmt.string(from: $0.start))\n\n\($0.text)" }
            .joined(separator: "\n\n")
    }
}
