import Foundation

/// How a request reaches a model provider: straight to the provider with a key (development builds with a key in an
/// env file), or through Manor's `alfred-proxy` function with the signed-in account's session, which adds Manor's
/// own keys on the server. Shipped builds hold no provider keys.
enum ProviderAuth: @unchecked Sendable {
    case apiKey(String)
    case hosted(publishableKey: String, token: @Sendable () async throws -> String)

    /// Supabase's gateway headers for a hosted request; a direct request sets its provider's own key header.
    func applyHosted(to request: inout URLRequest) async throws -> Bool {
        guard case .hosted(let publishableKey, let token) = self else { return false }
        request.setValue("Bearer \(try await token())", forHTTPHeaderField: "Authorization")
        request.setValue(publishableKey, forHTTPHeaderField: "apikey")
        return true
    }
}

/// Manor's `alfred-proxy` endpoint, read from the app's Info.plist (`ManorSupabaseURL`, `ManorSupabaseKey`).
struct HostedEndpoint: Equatable {
    /// `https://<project>.supabase.co/functions/v1/alfred-proxy`
    let base: URL
    let publishableKey: String

    var anthropic: URL { base.appendingPathComponent("anthropic") }
    var openAI: URL { base.appendingPathComponent("openai") }
    var deepgramToken: URL { base.appendingPathComponent("deepgram").appendingPathComponent("token") }

    init(base: URL, publishableKey: String) {
        self.base = base
        self.publishableKey = publishableKey
    }

    init?(info: [String: Any]?) {
        guard let url = (info?["ManorSupabaseURL"] as? String).flatMap(URL.init(string:)),
              let key = info?["ManorSupabaseKey"] as? String, !key.isEmpty else { return nil }
        self.init(base: url.appendingPathComponent("functions/v1/alfred-proxy"), publishableKey: key)
    }

    /// The signed-in account's access token, set by the host app while someone is signed in.
    nonisolated(unsafe) static var token: (@Sendable () async throws -> String)?

    /// A short-lived Deepgram token for one listening connection.
    func deepgramAuthorization() async throws -> String {
        guard let token = Self.token else { throw LLMError(status: 401, message: "Sign in to Manor to use Alfred.", provider: "Manor") }
        var request = URLRequest(url: deepgramToken)
        request.httpMethod = "POST"
        request.timeoutInterval = 15
        _ = try await ProviderAuth.hosted(publishableKey: publishableKey, token: token).applyHosted(to: &request)
        let (data, response) = try await URLSession.shared.data(for: request)
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        guard let http = response as? HTTPURLResponse, http.statusCode == 200, let access = json?["access_token"] as? String else {
            let message = (json?["error"] as? [String: Any])?["message"] as? String ?? "Alfred couldn't start listening."
            throw LLMError(status: (response as? HTTPURLResponse)?.statusCode ?? 0, message: message, provider: "Manor")
        }
        return "Bearer \(access)"
    }
}
