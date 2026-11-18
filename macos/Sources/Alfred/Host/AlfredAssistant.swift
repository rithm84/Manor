import Foundation
import Observation

/// In-app Alfred: a conversation inside the host app that answers about it and acts in it through the host's
/// `AlfredToolbox`. Each message goes to the model with a fresh snapshot of the user's page; the model calls tools,
/// Alfred runs them (asking first for tools that can't be undone), shows each action as a row with Undo, and the
/// model's reply streams in after. The conversation stays in memory for the life of the assistant.
///
/// ```swift
/// let assistant = AlfredAssistant(appName: "Manor")
/// assistant.toolbox = manorToolbox
/// assistant.send("Check off the laundry and move the report to Friday")
/// ```
@MainActor @Observable
public final class AlfredAssistant {
    public enum EntryKind: Sendable, Equatable {
        /// What the user asked.
        case request
        /// Alfred's reply (Markdown with ```diagram and ```ui blocks), streaming while `isComplete` is false.
        case answer
        /// One action Alfred took in the app, with Undo when the tool gave one.
        case action
        /// A question before a tool that can't be undone; the user approves or declines it.
        case confirmation
        /// Why the request couldn't finish.
        case failure
    }

    public enum UndoState: Sendable, Equatable {
        case unavailable
        case available
        case working
        /// Undone; the text says what the undo did ("Reopened 2 tasks").
        case done(String)
        case failed(String)
    }

    @MainActor @Observable
    public final class Entry: Identifiable {
        public let id = UUID()
        public let kind: EntryKind
        public internal(set) var text: String
        public internal(set) var isComplete = true
        public internal(set) var isError = false
        public internal(set) var undoState: UndoState = .unavailable
        /// The confirm button's label ("End session").
        public internal(set) var actionLabel = ""
        /// Nil while a confirmation waits for the user.
        public internal(set) var approved: Bool?
        /// The error means the assistant has no key, so Settings fixes it.
        public internal(set) var needsKey = false

        @ObservationIgnored var undo: (@MainActor () async throws -> String)?
        @ObservationIgnored var resolve: ((Bool) -> Void)?

        init(_ kind: EntryKind, text: String) {
            self.kind = kind
            self.text = text
        }
    }

    public enum Phase: Sendable, Equatable {
        case idle
        /// Waiting for the model (before text arrives, and between tool rounds).
        case thinking
        /// Text is streaming.
        case writing
        /// Running tools, or waiting for the user to confirm one.
        case acting
    }

    /// A scripted turn for reviewing the dialog without a key: tool calls to run, then the reply to stream.
    public struct ScriptedTurn {
        public var calls: [(name: String, arguments: [String: Any])]
        public var reply: String
        public init(calls: [(name: String, arguments: [String: Any])] = [], reply: String) {
            self.calls = calls
            self.reply = reply
        }
    }

    public private(set) var entries: [Entry] = []
    public private(set) var phase: Phase = .idle
    /// The host's tools and page snapshots. Without one, Alfred answers but can't act.
    public var toolbox: AlfredToolbox?
    /// Debug builds may script turns instead of calling the model (`ALFRED_NOTES_DEMO`).
    public var script: ((String, AlfredAppSnapshot?) -> ScriptedTurn)?

    public var isWorking: Bool { phase != .idle }
    /// Whether a key for the assistant's provider is set.
    public var isAvailable: Bool { script != nil || !(config.openAIKey ?? "").isEmpty }
    public static let missingKeyMessage = "Add an OpenAI key in Settings, under Alfred, to ask Alfred here."

    private let appName: String
    /// Earlier turns, compacted to the request and what Alfred said and did.
    private var history: [[String: Any]] = []
    /// Things that happened since the last request (undos), told to the model with the next one.
    private var notes: [String] = []
    private var task: Task<Void, Never>?
    private var client: (id: String, client: OpenAIClient)?
    private var tierUnsupported = false

    static let maxRounds = 8
    static let historyLimit = 24

    public init(appName: String) {
        self.appName = appName
    }

    // MARK: Conversation

    /// Sends a message. Ignored while a request runs.
    public func send(_ text: String) {
        let prompt = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !prompt.isEmpty, !isWorking else { return }
        entries.append(Entry(.request, text: prompt))
        phase = .thinking
        task = Task { [weak self] in
            await self?.run(prompt)
            self?.finish()
        }
    }

    /// Stops the running request; what was done stays done.
    public func stop() {
        task?.cancel()
        task = nil
        for entry in entries where entry.kind == .confirmation && entry.approved == nil { decide(entry, approved: false) }
        finish()
    }

    /// Starts a new conversation.
    public func clear() {
        stop()
        entries = []
        history = []
        notes = []
    }

    public func undo(_ entry: Entry) {
        guard entry.undoState == .available, let undo = entry.undo else { return }
        entry.undoState = .working
        Task { [weak self] in
            do {
                let summary = try await undo()
                entry.undoState = .done(summary)
                self?.notes.append("The user pressed Undo on \u{201C}\(entry.text)\u{201D}: \(summary).")
            } catch {
                entry.undoState = .failed(error.localizedDescription)
            }
        }
    }

    /// Approves or declines a confirmation.
    public func decide(_ entry: Entry, approved: Bool) {
        guard entry.kind == .confirmation, entry.approved == nil else { return }
        entry.approved = approved
        let resolve = entry.resolve
        entry.resolve = nil
        resolve?(approved)
    }

    private func finish() {
        for entry in entries where entry.kind == .answer { entry.isComplete = true }
        phase = .idle
    }

    @discardableResult
    private func append(_ kind: EntryKind, _ text: String) -> Entry {
        let entry = Entry(kind, text: text)
        entries.append(entry)
        return entry
    }

    // MARK: Running a request

    private func run(_ prompt: String) async {
        let snapshot = await toolbox?.snapshot()
        if let script {
            await runScript(script(prompt, snapshot), prompt: prompt)
            return
        }
        let config = config
        guard let client = client(for: config) else {
            let failure = append(.failure, Self.missingKeyMessage)
            failure.needsKey = true
            return
        }
        var message = ""
        if !notes.isEmpty { message += "## Since your last reply\n" + notes.joined(separator: "\n") + "\n\n" }
        notes = []
        if let snapshot { message += "## Page: \(snapshot.page)\n\(snapshot.details)\n\n" }
        message += "## Request\n\(prompt)"
        var items: [[String: Any]] = [["role": "user", "content": message]]
        var replies: [String] = []
        var actions: [String] = []
        let tools = toolbox?.tools ?? []

        do {
            for _ in 0..<Self.maxRounds {
                try Task.checkCancellation()
                phase = .thinking
                var answer: Entry?
                var calls: [[String: Any]] = []
                var body = requestBody(config: config, input: history + items, tools: tools)
                do {
                    try await stream(client, body: body, items: &items, calls: &calls, answer: &answer)
                } catch let error as LLMError where error.isTierRejection && body["service_tier"] != nil {
                    tierUnsupported = true
                    body["service_tier"] = nil
                    answer?.text = ""
                    try await stream(client, body: body, items: &items, calls: &calls, answer: &answer)
                }
                if let answer {
                    answer.isComplete = true
                    if !answer.text.isEmpty { replies.append(answer.text) }
                }
                guard !calls.isEmpty else { break }
                phase = .acting
                for call in calls {
                    try Task.checkCancellation()
                    let output = await perform(call, tools: tools, actions: &actions)
                    items.append(["type": "function_call_output", "call_id": call["call_id"] as? String ?? "", "output": output])
                }
            }
        } catch is CancellationError {
        } catch let error as URLError where error.code == .cancelled {
        } catch {
            Log.llm.error("Assistant failed: \(error.localizedDescription, privacy: .public)")
            append(.failure, Self.readable(error))
        }
        remember(prompt: prompt, replies: replies, actions: actions)
    }

    /// Streams one model round: text into an answer entry, finished items into `items`, function calls into `calls`.
    private func stream(_ client: OpenAIClient, body: [String: Any], items: inout [[String: Any]], calls: inout [[String: Any]],
                        answer: inout Entry?) async throws {
        var finished = false
        for try await event in client.streamResponse(body) {
            try Task.checkCancellation()
            switch event {
            case .delta(let text):
                if answer == nil {
                    let entry = append(.answer, "")
                    entry.isComplete = false
                    answer = entry
                }
                answer?.text += text
                phase = .writing
            case .item(let item):
                items.append(item)
                if item["type"] as? String == "function_call" { calls.append(item) }
            case .completed:
                finished = true
            case .incomplete(let reason):
                throw LLMError(status: 0, message: "Alfred stopped early (\(reason)).")
            }
        }
        try Task.checkCancellation()
        if !finished { throw LLMError(status: 0, message: "The connection dropped before Alfred finished.") }
    }

    /// Runs one function call and returns its output for the model.
    private func perform(_ call: [String: Any], tools: [AlfredTool], actions: inout [String]) async -> String {
        let name = call["name"] as? String ?? ""
        let raw = call["arguments"] as? String ?? "{}"
        let arguments = (try? JSONSerialization.jsonObject(with: Data(raw.utf8))) as? [String: Any] ?? [:]
        return await perform(name, arguments: arguments, tools: tools, actions: &actions)
    }

    private func perform(_ name: String, arguments: [String: Any], tools: [AlfredTool], actions: inout [String]) async -> String {
        guard let toolbox, let tool = tools.first(where: { $0.name == name }) else { return "There is no tool named \(name)." }
        if let problem = tool.validate(arguments) { return "Those arguments don't work: \(problem). Fix them and call the tool again." }
        if let confirmation = tool.confirmation {
            let entry = append(.confirmation, confirmation.question)
            entry.actionLabel = confirmation.action
            let approved = await withCheckedContinuation { continuation in
                entry.resolve = { continuation.resume(returning: $0) }
            }
            guard approved else { return "The user chose not to do this. Don't try again unless they ask." }
        }
        let result = await toolbox.call(name, arguments: arguments)
        // Failures go back to the model, which explains them (or asks) in its reply; only real actions get a row.
        guard !result.isError else { return "Failed: \(result.output)" }
        if !result.isQuiet {
            let entry = append(.action, result.summary)
            entry.undo = result.undo
            entry.undoState = result.undo == nil ? .unavailable : .available
            actions.append(result.summary)
        }
        return result.output
    }

    /// Keeps the turn as the request and what Alfred said and did, so follow-ups have context.
    private func remember(prompt: String, replies: [String], actions: [String]) {
        var said = replies.joined(separator: "\n\n")
        if !actions.isEmpty { said += (said.isEmpty ? "" : "\n\n") + "Done in \(appName): " + actions.joined(separator: "; ") }
        history.append(["role": "user", "content": prompt])
        history.append(["role": "assistant", "content": said.isEmpty ? "(no reply)" : said])
        if history.count > Self.historyLimit { history.removeFirst(history.count - Self.historyLimit) }
    }

    private func runScript(_ turn: ScriptedTurn, prompt: String) async {
        var actions: [String] = []
        try? await Task.sleep(for: .milliseconds(900))
        if !turn.calls.isEmpty {
            phase = .acting
            for call in turn.calls {
                guard !Task.isCancelled else { return }
                _ = await perform(call.name, arguments: call.arguments, tools: toolbox?.tools ?? [], actions: &actions)
            }
        }
        guard !Task.isCancelled, !turn.reply.isEmpty else { return }
        let answer = append(.answer, "")
        answer.isComplete = false
        phase = .writing
        var index = turn.reply.startIndex
        while index < turn.reply.endIndex, !Task.isCancelled {
            let end = turn.reply.index(index, offsetBy: 10, limitedBy: turn.reply.endIndex) ?? turn.reply.endIndex
            answer.text += String(turn.reply[index..<end])
            index = end
            try? await Task.sleep(for: .milliseconds(25))
        }
        answer.isComplete = true
        remember(prompt: prompt, replies: [answer.text], actions: actions)
    }

    // MARK: Requests

    private func requestBody(config: Config, input: [[String: Any]], tools: [AlfredTool]) -> [String: Any] {
        let knowledge = KnowledgeStore.promptBlock(AlfredHost.shared.knowledge.docs)
        let extra = AlfredHost.shared.preferences.extraInstructions
        var body: [String: Any] = [
            "model": config.assistantModel,
            "instructions": Prompts.assistantInstructions(appName: appName, knowledge: knowledge, extra: extra),
            "input": input,
            "store": false,
            "max_output_tokens": config.answerMaxOutputTokens,
            "prompt_cache_key": "alfred-assistant",
        ]
        if !tools.isEmpty {
            body["tools"] = tools.map(\.definition)
            body["parallel_tool_calls"] = true
        }
        if let tier = config.assistantTier, !tierUnsupported { body["service_tier"] = tier }
        if let effort = config.assistantEffort, effort != "none" {
            body["reasoning"] = ["effort": effort]
            // Stateless requests carry the model's reasoning between tool rounds.
            body["include"] = ["reasoning.encrypted_content"]
        }
        return body
    }

    private var config: Config { AlfredHost.shared.currentState?.config ?? AlfredHost.shared.settings.config }

    private func client(for config: Config) -> OpenAIClient? {
        guard let key = config.openAIKey, !key.isEmpty else { return nil }
        let id = "\(key)|\(config.openAIBaseURL)"
        if let client, client.id == id { return client.client }
        client?.client.invalidate()
        let made = OpenAIClient(apiKey: key, baseURL: config.openAIBaseURL)
        client = (id, made)
        return made
    }

    static func readable(_ error: Error) -> String {
        if let error = error as? URLError {
            switch error.code {
            case .notConnectedToInternet, .networkConnectionLost, .cannotConnectToHost, .cannotFindHost, .timedOut:
                return "Alfred couldn't reach the network. Check your connection and try again."
            default: break
            }
        }
        if let error = error as? LLMError, error.status == 401 { return "OpenAI didn't accept the key. Check it in Settings, under Alfred." }
        return error.localizedDescription
    }
}
