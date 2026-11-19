import Foundation
import XCTest
@testable import Alfred

/// Answer benchmark against a live provider, skipped unless `ALFRED_BENCH_OUT` names an output folder. Each case
/// is built with Alfred's real instructions and `AnswerEngine.parts`, streamed, and timed; the answers and a
/// JSONL of measurements land in the folder for review.
///
///     ALFRED_BENCH_OUT=/tmp/bench ALFRED_BENCH_ENV=<repo>/.env.local \
///       ALFRED_BENCH_VARIANTS=low,medium [ALFRED_BENCH_IMAGE=<png>] [ALFRED_BENCH_CASES=coding_1971,...] \
///       swift test --package-path macos --filter AlfredBenchmarkTests
///
/// Variants are effort levels for Claude Opus 5.5 in fast mode; a `+direct` suffix adds the one-line
/// "answer directly" nudge to the instructions.
final class AlfredBenchmarkTests: XCTestCase {
    struct Case {
        let id: String
        var mode: AssistMode = .interview
        var assistant: AlfredMode = .interview
        let turns: [(Speaker, String)]
        var history: [OpenAIClient.Message] = []
        var typed: String?
        var screen = false
        /// What a good answer must do, for review.
        let expect: String
    }

    static let cases: [Case] = [
        Case(id: "coding_1971", turns: [
            (.them, "Okay, next question. You're given n vertices labeled 0 to n minus 1 and a list of undirected edges. Given a source and a destination, return true if there's a valid path between them. n is up to two times ten to the fifth, edges up to the same, no self loops or duplicate edges."),
        ], expect: "Names BFS/DFS (and union-find) alternatives at the top; diagram; commented code; complexity; edge cases last"),
        Case(id: "coding_rotten", turns: [
            (.them, "So you have an m by n grid where 0 is empty, 1 is a fresh orange, 2 is rotten. Every minute, fresh oranges next to rotten ones go rotten. Return the minimum minutes until no fresh orange is left, or minus 1 if that's impossible. Grid is at most ten by ten."),
        ], expect: "Multi-source BFS; diagram; generous comments; complexity; edge cases incl. no extra minute for last batch"),
        Case(id: "coding_clarify", turns: [
            (.them, "Alright, let's do a coding one. Write a function that finds the duplicate number in an array."),
        ], expect: "Clarify-first: 2 to 4 questions (range of values, exactly one duplicate, modify array, space), no code"),
        Case(id: "coding_followup", turns: [
            (.them, "Given an array of integers and a target, return the indices of the two numbers that add up to target."),
            (.me, "I'd use a hash map from value to index and check for the complement as I go, so it's one pass."),
            (.them, "Great. Can you do it without the extra space if the array is sorted?"),
        ], history: [
            .init(role: .user, text: "Two Sum: return indices of the two numbers that add to target"),
            .init(role: .assistant, text: "**Use one pass with a hash map: for each x, look up target - x among the values already seen.**"),
        ], expect: "Two pointers on the sorted array, O(1) space; answers only the follow-up"),
        Case(id: "coding_topk", turns: [
            (.them, "Given an integer array nums and an integer k, return the k most frequent elements. You can return them in any order. The answer is guaranteed unique, k is between 1 and the number of distinct elements."),
        ], expect: "Names heap vs bucket sort (and quickselect); one shown; correct complexity"),
        Case(id: "coding_lru", turns: [
            (.them, "Design an LRU cache. It has a capacity, get returns the value or minus one, put inserts or updates and evicts the least recently used key when it's over capacity. Both in O(1)."),
        ], expect: "Hash map + doubly linked list; diagram; code; O(1)"),
        Case(id: "technical", turns: [
            (.them, "What's the difference between a process and a thread?"),
        ], expect: "Precise answer first, reasoning, one concrete example; no code needed"),
        Case(id: "behavioral", turns: [
            (.them, "Tell me about a time you disagreed with a teammate and how you handled it."),
        ], expect: "STAR talking points grounded in the profile; no invented employers"),
        Case(id: "design_open", mode: .systemDesign, turns: [
            (.them, "Let's do a design question. Design a URL shortener."),
        ], expect: "Clarify-first: scale, read/write mix, custom aliases, expiry"),
        Case(id: "design_spec", mode: .systemDesign, turns: [
            (.them, "Design a URL shortener. Assume 100 million new URLs a month, a 100 to 1 read to write ratio, links never expire, and no custom aliases."),
        ], expect: "Requirements with numbers, API, data model, components, deep dive, trade-offs"),
        Case(id: "coding_screen", mode: .coding, turns: [
            (.them, "Take a look at the problem on your screen and walk me through how you'd solve it."),
        ], screen: true, expect: "Reads 01 Matrix from the screenshot; multi-source BFS from zeros; code in Python"),
        Case(id: "general_screen", assistant: .general, turns: [], typed: "What is this problem asking, in plain words?", screen: true,
             expect: "Explains the 01 Matrix problem on screen plainly"),
    ]

    func testAnswers() async throws {
        let env = ProcessInfo.processInfo.environment
        guard let out = env["ALFRED_BENCH_OUT"] else { throw XCTSkip("Set ALFRED_BENCH_OUT to run the answer benchmark") }
        let file = env["ALFRED_BENCH_ENV"].flatMap { try? String(contentsOfFile: $0, encoding: .utf8) } ?? ""
        // Only the file's provider settings: a shell can carry its own ANTHROPIC_* variables for other tools.
        let config = Config(values: EnvFile.parse(file).merging(env.filter { $0.key.hasPrefix("ALFRED_") }) { _, new in new })
        guard let key = config.anthropicKey else { throw XCTSkip("No ANTHROPIC_API_KEY") }
        let outDir = URL(fileURLWithPath: out, isDirectory: true)
        try FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)
        let variants = (env["ALFRED_BENCH_VARIANTS"] ?? "low").split(separator: ",").map(String.init)
        let only = env["ALFRED_BENCH_CASES"].flatMap { $0.isEmpty ? nil : Set($0.split(separator: ",").map(String.init)) }
        let repeats = Int(env["ALFRED_BENCH_REPEATS"] ?? "1") ?? 1
        let image = env["ALFRED_BENCH_IMAGE"].flatMap { FileManager.default.contents(atPath: $0) }
            .map { "data:image/png;base64," + $0.base64EncodedString() }

        var lines: [String] = []
        for variant in variants {
            for item in Self.cases where only?.contains(item.id) ?? true {
                if item.screen, image == nil { continue }
                for run in 0..<repeats {
                    let result = try await measure(item, variant: variant, key: key, config: config, image: image)
                    let name = "\(variant)-\(item.id)\(repeats > 1 ? "-\(run + 1)" : "")"
                    try result.text.write(to: outDir.appendingPathComponent("\(name).md"), atomically: true, encoding: .utf8)
                    var row = result.metrics
                    row["case"] = item.id
                    row["variant"] = variant
                    row["expect"] = item.expect
                    let json = try JSONSerialization.data(withJSONObject: row, options: [.sortedKeys])
                    lines.append(String(decoding: json, as: UTF8.self))
                    print("BENCH \(String(decoding: json, as: UTF8.self))")
                }
            }
        }
        try (lines.joined(separator: "\n") + "\n").write(to: outDir.appendingPathComponent("results.jsonl"), atomically: true, encoding: .utf8)
    }

    /// The background memory pass on each candidate model: same prompt, schema, and transcripts.
    func testContext() async throws {
        let env = ProcessInfo.processInfo.environment
        guard let out = env["ALFRED_BENCH_OUT"], env["ALFRED_BENCH_CONTEXT"] != nil else { throw XCTSkip("Set ALFRED_BENCH_OUT and ALFRED_BENCH_CONTEXT") }
        let file = env["ALFRED_BENCH_ENV"].flatMap { try? String(contentsOfFile: $0, encoding: .utf8) } ?? ""
        let config = Config(values: EnvFile.parse(file))
        let outDir = URL(fileURLWithPath: out, isDirectory: true)
        try FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)
        let profile = Prompts.Profile(mode: .interview, language: "Python", knowledge: "", role: "Software engineer intern loop at a large tech company", extra: "")
        let transcripts: [(String, String, String)] = [
            ("fold", "Interviewer is Priya, a staff engineer on the payments team. Problem: merge intervals. ME explained sorting by start, then merging overlaps; Priya agreed. ME mentioned O(n log n).",
             """
             THEM: Okay, nice. So that works. Let's switch gears a little. Tell me about a project you're proud of where you had to make a tradeoff under time pressure.
             ME: Sure, so last summer at my internship I built a feature flag service, and we had about two weeks
             THEM: Mm-hm.
             """),
            ("coding", "",
             """
             THEM: Hi, thanks for joining. I'm Dev, I work on search infra. Let's jump into a coding question.
             ME: Sounds good.
             THEM: Given a string s, find the length of the longest substring without repeating characters. s can be up to fifty thousand characters, letters, digits, symbols and spaces.
             ME: Okay, so my first thought is a sliding window with a set, where I expand the right side
             THEM: Right. What happens when you hit a repeat?
             """),
            ("smalltalk", "",
             """
             THEM: Can you hear me okay?
             ME: Yep, loud and clear. How's your day going?
             THEM: Pretty good, busy week with the launch. Give me one second to pull up the doc.
             """),
        ]
        var rows: [String] = []
        for (id, memory, recent) in transcripts {
            let input = "## Previous memory\n\(memory.isEmpty ? "(empty)" : memory)\n\n## Older turns to fold into memory\n(none)\n\n## Recent conversation (most recent last)\n\(recent)"
            for (label, provider, model, tier, effort) in [("luna", LLMProvider.openai, "gpt-6-luna", "priority", "none"),
                                                         ("opus-fast", LLMProvider.anthropic, "claude-opus-5-5", "fast", "low")] {
                guard let client = config.makeClient(for: provider) else { continue }
                let request = OpenAIClient.Request(model: model, instructions: Prompts.contextInstructions(profile), parts: [.text(input)],
                                                   serviceTier: tier, effort: effort, maxOutputTokens: 4_000,
                                                   jsonSchema: (name: "alfred_context", schema: Prompts.contextSchema))
                let start = Date()
                let text: String
                do { text = try await client.complete(request) } catch { text = "ERROR \(error.localizedDescription)" }
                let row = "\(label)\t\(id)\t\((Date().timeIntervalSince(start) * 100).rounded() / 100)s\t\(text)"
                print("CONTEXT \(row)")
                rows.append(row)
            }
        }
        try rows.joined(separator: "\n").write(to: outDir.appendingPathComponent("context.tsv"), atomically: true, encoding: .utf8)
    }

    private func measure(_ item: Case, variant: String, key: String, config: Config, image: String?) async throws
        -> (text: String, metrics: [String: Any]) {
        let parts = variant.split(separator: "+").map(String.init)
        let effort = parts.first ?? "low"
        let profile = Prompts.Profile(mode: item.mode, language: "Python", knowledge: "", role: "Software engineer intern loop at a large tech company",
                                      extra: "", assistant: item.assistant)
        var instructions = Prompts.answerInstructions(profile)
        if parts.contains("direct") { instructions += "\n\nAnswer directly without deliberating." }
        let context = AssistContext(memory: "", turns: item.turns.map { Turn(speaker: $0.0, text: $0.1) }, live: [], brief: nil, briefIsFresh: false,
                                    history: item.history, typed: item.typed, screenshot: item.screen ? image : nil,
                                    screenApp: item.screen ? "Manor" : nil, screenTitle: item.screen ? "542. 01 Matrix" : nil,
                                    general: item.assistant == .general)
        let request = OpenAIClient.Request(model: "claude-opus-5-5", instructions: instructions, parts: AnswerEngine.parts(for: context),
                                           history: item.history, serviceTier: "fast", effort: effort,
                                           maxOutputTokens: config.answerMaxOutputTokens)
        var urlRequest = URLRequest(url: config.anthropicBaseURL.appendingPathComponent("messages"))
        urlRequest.httpMethod = "POST"
        urlRequest.setValue(key, forHTTPHeaderField: "x-api-key")
        urlRequest.setValue(AnthropicClient.apiVersion, forHTTPHeaderField: "anthropic-version")
        urlRequest.setValue(AnthropicClient.fallbackBeta, forHTTPHeaderField: "anthropic-beta")
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        urlRequest.httpBody = try JSONSerialization.data(withJSONObject: AnthropicClient.body(request, stream: true))
        urlRequest.timeoutInterval = 120

        let start = Date()
        var firstEvent: Double?, firstText: Double?
        var text = ""
        var usage: [String: Any] = [:]
        var stop = ""
        let (bytes, response) = try await URLSession.shared.bytes(for: urlRequest)
        if let http = response as? HTTPURLResponse, http.statusCode != 200 {
            var data = Data()
            for try await b in bytes { data.append(b) }
            XCTFail("HTTP \(http.statusCode): \(String(decoding: data, as: UTF8.self))")
            return ("", [:])
        }
        for try await line in bytes.lines {
            guard line.hasPrefix("data:"),
                  let json = try? JSONSerialization.jsonObject(with: Data(line.dropFirst(5).utf8)) as? [String: Any] else { continue }
            let now = Date().timeIntervalSince(start)
            if firstEvent == nil, json["type"] as? String == "content_block_start" { firstEvent = now }
            switch json["type"] as? String {
            case "message_start":
                ((json["message"] as? [String: Any])?["usage"] as? [String: Any])?.forEach { usage[$0.key] = $0.value }
            case "content_block_delta":
                if let delta = json["delta"] as? [String: Any], delta["type"] as? String == "text_delta", let t = delta["text"] as? String {
                    if firstText == nil { firstText = now }
                    text += t
                }
            case "message_delta":
                if let s = (json["delta"] as? [String: Any])?["stop_reason"] as? String { stop = s }
                (json["usage"] as? [String: Any])?.forEach { usage[$0.key] = $0.value }
            default: break
            }
        }
        let total = Date().timeIntervalSince(start)
        var metrics: [String: Any] = [
            "first_event_s": round2(firstEvent ?? total), "first_text_s": round2(firstText ?? total), "total_s": round2(total),
            "stop": stop, "output_tokens": usage["output_tokens"] ?? 0,
            "thinking_tokens": (usage["output_tokens_details"] as? [String: Any])?["thinking_tokens"] ?? 0,
            "cache_read": usage["cache_read_input_tokens"] ?? 0, "input_tokens": usage["input_tokens"] ?? 0,
            "speed": usage["speed"] ?? "",
        ]
        metrics.merge(Self.checks(text)) { _, new in new }
        return (text, metrics)
    }

    private func round2(_ v: Double) -> Double { (v * 100).rounded() / 100 }

    /// Structural checks against the answer template.
    static func checks(_ text: String) -> [String: Any] {
        let fences = text.components(separatedBy: "```")
        var diagrams: [String] = []
        var code: [String] = []
        var prose = ""
        for (i, chunk) in fences.enumerated() {
            if i % 2 == 0 { prose += chunk; continue }
            let header = chunk.prefix { $0 != "\n" }
            let body = String(chunk.dropFirst(header.count))
            if header == "diagram" { diagrams.append(body) } else if header != "ui" { code.append(body) }
        }
        let firstLine = text.trimmingCharacters(in: .whitespacesAndNewlines).components(separatedBy: "\n").first ?? ""
        let codeLines = code.flatMap { $0.components(separatedBy: "\n") }.filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
        let stepComments = codeLines.filter { $0.range(of: #"^\s*(#|//)\s*\d+\."#, options: .regularExpression) != nil }.count
        let trailing = codeLines.filter { $0.range(of: #"\S.*\s(#|//)\s"#, options: .regularExpression) != nil
            && $0.range(of: #"^\s*(#|//)"#, options: .regularExpression) == nil }.count
        let structures = diagrams.map { DiagramParser.frames($0).last?.structures.count ?? 0 }
        let collisions = diagrams.map { DiagramAudit.collisions(source: $0).count }.reduce(0, +)
        return [
            "bold_first_line": firstLine.hasPrefix("**"),
            "words_outside_code": prose.split { $0.isWhitespace }.count,
            "diagrams": diagrams.count,
            "diagram_structures": structures,
            "diagram_collisions": collisions,
            "code_blocks": code.count,
            "code_lines": codeLines.count,
            "step_comments": stepComments,
            "trailing_comments": trailing,
            "complexity": text.contains("**Complexity"),
            "edge_cases": text.contains("**Edge cases"),
            "clarify": text.contains("Ask before solving"),
            "em_dash": text.contains("\u{2014}"),
        ]
    }
}

/// The Messages request Alfred sends to Anthropic.
final class AnthropicClientTests: XCTestCase {
    func testMapsAlfredRequestOntoMessages() throws {
        let request = OpenAIClient.Request(
            model: "claude-opus-5-5", instructions: "Be brief.",
            parts: [.text("Question"), .image(dataURL: "data:image/png;base64,AAAA")],
            history: [.init(role: .user, text: "Earlier"), .init(role: .assistant, text: "Answer")],
            serviceTier: "fast", effort: "none", maxOutputTokens: 6000,
            jsonSchema: (name: "brief", schema: ["type": "object"]))
        let body = AnthropicClient.body(request, stream: true)
        XCTAssertEqual(body["speed"] as? String, "fast")
        XCTAssertEqual(body["max_tokens"] as? Int, 18_000, "room for thinking on top of the reply cap")
        let output = try XCTUnwrap(body["output_config"] as? [String: Any])
        XCTAssertEqual(output["effort"] as? String, "low", "effort below low maps to low; thinking can't be turned off")
        XCTAssertEqual((output["format"] as? [String: Any])?["type"] as? String, "json_schema")
        let system = try XCTUnwrap(body["system"] as? [[String: Any]])
        XCTAssertNotNil(system.first?["cache_control"])
        let messages = try XCTUnwrap(body["messages"] as? [[String: Any]])
        XCTAssertEqual(messages.map { $0["role"] as? String }, ["user", "assistant", "user"])
        let content = try XCTUnwrap(messages.last?["content"] as? [[String: Any]])
        XCTAssertEqual(content.map { $0["type"] as? String }, ["text", "image"])
        XCTAssertEqual((content[1]["source"] as? [String: Any])?["media_type"] as? String, "image/png")
        XCTAssertNil(AnthropicClient.body(OpenAIClient.Request(model: "m", instructions: "", parts: []), stream: false)["speed"])
    }

    func testBaseURLGetsTheAPIVersion() {
        XCTAssertEqual(Config(values: ["ANTHROPIC_BASE_URL": "https://api.anthropic.com"]).anthropicBaseURL.absoluteString, "https://api.anthropic.com/v1")
        XCTAssertEqual(Config(values: [:]).anthropicBaseURL.absoluteString, "https://api.anthropic.com/v1")
        let config = Config(values: ["ANTHROPIC_API_KEY": "k"])
        XCTAssertEqual(config.answerModel, "claude-opus-5-5")
        XCTAssertEqual(config.answerTier, "fast")
        XCTAssertTrue(config.makeClient(for: .anthropic) is AnthropicClient)
    }
}

/// A live tool-use round trip for Alfred in Manor, skipped unless `ALFRED_BENCH_ASSISTANT` is set: the model must
/// look up a task, then complete it, across two tool rounds whose thinking blocks are sent back unchanged.
@MainActor
final class AlfredAssistantLiveTests: XCTestCase {
    final class FakeToolbox: AlfredToolbox {
        var calls: [(String, [String: Any])] = []
        let tools = [
            AlfredTool(name: "find_tasks", description: "Search the user's tasks by words in the title. Returns ids and titles.",
                       parameters: ["type": "object", "properties": ["query": ["type": "string"]], "required": ["query"], "additionalProperties": false]),
            AlfredTool(name: "complete_task", description: "Mark a task done by id.",
                       parameters: ["type": "object", "properties": ["id": ["type": "string"]], "required": ["id"], "additionalProperties": false]),
        ]
        func snapshot() async -> AlfredAppSnapshot { AlfredAppSnapshot(page: "Home", details: "Today: 2 tasks (ids hidden; search to find them).") }
        func call(_ name: String, arguments: [String: Any]) async -> AlfredToolResult {
            calls.append((name, arguments))
            switch name {
            case "find_tasks": return .found(#"[{"id": "t-42", "title": "Do the laundry"}, {"id": "t-7", "title": "Write the report"}]"#)
            case "complete_task": return .done("Completed \u{201C}Do the laundry\u{201D}")
            default: return .failed("Unknown tool")
            }
        }
    }

    func testCompletesATaskThroughTwoToolRounds() async throws {
        guard ProcessInfo.processInfo.environment["ALFRED_BENCH_ASSISTANT"] != nil else { throw XCTSkip("Set ALFRED_BENCH_ASSISTANT") }
        let toolbox = FakeToolbox()
        let assistant = AlfredAssistant(appName: "Manor")
        assistant.toolbox = toolbox
        XCTAssertTrue(assistant.isAvailable, "needs ANTHROPIC_API_KEY in an env file Alfred reads")
        let start = Date()
        assistant.send("Check off my laundry task")
        while assistant.isWorking, Date().timeIntervalSince(start) < 90 { try await Task.sleep(for: .milliseconds(100)) }
        let summary = assistant.entries.map { "\($0.kind): \($0.text)" }.joined(separator: "\n")
        print("ASSISTANT \(String(format: "%.1f", Date().timeIntervalSince(start))) s\n\(summary)")
        XCTAssertEqual(toolbox.calls.last?.0, "complete_task", summary)
        XCTAssertEqual(toolbox.calls.last?.1["id"] as? String, "t-42", summary)
        XCTAssertFalse(assistant.entries.contains { $0.kind == .failure }, summary)
        XCTAssertTrue(assistant.entries.contains { $0.kind == .answer && !$0.text.isEmpty }, summary)
    }
}
