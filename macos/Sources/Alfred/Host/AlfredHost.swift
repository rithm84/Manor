import AppKit
import Combine
import SwiftUI

/// Manor's entry point into Alfred. Manor calls `start` once at launch; Alfred then owns its notch overlay,
/// its ⌃⌥ hotkeys, and its menu bar item for the rest of the process. Everything runs on the main actor; audio,
/// transcription, and network work happen off it inside Alfred's engines.
///
/// ```swift
/// AlfredHost.shared.start(.init(appName: "Manor", openManor: { … }, openSettings: { … }, quitManor: { … }))
/// ```
@MainActor
public final class AlfredHost {
    public static let shared = AlfredHost()

    /// What the menu bar item and the overlay ask Manor to do.
    public struct Actions {
        /// "Manor" or "Manor Staging": the name the menu uses.
        public var appName: String
        /// Bring Manor's window back (and its Dock icon, if Manor was hidden by a Dock quit).
        public var openManor: () -> Void
        /// Show Settings ▸ Alfred in Manor's window.
        public var openSettings: () -> Void
        /// Quit Manor for real, Alfred included.
        public var quitManor: () -> Void
        /// Offered each hotkey first; returns true when Manor handled it in its own window (in-app Alfred), so the
        /// overlay stays put.
        public var handleInApp: (HotkeyAction) -> Bool

        public init(appName: String, openManor: @escaping () -> Void, openSettings: @escaping () -> Void, quitManor: @escaping () -> Void,
                    handleInApp: @escaping (HotkeyAction) -> Bool = { _ in false }) {
            self.appName = appName
            self.openManor = openManor
            self.openSettings = openSettings
            self.quitManor = quitManor
            self.handleInApp = handleInApp
        }
    }

    /// Non-secret preferences (mode, screenshots, microphone, interview context). Available before `start`.
    public let preferences = Preferences()
    /// Personal context documents used by every answer.
    public let knowledge = KnowledgeStore()

    private var state: AlfredState?
    private var overlay: OverlayController?
    private var hotkeys: HotkeyCenter?
    private var statusMenu: StatusMenu?
    private var settingsModel: AlfredSettingsModel?
    private var actions: Actions?

    private init() {}

    public var isStarted: Bool { state != nil }

    /// The host app's signed-in account: a way to read its current access token (refreshed as needed), or nil when
    /// signed out. Alfred reaches its models through Manor's proxy with it, so there are no provider keys in the app.
    public func setAccount(token: (@Sendable () async throws -> String)?) {
        let changed = (HostedEndpoint.token == nil) != (token == nil)
        HostedEndpoint.token = token
        guard changed else { return }
        state?.reloadConfig()
        settingsModel?.refreshConfig()
    }

    /// General or Prep. Setting it takes effect at once: Prep starts listening, General stops it.
    public var mode: AlfredMode {
        get { preferences.alfredMode }
        set { preferences.alfredMode = newValue }
    }

    /// Prep mode keeps Alfred (and its menu bar item) running when Manor is quit from the Dock or with ⌘Q.
    public var keepsRunningWhenManorQuits: Bool { isStarted && mode == .interview }

    /// Model for Settings ▸ Alfred. Usable before `start` (keys, permissions, and preferences don't need the overlay).
    public var settings: AlfredSettingsModel {
        if let settingsModel { return settingsModel }
        let model = AlfredSettingsModel(host: self)
        settingsModel = model
        return model
    }

    /// Installs the overlay, hotkeys, and menu bar item. Safe to call more than once.
    public func start(_ actions: Actions) {
        self.actions = actions
        guard state == nil else { return }
        let state = AlfredState(prefs: preferences, knowledge: knowledge)
        self.state = state
        state.openSettings = { [weak self] in self?.actions?.openSettings() }
        state.openManor = { [weak self] in self?.actions?.openManor() }
        overlay = OverlayController(state: state)
        let hotkeys = HotkeyCenter { [weak self, weak state] action in
            if self?.actions?.handleInApp(action) == true { return }
            state?.handle(action)
        }
        hotkeys.register(HotkeyAction.actions(for: mode))
        self.hotkeys = hotkeys
        statusMenu = StatusMenu(state: state, actions: { [weak self] in self?.actions })
        state.onModeChange = { [weak self] mode in
            self?.hotkeys?.register(HotkeyAction.actions(for: mode))
            self?.statusMenu?.refresh()
        }
        settingsModel?.attach(state)
        state.bootstrap()
        Log.app.info("Alfred started in \(self.mode.rawValue, privacy: .public) mode")

        let env = ProcessInfo.processInfo.environment
        if let path = env["ALFRED_SNAPSHOT"] {
            // Debug: render the overlay to a PNG for UI review without Screen Recording permission.
            if env["ALFRED_SNAPSHOT_STATE"] == "flush" { state.collapseCard() }
            let delay = env["ALFRED_SNAPSHOT_DELAY"].flatMap(Double.init) ?? 1.5
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
                self?.overlay?.snapshot(to: URL(fileURLWithPath: path))
            }
        }
    }

    /// Saves the session and releases the hotkeys and audio. Call from `applicationWillTerminate`.
    public func stop() {
        guard let state else { return }
        state.saveSession()
        hotkeys?.unregisterAll()
        if state.listener.isActive { state.stopListening() }
    }

    /// Hotkeys that failed to register (another app owns them), for Settings.
    public var unavailableShortcuts: [HotkeyAction] { hotkeys?.failed ?? [] }

    var currentState: AlfredState? { state }
}
