import Foundation

/// The app's pages, in sidebar order. Command-1 through Command-7 follow this order; Settings is Command-comma.
public enum Route: String, CaseIterable, Identifiable, Hashable, Sendable {
  case home, tracking, pomodoro, problems, jobs, notes, bookmarks, settings

  public var id: String { rawValue }

  public var title: String {
    switch self {
    case .home: return "Home"
    case .tracking: return "Tracking"
    case .pomodoro: return "Pomodoro"
    case .problems: return "Problems"
    case .jobs: return "Jobs"
    case .notes: return "Notes"
    case .bookmarks: return "Bookmarks"
    case .settings: return "Settings"
    }
  }

  public var systemImage: String {
    switch self {
    case .home: return "house"
    case .tracking: return "flame"
    case .pomodoro: return "timer"
    case .problems: return "chevron.left.forwardslash.chevron.right"
    case .jobs: return "briefcase"
    case .notes: return "doc.text"
    case .bookmarks: return "bookmark"
    case .settings: return "gearshape"
    }
  }

  /// The path segment deep links use (`manor://habits`), matching the web routes.
  public var path: String {
    switch self {
    case .problems: return "leetcode"
    default: return rawValue
    }
  }

  public init?(path: String) {
    // Links from before Habits and Mood & Focus became Tracking still open it.
    if path == "habits" || path == "mood-focus" { self = .tracking; return }
    guard let route = Route.allCases.first(where: { $0.path == path }) else { return nil }
    self = route
  }

  /// Pages with a Command-N create action.
  public var supportsCreate: Bool { [.home, .tracking, .jobs, .notes].contains(self) }

  public static var modules: [Route] { allCases.filter { $0 != .settings } }
}
