import Foundation

/// A synced Google event as `calendar_events` stores it.
public struct StoredCalendarEvent: Hashable, Sendable {
  public var id: String
  public var accountId: String
  public var calendarId: String
  public var title: String
  public var startsAt: String?
  public var endsAt: String?
  public var startDate: String?
  public var endDate: String?
  public var allDay: Bool

  public init(id: String, accountId: String, calendarId: String, title: String, startsAt: String?, endsAt: String?, startDate: String?, endDate: String?, allDay: Bool) {
    self.id = id
    self.accountId = accountId
    self.calendarId = calendarId
    self.title = title
    self.startsAt = startsAt
    self.endsAt = endsAt
    self.startDate = startDate
    self.endDate = endDate
    self.allDay = allDay
  }

  public init?(row: Row) {
    guard let id = row["id"]?.string, let accountId = row["account_id"]?.string, let calendarId = row["calendar_id"]?.string,
      let allDay = row["all_day"]?.bool else { return nil }
    self.init(
      id: id, accountId: accountId, calendarId: calendarId, title: row["title"]?.string ?? "",
      startsAt: row["starts_at"]?.string, endsAt: row["ends_at"]?.string,
      startDate: row["start_date"]?.string.map { String($0.prefix(10)) }, endDate: row["end_date"]?.string.map { String($0.prefix(10)) },
      allDay: allDay
    )
  }
}

/// One event occurrence on one account-local day, clamped into that day (00:00 to 24:00).
public struct CalendarDayEvent: Identifiable, Hashable, Sendable {
  public var id: String
  public var calendarId: String
  public var accountId: String
  public var title: String
  public var date: String
  public var start: String
  public var end: String
  public var allDay: Bool
  /// The source calendar's hex swatch, when Google has one.
  public var color: String?
}

public enum CalendarDays {
  /// Projects one stored event onto the requested account-local days: midnight ends exclusively and
  /// multi-day events split per day. All-day dates carry no zone.
  public static func days(_ event: StoredCalendarEvent, dates: [String], timeZone: TimeZone, color: String?) -> [CalendarDayEvent] {
    func make(_ date: String, _ start: String, _ end: String, _ allDay: Bool) -> CalendarDayEvent {
      CalendarDayEvent(id: event.id, calendarId: event.calendarId, accountId: event.accountId, title: event.title, date: date, start: start, end: end, allDay: allDay, color: color)
    }
    if event.allDay {
      guard let startDate = event.startDate, let endDate = event.endDate else { return [] }
      return dates.filter { $0 >= startDate && $0 < endDate }.map { make($0, "00:00", "24:00", true) }
    }
    guard let startsAt = event.startsAt.flatMap(TaskDates.timestamp), let endsAt = event.endsAt.flatMap(TaskDates.timestamp) else { return [] }
    let start = TaskDates.local(startsAt, in: timeZone), end = TaskDates.local(endsAt, in: timeZone)
    return dates
      .filter { $0 >= start.date && $0 <= end.date && !($0 == end.date && end.time == "00:00") }
      .map { make($0, $0 == start.date ? start.time : "00:00", $0 == end.date ? end.time : "24:00", false) }
  }
}
