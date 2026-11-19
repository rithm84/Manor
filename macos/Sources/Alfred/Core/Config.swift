import Foundation

/// Provider configuration. Secrets never live in UserDefaults.
///
/// Shipped builds hold no provider keys: Alfred reaches every provider through Manor's `alfred-proxy` function with
/// the signed-in account's session. A provider key found in development settings overrides that for its provider.
/// Resolution order (first match wins per key):
///   1. Process environment
///   2. `~/Library/Application Support/Manor/Alfred/.env.local`
///   3. Debug builds only: `<repo>/macos/.env.local`, then `<repo>/macos/.env`, then the repository's own
///      `.env.local`. Release builds never read the checkout, so a staging or production build made on a developer's
///      Mac still goes through the proxy.

/// The two model providers Alfred uses: Anthropic for everything that reasons, OpenAI for the quick new-topic check.
enum LLMProvider: String, Equatable {
    /// Anthropic Messages API: answers, conversation memory, the Notes writer, and Alfred in Manor.
    case anthropic
    /// OpenAI Responses API: the new-topic router only.
    case openai

    var title: String {
        switch self {
        case .anthropic: "Anthropic"
        case .openai: "OpenAI"
        }
    }
}

struct Config: Equatable {
    var anthropicKey: String?
    var anthropicBaseURL: URL
    var openAIKey: String?
    var openAIBaseURL: URL

    /// Claude Opus 5.5 in fast mode for every reasoning path; thinking is always on, so low effort keeps it short.
    static let model = "claude-opus-5-5"

    /// Hotkey answer model (latency critical).
    var answerModel: String
    var answerTier: String?
    var answerEffort: String?
    /// Always-on context model (rolling memory, open-question detection).
    var contextModel: String
    var contextTier: String?
    var contextEffort: String?
    /// In-app Alfred acts in Manor through tool use on the answer model.
    var assistantModel: String { answerModel }
    var assistantTier: String? { answerTier }
    var assistantEffort: String? { answerEffort }
    /// Decides whether a ⌃⌥S screenshot shows a new problem (→ new chat tab). OpenAI only; "off" or no OpenAI key
    /// disables it.
    var routerModel: String?
    var routerTier: String?
    var routerEffort: String?
    var answerMaxOutputTokens: Int

    var deepgramKey: String?
    var deepgramModel: String
    var deepgramEOTThreshold: Double?
    var deepgramEagerEOTThreshold: Double?
    var deepgramEOTTimeoutMs: Int?
    var deepgramLanguageHints: [String]

    /// Files that contributed values, for display in Settings.
    var sources: [URL]
    /// Manor's proxy for this build, when the app's Info.plist names a Supabase project.
    var hosted: HostedEndpoint?
    /// Whether the host app has an account signed in, which the proxy requires.
    var signedIn = false

    var hasOpenAI: Bool { !(openAIKey ?? "").isEmpty }
    var hasAnthropic: Bool { !(anthropicKey ?? "").isEmpty }
    /// Requests can go through Manor's proxy.
    var isHosted: Bool { hosted != nil && signedIn }
    func key(for provider: LLMProvider) -> String? {
        switch provider {
        case .anthropic: anthropicKey
        case .openai: openAIKey
        }
    }
    func baseURL(for provider: LLMProvider) -> URL {
        switch provider {
        case .anthropic: anthropicBaseURL
        case .openai: openAIBaseURL
        }
    }

    /// How to reach a provider: its development key when one is set, otherwise Manor's proxy while signed in.
    func access(for provider: LLMProvider) -> (auth: ProviderAuth, baseURL: URL)? {
        if let key = key(for: provider), !key.isEmpty { return (.apiKey(key), baseURL(for: provider)) }
        guard let hosted, signedIn, let token = HostedEndpoint.token else { return nil }
        return (.hosted(publishableKey: hosted.publishableKey, token: token), provider == .anthropic ? hosted.anthropic : hosted.openAI)
    }

    /// A client for a provider, or nil when it can't be reached.
    func makeClient(for provider: LLMProvider) -> LLMClient? {
        guard let access = access(for: provider) else { return nil }
        switch provider {
        case .anthropic: return AnthropicClient(auth: access.auth, baseURL: access.baseURL)
        case .openai: return OpenAIClient(auth: access.auth, baseURL: access.baseURL)
        }
    }

    /// Identifies a provider's client, so a client is rebuilt only when how it connects changes.
    func clientID(for provider: LLMProvider) -> String? {
        if let key = key(for: provider), !key.isEmpty { return "\(provider.rawValue)|key|\(key.hashValue)|\(baseURL(for: provider))" }
        return isHosted ? "\(provider.rawValue)|hosted|\(hosted!.base)" : nil
    }

    /// The answer path is the one that must work for Alfred to be useful.
    var answerReady: Bool { hasAnthropic || isHosted }
    var hasDeepgram: Bool { !(deepgramKey ?? "").isEmpty || isHosted }

    static func load() -> Config {
        var files: [URL] = [Paths.userEnvFile]
        #if DEBUG
        if let repo = Paths.repoRoot {
            files.append(repo.appendingPathComponent(".env.local"))
            files.append(repo.appendingPathComponent(".env"))
            files.append(repo.deletingLastPathComponent().appendingPathComponent(".env.local"))
        }
        #endif

        var merged: [String: String] = [:]
        var sources: [URL] = []
        for file in files.reversed() {  // lowest priority first, later ones overwrite
            guard let text = try? String(contentsOf: file, encoding: .utf8) else { continue }
            merged.merge(EnvFile.parse(text)) { _, new in new }
            sources.insert(file, at: 0)
        }
        // The process environment wins (CI, self-tests).
        merged.merge(ProcessInfo.processInfo.environment) { _, env in env }

        var config = Config(values: merged, sources: sources)
        config.hosted = HostedEndpoint(info: Bundle.main.infoDictionary)
        config.signedIn = HostedEndpoint.token != nil
        return config
    }

    init(values v: [String: String], sources: [URL] = []) {
        func str(_ key: String) -> String? {
            guard let s = v[key]?.trimmingCharacters(in: .whitespaces), !s.isEmpty else { return nil }
            return s
        }
        /// Tier values: empty / "default" / "standard" means "don't send service_tier".
        func tier(_ key: String, _ fallback: String?) -> String? {
            guard let raw = str(key) else { return fallback }
            return ["default", "standard", "none"].contains(raw.lowercased()) ? nil : raw
        }

        anthropicKey = str("ANTHROPIC_API_KEY")
        // Alfred's base URLs end in the API version; a bare host (as other tools set it) gets /v1.
        anthropicBaseURL = str("ANTHROPIC_BASE_URL").flatMap(URL.init(string:)).map { ["", "/"].contains($0.path) ? $0.appendingPathComponent("v1") : $0 }
            ?? URL(string: "https://api.anthropic.com/v1")!
        openAIKey = str("OPENAI_API_KEY")
        openAIBaseURL = str("OPENAI_BASE_URL").flatMap(URL.init(string:)) ?? URL(string: "https://api.openai.com/v1")!

        // Benchmarked against the earlier GPT-6.1 Terra default (docs/arch-components/benchmarks.md): first answer text
        // in about 1.2 s, full coding answers in about 5 s, and a faster, more faithful memory pass than GPT-6 Luna.
        answerModel = str("ALFRED_ANSWER_MODEL") ?? Self.model
        answerTier = tier("ALFRED_ANSWER_TIER", "fast")
        answerEffort = str("ALFRED_ANSWER_EFFORT") ?? "low"
        contextModel = str("ALFRED_CONTEXT_MODEL") ?? Self.model
        contextTier = tier("ALFRED_CONTEXT_TIER", "fast")
        contextEffort = str("ALFRED_CONTEXT_EFFORT") ?? "low"
        // GPT-6 Luna on the priority tier, no reasoning: ~0.7 s for the yes/no with a low-detail screenshot.
        let router = str("ALFRED_ROUTER_MODEL") ?? "gpt-6-luna"
        routerModel = router.lowercased() == "off" ? nil : router
        routerTier = tier("ALFRED_ROUTER_TIER", "priority")
        routerEffort = str("ALFRED_ROUTER_EFFORT") ?? "none"
        answerMaxOutputTokens = str("ALFRED_ANSWER_MAX_TOKENS").flatMap(Int.init) ?? 6000

        deepgramKey = str("DEEPGRAM_API_KEY")
        deepgramModel = str("DEEPGRAM_MODEL") ?? "flux-general-en"
        deepgramEOTThreshold = str("DEEPGRAM_EOT_THRESHOLD").flatMap(Double.init)
        deepgramEagerEOTThreshold = str("DEEPGRAM_EAGER_EOT_THRESHOLD").flatMap(Double.init)
        deepgramEOTTimeoutMs = str("DEEPGRAM_EOT_TIMEOUT_MS").flatMap(Int.init)
        deepgramLanguageHints = (str("DEEPGRAM_LANGUAGE_HINTS") ?? "")
            .split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }

        self.sources = sources
    }
}

enum EnvFile {
    /// Minimal dotenv parser: `KEY=value`, optional `export`, quotes, `#` comments.
    static func parse(_ text: String) -> [String: String] {
        var out: [String: String] = [:]
        for rawLine in text.split(whereSeparator: \.isNewline) {
            var line = rawLine.trimmingCharacters(in: .whitespaces)
            if line.isEmpty || line.hasPrefix("#") { continue }
            if line.hasPrefix("export ") { line.removeFirst("export ".count) }
            guard let eq = line.firstIndex(of: "=") else { continue }
            let key = line[..<eq].trimmingCharacters(in: .whitespaces)
            var value = line[line.index(after: eq)...].trimmingCharacters(in: .whitespaces)
            if let q = value.first, q == "\"" || q == "'", value.count >= 2, value.last == q {
                value = String(value.dropFirst().dropLast())
            } else if let hash = value.range(of: " #") {
                value = value[..<hash.lowerBound].trimmingCharacters(in: .whitespaces)
            }
            if !key.isEmpty { out[key] = value }
        }
        return out
    }
}

enum Paths {
    static let support: URL = {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        // Per Mac, shared by Manor's production and staging builds: Application Support/Manor/Alfred.
        let dir = base.appendingPathComponent("Manor", isDirectory: true).appendingPathComponent("Alfred", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }()

    static var userEnvFile: URL { support.appendingPathComponent(".env.local") }
    static var sessions: URL {
        let dir = support.appendingPathComponent("Sessions", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    /// Source checkout root (dev builds). Derived from this file's compile-time path; nil if it no longer exists.
    static let repoRoot: URL? = {
        let url = URL(fileURLWithPath: #filePath)  // <repo>/macos/Sources/Alfred/Core/Config.swift → <repo>/macos
            .deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
        return FileManager.default.fileExists(atPath: url.appendingPathComponent("Package.swift").path) ? url : nil
    }()

}
