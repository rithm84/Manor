import Foundation

/// OpenAI-compatible Chat Completions client (`POST {base}/chat/completions`, SSE) — Nebius Token Factory,
/// and any other compatible host. Maps Alfred's request model onto chat messages:
/// instructions → system, parts → user content, effort → `reasoning_effort` ("none" disables thinking),
/// tier → `service_tier`, JSON schema → `response_format`.
final class ChatCompletionsClient: LLMClient, @unchecked Sendable {
    let providerName: String
    private let apiKey: String
    private let baseURL: URL
    private let session: URLSession

    init(apiKey: String, baseURL: URL, providerName: String) {
        self.apiKey = apiKey
        self.baseURL = baseURL
        self.providerName = providerName
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 60
        config.httpMaximumConnectionsPerHost = 4
        session = URLSession(configuration: config)
    }

    func invalidate() { session.finishTasksAndInvalidate() }

    func warmUp() {
        var request = URLRequest(url: baseURL.appendingPathComponent("models"))
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 10
        session.dataTask(with: request) { _, _, _ in }.resume()
    }

    static func body(_ req: LLMRequest, stream: Bool) -> [String: Any] {
        let hasImage = req.parts.contains { if case .image = $0 { true } else { false } }
        let content: Any = hasImage
            ? req.parts.map { part -> [String: Any] in
                switch part {
                case .text(let t): ["type": "text", "text": t]
                case .image(let url, _): ["type": "image_url", "image_url": ["url": url]]
                }
            }
            : req.parts.compactMap { if case .text(let t) = $0 { t } else { nil } }.joined(separator: "\n\n")
        var body: [String: Any] = [
            "model": req.model,
            "messages": [["role": "system", "content": req.instructions]]
                + req.history.map { ["role": $0.role.rawValue, "content": $0.text] }
                + [["role": "user", "content": content]],
            "stream": stream,
        ]
        if stream { body["stream_options"] = ["include_usage": true] }
        if let t = req.serviceTier { body["service_tier"] = t }
        if let e = req.effort { body["reasoning_effort"] = e }
        if let m = req.maxOutputTokens { body["max_tokens"] = m }
        if let schema = req.jsonSchema {
            body["response_format"] = ["type": "json_schema",
                                       "json_schema": ["name": schema.name, "schema": schema.schema, "strict": true]]
        }
        return body
    }

    func complete(_ req: LLMRequest) async throws -> String {
        let (data, response) = try await session.data(for: try urlRequest(req, stream: false))
        try check(response, data: data)
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        let message = ((json?["choices"] as? [[String: Any]])?.first?["message"]) as? [String: Any]
        return message?["content"] as? String ?? ""
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
                    var usage: [String: Any]?
                    var tier: String?
                    var finish: String?
                    for try await line in bytes.lines {
                        guard line.hasPrefix("data:") else { continue }
                        let payload = line.dropFirst(5).trimmingCharacters(in: .whitespaces)
                        if payload == "[DONE]" { break }
                        guard let json = try? JSONSerialization.jsonObject(with: Data(payload.utf8)) as? [String: Any] else { continue }
                        if let err = json["error"] as? [String: Any] {
                            throw LLMError(status: 0, message: err["message"] as? String ?? "Stream error", provider: providerName)
                        }
                        if let u = json["usage"] as? [String: Any] { usage = u }
                        if let t = json["service_tier"] as? String { tier = t }
                        for choice in json["choices"] as? [[String: Any]] ?? [] {
                            if let delta = choice["delta"] as? [String: Any], let text = delta["content"] as? String, !text.isEmpty {
                                continuation.yield(.delta(text))   // reasoning_content is never shown
                            }
                            if let f = choice["finish_reason"] as? String { finish = f }
                        }
                    }
                    if finish == "length" {
                        continuation.yield(.incomplete(reason: "max_output_tokens"))
                    } else {
                        let cached = (usage?["prompt_tokens_details"] as? [String: Any])?["cached_tokens"] as? Int
                        let reasoning = (usage?["completion_tokens_details"] as? [String: Any])?["reasoning_tokens"] as? Int
                        continuation.yield(.completed(serviceTier: tier, cachedTokens: cached, reasoningTokens: reasoning))
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    private func urlRequest(_ req: LLMRequest, stream: Bool) throws -> URLRequest {
        var request = URLRequest(url: baseURL.appendingPathComponent("chat/completions"))
        request.httpMethod = "POST"
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if stream { request.setValue("text/event-stream", forHTTPHeaderField: "Accept") }
        request.httpBody = try JSONSerialization.data(withJSONObject: Self.body(req, stream: stream))
        return request
    }

    private func check(_ response: URLResponse, data: Data) throws {
        guard let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) else { return }
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        let err = json?["error"] as? [String: Any]
        let message = err?["message"] as? String ?? (json?["detail"] as? String) ?? HTTPURLResponse.localizedString(forStatusCode: http.statusCode)
        throw LLMError(status: http.statusCode, message: message, param: err?["param"] as? String, provider: providerName)
    }
}
