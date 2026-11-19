import Foundation

/// A streaming LLM endpoint. Alfred talks to providers only through this, so the answer path and the
/// context path can each run on whichever provider/model benchmarks best.
protocol LLMClient: AnyObject {
    var providerName: String { get }
    func stream(_ req: LLMRequest) -> AsyncThrowingStream<LLMEvent, Error>
    func complete(_ req: LLMRequest) async throws -> String
    /// Opens (and keeps alive) the TLS/HTTP2 connection so the next request skips the handshake.
    func warmUp()
    /// Lets in-flight requests finish, then releases the session.
    func invalidate()
}

typealias LLMRequest = OpenAIClient.Request
typealias LLMEvent = OpenAIClient.StreamEvent
typealias LLMError = OpenAIClient.APIError

/// OpenAI Responses API client (`POST /v1/responses`) with SSE streaming.
final class OpenAIClient: LLMClient, @unchecked Sendable {
    var providerName: String { "OpenAI" }

    enum Part {
        case text(String)
        /// `lowDetail` lets the API downsample to 512 px — plenty for a yes/no decision, and faster.
        case image(dataURL: String, lowDetail: Bool = false)
    }

    /// An earlier turn of the same chat, sent before the current message.
    struct Message: Equatable {
        enum Role: String { case user, assistant }
        var role: Role
        var text: String
    }

    struct Request {
        var model: String
        var instructions: String
        var parts: [Part]
        /// Earlier exchanges of the chat (oldest first). Placed before the current message so the growing
        /// conversation stays a cacheable prefix.
        var history: [Message] = []
        var serviceTier: String?
        var effort: String?
        var maxOutputTokens: Int?
        var promptCacheKey: String?
        var jsonSchema: (name: String, schema: [String: Any])?

        func body(stream: Bool) -> [String: Any] {
            let content: [[String: Any]] = parts.map {
                switch $0 {
                case .text(let t): ["type": "input_text", "text": t]
                case .image(let url, let low): ["type": "input_image", "image_url": url, "detail": low ? "low" : "high"]
                }
            }
            var body: [String: Any] = [
                "model": model,
                "instructions": instructions,
                "input": history.map { ["role": $0.role.rawValue, "content": $0.text] } + [["role": "user", "content": content]],
                "stream": stream,
                "store": false,
            ]
            if let serviceTier { body["service_tier"] = serviceTier }
            if let effort { body["reasoning"] = ["effort": effort] }
            if let maxOutputTokens { body["max_output_tokens"] = maxOutputTokens }
            if let promptCacheKey { body["prompt_cache_key"] = promptCacheKey }
            if let jsonSchema {
                body["text"] = ["format": ["type": "json_schema", "name": jsonSchema.name,
                                           "schema": jsonSchema.schema, "strict": true]]
            }
            return body
        }
    }

    enum StreamEvent: Equatable {
        case delta(String)
        case completed(serviceTier: String?, cachedTokens: Int?, reasoningTokens: Int? = nil)
        case incomplete(reason: String)
    }

    struct APIError: LocalizedError {
        var status: Int
        var message: String
        var param: String?
        var provider = "OpenAI"
        var errorDescription: String? { status > 0 ? "\(provider) \(status): \(message)" : message }
        /// True when the request was rejected because of the requested service tier.
        var isTierRejection: Bool {
            (status == 400 || status == 403 || status == 404) &&
                (param == "service_tier" || message.localizedCaseInsensitiveContains("service_tier") ||
                 message.localizedCaseInsensitiveContains("service tier"))
        }
    }

    private let auth: ProviderAuth
    private let baseURL: URL
    private let session: URLSession

    init(auth: ProviderAuth, baseURL: URL) {
        self.auth = auth
        self.baseURL = baseURL
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 60
        config.httpMaximumConnectionsPerHost = 4
        config.waitsForConnectivity = false
        session = URLSession(configuration: config)
    }

    /// Lets in-flight requests finish, then releases the session.
    func invalidate() {
        session.finishTasksAndInvalidate()
    }

    /// Opens (and keeps alive) the TLS/HTTP2 connection so the first hotkey answer skips the handshake.
    func warmUp() {
        Task { [session, baseURL] in
            var request = URLRequest(url: baseURL.appendingPathComponent("models"))
            request.timeoutInterval = 10
            guard (try? await self.authorize(&request)) != nil else { return }
            _ = try? await session.data(for: request)
        }
    }

    /// A direct request carries the key; a hosted one carries the account's session for Manor's proxy.
    private func authorize(_ request: inout URLRequest) async throws {
        if case .apiKey(let key) = auth { request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization") }
        _ = try await auth.applyHosted(to: &request)
    }

    /// Non-streaming call; returns the concatenated output text.
    func complete(_ req: Request) async throws -> String {
        let (data, response) = try await session.data(for: try await urlRequest(req, stream: false))
        try Self.check(response, data: data)
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw APIError(status: 0, message: "Malformed response")
        }
        return Self.outputText(json)
    }

    /// Streaming call. Cancel the consuming Task to abort the HTTP request.
    func stream(_ req: Request) -> AsyncThrowingStream<StreamEvent, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    let (bytes, response) = try await session.bytes(for: try await urlRequest(req, stream: true))
                    if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                        var data = Data()
                        for try await b in bytes { data.append(b) }
                        try Self.check(response, data: data)
                    }
                    for try await line in bytes.lines {
                        if let event = try SSE.event(fromLine: line) {
                            continuation.yield(event)
                            if case .delta = event { continue }
                            break
                        }
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    private func urlRequest(_ req: Request, stream: Bool) async throws -> URLRequest {
        var request = URLRequest(url: baseURL.appendingPathComponent("responses"))
        request.httpMethod = "POST"
        try await authorize(&request)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if stream { request.setValue("text/event-stream", forHTTPHeaderField: "Accept") }
        request.httpBody = try JSONSerialization.data(withJSONObject: req.body(stream: stream))
        return request
    }

    private static func check(_ response: URLResponse, data: Data) throws {
        guard let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) else { return }
        let err = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? [String: Any]
        throw APIError(status: http.statusCode,
                       message: err?["message"] as? String ?? HTTPURLResponse.localizedString(forStatusCode: http.statusCode),
                       param: err?["param"] as? String)
    }

    static func outputText(_ response: [String: Any]) -> String {
        let output = response["output"] as? [[String: Any]] ?? []
        return output
            .filter { $0["type"] as? String == "message" }
            .flatMap { $0["content"] as? [[String: Any]] ?? [] }
            .filter { $0["type"] as? String == "output_text" }
            .compactMap { $0["text"] as? String }
            .joined()
    }
}

/// Server-sent-event decoding for the Responses API stream.
enum SSE {
    static func event(fromLine line: String) throws -> OpenAIClient.StreamEvent? {
        guard line.hasPrefix("data:") else { return nil }
        let payload = line.dropFirst(5).trimmingCharacters(in: .whitespaces)
        guard payload != "[DONE]", let data = payload.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = json["type"] as? String else { return nil }

        switch type {
        case "response.output_text.delta":
            return (json["delta"] as? String).map { .delta($0) }
        case "response.completed":
            let response = json["response"] as? [String: Any]
            let usage = response?["usage"] as? [String: Any]
            let cached = (usage?["input_tokens_details"] as? [String: Any])?["cached_tokens"] as? Int
            let reasoning = (usage?["output_tokens_details"] as? [String: Any])?["reasoning_tokens"] as? Int
            return .completed(serviceTier: response?["service_tier"] as? String, cachedTokens: cached, reasoningTokens: reasoning)
        case "response.incomplete":
            let details = (json["response"] as? [String: Any])?["incomplete_details"] as? [String: Any]
            return .incomplete(reason: details?["reason"] as? String ?? "incomplete")
        case "response.failed":
            let err = (json["response"] as? [String: Any])?["error"] as? [String: Any]
            throw OpenAIClient.APIError(status: 0, message: err?["message"] as? String ?? "Response failed")
        case "error":
            let err = json["error"] as? [String: Any] ?? json
            throw OpenAIClient.APIError(status: 0, message: err["message"] as? String ?? "Stream error",
                                        param: err["param"] as? String)
        default:
            return nil
        }
    }
}
