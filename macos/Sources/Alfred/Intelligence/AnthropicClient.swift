import Foundation

/// Anthropic Messages API client (`POST {base}/messages`, SSE). Maps Alfred's request model onto a Messages
/// request: instructions → a cached `system` block, history → earlier turns, parts → text and base64 image
/// blocks, effort → `output_config.effort` (thinking is always on for Claude Opus 5.5, so effort is what bounds it;
/// "none" and "minimal" map to `low`), the `fast` tier → `speed: "fast"`, and a JSON schema →
/// `output_config.format`. Thinking blocks are never shown: only text deltas reach Alfred.
final class AnthropicClient: LLMClient, @unchecked Sendable {
    var providerName: String { "Anthropic" }

    static let apiVersion = "2026-10-21"
    /// Server-side refusal fallback: a classifier decline is retried on the model Anthropic recommends.
    static let fallbackBeta = "server-side-fallback-2026-07-01"

    private let apiKey: String
    private let baseURL: URL
    private let session: URLSession

    init(apiKey: String, baseURL: URL) {
        self.apiKey = apiKey
        self.baseURL = baseURL
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 90
        config.httpMaximumConnectionsPerHost = 4
        config.waitsForConnectivity = false
        session = URLSession(configuration: config)
    }

    func invalidate() { session.finishTasksAndInvalidate() }

    func warmUp() {
        var request = URLRequest(url: baseURL.appendingPathComponent("models"))
        headers(&request)
        request.timeoutInterval = 10
        session.dataTask(with: request) { _, _, _ in }.resume()
    }

    /// Effort levels the Messages API accepts; anything lower than `low` (Alfred's "none" and "minimal") is `low`.
    static func effort(_ value: String?) -> String? {
        guard let value = value?.lowercased() else { return nil }
        return ["low", "medium", "high", "xhigh", "max"].contains(value) ? value : "low"
    }

    static func body(_ req: LLMRequest, stream: Bool) -> [String: Any] {
        var content: [[String: Any]] = []
        for part in req.parts {
            switch part {
            case .text(let t):
                content.append(["type": "text", "text": t])
            case .image(let url, _):
                if let image = imageSource(url) { content.append(["type": "image", "source": image]) }
            }
        }
        var messages: [[String: Any]] = req.history.map { ["role": $0.role.rawValue, "content": $0.text] }
        messages.append(["role": "user", "content": content])
        // Thinking counts toward max_tokens, so the reply's own cap gets room for it on top.
        let replyCap = req.maxOutputTokens ?? 4000
        var body: [String: Any] = [
            "model": req.model,
            "max_tokens": replyCap + 12_000,
            // The instructions are long and identical across requests: cache them so later answers start sooner.
            "system": [["type": "text", "text": req.instructions, "cache_control": ["type": "ephemeral"]]],
            "messages": messages,
            "stream": stream,
            "fallbacks": "default",
        ]
        var output: [String: Any] = [:]
        if let effort = effort(req.effort) { output["effort"] = effort }
        if let schema = req.jsonSchema { output["format"] = ["type": "json_schema", "schema": schema.schema] }
        if !output.isEmpty { body["output_config"] = output }
        if req.serviceTier?.lowercased() == "fast" { body["speed"] = "fast" }
        return body
    }

    /// `data:image/jpeg;base64,...` → a base64 image source.
    static func imageSource(_ dataURL: String) -> [String: Any]? {
        guard dataURL.hasPrefix("data:"), let comma = dataURL.firstIndex(of: ","),
              let semicolon = dataURL[..<comma].firstIndex(of: ";") else { return nil }
        let media = String(dataURL[dataURL.index(dataURL.startIndex, offsetBy: 5)..<semicolon])
        return ["type": "base64", "media_type": media, "data": String(dataURL[dataURL.index(after: comma)...])]
    }

    func complete(_ req: LLMRequest) async throws -> String {
        let (data, response) = try await session.data(for: try urlRequest(req, stream: false))
        try check(response, data: data)
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw LLMError(status: 0, message: "Malformed response", provider: providerName)
        }
        if json["stop_reason"] as? String == "refusal" { throw Self.refusal(provider: providerName) }
        let blocks = json["content"] as? [[String: Any]] ?? []
        return blocks.filter { $0["type"] as? String == "text" }.compactMap { $0["text"] as? String }.joined()
    }

    func stream(_ req: LLMRequest) -> AsyncThrowingStream<LLMEvent, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    let (bytes, response) = try await session.bytes(for: try urlRequest(req, stream: true))
                    if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                        var data = Data()
                        for try await b in bytes { data.append(b) }
                        try check(response, data: data)
                    }
                    var stop: String?
                    var cached: Int?
                    var speed: String?
                    for try await line in bytes.lines {
                        guard line.hasPrefix("data:") else { continue }
                        let payload = line.dropFirst(5).trimmingCharacters(in: .whitespaces)
                        guard let json = try? JSONSerialization.jsonObject(with: Data(payload.utf8)) as? [String: Any] else { continue }
                        switch json["type"] as? String {
                        case "content_block_delta":
                            // Only visible text: thinking deltas and fallback markers are not part of the answer.
                            if let delta = json["delta"] as? [String: Any], delta["type"] as? String == "text_delta",
                               let text = delta["text"] as? String, !text.isEmpty {
                                continuation.yield(.delta(text))
                            }
                        case "message_start":
                            let usage = (json["message"] as? [String: Any])?["usage"] as? [String: Any]
                            cached = usage?["cache_read_input_tokens"] as? Int
                            speed = usage?["speed"] as? String
                        case "message_delta":
                            if let s = (json["delta"] as? [String: Any])?["stop_reason"] as? String { stop = s }
                            if let s = (json["usage"] as? [String: Any])?["speed"] as? String { speed = s }
                        case "error":
                            let err = json["error"] as? [String: Any]
                            throw LLMError(status: 0, message: err?["message"] as? String ?? "Stream error", provider: providerName)
                        default:
                            break
                        }
                    }
                    switch stop {
                    case "refusal": throw Self.refusal(provider: providerName)
                    case "max_tokens": continuation.yield(.incomplete(reason: "max_output_tokens"))
                    default: continuation.yield(.completed(serviceTier: speed, cachedTokens: cached, reasoningTokens: nil))
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    private static func refusal(provider: String) -> LLMError {
        LLMError(status: 0, message: "Alfred couldn't answer that one. Try rephrasing the request.", provider: provider)
    }

    private func headers(_ request: inout URLRequest) {
        request.setValue(apiKey, forHTTPHeaderField: "x-api-key")
        request.setValue(Self.apiVersion, forHTTPHeaderField: "anthropic-version")
    }

    private func urlRequest(_ req: LLMRequest, stream: Bool) throws -> URLRequest {
        var request = URLRequest(url: baseURL.appendingPathComponent("messages"))
        request.httpMethod = "POST"
        headers(&request)
        request.setValue(Self.fallbackBeta, forHTTPHeaderField: "anthropic-beta")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if stream { request.setValue("text/event-stream", forHTTPHeaderField: "Accept") }
        request.httpBody = try JSONSerialization.data(withJSONObject: Self.body(req, stream: stream))
        return request
    }

    private func check(_ response: URLResponse, data: Data) throws {
        guard let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) else { return }
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        let err = json?["error"] as? [String: Any]
        let message = err?["message"] as? String ?? HTTPURLResponse.localizedString(forStatusCode: http.statusCode)
        // A rejected or rate-limited fast request is retried at standard speed, as a rejected OpenAI tier is.
        let speedIssue = message.localizedCaseInsensitiveContains("speed") || message.localizedCaseInsensitiveContains("fast mode")
        throw LLMError(status: http.statusCode, message: message, param: speedIssue ? "service_tier" : nil, provider: providerName)
    }
}
