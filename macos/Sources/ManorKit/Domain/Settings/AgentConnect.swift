import Foundation

extension SettingsDomain {
  /// How an agent reaches Manor: the remote MCP address every account shares, and the one-line setup for agents
  /// that add servers from a terminal. Agents still sign in and ask for approval in Manor before they get access.
  public struct AgentConnect: Equatable, Sendable {
    /// `https://<project>.supabase.co/functions/v1/manor-mcp`
    public let address: String
    /// What the agent calls this server; staging gets its own name so both can be added side by side.
    public let name: String

    public init(supabaseURL: URL, environment: AppConfig.Environment) {
      address = supabaseURL.appendingPathComponent("functions/v1/manor-mcp").absoluteString
      name = environment == .production ? "manor" : "manor-\(environment.rawValue)"
    }

    /// Adds Manor to Claude Code; `/mcp` in Claude Code then signs in.
    public var claudeCodeCommand: String { "claude mcp add --transport http \(name) \(address)" }

    /// Adds Manor to Codex and opens the sign-in.
    public var codexCommand: String { "codex mcp add \(name) --url \(address) && codex mcp login \(name)" }
  }
}
