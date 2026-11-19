import Foundation
import Security

/// API keys entered in the app (Settings ▸ Providers), kept in the user's login Keychain — never in
/// preferences or plain files. Env files still work for development and take lower priority.
enum KeyStore {
    static let service = "app.manor.alfred.api-keys"
    /// The keys the setup screen manages.
    static let names = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "DEEPGRAM_API_KEY"]

    static func get(_ name: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: name,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var out: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess, let data = out as? Data,
              let value = String(data: data, encoding: .utf8), !value.isEmpty else { return nil }
        return value
    }

    /// Stores (or with nil / empty, removes) a key.
    @discardableResult
    static func set(_ name: String, _ value: String?) -> Bool {
        let base: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: name,
        ]
        guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else {
            let status = SecItemDelete(base as CFDictionary)
            return status == errSecSuccess || status == errSecItemNotFound
        }
        let data = Data(value.utf8)
        let status = SecItemUpdate(base as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound {
            var add = base
            add[kSecValueData as String] = data
            add[kSecAttrLabel as String] = "Manor Alfred: \(name)"
            add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
            return SecItemAdd(add as CFDictionary, nil) == errSecSuccess
        }
        return status == errSecSuccess
    }

    static var all: [String: String] {
        var out: [String: String] = [:]
        for name in names { if let v = get(name) { out[name] = v } }
        return out
    }
}

/// Checks a key against its provider before it's saved.
enum KeyCheck {
    enum Result: Equatable {
        case ok
        case rejected(String)
        case unreachable(String)
    }

    static func openAI(_ key: String, baseURL: URL = URL(string: "https://api.openai.com/v1")!) async -> Result {
        var req = URLRequest(url: baseURL.appendingPathComponent("models"))
        req.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        return await run(req)
    }

    static func anthropic(_ key: String, baseURL: URL = URL(string: "https://api.anthropic.com/v1")!) async -> Result {
        var req = URLRequest(url: baseURL.appendingPathComponent("models"))
        req.setValue(key, forHTTPHeaderField: "x-api-key")
        req.setValue(AnthropicClient.apiVersion, forHTTPHeaderField: "anthropic-version")
        return await run(req)
    }

    static func deepgram(_ key: String) async -> Result {
        var req = URLRequest(url: URL(string: "https://api.deepgram.com/v1/projects")!)
        req.setValue("Token \(key)", forHTTPHeaderField: "Authorization")
        return await run(req)
    }

    private static func run(_ req: URLRequest) async -> Result {
        var req = req
        req.timeoutInterval = 10
        do {
            let (_, response) = try await URLSession.shared.data(for: req)
            let code = (response as? HTTPURLResponse)?.statusCode ?? 0
            switch code {
            case 200..<300: return .ok
            case 401, 403: return .rejected("The provider rejected this key.")
            default: return .unreachable("Unexpected response (HTTP \(code)).")
            }
        } catch {
            return .unreachable(error.localizedDescription)
        }
    }
}
