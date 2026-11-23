import AppKit
import ManorKit
import SwiftUI

/// Settings ▸ Connections ▸ Connect an agent: Manor's MCP address and the setup for each common agent, one click to
/// copy. The agent then asks for access, which you approve in Manor.
struct AgentConnectCard: View {
  let connect: SettingsDomain.AgentConnect

  var body: some View {
    SettingsCard {
      SettingsRow("Manor's address", description: connect.address) {
        CopyButton(label: "Copy address", text: connect.address)
      }
      SettingsRow("ChatGPT", description: "Open Plugins, choose +, then Add custom MCP server, and paste Manor's address.") {
        CopyButton(label: "Copy address", text: connect.address)
      }
      SettingsRow("Claude", description: "Open Customize, then Connectors. Choose Add, then Add custom connector, and paste Manor's address.") {
        CopyButton(label: "Copy address", text: connect.address)
      }
      SettingsRow("Claude Code", description: "Paste the command in Terminal, then run /mcp in Claude Code to sign in.") {
        CopyButton(label: "Copy command", text: connect.claudeCodeCommand)
      }
      SettingsRow("Codex", description: "Paste the command in Terminal. It adds Manor and opens the sign-in.") {
        CopyButton(label: "Copy command", text: connect.codexCommand)
      }
    }
  }
}

/// A small button that copies text and briefly confirms it.
private struct CopyButton: View {
  let label: String
  let text: String
  @State private var copied = false

  var body: some View {
    Button(copied ? "Copied" : label) {
      NSPasteboard.general.clearContents()
      NSPasteboard.general.setString(text, forType: .string)
      copied = true
      Task {
        try? await Task.sleep(for: .seconds(1.6))
        copied = false
      }
    }
    .buttonStyle(.manor(.secondary, size: .small))
    .contentTransition(.opacity)
    .animation(Motion.fast, value: copied)
    .accessibilityLabel(copied ? "Copied" : label)
  }
}
