import AppKit
import Combine

/// Alfred's menu bar item: Manor's mark as a template glyph (with a dot while listening) and a menu rebuilt each
/// time it opens, so titles always match the current state.
@MainActor
final class StatusMenu: NSObject, NSMenuDelegate {
    private let state: AlfredState
    private let actions: () -> AlfredHost.Actions?
    private let item: NSStatusItem
    private var bag = Set<AnyCancellable>()

    init(state: AlfredState, actions: @escaping () -> AlfredHost.Actions?) {
        self.state = state
        self.actions = actions
        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        super.init()
        let menu = NSMenu()
        menu.delegate = self
        menu.autoenablesItems = false
        item.menu = menu
        item.behavior = []
        refresh()
        // Only the listening flag changes the glyph; the 20 Hz meters never touch the menu bar.
        state.listener.$status
            .map { status -> Bool in status == .live || status == .starting || { if case .degraded = status { return true } else { return false } }() }
            .removeDuplicates()
            .sink { [weak self] _ in DispatchQueue.main.async { self?.refresh() } }
            .store(in: &bag)
    }

    func refresh() {
        let listening = state.listener.isActive || state.listener.status == .starting
        item.button?.image = MenuBarIcon.make(listening: listening)
        let name = actions()?.appName ?? "Manor"
        item.button?.toolTip = listening ? "Alfred is listening" : "Alfred, part of \(name)"
        item.button?.setAccessibilityLabel(listening ? "Alfred, listening" : "Alfred")
    }

    nonisolated func menuNeedsUpdate(_ menu: NSMenu) {
        MainActor.assumeIsolated { rebuild(menu) }
    }

    private func rebuild(_ menu: NSMenu) {
        menu.removeAllItems()
        let name = actions()?.appName ?? "Manor"
        let interview = state.mode == .interview

        let header = NSMenuItem(title: "Alfred: \(state.mode.title)", action: nil, keyEquivalent: "")
        header.isEnabled = false
        menu.addItem(header)
        menu.addItem(.separator())

        add(menu, state.isCardOpen ? "Hide Alfred" : "Ask Alfred", .toggleOverlay) { [state] in state.toggleOverlay() }
        add(menu, "Answer Now", .assist) { [state] in state.assist(forceScreen: state.mode == .general) }
        if interview {
            let listening = state.listener.isActive || state.listener.status == .starting
            add(menu, listening ? "Stop Listening" : "Start Listening", .toggleListening) { [state] in state.toggleListening() }
            add(menu, state.prefs.captureMic ? "Mute Microphone" : "Unmute Microphone", .toggleMic) { [state] in state.toggleMic() }
        }
        add(menu, "New Session", .newSession) { [state] in state.newSession() }
        menu.addItem(.separator())

        let modeItem = NSMenuItem(title: "Mode", action: nil, keyEquivalent: "")
        let modes = NSMenu()
        for mode in AlfredMode.allCases {
            let entry = ClosureMenuItem(title: mode.title) { [state] in state.prefs.alfredMode = mode }
            entry.state = mode == state.mode ? .on : .off
            modes.addItem(entry)
        }
        modeItem.submenu = modes
        menu.addItem(modeItem)
        add(menu, "Alfred Settings…", .settings) { [actions] in actions()?.openSettings() }
        menu.addItem(.separator())
        add(menu, "Open \(name)", nil) { [actions] in actions()?.openManor() }
        add(menu, "Quit \(name)", nil) { [actions] in actions()?.quitManor() }
    }

    /// A menu row; ⌃⌥ shortcuts show as native key equivalents on the right.
    private func add(_ menu: NSMenu, _ title: String, _ action: HotkeyAction?, _ handler: @escaping () -> Void) {
        let entry = ClosureMenuItem(title: title, handler: handler)
        if let action, let key = action.menuKeyEquivalent {
            entry.keyEquivalent = key
            entry.keyEquivalentModifierMask = [.control, .option]
        }
        menu.addItem(entry)
    }
}

final class ClosureMenuItem: NSMenuItem {
    private let handler: () -> Void
    init(title: String, handler: @escaping () -> Void) {
        self.handler = handler
        super.init(title: title, action: #selector(fire), keyEquivalent: "")
        target = self
    }
    required init(coder: NSCoder) {
        handler = {}
        super.init(coder: coder)
    }
    @objc private func fire() { handler() }
}

extension HotkeyAction {
    /// The character AppKit draws for this shortcut in a menu.
    var menuKeyEquivalent: String? {
        switch self {
        case .assist: " "
        case .scrollUp, .scrollDown, .previousChat, .nextChat: nil
        default: keyGlyph.lowercased()
        }
    }
}
