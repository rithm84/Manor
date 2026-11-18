import CoreGraphics
import Foundation
import Testing
@testable import ManorKit

private let fields = JobRoleFields(
  company: "OpenAI", role: "SWE Intern", location: "San Francisco, CA", postingLink: "https://openai.com/careers/example",
  datePosted: "2026-08-14", stage: .interview2, appliedDate: "2026-08-17", oaDueDate: "2026-08-20", oaCompletedDate: nil,
  interview1Date: "2026-08-22", interview2Date: "2026-08-29", interview3Date: nil, decisionDate: nil, resumeId: nil, term: nil
)

private let oaRole = JobRoleFields(
  company: "Databricks", role: "SWE Intern", location: "San Francisco, CA", datePosted: "2026-08-14", stage: .oa,
  appliedDate: "2026-08-17", oaDueDate: "2026-08-22"
)

private func transition(_ id: String, _ role: String, _ from: JobStage?, _ to: JobStage, _ at: String) -> JobStageTransition {
  JobStageTransition(id: id, roleId: role, fromStage: from, toStage: to, changedAt: at)
}

private func link(_ flow: JobFlowData, _ source: JobFlowStage, _ target: JobFlowStage) -> Int? {
  flow.links.first { $0.source == source && $0.target == target }?.value
}

@Suite("Jobs validation")
struct JobsValidationTests {
  @Test func keepsOneCompleteSchemaAtEveryStage() throws {
    #expect(try fields.validated() == fields)
    var early = fields
    early.stage = .toApply
    early.appliedDate = nil
    early.interview2Date = nil
    let parsed = try early.validated()
    #expect(parsed.stage == .toApply)
    #expect(parsed.appliedDate == nil)
  }

  @Test func normalizesResumeReferenceAndCycle() throws {
    var withResume = fields
    withResume.resumeId = " resume-1 "
    withResume.term = "  "
    let parsed = try withResume.validated()
    #expect(parsed.resumeId == "resume-1")
    #expect(parsed.term == nil)
    withResume.resumeId = ""
    #expect(throws: JobValidationError.self) { try withResume.validated() }
  }

  @Test func rejectsUnsafeLinksAndUnrealDates() {
    var unsafe = fields
    unsafe.postingLink = "javascript:alert(1)"
    #expect(throws: JobValidationError.self) { try unsafe.validated() }
    var badDate = fields
    badDate.decisionDate = "2026-02-30"
    #expect(throws: JobValidationError.self) { try badDate.validated() }
    var blank = fields
    blank.company = "   "
    #expect(throws: JobValidationError.self) { try blank.validated() }
  }

  @Test func acceptsUnsetOptionalProperties() throws {
    var sparse = fields
    sparse.location = ""
    sparse.postingLink = ""
    sparse.datePosted = nil
    #expect(try sparse.validated().location == "")
  }

  @Test func readsRowsWithTheShortColumnNames() throws {
    let row: Row = [
      "id": "job-1", "company": "Ramp", "role": "SWE Intern", "location": "New York, NY", "link": "", "posted": "2026-08-14",
      "stage": "oa", "applied": "2026-08-17", "oa_due": "2026-08-22", "oa_done": "2026-08-21", "interview1": nil, "interview2": nil,
      "interview3": nil, "decision": nil, "resume_id": nil, "term": "Summer 2027", "created_at": "2026-08-14T12:00:00Z",
      "updated_at": "2026-08-20T12:00:00Z", "revision": 3, "deleted_at": nil
    ]
    let role = try JobRole(row: row)
    #expect(role.stage == .oa)
    #expect(role.fields.oaCompletedDate == "2026-08-21")
    #expect(role.fields.term == "Summer 2027")
    #expect(role.revision == 3)
  }

  @Test func sendsTheCommandColumnsTheServiceSends() {
    let input = fields.commandInput
    #expect(input["link"] == .string("https://openai.com/careers/example"))
    #expect(input["interview2"] == .string("2026-08-29"))
    #expect(input["oa_done"] == .null)
    #expect(input["stage"] == .string("interview_2"))
    #expect(Set(input.keys) == ["company", "role", "location", "link", "posted", "stage", "applied", "oa_due", "oa_done",
                                "interview1", "interview2", "interview3", "decision", "resume_id", "term"])
  }

  @Test func sortsHiringCycles() {
    #expect(jobTermSortKey("Summer 2027") > jobTermSortKey("Spring 2027"))
    #expect(jobTermSortKey("Fall 2026") < jobTermSortKey("Summer 2027"))
    #expect(jobTermSortKey(nil) == .infinity)
  }
}

@Suite("Jobs presentation")
struct JobsPresentationTests {
  @Test func showsOnlyTheCurrentMeaningfulUpdate() {
    #expect(JobLabels.currentUpdate(oaRole, today: "2026-08-20") == "OA due Saturday")
    var later = oaRole
    later.oaDueDate = "2026-08-29"
    #expect(JobLabels.currentUpdate(later, today: "2026-08-20") == "OA due Aug 29")
    var overdue = oaRole
    overdue.oaDueDate = "2026-08-18"
    #expect(JobLabels.currentUpdate(overdue, today: "2026-08-20") == "OA overdue Aug 18")
    #expect(JobLabels.oaOverdue(overdue, today: "2026-08-20"))
    overdue.oaCompletedDate = "2026-08-17"
    #expect(JobLabels.currentUpdate(overdue, today: "2026-08-20") == "OA done Aug 17")
    #expect(JobLabels.detailTone(overdue) == .success)
    #expect(!JobLabels.oaOverdue(overdue, today: "2026-08-20"))
    var interview = oaRole
    interview.stage = .interview2
    #expect(JobLabels.currentUpdate(interview, today: "2026-08-20") == "Round 2 date not set")
  }

  @Test func usesRelativeAndAbsolutePostingDates() {
    #expect(JobLabels.posted("2026-08-20", today: "2026-08-20") == "Today")
    #expect(JobLabels.posted("2026-08-19", today: "2026-08-20") == "Yesterday")
    #expect(JobLabels.posted("2026-08-18", today: "2026-08-20") == "2d ago")
    #expect(JobLabels.posted("2026-07-30", today: "2026-08-20") == "Jul 30")
    #expect(JobLabels.posted(nil, today: "2026-08-20") == "Not set")
  }

  @Test func assignsDistinctTonesToActiveAndDecidedUpdates() {
    var role = oaRole
    role.stage = .interview1
    #expect(JobLabels.detailTone(role) == .plum)
    role.stage = .offer
    #expect(JobLabels.detailTone(role) == .success)
    role.stage = .rejected
    #expect(JobLabels.detailTone(role) == .overdue)
    role.stage = .applied
    #expect(JobLabels.detailTone(role) == nil)
  }

  @Test func groupedDropsRequireAnExplicitChoice() {
    #expect(JobStageRequest.column(.interview).initialStage == nil)
    #expect(JobStageRequest.column(.interview).options == [.interview1, .interview2, .interview3])
    #expect(JobStageRequest.column(.decided).initialStage == nil)
    #expect(JobStageRequest.column(.decided).choicePrompt == "Choose outcome")
    #expect(JobStageRequest.column(.oa).initialStage == .oa)
    #expect(JobStageRequest.stage(.interview3).initialStage == .interview3)
    #expect(!JobStageRequest.column(.interview).moves(from: .interview2))
    #expect(JobStageRequest.column(.decided).moves(from: .interview2))
    #expect(!JobStageRequest.stage(.oa).moves(from: .oa))
  }

  @Test func movesLeadWithTheDestinationDate() {
    #expect(JobStage.applied.dateField == .appliedDate)
    #expect(JobStage.rejected.dateField == .decisionDate)
    #expect(JobStage.interview3.column == .interview)
  }

  @Test func countsFreshRoles() {
    let role = JobRole(id: "a", fields: JobRoleFields(company: "A", role: "B", datePosted: "2026-08-20"), createdAt: "", updatedAt: "", revision: 1)
    #expect(JobLabels.freshRolesNote(JobsState(today: "2026-08-20", roles: [role], transitions: [])) == "1 new today")
    #expect(JobLabels.freshRolesNote(JobsState(today: "2026-08-21", roles: [role], transitions: [])) == nil)
  }
}

@Suite("Jobs flow")
struct JobsFlowTests {
  @Test func dropsCorrectedHops() {
    let transitions = [
      transition("1", "a", .toApply, .applied, "2026-08-01T12:00:00.000Z"),
      transition("2", "b", .toApply, .applied, "2026-08-02T12:00:00.000Z"),
      transition("3", "a", .applied, .oa, "2026-08-03T12:00:00.000Z"),
      transition("4", "a", .oa, .rejected, "2026-08-04T12:00:00.000Z"),
      transition("5", "b", .applied, .oa, "2026-08-05T12:00:00.000Z"),
      transition("6", "b", .oa, .applied, "2026-08-06T12:00:00.000Z")
    ]
    let flow = JobFlow.data(roles: [("a", .rejected), ("b", .applied)], transitions: transitions)
    #expect(flow.appliedCount == 2)
    #expect(link(flow, .applied, .responded) == 1)
    #expect(link(flow, .applied, .noResponse) == 1)
    #expect(link(flow, .responded, .oa) == 1)
    #expect(link(flow, .oa, .rejected) == 1)
    #expect(flow.links.count == 4)
  }

  @Test func excludesRolesCorrectedBackToToApply() {
    let transitions = [
      transition("1", "a", .applied, .oa, "2026-08-01T12:00:00.000Z"),
      transition("2", "a", .oa, .interview1, "2026-08-01T12:01:00.000Z"),
      transition("3", "a", .interview1, .toApply, "2026-08-01T12:02:00.000Z")
    ]
    let flow = JobFlow.data(roles: [("a", .toApply)], transitions: transitions)
    #expect(flow == JobFlowData(appliedCount: 0, nodes: [], links: []))
  }

  @Test func countsARoleOncePerEdge() {
    let transitions = [
      transition("1", "a", .applied, .oa, "2026-08-01T12:00:00.000Z"),
      transition("2", "a", .oa, .applied, "2026-08-01T12:01:00.000Z"),
      transition("3", "a", .applied, .oa, "2026-08-01T12:02:00.000Z"),
      transition("4", "a", .oa, .interview1, "2026-08-01T12:03:00.000Z"),
      transition("5", "b", .applied, .oa, "2026-08-02T12:00:00.000Z")
    ]
    let flow = JobFlow.data(roles: [("a", .interview1), ("b", .oa)], transitions: transitions)
    #expect(link(flow, .applied, .responded) == 2)
    #expect(link(flow, .responded, .oa) == 2)
    #expect(link(flow, .oa, .interview1) == 1)
    #expect(flow.links.count == 3)
  }

  @Test func omitsCorrectionsThatWouldMakeTheFlowCyclic() {
    let transitions = [
      transition("1", "a", .offer, .rejected, "2026-08-06T12:00:00.000Z"),
      transition("2", "b", .interview2, .applied, "2026-08-07T12:00:00.000Z")
    ]
    let flow = JobFlow.data(roles: [("a", .rejected), ("b", .applied)], transitions: transitions)
    #expect(link(flow, .applied, .responded) == 1)
    #expect(link(flow, .applied, .noResponse) == 1)
    #expect(link(flow, .responded, .rejected) == 1)
    #expect(flow.links.count == 3)
    #expect(!flow.nodes.contains(.offer))
  }

  @Test func includesImportedApplicationsWithoutHistory() {
    let flow = JobFlow.data(roles: [("offer", .offer), ("p1", .applied), ("p2", .applied)], transitions: [])
    #expect(flow.appliedCount == 3)
    #expect(link(flow, .applied, .responded) == 1)
    #expect(link(flow, .applied, .noResponse) == 2)
    #expect(link(flow, .responded, .offer) == 1)
    #expect(flow.links.count == 3)
    #expect(flow.links.first { $0.target == .noResponse }?.summary == "Applied to No response yet: 2 roles")
  }

  @Test func laysOutRibbonsProportionalToRoleCounts() {
    let flow = JobFlow.data(roles: [("a", .offer), ("b", .applied), ("c", .applied), ("d", .rejected)], transitions: [])
    let layout = JobFlowLayout(data: flow, size: CGSize(width: 800, height: 300))
    #expect(layout.nodes.count == flow.nodes.count)
    for node in layout.nodes {
      #expect(node.rect.minY >= 0 && node.rect.maxY <= 300)
      #expect(node.rect.minX >= 0 && node.rect.maxX <= 800)
    }
    let applied = layout.nodes.first { $0.stage == .applied }!
    let responded = layout.nodes.first { $0.stage == .responded }!
    #expect(applied.rect.minX < responded.rect.minX)
    let noResponse = layout.ribbons.first { $0.link.target == .noResponse }!
    let toResponded = layout.ribbons.first { $0.link.target == .responded }!
    #expect(abs(noResponse.width - toResponded.width) < 0.001)
    // The applied bar's outgoing bands fill it exactly.
    let outgoing = layout.ribbons.filter { $0.link.source == .applied }.reduce(0) { $0 + $1.width }
    #expect(abs(outgoing - applied.rect.height) < 0.001)
    #expect(layout.hit(CGPoint(x: applied.rect.midX, y: applied.rect.midY)) != nil)
  }
}

@Suite("Browse filters")
struct BrowseFilterTests {
  let listings = [
    JobListing(id: "one", company: "Ramp", role: "SWE Intern", locations: "New York, NY", url: "https://example.test/1", posted: "2026-08-25", term: "Summer 2027", category: "Software", added: false),
    JobListing(id: "two", company: "Jane Street", role: "Quant Intern", locations: "New York, NY", url: "https://example.test/2", posted: "2026-08-20", term: "Summer 2027", category: "Quant", added: true),
    JobListing(id: "three", company: "Stripe", role: "Infra Intern", locations: "Seattle, WA", url: "https://example.test/3", posted: "2026-07-30", term: "Fall 2026", category: "Software", added: false)
  ]

  @Test func combinesRulesWithAnd() {
    let rules = [
      BrowseFilterRule(condition: .term("Summer 2027")),
      BrowseFilterRule(condition: .category("Software")),
      BrowseFilterRule(condition: .added(.notAdded))
    ]
    #expect(rules.filter(listings).map(\.id) == ["one"])
  }

  @Test func matchesCompanyAndLocationBySubstring() {
    #expect([BrowseFilterRule(condition: .company("jane"))].filter(listings).map(\.id) == ["two"])
    #expect([BrowseFilterRule(condition: .location("SEATTLE"))].filter(listings).map(\.id) == ["three"])
    #expect([BrowseFilterRule(condition: .company("   "))].filter(listings) == listings)
    #expect([BrowseFilterRule]().filter(listings) == listings)
  }

  @Test func supportsPostedOperators() {
    #expect(BrowseFilterRule(condition: .posted(.before, from: "2026-08-01", to: "2026-08-01")).matches(listings[2]))
    #expect(BrowseFilterRule(condition: .posted(.on, from: "2026-08-20", to: "2026-08-20")).matches(listings[1]))
    #expect(BrowseFilterRule(condition: .posted(.after, from: "2026-08-24", to: "2026-08-24")).matches(listings[0]))
    #expect([BrowseFilterRule(condition: .posted(.within, from: "2026-08-20", to: "2026-08-25"))].filter(listings).map(\.id) == ["one", "two"])
  }

  @Test func seedsRulesFromTheFeed() throws {
    let terms = ["Summer 2027", "Fall 2026"], categories = ["Software", "Quant"]
    #expect(try BrowseFilterRule.make(.term, today: "2026-08-26", terms: terms, categories: categories).condition == .term("Summer 2027"))
    #expect(try BrowseFilterRule.make(.added, today: "2026-08-26", terms: terms, categories: categories).condition == .added(.notAdded))
    #expect(try BrowseFilterRule.make(.posted, today: "2026-08-26", terms: terms, categories: categories).condition == .posted(.on, from: "2026-08-26", to: "2026-08-26"))
    #expect(throws: JobValidationError.self) { try BrowseFilterRule.make(.term, today: "2026-08-26", terms: [], categories: categories) }
    #expect(BrowseFilterProperty.available(terms: [], categories: categories) == [.category, .company, .location, .posted, .added])
  }

  @Test func keepsIdentityAcrossPropertyAndOperatorChanges() throws {
    let rule = try BrowseFilterRule.make(.company, today: "2026-08-26", terms: [], categories: [])
    let changed = try rule.changingProperty(to: .posted, today: "2026-08-26", terms: [], categories: [])
    #expect(changed.id == rule.id)
    let single = BrowseFilterRule(condition: .posted(.on, from: "2026-08-10", to: "2026-08-10"))
    let range = single.changingOperator(to: .within, today: "2026-08-26")
    #expect(range.condition == .posted(.within, from: "2026-08-10", to: "2026-08-10"))
    #expect(range.changingOperator(to: .after, today: "2026-08-26").condition == .posted(.after, from: "2026-08-10", to: "2026-08-10"))
  }

  @Test func searchesPrecomputedKeysTogetherWithRules() {
    #expect(listings[2].searchKey.contains("seattle"))
    #expect([BrowseFilterRule]().filter(listings, search: "  NEW york ").map(\.id) == ["one", "two"])
    #expect([BrowseFilterRule(condition: .added(.added))].filter(listings, search: "new york").map(\.id) == ["two"])
    #expect([BrowseFilterRule]().filter(listings, search: "") == listings)
    #expect([BrowseFilterRule(condition: .company("STRIPE"))].filter(listings, search: "infra").map(\.id) == ["three"])
  }

  @Test func buildsTheFeedVocabulary() {
    let page = JobFeedPage(listings: listings)
    #expect(page.terms == ["Summer 2027", "Fall 2026"])
    #expect(page.categories == ["Quant", "Software"])
    #expect(listings[0].matches(search: "ramp"))
    #expect(!listings[0].matches(search: "seattle"))
  }

  @Test func readsListingRows() {
    let row: Row = ["id": "x", "company": "Ramp", "role": "SWE", "locations": "NYC", "url": "https://x.test", "posted": "2026-08-25",
                    "term": "", "category": "", "active": true]
    #expect(JobListing(row: row, added: true)?.added == true)
    var inactive = row
    inactive["active"] = false
    #expect(JobListing(row: inactive, added: false) == nil)
  }
}

@Suite("Resumes")
struct ResumeTests {
  @Test func requiresAPdf() {
    #expect(throws: JobValidationError.self) { try ResumesService.validate(fileName: "resume.docx") }
    #expect(throws: Never.self) { try ResumesService.validate(fileName: "Resume.PDF") }
  }

  @Test func keepsLabelsWithinTheColumnLimit() {
    let long = String(repeating: "a", count: 200) + ".pdf"
    let label = ResumesService.label(for: long)
    #expect(label.count == 120)
    #expect(label.hasSuffix(".pdf"))
    #expect(ResumesService.label(for: "cv.pdf") == "cv.pdf")
  }

  @Test func readsVersionRows() {
    let version = ResumeVersion(row: ["id": "r1", "label": "cv.pdf", "file_name": "cv.pdf", "byte_size": 1024, "uploaded_at": "2026-08-01T00:00:00Z"])
    #expect(version?.byteSize == 1024)
    #expect(ResumeVersion(row: ["id": "r1"]) == nil)
  }
}
