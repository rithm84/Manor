import Alfred
import AppKit
import SwiftUI

/// Settings ▸ Alfred: the mode, what answers can see, interview preferences, personal context, models,
/// permissions, and the ⌃⌥ shortcuts. Everything here is kept on this Mac. Alfred runs on Manor's own model access,
/// so there are no keys to enter.
struct AlfredSettingsSection: View {
  @State private var windowTextTrusted = WindowText.isTrusted
  @ObservedObject private var prefs = AlfredHost.shared.preferences
  @ObservedObject private var model = AlfredHost.shared.settings
  @State private var editing: KnowledgeDoc?

  var body: some View {
    VStack(alignment: .leading, spacing: Space.s5) {
      SettingsSectionTitle(title: "Alfred")
      modeCard
      if prefs.alfredMode == .interview { interviewCard }
      AlfredKnowledgeCard(editing: $editing)
      modelsCard
      permissionsCard
      shortcutsCard
      sessionsCard
    }
    .settingsDialogs(open: editing != nil) {
      Color.clear.manorDialog(item: $editing, width: 640) { doc in
        AlfredDocumentDialog(doc: doc) { editing = nil }
      }
    }
  }

  // MARK: Mode and answers

  private var modeCard: some View {
    SettingsCard {
      SettingsRow("Mode", description: prefs.alfredMode == .general
        ? "Ask about anything on your screen, or any question."
        : "Listens to your call and helps with interview questions as they come.") {
        SegmentedTabs(AlfredMode.allCases.map { ($0, $0.title) }, selection: $prefs.alfredMode)
      }
      SettingsRow("Include your screen", description: "Answers see the window you're working in. Alfred's panel, other windows, and the desktop are left out.") {
        toggle("Include your screen", $prefs.includeScreen)
      }
      if prefs.includeScreen {
        SettingsRow("Read the window's text", description: windowTextTrusted
          ? "Alfred also reads the window's text, which is more exact for code and numbers. Nothing in the window changes."
          : "Needs Accessibility access for Manor in System Settings. Until then, answers use the image.") {
          HStack(spacing: Space.s2) {
            if prefs.includeWindowText && !windowTextTrusted {
              Button("Allow access") { WindowText.requestTrust() }.buttonStyle(.manor(.secondary, size: .small))
            }
            toggle("Read the window's text", $prefs.includeWindowText)
          }
        }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
          windowTextTrusted = WindowText.isTrusted
        }
      }
      SettingsRow("Answer text size") {
        HStack(spacing: Space.s2) {
          Image(systemName: "textformat.size.smaller").foregroundStyle(Palette.inkMuted).accessibilityHidden(true)
          Slider(value: $prefs.textScale, in: 0.85...1.3).frame(width: 140).tint(Palette.primary)
            .accessibilityLabel("Answer text size")
          Image(systemName: "textformat.size.larger").foregroundStyle(Palette.inkMuted).accessibilityHidden(true)
        }
      }
      VStack(alignment: .leading, spacing: Space.s2) {
        Text("How Alfred answers").font(.ui(Typography.Size.body, weight: .medium)).foregroundStyle(Palette.ink)
        AlfredTextArea(text: $prefs.extraInstructions, placeholder: "Keep answers under 100 words. Prefer Go for code.")
      }
      .padding(.vertical, Space.s3)
    }
  }

  private var interviewCard: some View {
    SettingsCard("Prep") {
      SettingsRow("Answer style") {
        ManorSelect("Answer style", selection: $prefs.mode, options: AssistMode.allCases.map { ManorSelectOption($0, $0.title) })
          .fixedSize()
      }
      SettingsRow("Coding language") {
        ManorSelect("Coding language", selection: $prefs.codingLanguage, options: Preferences.languages.map { ManorSelectOption($0, $0) })
          .fixedSize()
      }
      SettingsRow("Use your microphone", description: "Alfred hears you as well as the call, so answers pick up where you are.") {
        toggle("Use your microphone", $prefs.captureMic)
      }
      SettingsRow("Prepare answers early", description: "Starts answering when a question ends, so ⌃⌥Space shows it at once.") {
        toggle("Prepare answers early", $prefs.prefetchAnswers)
      }
      SettingsRow("Listen when Manor opens") {
        toggle("Listen when Manor opens", $prefs.listenOnLaunch)
      }
      VStack(alignment: .leading, spacing: Space.s2) {
        Text("This interview").font(.ui(Typography.Size.body, weight: .medium)).foregroundStyle(Palette.ink)
        AlfredTextArea(text: $prefs.roleContext, placeholder: "Company, role, team, interviewer names, the agenda, and what they care about.")
      }
      .padding(.vertical, Space.s3)
    }
  }

  // MARK: Models, permissions, shortcuts, sessions

  private var modelsCard: some View {
    SettingsCard("Models") {
      ForEach(model.models, id: \.role) { row in
        SettingsRow(row.role) {
          Text(row.value).font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted).textSelection(.enabled)
        }
      }
    }
  }

  private var permissionsCard: some View {
    SettingsCard("Permissions") {
      permissionRow(
        "Screen & System Audio Recording",
        description: prefs.alfredMode == .interview ? "Lets Alfred see your screen and hear the call." : "Lets Alfred see your screen.",
        state: model.screenRecording, permission: .screenRecording)
      if prefs.alfredMode == .interview {
        permissionRow("Microphone", description: "Lets Alfred hear what you say.", state: model.microphone, permission: .microphone)
      }
    }
  }

  private func permissionRow(_ title: String, description: String, state: AlfredSettingsModel.PermissionState,
                             permission: AlfredSettingsModel.Permission) -> some View {
    SettingsRow(title, description: description) {
      HStack(spacing: Space.s2) {
        if state == .granted {
          Label("Allowed", systemImage: "checkmark.circle.fill")
            .font(.ui(Typography.Size.sm, weight: .medium))
            .foregroundStyle(Palette.completion)
        } else {
          Button(state == .denied ? "Open System Settings" : "Allow…") { model.request(permission) }
            .buttonStyle(.manor(.secondary, size: .small))
        }
      }
    }
  }

  private var shortcutsCard: some View {
    let failed = Set(model.unavailableShortcuts)
    return SettingsCard("Shortcuts") {
      ForEach(HotkeyAction.actions(for: prefs.alfredMode), id: \.self) { action in
        HStack(spacing: Space.s4) {
          HStack(spacing: 3) {
            KeyCap(key: "⌃")
            KeyCap(key: "⌥")
            KeyCap(key: action.keyGlyph)
          }
          .frame(width: 112, alignment: .leading)
          Text(action.title).font(.ui(Typography.Size.body)).foregroundStyle(failed.contains(action) ? Palette.inkMuted : Palette.inkBody)
          Spacer(minLength: 0)
          if failed.contains(action) {
            Text("In use by another app").font(.ui(Typography.Size.sm)).foregroundStyle(Palette.overdueError)
          }
        }
        .padding(.vertical, Space.s2 + 2)
        .accessibilityElement(children: .combine)
      }
    }
  }

  private var sessionsCard: some View {
    SettingsCard {
      SettingsRow("Save sessions", description: "Keeps each session's chats and transcript on this Mac as Markdown.") {
        HStack(spacing: Space.s3) {
          Button("Show in Finder") { model.openSessionsFolder() }.buttonStyle(.manor(.ghost, size: .small))
          toggle("Save sessions", $prefs.saveSessions)
        }
      }
    }
  }

  private func toggle(_ label: String, _ isOn: Binding<Bool>) -> some View {
    Toggle(label, isOn: isOn).toggleStyle(.switch).labelsHidden().tint(Palette.primary)
  }
}

/// A multi-line field that saves as you type, with a placeholder.
struct AlfredTextArea: View {
  @Binding var text: String
  let placeholder: String
  var minHeight: CGFloat = 72

  var body: some View {
    let shape = RoundedRectangle(cornerRadius: Radius.control, style: .continuous)
    TextEditor(text: $text)
      .font(.ui(Typography.Size.body))
      .foregroundStyle(Palette.ink)
      .scrollContentBackground(.hidden)
      .padding(.horizontal, Space.s2)
      .padding(.vertical, Space.s2)
      .frame(minHeight: minHeight)
      .background(shape.fill(Palette.fieldFill))
      .overlay(shape.strokeBorder(Palette.fieldBorder, lineWidth: 1))
      .overlay(alignment: .topLeading) {
        if text.isEmpty {
          Text(placeholder).font(.ui(Typography.Size.body)).foregroundStyle(Palette.inkMuted)
            .padding(.horizontal, Space.s3).padding(.vertical, Space.s2)
            .allowsHitTesting(false)
        }
      }
      .accessibilityLabel(placeholder)
  }
}
