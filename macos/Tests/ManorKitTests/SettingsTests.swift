import Foundation
import Testing
@testable import ManorKit

@Suite("Settings")
struct SettingsTests {
  @Test func pkceChallengeIsTheBase64URLSHA256OfTheVerifier() {
    let pkce = SettingsDomain.PKCE(verifier: "dBjftJeZ4CVP-mJ92heqfaH8vVJT7wbTuCQqHjhvzYk")
    #expect(pkce.challenge == "rpEtg5qH22crqdpHmT6he35bWJDmgt1SNSbiF2Kp2yw")
    let random = SettingsDomain.PKCE.random()
    #expect(random.verifier.range(of: #"^[A-Za-z0-9_-]{43}$"#, options: .regularExpression) != nil)
    #expect(random.challenge.range(of: #"^[A-Za-z0-9_-]{43}$"#, options: .regularExpression) != nil)
  }

  @Test func authorizationIdsKeepTheirURLSafeShape() {
    #expect(SettingsDomain.validAuthorizationId("abcdefgh12345678abcdefgh12345678") != nil)
    #expect(SettingsDomain.validAuthorizationId("short") == nil)
    #expect(SettingsDomain.validAuthorizationId("has spaces in it") == nil)
    #expect(SettingsDomain.validAuthorizationId("../../etc/passwd") == nil)
  }

  @Test func connectionCallbacksReadTheReturnedQuery() {
    #expect(SettingsDomain.connectionCallback(from: [:]) == nil)
    #expect(SettingsDomain.connectionCallback(from: ["connection_code": "c"]) == nil)
    #expect(SettingsDomain.connectionCallback(from: ["connection_code": "c", "connection_state": "s", "connection_provider": "x"])
      == .code(provider: "x", code: "c", state: "s"))
    #expect(SettingsDomain.connectionCallback(from: ["connection_code": "c", "connection_state": "s"])
      == .code(provider: "google", code: "c", state: "s"))
    #expect(SettingsDomain.connectionCallback(from: ["connection_error": "access_denied"]) == .failure("The connection was cancelled."))
    #expect(SettingsDomain.connectionCallback(from: ["connection_error": "The connection request expired. Try connecting again."])
      == .failure("The connection request expired. Try connecting again."))
  }

  @Test func agentConnectionsParseAndSortNewestFirst() throws {
    let value: JSONValue = [
      ["client_id": "6F1C0E8A-7E36-4C59-9C3E-6D2B1C3A4B5C", "can_write": true, "authorized_at": "2026-10-01T10:00:00.123456+00:00"],
      ["client_id": "1b8a3f2e-0000-4000-8000-000000000001", "can_write": false, "authorized_at": "2026-11-01T10:00:00+00:00"]
    ]
    let connections = try SettingsDomain.agentConnections(from: value)
    #expect(connections.map(\.canWrite) == [false, true])
    #expect(connections[1].clientId == "6f1c0e8a-7e36-4c59-9c3e-6d2b1c3a4b5c")
    #expect(throws: (any Error).self) { try SettingsDomain.agentConnections(from: [["client_id": "not-a-uuid", "can_write": true, "authorized_at": "2026-11-01T10:00:00Z"]]) }
  }

  @Test func timestampsParseEveryPostgresShape() throws {
    let expected = try #require(SettingsDomain.parseTimestamp("2026-08-25T09:41:00Z"))
    #expect(SettingsDomain.parseTimestamp("2026-08-25T09:41:00+00:00") == expected)
    #expect(SettingsDomain.parseTimestamp("2026-08-25 09:41:00+00") == expected)
    #expect(SettingsDomain.parseTimestamp("2026-08-25T02:41:00-07:00") == expected)
    #expect(SettingsDomain.parseTimestamp("2026-08-25T09:41:00.000000+00:00") == expected)
    let micro = try #require(SettingsDomain.parseTimestamp("2026-08-25T09:41:00.123456+00:00"))
    #expect(abs(micro.timeIntervalSince(expected) - 0.123) < 0.001)
    #expect(SettingsDomain.parseTimestamp("not a date") == nil)
  }

  @Test func courseFeedSummaryNamesHostCountAndCheck() throws {
    let zone = try #require(TimeZone(identifier: "America/Los_Angeles"))
    let checked = try #require(SettingsDomain.parseTimestamp("2026-11-17T17:05:00Z"))
    let status = SettingsDomain.CourseFeedStatus(connected: true, host: "bruinlearn.ucla.edu", lastCheckedAt: checked, lastItemCount: 1, lastError: nil)
    #expect(SettingsDomain.courseFeedSummary(status, timeZone: zone) == "Connected to bruinlearn.ucla.edu. The last check found 1 item. Checked Nov 17, 9:05 AM.")
    let failed = SettingsDomain.CourseFeedStatus(connected: true, host: "canvas.test", lastCheckedAt: nil, lastItemCount: 4, lastError: "The feed returned 404")
    #expect(SettingsDomain.courseFeedSummary(failed, timeZone: zone) == "Connected to canvas.test. The last check failed: The feed returned 404")
    #expect(SettingsDomain.courseFeedConnected(host: "canvas.test", count: 2) == "Course calendar connected to canvas.test. 2 items are due in the next two weeks.")
    #expect(SettingsDomain.validFeedLink("  https://canvas.test/feeds/calendars/user_1.ics ") == "https://canvas.test/feeds/calendars/user_1.ics")
    #expect(SettingsDomain.validFeedLink("canvas calendar") == nil)
  }

  @Test func profileInputCarriesSettingsAndRevision() {
    let input = SettingsDomain.profileInput(name: "  Ada  ", timezone: "Europe/London", settings: ["avatar_file_id": "f"], revision: 4)
    #expect(input["name"] == "Ada")
    #expect(input["timezone"] == "Europe/London")
    #expect(input["settings"] == ["avatar_file_id": "f"])
    #expect(input["expected_revision"] == 4)
    #expect(SettingsDomain.nameProblem("   ") == "Enter a name.")
    #expect(SettingsDomain.nameProblem(String(repeating: "a", count: 121)) != nil)
    #expect(SettingsDomain.nameProblem("Ada") == nil)
  }

  @Test func timeZoneLabelsShowCityAndOffset() throws {
    let winter = try #require(SettingsDomain.parseTimestamp("2026-01-15T12:00:00Z"))
    #expect(SettingsDomain.timeZoneLabel("America/Los_Angeles", at: winter) == "Los Angeles (GMT-8)")
    #expect(SettingsDomain.timeZoneLabel("Asia/Kolkata", at: winter) == "Kolkata (GMT+5:30)")
    #expect(SettingsDomain.timeZoneLabel("UTC", at: winter) == "UTC (GMT)")
    let choices = SettingsDomain.timeZoneChoices(including: "Etc/GMT+3")
    #expect(choices.contains("America/New_York") && choices.contains("Etc/GMT+3") && choices.contains("UTC"))
  }

  // MARK: Knowledge base

  private func entry(_ id: String = "kb-1", source: KnowledgeBase.Source = .capture, url: String? = "https://example.com/post", title: String? = "A post",
                     author: String? = "Ada", summary: String? = "A summary.", status: KnowledgeBase.Status = .normalized, at: String = "2026-08-25T09:41:00Z") -> KnowledgeBase.Entry {
    KnowledgeBase.Entry(id: id, source: source, url: url, title: title, author: author, summary: summary, contentMd: nil, status: status,
                        error: nil, capturedAt: SettingsDomain.parseTimestamp(at)!, revision: 1)
  }

  @Test func captureHostAndTitleFallBack() {
    #expect(KnowledgeBase.host("https://www.simonwillison.net/2026/aug") == "simonwillison.net")
    #expect(KnowledgeBase.host("https://x.com/karpathy/status/1") == "x.com")
    #expect(KnowledgeBase.host("not a url") == nil)
    #expect(KnowledgeBase.host(nil) == nil)
    #expect(KnowledgeBase.title(entry(title: "Kernel tuning notes")) == "Kernel tuning notes")
    #expect(KnowledgeBase.title(entry(url: "https://www.example.com/a", title: nil)) == "example.com")
    #expect(KnowledgeBase.title(entry(url: nil, title: "  ")) == "Screen capture")
    #expect(KnowledgeBase.isSecureLink("https://x.com/a"))
    #expect(!KnowledgeBase.isSecureLink("http://x.com/a"))
    #expect(!KnowledgeBase.isSecureLink("javascript:alert(1)"))
  }

  @Test func captureTimeLabelsUseTheAccountZone() throws {
    let zone = try #require(TimeZone(identifier: "America/Los_Angeles"))
    let now = try #require(SettingsDomain.parseTimestamp("2026-08-25T19:00:00Z"))
    func label(_ value: String) -> String { KnowledgeBase.timeLabel(SettingsDomain.parseTimestamp(value)!, now: now, timeZone: zone) }
    #expect(label("2026-08-25T16:41:00Z") == "9:41 AM")
    #expect(label("2026-08-25T22:05:00Z") == "3:05 PM")
    #expect(label("2026-08-22T16:41:00Z") == "Aug 22")
    #expect(label("2026-01-01T05:00:00Z") == "Dec 31, 2025")
  }

  @Test func pendingAndSearch() {
    #expect(KnowledgeBase.hasPending([entry(status: .pending), entry("kb-2")]))
    #expect(!KnowledgeBase.hasPending([entry(), entry("kb-2", status: .failed)]))
    let subject = entry(url: "https://simonwillison.net/cuda", title: "CUDA occupancy", author: "Simon", summary: "Bank conflicts explained.")
    #expect(KnowledgeBase.matches(subject, query: ""))
    #expect(KnowledgeBase.matches(subject, query: "Occupancy"))
    #expect(KnowledgeBase.matches(subject, query: "bank conflicts"))
    #expect(KnowledgeBase.matches(subject, query: "simonwillison.net"))
    #expect(!KnowledgeBase.matches(subject, query: "rendering"))
    #expect(!KnowledgeBase.matches(entry(url: nil, title: nil, author: nil, summary: nil), query: "x"))
  }

  @Test func bookmarksKeepSourceOrderWithinASync() {
    let entries = [
      entry("first-sync-a", at: "2026-08-20T10:00:00.100Z"),
      entry("second-sync-a", at: "2026-08-25T10:00:00.100Z"),
      entry("first-sync-b", at: "2026-08-20T10:00:00.101Z"),
      entry("second-sync-b", at: "2026-08-25T10:00:00.100Z"),
      entry("second-sync-c", at: "2026-08-25T10:00:00.250Z")
    ]
    #expect(KnowledgeBase.ordered(entries).map(\.id) == ["second-sync-a", "second-sync-b", "second-sync-c", "first-sync-a", "first-sync-b"])
  }

  @Test func entriesSkipRemovedAndMalformedRows() {
    let rows: [Row] = [
      ["id": "a", "source": "x_bookmark", "status": "normalized", "captured_at": "2026-08-25T10:00:00Z", "raw": ["post_url": "https://x.com/i/status/1"], "revision": 3],
      ["id": "b", "source": "capture", "status": "pending", "captured_at": "2026-08-25T10:00:00Z", "deleted_at": "2026-08-26T10:00:00Z"],
      ["id": "c", "source": "mystery", "status": "pending", "captured_at": "2026-08-25T10:00:00Z"]
    ]
    let entries = KnowledgeBase.entries(from: rows)
    #expect(entries.map(\.id) == ["a"])
    #expect(entries[0].postUrl == "https://x.com/i/status/1")
    #expect(entries[0].revision == 3)
  }

  @Test func legacyZoneLinksMatchTheirCanonicalZone() {
    #expect(SettingsDomain.sameTimeZone("US/Pacific", "America/Los_Angeles"))
    #expect(SettingsDomain.sameTimeZone("UTC", "UTC"))
    #expect(!SettingsDomain.sameTimeZone("America/Los_Angeles", "America/Phoenix"))
    #expect(!SettingsDomain.sameTimeZone("Europe/London", "Africa/Abidjan"))
  }
}
