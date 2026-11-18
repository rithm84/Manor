import Foundation

/// The environment this build talks to. A bundle carries it in Info.plist; an unbundled development run reads
/// `MANOR_SUPABASE_URL`, `MANOR_SUPABASE_KEY`, and `MANOR_URL_SCHEME` from the process environment.
public struct AppConfig: Sendable {
  public enum Environment: String, Sendable { case production, staging, development }

  public let supabaseURL: URL
  public let supabaseKey: String
  /// `manor` in production, `manor-staging` in staging. Every link back into the app uses it.
  public let urlScheme: String
  public let environment: Environment

  public var authRedirectURL: URL { URL(string: "\(urlScheme)://auth/callback")! }

  public init(supabaseURL: URL, supabaseKey: String, urlScheme: String, environment: Environment) {
    self.supabaseURL = supabaseURL
    self.supabaseKey = supabaseKey
    self.urlScheme = urlScheme
    self.environment = environment
  }

  public static func load(bundle: Bundle = .main, environment env: [String: String] = ProcessInfo.processInfo.environment) throws -> AppConfig {
    let info = bundle.infoDictionary ?? [:]
    func value(_ plistKey: String, _ envKey: String) -> String? {
      (env[envKey]?.isEmpty == false ? env[envKey] : nil) ?? (info[plistKey] as? String).flatMap { $0.isEmpty ? nil : $0 }
    }
    guard let urlString = value("ManorSupabaseURL", "MANOR_SUPABASE_URL"), let url = URL(string: urlString),
          let key = value("ManorSupabaseKey", "MANOR_SUPABASE_KEY") else {
      throw ConfigError.missing
    }
    let scheme = value("ManorURLScheme", "MANOR_URL_SCHEME") ?? "manor-staging"
    let name = value("ManorEnvironment", "MANOR_ENVIRONMENT") ?? "development"
    return AppConfig(supabaseURL: url, supabaseKey: key, urlScheme: scheme, environment: Environment(rawValue: name) ?? .development)
  }

  public enum ConfigError: LocalizedError {
    case missing
    public var errorDescription: String? { "This build has no Manor backend configured." }
  }
}
