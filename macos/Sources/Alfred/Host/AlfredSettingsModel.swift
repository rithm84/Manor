import AppKit
import AVFoundation
import Combine

/// Everything Settings ▸ Alfred shows and changes: models, permissions, and the session folder.
/// Preferences and knowledge are edited directly through `AlfredHost.shared.preferences` and `.knowledge`.
@MainActor
public final class AlfredSettingsModel: ObservableObject {
    public enum Permission: Sendable { case screenRecording, microphone }

    public enum PermissionState: Equatable, Sendable { case granted, denied, notAsked }

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

    /// Whether Alfred can answer: signed in to Manor, or a development key is set.
    public var isReady: Bool { config.answerReady }

    /// Picks up a sign-in or sign-out when no Alfred session is running to publish it.
    func refreshConfig() {
        if host?.currentState == nil { config = Config.load() }
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
