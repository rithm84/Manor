import Foundation
import Testing
@testable import ManorKit

private func day(_ string: String) -> CivilDate { CivilDate(string)! }

@Suite("Civil dates")
struct CivilDateTests {
  @Test func roundTripsDayNumbersAcrossCenturies() {
    #expect(CivilDate(dayNumber: 0).string == "1970-01-01")
    #expect(day("2000-02-29").dayNumber == 11_016)
    for number in stride(from: -800_000, through: 800_000, by: 997) {
      #expect(CivilDate(dayNumber: number).dayNumber == number)
    }
  }

  @Test func rejectsImpossibleDates() {
    #expect(CivilDate("2026-02-29") == nil)
    #expect(CivilDate("2024-02-29") != nil)
    #expect(CivilDate("1900-02-29") == nil)
    #expect(CivilDate("2026-13-01") == nil)
    #expect(CivilDate("2026-1-01") == nil)
    #expect(CivilDate("2026-04-31") == nil)
  }

  @Test func weekdaysAreISO() {
    #expect(day("2026-11-16").weekday == 1)  // Monday
    #expect(day("2026-11-22").weekday == 7)  // Sunday
    #expect(day("1969-12-31").weekday == 3)  // Wednesday, before the epoch
  }

  @Test func monthArithmeticClampsTheDay() {
    #expect(day("2026-01-31").adding(months: 1).string == "2026-02-28")
    #expect(day("2024-01-31").adding(months: 1).string == "2024-02-29")
    #expect(day("2026-03-31").adding(months: -1).string == "2026-02-28")
    #expect(day("2026-12-15").adding(months: 1).string == "2027-01-15")
    #expect(day("2026-01-15").adding(months: -13).string == "2024-12-15")
    #expect(CivilMonth(year: 2026, month: 0) == CivilMonth(year: 2025, month: 12))
  }

  @Test func todayFollowsTheAccountZoneNotTheMac() {
    // 2026-11-17 03:30 UTC is still the 16th in Los Angeles and already the 17th in Tokyo.
    let instant = Date(timeIntervalSince1970: 1_794_886_200)
    #expect(CivilDate.today(in: TimeZone(identifier: "America/Los_Angeles")!, now: instant).string == "2026-11-16")
    #expect(CivilDate.today(in: TimeZone(identifier: "Asia/Tokyo")!, now: instant).string == "2026-11-17")
  }
}

@Suite("Month grid")
struct MonthGridTests {
  @Test func startsOnMondayAndAlwaysHasSixWeeks() {
    let november = MonthGrid.days(for: CivilMonth(year: 2026, month: 11))
    #expect(november.count == 42)
    #expect(november.first?.string == "2026-10-26")  // Nov 1 2026 is a Sunday, so the page opens on the Monday before.
    #expect(november.allSatisfy { $0.weekday == november[november.firstIndex(of: $0)! % 7].weekday })
    #expect(november[6].string == "2026-11-01")
    #expect(november.last?.string == "2026-12-06")
  }

  @Test func aMonthStartingOnMondayHasNoLeadingDays() {
    let june = MonthGrid.days(for: CivilMonth(year: 2026, month: 6))
    #expect(june.first?.string == "2026-06-01")
    #expect(MonthGrid.weekdays() == [1, 2, 3, 4, 5, 6, 7])
    #expect(MonthGrid.weekdays(firstWeekday: 7) == [7, 1, 2, 3, 4, 5, 6])
  }

  @Test func boundsDisableDaysAndWholeMonths() {
    let bounds = DateBounds(minimum: day("2026-11-10"), maximum: day("2026-12-05"))
    #expect(!bounds.contains(day("2026-11-09")))
    #expect(bounds.contains(day("2026-11-10")))
    #expect(bounds.contains(day("2026-12-05")))
    #expect(!bounds.contains(day("2026-12-06")))
    #expect(bounds.allowsAny(of: CivilMonth(year: 2026, month: 11)))
    #expect(bounds.allowsAny(of: CivilMonth(year: 2026, month: 12)))
    #expect(!bounds.allowsAny(of: CivilMonth(year: 2026, month: 10)))
    #expect(!bounds.allowsAny(of: CivilMonth(year: 2027, month: 1)))
  }
}

@Suite("Calendar keyboard")
struct CalendarKeyboardTests {
  @Test func arrowsCrossMonthAndYearBoundaries() {
    #expect(DateNavigation.move(day("2026-11-30"), by: .nextDay).string == "2026-12-01")
    #expect(DateNavigation.move(day("2026-12-01"), by: .previousDay).string == "2026-11-30")
    #expect(DateNavigation.move(day("2026-12-28"), by: .nextWeek).string == "2027-01-04")
    #expect(DateNavigation.move(day("2027-01-03"), by: .previousWeek).string == "2026-12-27")
  }

  @Test func pageKeysMoveByMonthAndYear() {
    #expect(DateNavigation.move(day("2026-03-31"), by: .previousMonth).string == "2026-02-28")
    #expect(DateNavigation.move(day("2026-12-31"), by: .nextMonth).string == "2027-01-31")
    #expect(DateNavigation.move(day("2024-02-29"), by: .nextYear).string == "2025-02-28")
  }

  @Test func homeAndEndStayInTheMondayWeek() {
    #expect(DateNavigation.move(day("2026-11-19"), by: .startOfWeek).string == "2026-11-16")
    #expect(DateNavigation.move(day("2026-11-19"), by: .endOfWeek).string == "2026-11-22")
    #expect(DateNavigation.move(day("2026-11-22"), by: .startOfWeek).string == "2026-11-16")
  }

  @Test func movementStopsAtTheBounds() {
    let bounds = DateBounds(minimum: day("2026-11-10"), maximum: day("2026-11-20"))
    #expect(DateNavigation.move(day("2026-11-12"), by: .previousWeek, within: bounds).string == "2026-11-10")
    #expect(DateNavigation.move(day("2026-11-18"), by: .nextMonth, within: bounds).string == "2026-11-20")
    #expect(DateNavigation.move(day("2026-11-10"), by: .previousDay, within: bounds).string == "2026-11-10")
  }
}

@Suite("Typed dates")
struct DateTextParserTests {
  let today = day("2026-11-17")  // a Tuesday

  private func parse(_ text: String, dayFirst: Bool = false) -> String? {
    DateTextParser.parse(text, today: today, dayFirst: dayFirst)?.string
  }

  @Test func relativeWords() {
    #expect(parse("today") == "2026-11-17")
    #expect(parse("Tomorrow") == "2026-11-18")
    #expect(parse("yesterday") == "2026-11-16")
    #expect(parse("next week") == "2026-11-24")
    #expect(parse("in 3 days") == "2026-11-20")
    #expect(parse("+2w") == "2026-12-01")
    #expect(parse("-1") == "2026-11-16")
    #expect(parse("2 weeks ago") == "2026-11-03")
    #expect(parse("1 month") == "2026-12-17")
  }

  @Test func weekdayNames() {
    #expect(parse("fri") == "2026-11-20")
    #expect(parse("tue") == "2026-11-17")
    #expect(parse("next tue") == "2026-11-24")
    #expect(parse("Monday") == "2026-11-23")
    #expect(parse("t") == nil)
  }

  @Test func numericAndNamedDates() {
    #expect(parse("2026-12-03") == "2026-12-03")
    #expect(parse("12/3") == "2026-12-03")
    #expect(parse("12/3", dayFirst: true) == "2026-03-12")
    #expect(parse("25/12") == "2026-12-25")
    #expect(parse("12/25/27") == "2027-12-25")
    #expect(parse("2027/1/5") == "2027-01-05")
    #expect(parse("Nov 20") == "2026-11-20")
    #expect(parse("november 20, 2027") == "2027-11-20")
    #expect(parse("20th Dec") == "2026-12-20")
    #expect(parse("5") == "2026-11-05")
  }

  @Test func impossibleOrUnreadableTextIsRejected() {
    #expect(parse("") == nil)
    #expect(parse("feb 30") == nil)
    #expect(parse("13/13") == nil)
    #expect(parse("soon") == nil)
    #expect(parse("32") == nil)
  }
}

@Suite("Typed times")
struct TimeTextParserTests {
  private func parse(_ text: String) -> String? { TimeTextParser.parse(text)?.string }

  @Test func twelveHourForms() {
    #expect(parse("5:30 pm") == "17:30")
    #expect(parse("5:30PM") == "17:30")
    #expect(parse("5pm") == "17:00")
    #expect(parse("530p") == "17:30")
    #expect(parse("12am") == "00:00")
    #expect(parse("12:15 pm") == "12:15")
    #expect(parse("9.45 a.m.") == "09:45")
    #expect(parse("noon") == "12:00")
    #expect(parse("midnight") == "00:00")
  }

  @Test func twentyFourHourForms() {
    #expect(parse("17:30") == "17:30")
    #expect(parse("1730") == "17:30")
    #expect(parse("17") == "17:00")
    #expect(parse("0:05") == "00:05")
    #expect(parse("9:5") == "09:50")
  }

  @Test func invalidTimesAreRejected() {
    #expect(parse("25:00") == nil)
    #expect(parse("13pm") == nil)
    #expect(parse("7:75") == nil)
    #expect(parse("lunch") == nil)
    #expect(parse("12345") == nil)
  }

  @Test func labelsFollowTheClockStyle() {
    let time = ClockTime(hour: 17, minute: 5)!
    #expect(time.label(twentyFourHour: false) == "5:05 PM")
    #expect(time.label(twentyFourHour: true) == "17:05")
    #expect(ClockTime(hour: 0, minute: 0)!.label(twentyFourHour: false) == "12:00 AM")
    #expect(ClockTime.systemUsesTwentyFourHour(Locale(identifier: "en_US")) == false)
    #expect(ClockTime.systemUsesTwentyFourHour(Locale(identifier: "en_GB")) == true)
  }

  @Test func optionsStepAndKeepAnOffGridValue() {
    let all = TimeOptions.list()
    #expect(all.count == 96)
    #expect(all.first?.string == "00:00" && all.last?.string == "23:45")
    let scratch = TimeOptions.list(step: 15, start: 6 * 60, end: 23 * 60 + 45, including: ClockTime("09:37"))
    #expect(scratch.first?.string == "06:00")
    #expect(scratch.contains(ClockTime("09:37")!))
    #expect(scratch == scratch.sorted())
    #expect(TimeOptions.nearest(to: ClockTime("09:40")!, in: all)?.string == "09:45")
  }
}
