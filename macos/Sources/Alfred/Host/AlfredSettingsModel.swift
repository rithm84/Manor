import AppKit
import AVFoundation
import Combine

/// Everything Settings ▸ Alfred shows and changes: keys, models, permissions, and the session folder.
/// Preferences and knowledge are edited directly through `AlfredHost.shared.preferences` and `.knowledge`.
@MainActor
public final class AlfredSettingsModel: ObservableObject {
    public enum KeySource: Equatable, Sendable { case saved, envFile, missing }

    public struct KeyStatus: Equatable, Sendable {
        public let name: String
        /// The last four characters of the key in use, for recognition.
        public let suffix: String?
        public let source: KeySource
    }

    public enum CheckResult: Equatable, Sendable {
        case ok
        case rejected(String)
        case unreachable(String)
    }

    public enum Permission: Sendable { case screenRecording, microphone }

    public enum PermissionState: Equatable, Sendable { case granted, denied, notAsked }

    public static let openAIKeyName = "OPENAI_API_KEY"
    public static let deepgramKeyName = "DEEPGRAM_API_KEY"

    @Published private(set) var config: Config
    @Published public private(set) var screenRecording: PermissionState = .notAsked
    @Published public private(set) var microphone: PermissionState = .notAsked

    private weak var host: AlfredHost?
    private var bag = Set<AnyCancellable>()

    init(host: AlfredHost) {
        self.host = host
        config = host.currentState?.config ?? Config.load()
        if let state = host.currentState { attach(state) }
        refreshPermissions()
        NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)
            .sink { [weak self] _ in MainActor.assumeIsolated { self?.refreshPermissions() } }
            .store(in: &bag)
    }

    func attach(_ state: AlfredState) {
        config = state.config
        state.$config.removeDuplicates().sink { [weak self] in self?.config = $0 }.store(in: &bag)
    }

    // MARK: Keys

    public var openAIKey: KeyStatus { status(Self.openAIKeyName, config.openAIKey) }
    public var deepgramKey: KeyStatus { status(Self.deepgramKeyName, config.deepgramKey) }
    /// Answers need an OpenAI key; Prep mode's listening also needs Deepgram.
    public var isReady: Bool { config.answerReady }
    public var hasSavedKeys: Bool { !config.appKeys.isEmpty }

    private func status(_ name: String, _ value: String?) -> KeyStatus {
        guard let value, !value.isEmpty else { return KeyStatus(name: name, suffix: nil, source: .missing) }
        return KeyStatus(name: name, suffix: String(value.suffix(4)), source: config.appKeys.contains(name) ? .saved : .envFile)
    }

    /// Checks each non-empty key with its provider, then saves it to the Keychain. A rejected key never replaces a
    /// working one; a key that couldn't be checked (offline) is saved anyway.
    public func checkAndSave(openAI: String, deepgram: String) async -> [String: CheckResult] {
        var results: [String: CheckResult] = [:]
        var saved = false
        for (name, raw) in [(Self.openAIKeyName, openAI), (Self.deepgramKeyName, deepgram)] {
            let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !value.isEmpty else { continue }
            let result = name == Self.openAIKeyName ? await KeyCheck.openAI(value, baseURL: config.openAIBaseURL)
                                                    : await KeyCheck.deepgram(value)
            switch result {
            case .ok: results[name] = .ok
            case .rejected(let why): results[name] = .rejected(why); continue
            case .unreachable(let why): results[name] = .unreachable(why)
            }
            if KeyStore.set(name, value) { saved = true }
        }
        if saved { reload() }
        return results
    }

    public func removeSavedKeys() {
        KeyStore.names.forEach { KeyStore.set($0, nil) }
        reload()
    }

    private func reload() {
        if let state = host?.currentState { state.reloadConfig() } else { config = Config.load() }
    }

    // MARK: Models

    /// Human-readable model choices (set with `ALFRED_*` overrides, not in the UI).
    public var models: [(role: String, value: String)] {
        let c = config
        func describe(_ model: String, _ tier: String?, _ effort: String?) -> String {
            [model, tier.map { "\($0) tier" } ?? "standard tier", effort.map { $0 == "none" ? "no reasoning" : "\($0) effort" }].compactMap { $0 }.joined(separator: " · ")
        }
        return [
            ("Answers", describe(c.answerModel, c.answerTier, c.answerEffort)),
            ("Conversation memory", describe(c.contextModel, c.contextTier, c.contextEffort)),
            ("New topic check", c.routerModel.map { describe($0, c.routerTier, c.routerEffort) } ?? "Off"),
            ("Transcription", "Deepgram \(c.deepgramModel)"),
        ]
    }

    // MARK: Permissions

    public func refreshPermissions() {
        screenRecording = ScreenCapture.hasPermission ? .granted : .notAsked
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: microphone = .granted
        case .notDetermined: microphone = .notAsked
        default: microphone = .denied
        }
    }

    /// Asks macOS for the permission (the system prompt appears once), then opens its System Settings pane.
    public func request(_ permission: Permission) {
        switch permission {
        case .screenRecording:
            ScreenCapture.requestPermission()
            openSystemSettings(for: .screenRecording)
        case .microphone:
            if AVCaptureDevice.authorizationStatus(for: .audio) == .notDetermined {
                Task {
                    _ = await MicrophoneCapture.requestAccess()
                    refreshPermissions()
                }
            } else {
                openSystemSettings(for: .microphone)
            }
        }
    }

    public func openSystemSettings(for permission: Permission) {
        let pane = permission == .screenRecording ? "Privacy_ScreenCapture" : "Privacy_Microphone"
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?\(pane)") {
            NSWorkspace.shared.open(url)
        }
    }

    // MARK: Sessions

    public func openSessionsFolder() { NSWorkspace.shared.open(Paths.sessions) }

    /// Shortcuts another app already owns.
    public var unavailableShortcuts: [HotkeyAction] { host?.unavailableShortcuts ?? [] }
}
