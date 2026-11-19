import Alfred
import SwiftUI

/// Provider keys: paste, check with the provider, and keep in the Keychain.
struct AlfredKeysCard: View {
  @ObservedObject var model: AlfredSettingsModel
  @State private var anthropic = ""
  @State private var openAI = ""
  @State private var deepgram = ""
  @State private var checking = false
  @State private var results: [String: AlfredSettingsModel.CheckResult] = [:]
  @State private var confirmRemove = false

  private var canSave: Bool {
    !checking && ![anthropic, openAI, deepgram].allSatisfy { $0.trimmingCharacters(in: .whitespaces).isEmpty }
  }

  var body: some View {
    VStack(alignment: .leading, spacing: Space.s2) {
      SettingsCard("Keys") {
        keyRow("Anthropic", status: model.anthropicKey, text: $anthropic, purpose: "Answers, memory, and writing in both modes.")
        keyRow("OpenAI", status: model.openAIKey, text: $openAI, purpose: "Spotting when a new problem needs its own chat.")
        keyRow("Deepgram", status: model.deepgramKey, text: $deepgram, purpose: "Live transcription in Prep mode.")
        HStack(spacing: Space.s2) {
          if model.hasSavedKeys {
            Button("Remove Saved Keys") { confirmRemove = true }
              .buttonStyle(.manor(.ghost, size: .small))
              .disabled(checking)
          }
          Spacer()
          if checking { ProgressView().controlSize(.small) }
          Button("Check and Save") { Task { await save() } }
            .buttonStyle(.manor(.primary, size: .small))
            .keyboardShortcut(.defaultAction)
            .disabled(!canSave)
        }
        .padding(.vertical, Space.s3)
      }
      Text("Keys are checked with their provider, then kept in your Mac's Keychain and sent only to that provider.")
        .font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted)
        .padding(.leading, Space.s1)
    }
    .settingsDialogs(open: confirmRemove) {
      Color.clear.manorDialog(isPresented: $confirmRemove, width: 420) {
        ConfirmPanel(
          title: "Remove saved keys?",
          message: "Alfred stops answering until you add a key again. Keys from development env files stay in use.",
          confirmLabel: "Remove Keys",
          onCancel: { confirmRemove = false },
          onConfirm: {
            confirmRemove = false
            results = [:]
            model.removeSavedKeys()
          }
        )
      }
    }
  }

  private func keyRow(_ provider: String, status: AlfredSettingsModel.KeyStatus, text: Binding<String>, purpose: String) -> some View {
    VStack(alignment: .leading, spacing: Space.s2) {
      HStack(alignment: .firstTextBaseline) {
        VStack(alignment: .leading, spacing: 2) {
          Text(provider).font(.ui(Typography.Size.body, weight: .medium)).foregroundStyle(Palette.ink)
          Text(purpose).font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted)
        }
        Spacer()
        statusLabel(status)
      }
      SecureField(status.source == .missing ? "Paste your \(provider) key" : "Paste a new key to replace it", text: text)
        .textFieldStyle(.manor)
        .accessibilityLabel("\(provider) key")
      if let result = results[status.name] { resultLabel(result) }
    }
    .padding(.vertical, Space.s3)
  }

  @ViewBuilder
  private func statusLabel(_ status: AlfredSettingsModel.KeyStatus) -> some View {
    switch status.source {
    case .missing:
      Text("Not set").font(.ui(Typography.Size.sm, weight: .medium)).foregroundStyle(Palette.inkMuted)
    case .saved, .envFile:
      HStack(spacing: Space.s1) {
        Image(systemName: "checkmark.circle.fill").foregroundStyle(Palette.completion)
        Text("Ends in \(status.suffix ?? "")").font(.ui(Typography.Size.sm, weight: .medium)).foregroundStyle(Palette.inkBody).tabular()
        if status.source == .envFile {
          Text("from env file").font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted)
        }
      }
      .accessibilityElement(children: .combine)
    }
  }

  @ViewBuilder
  private func resultLabel(_ result: AlfredSettingsModel.CheckResult) -> some View {
    switch result {
    case .ok:
      SettingsNotice(text: "The key works and is saved.")
    case .rejected(let why):
      SettingsNotice(text: why, failed: true)
    case .unreachable(let why):
      SettingsNotice(text: "Saved, but Alfred couldn't check it: \(why)", failed: true)
    }
  }

  private func save() async {
    checking = true
    defer { checking = false }
    results = await model.checkAndSave(anthropic: anthropic, openAI: openAI, deepgram: deepgram)
    if case .rejected? = results[AlfredSettingsModel.anthropicKeyName] {} else { anthropic = "" }
    if case .rejected? = results[AlfredSettingsModel.openAIKeyName] {} else { openAI = "" }
    if case .rejected? = results[AlfredSettingsModel.deepgramKeyName] {} else { deepgram = "" }
  }
}
