import AppKit
import Observation
import SwiftUI

/// System, light, dark, or day and night (light from 6 AM to 6 PM local time). Saved on this Mac.
public enum ThemePreference: String, CaseIterable, Identifiable, Sendable {
  case system, light, dark, temporal
  public var id: String { rawValue }
  public var label: String {
    switch self {
    case .system: return "System"
    case .light: return "Light"
    case .dark: return "Dark"
    case .temporal: return "Day and night"
    }
  }
}

@MainActor
@Observable
public final class ThemeController {
  public private(set) var preference: ThemePreference
  @ObservationIgnored private var boundary: Task<Void, Never>?

  public init() {
    preference = ThemePreference(rawValue: UserDefaults.standard.string(forKey: "manor.theme") ?? "") ?? .system
  }

  public func set(_ preference: ThemePreference) {
    self.preference = preference
    UserDefaults.standard.set(preference.rawValue, forKey: "manor.theme")
    apply()
  }

  /// Applies the preference to the whole app and, for day and night, re-applies at the next boundary.
  public func apply() {
    boundary?.cancel()
    switch preference {
    case .system: NSApp.appearance = nil
    case .light: NSApp.appearance = NSAppearance(named: .aqua)
    case .dark: NSApp.appearance = NSAppearance(named: .darkAqua)
    case .temporal:
      let hour = Calendar.current.component(.hour, from: Date())
      NSApp.appearance = NSAppearance(named: hour >= 6 && hour < 18 ? .aqua : .darkAqua)
      boundary = Task { [weak self] in
        try? await Task.sleep(for: .seconds(Self.secondsToNextBoundary(Date())))
        if !Task.isCancelled { self?.apply() }
      }
    }
  }

  static func secondsToNextBoundary(_ now: Date) -> Double {
    let calendar = Calendar.current
    let hour = calendar.component(.hour, from: now)
    var components = calendar.dateComponents([.year, .month, .day], from: now)
    components.hour = hour < 6 ? 6 : hour < 18 ? 18 : 6
    var next = calendar.date(from: components) ?? now
    if hour >= 18 { next = calendar.date(byAdding: .day, value: 1, to: next) ?? next }
    return max(1, next.timeIntervalSince(now))
  }
}
