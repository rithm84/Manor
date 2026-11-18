import Foundation

/// Provider configuration. Secrets never live in UserDefaults.
///
/// Resolution order (first match wins per key):
///   1. Process environment
///   2. Keys saved in Settings ▸ Alfred (Keychain, `KeyStore`)
///   3. `~/Library/Application Support/Manor/Alfred/.env.local`
///   4. `<repo>/macos/.env.local`, then `<repo>/macos/.env` (development builds)

/// LLM providers Alfred can route a role (answers / context) to.
enum LLMProvider: String, Equatable {
    /// OpenAI Responses API.
    case openai
    /// Nebius Token Factory (OpenAI-compatible Chat Completions).
    case nebius
    /// Fireworks AI (OpenAI-compatible Chat Completions; has an ultrafast DeepSeek router).
    case fireworks

    var title: String {
        switch self {
        case .openai: "OpenAI"
        case .nebius: "Nebius"
        case .fireworks: "Fireworks"
        }
    }
}

struct Config: Equatable {
    var openAIKey: String?
    var openAIBaseURL: URL
    var nebiusKey: String?
    var nebiusBaseURL: URL
    var fireworksKey: String?
    var fireworksBaseURL: URL

    /// Provider per role (ALFRED_ANSWER_PROVIDER / ALFRED_CONTEXT_PROVIDER).
    var answerProvider: LLMProvider
    var contextProvider: LLMProvider

    /// Always-on context model (rolling memory, open-question detection).
    var contextModel: String
    var contextTier: String?
    var contextEffort: String?

    /// Hotkey answer model (latency critical).
    var answerModel: String
    var answerTier: String?
    var answerEffort: String?
    /// Decides whether a ⌃⌥S screenshot shows a new problem (→ new chat tab). OpenAI only; "off" disables it.
    var routerModel: String?
    var routerTier: String?
    var routerEffort: String?
    var answerMaxOutputTokens: Int
    /// In-app Alfred acts in Manor through function calling on OpenAI's Responses API: the answer model when the
    /// answer provider is OpenAI, otherwise OpenAI's default.
    var assistantModel: String
    var assistantTier: String?
    var assistantEffort: String?

    var deepgramKey: String?
    var deepgramModel: String
    var deepgramEOTThreshold: Double?
    var deepgramEagerEOTThreshold: Double?
    var deepgramEOTTimeoutMs: Int?
    var deepgramLanguageHints: [String]

    /// Files that contributed values, for display in Settings.
    var sources: [URL]
    /// Keys that came from the Keychain (entered in Settings ▸ Providers).
    var appKeys: Set<String> = []

    var hasOpenAI: Bool { !(openAIKey ?? "").isEmpty }
    func key(for provider: LLMProvider) -> String? {
        switch provider {
        case .openai: openAIKey
        case .nebius: nebiusKey
        case .fireworks: fireworksKey
        }
    }
    func hasKey(for provider: LLMProvider) -> Bool { !(key(for: provider) ?? "").isEmpty }
    func baseURL(for provider: LLMProvider) -> URL {
        switch provider {
        case .openai: openAIBaseURL
        case .nebius: nebiusBaseURL
        case .fireworks: fireworksBaseURL
        }
    }
    /// The answer path is the one that must work for Alfred to be useful.
    var answerReady: Bool { hasKey(for: answerProvider) }
    var missingAnswerKey: String {
        switch answerProvider {
        case .openai: "OPENAI_API_KEY"
        case .nebius: "NEBIUS_TOKEN_FACTORY_API_KEY"
        case .fireworks: "FIREWORKS_API_KEY"
        }
    }

    static let nebiusDefaultModel = "deepseek-ai/DeepSeek-V4.1-Flash-1017"
    static let fireworksDefaultModel = "accounts/fireworks/routers/deepseek-v4p1-flash-1017-ultrafast"
    var hasDeepgram: Bool { !(deepgramKey ?? "").isEmpty }

    static func load() -> Config {
        var files: [URL] = [Paths.userEnvFile]
        if let repo = Paths.repoRoot {
            files.append(repo.appendingPathComponent(".env.local"))
            files.append(repo.appendingPathComponent(".env"))
        }

        var merged: [String: String] = [:]
        var sources: [URL] = []
        for file in files.reversed() {  // lowest priority first, later ones overwrite
            guard let text = try? String(contentsOf: file, encoding: .utf8) else { continue }
            merged.merge(EnvFile.parse(text)) { _, new in new }
            sources.insert(file, at: 0)
        }
        // Keys entered in the app beat env files; the process environment still wins (CI, self-tests).
        let appKeys = KeyStore.all
        merged.merge(appKeys) { _, app in app }
        merged.merge(ProcessInfo.processInfo.environment) { _, env in env }

        var config = Config(values: merged, sources: sources)
        config.appKeys = Set(appKeys.keys)
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

        openAIKey = str("OPENAI_API_KEY")
        openAIBaseURL = str("OPENAI_BASE_URL").flatMap(URL.init(string:)) ?? URL(string: "https://api.openai.com/v1")!
        nebiusKey = str("NEBIUS_TOKEN_FACTORY_API_KEY") ?? str("NEBIUS_API_KEY")
        nebiusBaseURL = str("NEBIUS_BASE_URL").flatMap(URL.init(string:)) ?? URL(string: "https://api.tokenfactory.nebius.com/v1")!
        fireworksKey = str("FIREWORKS_API_KEY")
        fireworksBaseURL = str("FIREWORKS_BASE_URL").flatMap(URL.init(string:)) ?? URL(string: "https://api.fireworks.ai/inference/v1")!

        answerProvider = LLMProvider(rawValue: (str("ALFRED_ANSWER_PROVIDER") ?? "").lowercased()) ?? .openai
        contextProvider = LLMProvider(rawValue: (str("ALFRED_CONTEXT_PROVIDER") ?? "").lowercased()) ?? .openai

        // Defaults per provider: GPT-6.1 Terra on OpenAI's fast tier for both
        // roles (Sol-level correctness, ~2-3 s answers, ~7x cheaper than Sol Ultrafast); DeepSeek V4.1
        // Flash on Nebius (default tier, reasoning off) and on the Fireworks ultrafast router (low reasoning).
        let model = str("ALFRED_MODEL") ?? "gpt-6.1-terra"
        func defaults(_ p: LLMProvider, answer: Bool) -> (model: String, tier: String?, effort: String) {
            switch p {
            case .openai: (model, "fast", "low")
            case .nebius: (Self.nebiusDefaultModel, nil, "none")
            case .fireworks: (Self.fireworksDefaultModel, nil, "low")
            }
        }
        let c = defaults(contextProvider, answer: false)
        contextModel = str("ALFRED_CONTEXT_MODEL") ?? c.model
        contextTier = tier("ALFRED_CONTEXT_TIER", c.tier)
        contextEffort = str("ALFRED_CONTEXT_EFFORT") ?? c.effort

        let a = defaults(answerProvider, answer: true)
        answerModel = str("ALFRED_ANSWER_MODEL") ?? a.model
        answerTier = tier("ALFRED_ANSWER_TIER", a.tier)
        answerEffort = str("ALFRED_ANSWER_EFFORT") ?? a.effort
        let o = defaults(.openai, answer: true)
        assistantModel = answerProvider == .openai ? answerModel : o.model
        assistantTier = answerProvider == .openai ? answerTier : o.tier
        assistantEffort = answerProvider == .openai ? answerEffort : o.effort
        // GPT-6 Luna on the fast tier, no reasoning: ~0.7 s for the yes/no with a low-detail screenshot
        // (Terra fast was ~1.05 s).
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

    /// Where "Open .env.local" should point: the repo file in dev builds, otherwise Application Support.
    static var preferredEnvFile: URL {
        repoRoot?.appendingPathComponent(".env.local") ?? userEnvFile
    }
}
