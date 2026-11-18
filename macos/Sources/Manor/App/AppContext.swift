import Foundation
import ManorKit
import Observation
import SwiftUI

/// Everything a signed-in page needs: the gateway, the account, navigation, toasts, and app-wide signals.
/// Pages read it with `@Environment(AppContext.self)`.
@MainActor
@Observable
public final class AppContext {
  public let session: ManorSession
  public let gateway: Gateway
  public let toasts: ToastCenter
  public var account: ManorAccount
  public var route: Route = .home
  /// Increments when Command-N is pressed on a page that creates; pages observe their own entry.
  public private(set) var createRequests: [Route: Int] = [:]
  /// A deep link's extra path and query for the page it opened (`manor://notes/<id>` gives ["<id>"]).
  public var linkTarget: (route: Route, path: [String], query: [String: String])?
  /// An agent's pending authorization request, shown as a centered dialog over any page.
  public var consentAuthorizationId: String?
  /// The Pomodoro countdown beside the sidebar entry, set by the Pomodoro module.
  public var pomodoroBadge: (text: String, paused: Bool)?

  public init(session: ManorSession, gateway: Gateway, account: ManorAccount, toasts: ToastCenter) {
    self.session = session
    self.gateway = gateway
    self.account = account
    self.toasts = toasts
  }

  public var timeZone: TimeZone { account.timeZone }

  /// A Gregorian calendar in the account's saved time zone. Today, yesterday, and streak days use it.
  public var calendar: Calendar {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = account.timeZone
    calendar.firstWeekday = 2
    return calendar
  }

  /// Today's account-local date as `YYYY-MM-DD`.
  public var today: String { LocalDate.string(from: Date(), in: account.timeZone) }

  public func navigate(to route: Route) { self.route = route }

  public func requestCreate(on route: Route) { createRequests[route, default: 0] += 1 }

  /// Opens a URL that leaves the app in the default browser.
  public func openExternal(_ url: URL) { NSWorkspace.shared.open(url) }
}

/// Account-local calendar dates as the backend stores them (`YYYY-MM-DD`).
public enum LocalDate {
  public static func string(from date: Date, in timeZone: TimeZone) -> String {
    let formatter = DateFormatter()
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = timeZone
    formatter.dateFormat = "yyyy-MM-dd"
    return formatter.string(from: date)
  }

  /// Midnight at the start of `string` in `timeZone`.
  public static func date(from string: String, in timeZone: TimeZone) -> Date? {
    let formatter = DateFormatter()
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = timeZone
    formatter.dateFormat = "yyyy-MM-dd"
    return formatter.date(from: string)
  }

  /// `string` moved by `days` calendar days.
  public static func adding(_ days: Int, to string: String) -> String {
    let utc = TimeZone(identifier: "UTC")!
    guard let date = date(from: string, in: utc) else { return string }
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = utc
    return Self.string(from: calendar.date(byAdding: .day, value: days, to: date) ?? date, in: utc)
  }
}
