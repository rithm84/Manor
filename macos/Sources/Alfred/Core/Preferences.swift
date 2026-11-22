import Combine
import Foundation

/// What Alfred is for right now. Chosen in Settings ▸ Alfred and kept per Mac.
public enum AlfredMode: String, CaseIterable, Identifiable, Sendable {
    /// A general assistant: ask about anything on screen or any question. Never listens.
    case general
    /// Preparation and live conversation: listens to system audio and microphone, with DSA-focused answers.
    case interview

    public var id: String { rawValue }
    public var title: String { self == .general ? "General" : "Prep" }
}

/// The answer style inside Prep mode.
public enum AssistMode: String, CaseIterable, Identifiable, Sendable {
    case interview, coding, systemDesign, meeting
    public var id: String { rawValue }
    public var title: String {
        switch self {
        case .interview: "Interview"
        case .coding: "Coding"
        case .systemDesign: "System Design"
        case .meeting: "Meeting"
        }
    }
}

/// How the notch opens Alfred: resting the pointer on it (the default), or clicking it.
public enum NotchOpening: String, CaseIterable, Identifiable, Sendable {
    case hover, click
    public var id: String { rawValue }
    public var title: String { self == .hover ? "Hover" : "Click" }
}

/// User-facing, non-secret preferences persisted in UserDefaults under `manor.alfred.*`. Keys never live here.
@MainActor
public final class Preferences: ObservableObject {
    private let defaults: UserDefaults
    nonisolated static let prefix = "manor.alfred."

    @Published public var alfredMode: AlfredMode { didSet { set(alfredMode.rawValue, "mode") } }
    /// Prep mode's answer style.
    @Published public var mode: AssistMode { didSet { set(mode.rawValue, "interviewStyle") } }
    @Published public var codingLanguage: String { didSet { set(codingLanguage, "codingLanguage") } }
    @Published public var roleContext: String { didSet { set(roleContext, "roleContext") } }
    @Published public var extraInstructions: String { didSet { set(extraInstructions, "extraInstructions") } }
    /// Answer text size in the notch card.
    @Published public var textScale: Double { didSet { set(textScale, "textScale") } }
    @Published public var captureMic: Bool { didSet { set(captureMic, "captureMic") } }
    @Published public var listenOnLaunch: Bool { didSet { set(listenOnLaunch, "listenOnLaunch") } }
    @Published public var saveSessions: Bool { didSet { set(saveSessions, "saveSessions") } }
    /// Start answering (hidden) as soon as an interviewer question ends, so ⌃⌥␣ is instant.
    @Published public var prefetchAnswers: Bool { didSet { set(prefetchAnswers, "prefetchAnswers") } }
    /// Every answer also sees a screenshot of the display under the cursor (needs Screen Recording).
    @Published public var includeScreen: Bool { didSet { set(includeScreen, "includeScreen") } }
    /// With the screen included, answers also get the front window's text (needs Accessibility).
    @Published public var includeWindowText: Bool { didSet { set(includeWindowText, "includeWindowText") } }
    /// Whether the notch opens Alfred on hover or on click.
    @Published public var notchOpening: NotchOpening { didSet { set(notchOpening.rawValue, "notchOpening") } }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        func value<T>(_ key: String) -> T? { defaults.object(forKey: Self.prefix + key) as? T }
        alfredMode = AlfredMode(rawValue: value("mode") ?? "") ?? .general
        mode = AssistMode(rawValue: value("interviewStyle") ?? "") ?? .interview
        codingLanguage = value("codingLanguage") ?? "Python"
        roleContext = value("roleContext") ?? ""
        extraInstructions = value("extraInstructions") ?? ""
        textScale = value("textScale") ?? 1.0
        captureMic = value("captureMic") ?? true
        listenOnLaunch = value("listenOnLaunch") ?? false
        saveSessions = value("saveSessions") ?? true
        prefetchAnswers = value("prefetchAnswers") ?? true
        includeScreen = value("includeScreen") ?? true
        includeWindowText = value("includeWindowText") ?? true
        notchOpening = NotchOpening(rawValue: value("notchOpening") ?? "") ?? .hover
    }

    private func set(_ value: Any, _ key: String) { defaults.set(value, forKey: Self.prefix + key) }

    public static let languages = ["Python", "C++", "Java", "JavaScript", "TypeScript", "Go", "Rust", "Swift", "C", "Kotlin", "C#"]
}
