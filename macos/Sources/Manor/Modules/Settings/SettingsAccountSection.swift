import AppKit
import ManorKit
import SwiftUI
import UniformTypeIdentifiers

/// Your profile: picture, display name, saved time zone, and sign-out.
struct SettingsAccountSection: View {
  @Environment(AppContext.self) private var context
  @Bindable var store: SettingsStore
  @State private var cropImage: IdentifiedImage?
  @State private var pendingZone: String?
  @State private var confirmSignOut = false
  @FocusState private var nameFocused: Bool

  private var macZone: String { TimeZone.current.identifier }

  var body: some View {
    VStack(alignment: .leading, spacing: Space.s4) {
      SettingsSectionTitle(title: "Account")
      if let error = store.profileError { SettingsNotice(text: error, failed: true) { store.profileError = nil } }
      SettingsCard {
        identity
        nameRow
        timeZoneRow
      }
      if let error = store.avatarError { SettingsNotice(text: error, failed: true) { store.avatarError = nil } }
      SettingsCard {
        SettingsRow("Sign out", description: "Your data stays in your Manor account.") {
          Button("Sign out") { confirmSignOut = true }
            .buttonStyle(.manor(.secondary, size: .small))
            .disabled(store.signingOut)
        }
      }
      if let error = store.signOutError { SettingsNotice(text: error, failed: true) { store.signOutError = nil } }
    }
    // The settings column scrolls and clips, so its dialogs are drawn by the page over the whole window area.
    .settingsDialogs(open: cropImage != nil || pendingZone != nil || confirmSignOut) {
      Color.clear
      .manorDialog(item: $cropImage, width: 400) { picked in
        AvatarCropPanel(image: picked.image, saving: store.avatarBusy, onCancel: { cropImage = nil }) { jpeg in
          Task { _ = await store.uploadAvatar(jpeg); cropImage = nil }
        }
      }
      .manorDialog(item: Binding(get: { pendingZone.map(IdentifiedString.init) }, set: { pendingZone = $0?.value }), width: 440) { zone in
        ConfirmPanel(
          title: "Change your time zone?",
          message: "Today, streaks, recurring tasks, and weekly reviews follow \(SettingsDomain.timeZoneLabel(zone.value)) from now on. Days you already logged keep their dates, and calendar events keep their times.",
          confirmLabel: "Change time zone",
          destructive: false,
          onCancel: { pendingZone = nil },
          onConfirm: {
            pendingZone = nil
            Task { await store.saveProfile(name: store.savedName, timezone: zone.value) }
          }
        )
      }
      .manorDialog(isPresented: $confirmSignOut, width: 420) {
        ConfirmPanel(
          title: "Sign out of Manor?",
          message: "This Mac forgets your account's local copy. Sign in again with Google whenever you like.",
          confirmLabel: "Sign out",
          destructive: false,
          onCancel: { confirmSignOut = false },
          onConfirm: {
            confirmSignOut = false
            Task { await store.signOut() }
          }
        )
      }
    }
  }

  // MARK: Rows

  private var identity: some View {
    HStack(spacing: Space.s4) {
      Button(action: pickPicture) { avatar }
        .buttonStyle(.plain)
        .disabled(store.avatarBusy)
        .help(store.avatarURL == nil ? "Add a profile picture" : "Change profile picture")
        .accessibilityLabel(store.avatarURL == nil ? "Add a profile picture" : "Change profile picture")
      VStack(alignment: .leading, spacing: 2) {
        Text(store.savedName.isEmpty ? context.account.name : store.savedName)
          .font(.ui(Typography.Size.emphasis, weight: .semibold)).foregroundStyle(Palette.ink)
        Text(context.account.email).font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted).textSelection(.enabled)
      }
      Spacer()
    }
    .padding(.vertical, Space.s4)
  }

  private var avatar: some View {
    ZStack(alignment: .bottomTrailing) {
      Group {
        if let url = store.avatarURL {
          AsyncImage(url: url) { phase in
            if let image = phase.image { image.resizable().scaledToFill() } else { initial }
          }
        } else {
          initial
        }
      }
      .frame(width: 52, height: 52)
      .clipShape(Circle())
      .overlay(Circle().strokeBorder(Palette.hairline, lineWidth: 1))
      .overlay { if store.avatarBusy { Circle().fill(.black.opacity(0.35)); ProgressView().controlSize(.small) } }
      Image(systemName: "camera.fill")
        .font(.system(size: 9, weight: .semibold))
        .foregroundStyle(Palette.ink)
        .frame(width: 20, height: 20)
        .background(Circle().fill(Palette.surfaceCanvas))
        .overlay(Circle().strokeBorder(Palette.hairlineStrong, lineWidth: 1))
        .offset(x: 2, y: 2)
    }
  }

  private var initial: some View {
    ZStack {
      Palette.primaryTint
      Text(String((store.savedName.isEmpty ? context.account.name : store.savedName).prefix(1)).uppercased())
        .font(.display(Typography.Size.title)).foregroundStyle(Palette.primary)
    }
  }

  private var nameRow: some View {
    SettingsRow("Display name", description: "How Manor greets you.") {
      HStack(spacing: Space.s2) {
        TextField("Your name", text: $store.nameDraft)
          .textFieldStyle(.manor)
          .frame(width: 220)
          .focused($nameFocused)
          .onSubmit { Task { await store.saveProfile() } }
          .onExitCommand { store.nameDraft = store.savedName; nameFocused = false }
        if store.nameDirty {
          Button("Save") { Task { await store.saveProfile() } }
            .buttonStyle(.manor(.primary, size: .small))
            .disabled(store.savingProfile)
            .transition(.opacity)
        }
      }
      .animation(Motion.fast, value: store.nameDirty)
    }
  }

  private var timeZoneRow: some View {
    let matchesMac = SettingsDomain.sameTimeZone(store.savedTimeZone, macZone)
    return SettingsRow("Time zone", description: matchesMac
      ? "Today, streaks, and reviews follow this time zone."
      : "This Mac is set to \(SettingsDomain.timeZoneLabel(macZone)). Manor keeps your saved zone until you change it.") {
      HStack(spacing: Space.s2) {
        if !matchesMac {
          Button("Use this Mac's") { pendingZone = macZone }
            .buttonStyle(.manor(.ghost, size: .small))
            .disabled(store.savingProfile)
        }
        TimeZonePicker(selection: store.savedTimeZone) { zone in
          if zone != store.savedTimeZone { pendingZone = zone }
        }
        .disabled(store.savingProfile)
      }
    }
  }

  // MARK: Picture

  private func pickPicture() {
    let panel = NSOpenPanel()
    panel.allowedContentTypes = [.png, .jpeg, .webP]
    panel.allowsMultipleSelection = false
    panel.canChooseDirectories = false
    panel.prompt = "Choose"
    panel.message = "Choose a PNG, JPEG, or WebP picture."
    guard panel.runModal() == .OK, let url = panel.url else { return }
    guard let image = NSImage(contentsOf: url), image.isValid else {
      store.avatarError = "That picture could not be opened. Choose a PNG, JPEG, or WebP image."
      return
    }
    store.avatarError = nil
    cropImage = IdentifiedImage(image: image)
  }
}

struct IdentifiedImage: Identifiable {
  let id = UUID()
  let image: NSImage
}

// MARK: Time zone picker

/// The saved zone, and a searchable list of zones grouped by region.
struct TimeZonePicker: View {
  let selection: String
  let onPick: (String) -> Void

  private var options: [ManorSelectOption<String>] {
    SettingsDomain.timeZoneChoices(including: selection).map { zone in
      ManorSelectOption(zone, SettingsDomain.timeZoneLabel(zone), section: zone.split(separator: "/").first.map(String.init),
                        keywords: zone.replacingOccurrences(of: "_", with: " "))
    }
  }

  var body: some View {
    ManorSelect("Time zone", selection: Binding(get: { selection }, set: { onPick($0) }), options: options,
                searchable: true, searchPrompt: "Search cities", width: 320)
      .fixedSize()
  }
}
