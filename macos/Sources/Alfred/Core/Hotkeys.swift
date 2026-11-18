import AppKit
import Carbon.HIToolbox

/// Every global action Alfred exposes. All use ⌃⌥ (Control+Option), a pair almost no app binds,
/// so Alfred never steals ⌘↩ / ⌘⇧ shortcuts from editors, browsers or coding pads.
public enum HotkeyAction: UInt32, CaseIterable, Sendable {
    case assist = 1, toggleListening, toggleMic, toggleOverlay,
         newSession, scrollUp, scrollDown, previousChat, nextChat, settings, stepBack, stepForward, newChat, closeChat

    var keyCode: Int {
        switch self {
        case .assist: kVK_Space
        case .toggleListening: kVK_ANSI_L
        case .toggleMic: kVK_ANSI_M
        case .toggleOverlay: kVK_ANSI_H
        case .newSession: kVK_ANSI_N
        case .scrollUp: kVK_UpArrow
        case .scrollDown: kVK_DownArrow
        case .previousChat: kVK_LeftArrow
        case .nextChat: kVK_RightArrow
        case .settings: kVK_ANSI_Comma
        case .stepBack: kVK_ANSI_LeftBracket
        case .stepForward: kVK_ANSI_RightBracket
        case .newChat: kVK_ANSI_T
        case .closeChat: kVK_ANSI_W
        }
    }

    var modifiers: Int { controlKey | optionKey }

    /// Listening controls exist only in Prep mode; General mode leaves those keys free for other apps.
    public var interviewOnly: Bool { [.toggleListening, .toggleMic].contains(self) }

    public static func actions(for mode: AlfredMode) -> [HotkeyAction] {
        allCases.filter { mode == .interview || !$0.interviewOnly }
    }

    public var keyGlyph: String {
        switch self {
        case .assist: "Space"
        case .toggleListening: "L"
        case .toggleMic: "M"
        case .toggleOverlay: "H"
        case .newSession: "N"
        case .scrollUp: "↑"
        case .scrollDown: "↓"
        case .previousChat: "←"
        case .nextChat: "→"
        case .settings: ","
        case .stepBack: "["
        case .stepForward: "]"
        case .newChat: "T"
        case .closeChat: "W"
        }
    }

    public var display: String { "⌃⌥" + (keyGlyph == "Space" ? "␣" : keyGlyph) }

    public var title: String {
        switch self {
        case .assist: "Answer now"
        case .toggleListening: "Start or stop listening"
        case .toggleMic: "Mute or unmute your microphone"
        case .toggleOverlay: "Open Alfred to type a question, or fold it away"
        case .newSession: "Start a new session"
        case .scrollUp: "Scroll the answer up"
        case .scrollDown: "Scroll the answer down"
        case .previousChat: "Previous chat"
        case .nextChat: "Next chat"
        case .settings: "Alfred settings in Manor"
        case .stepBack: "Previous diagram step"
        case .stepForward: "Next diagram step"
        case .newChat: "New chat"
        case .closeChat: "Close the chat"
        }
    }
}

/// Thin wrapper over Carbon `RegisterEventHotKey` — still the only API for system-wide
/// hotkeys that needs no Accessibility permission.
@MainActor
final class HotkeyCenter {
    private var refs: [EventHotKeyRef] = []
    /// Shortcuts another app already owns; Settings lists them.
    private(set) var failed: [HotkeyAction] = []
    private var handlerRef: EventHandlerRef?
    private let onAction: (HotkeyAction) -> Void
    private static let signature: OSType = 0x414C_4652  // 'ALFR'

    init(onAction: @escaping (HotkeyAction) -> Void) {
        self.onAction = onAction
    }

    func register(_ actions: [HotkeyAction]) {
        unregisterAll()
        failed = []
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        let context = Unmanaged.passUnretained(self).toOpaque()
        InstallEventHandler(GetApplicationEventTarget(), { _, event, context in
            guard let event, let context else { return OSStatus(eventNotHandledErr) }
            var id = EventHotKeyID()
            let status = GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID),
                                           nil, MemoryLayout<EventHotKeyID>.size, nil, &id)
            guard status == noErr, id.signature == HotkeyCenter.signature,
                  let action = HotkeyAction(rawValue: id.id) else { return OSStatus(eventNotHandledErr) }
            let center = Unmanaged<HotkeyCenter>.fromOpaque(context).takeUnretainedValue()
            MainActor.assumeIsolated { center.onAction(action) }
            return noErr
        }, 1, &spec, context, &handlerRef)

        for action in actions {
            var ref: EventHotKeyRef?
            let id = EventHotKeyID(signature: Self.signature, id: action.rawValue)
            let status = RegisterEventHotKey(UInt32(action.keyCode), UInt32(action.modifiers), id,
                                             GetApplicationEventTarget(), 0, &ref)
            if status == noErr, let ref { refs.append(ref) } else {
                failed.append(action)
                Log.app.error("Hotkey \(action.display, privacy: .public) unavailable (status \(status))")
            }
        }
    }

    func unregisterAll() {
        refs.forEach { UnregisterEventHotKey($0) }
        refs.removeAll()
        if let handlerRef { RemoveEventHandler(handlerRef) }
        handlerRef = nil
    }
}
