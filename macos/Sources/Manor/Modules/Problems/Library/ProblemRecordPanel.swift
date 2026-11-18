import ManorKit
import SwiftUI

/// What the record dialog opens on.
struct ProblemRecordRequest: Identifiable, Equatable {
  let problemId: String
  /// Opens with the solve form showing.
  let logging: Bool
  var id: String { problemId }
}

/// A problem's record: its labels, source details, grouped sources, and the account's dated solves and reviews.
/// Every manual solve or review appends a separate attempt with an editable past date.
struct ProblemRecordPanel: View {
  let store: ProblemLibraryStore
  let group: ProblemGroup
  let today: String
  let startLogging: Bool
  /// True while a typed solution or an attempt edit is unsaved, so closing asks first.
  @Binding var hasUnsavedWork: Bool
  let requestClose: () -> Void
  let openURL: (URL) -> Void

  @State private var full: ProblemGroup?
  @State private var logging = false
  @State private var newDate = ""
  @State private var newSolution = ""
  @State private var editing: ProblemAttempt?
  @State private var editDate = ""
  @State private var editSolution = ""
  @State private var deleteCandidate: String?
  @State private var submitting = false
  @State private var error: String?

  private var shown: ProblemGroup { full ?? group }
  private var problem: ProblemRecord { shown.problem }
  private var attempts: [ProblemAttempt] { store.history(for: group.problem.id) }

  var body: some View {
    VStack(spacing: 0) {
      header
      Hairline()
      ScrollView {
        VStack(alignment: .leading, spacing: Space.s5) {
          labels
          ProblemSourceDetailsView(metadata: problem.sourceMetadata, openURL: openURL)
          if shown.sources.count > 1 { ProblemSourcesView(group: shown, openURL: openURL) }
          if let error { ErrorBanner(error) }
          history
          logSection
        }
        .padding(Space.s5)
        .frame(maxWidth: .infinity, alignment: .leading)
      }
      .scrollBounceBehavior(.basedOnSize)
    }
    .onAppear {
      newDate = today
      logging = startLogging || attempts.isEmpty
    }
    .task(id: group.id) { await loadFullRecords() }
    .onChange(of: unsaved, initial: true) { _, value in hasUnsavedWork = value }
  }

  private var unsaved: Bool {
    let typed = !newSolution.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    let edited = editing.map { editDate != $0.date || editSolution != $0.solution } ?? false
    return typed || edited
  }

  // MARK: Header

  private var header: some View {
    HStack(alignment: .top, spacing: Space.s3) {
      VStack(alignment: .leading, spacing: Space.s2) {
        Text(problem.title).font(.dialogTitle).foregroundStyle(Palette.ink).textSelection(.enabled)
          .fixedSize(horizontal: false, vertical: true)
        HStack(spacing: Space.s3) {
          if problem.difficulty != nil {
            ProblemDifficultyBadge(difficulty: problem.difficulty, estimated: problem.sourceMetadata?.difficultySource == .estimated)
          }
          Text(problem.kind.label).font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted)
          Text(attempts.count == 1 ? "1 attempt" : "\(attempts.count) attempts").font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted).tabular()
          if !attempts.isEmpty { ProblemStatusLabel(status: .solved) }
          if let url = problem.sourceUrl.flatMap(URL.init(string:)) {
            Button { openURL(url) } label: {
              Label("Open original problem", systemImage: "arrow.up.right").font(.ui(Typography.Size.sm, weight: .medium))
            }
            .buttonStyle(.plain)
            .foregroundStyle(Palette.link)
          }
        }
      }
      Spacer(minLength: Space.s3)
      IconButton("xmark", label: "Close", action: requestClose)
    }
    .padding(.horizontal, Space.s5)
    .padding(.vertical, Space.s4)
  }

  @ViewBuilder
  private var labels: some View {
    let present = ProblemLabelProperty.allCases.filter { !problem.labels($0).isEmpty }
    if !present.isEmpty {
      VStack(alignment: .leading, spacing: Space.s2) {
        ForEach([ProblemLabelProperty.topics, .companies, .collections, .tags].filter(present.contains), id: \.self) { property in
          ProblemChipWrap(property: property, labels: problem.labels(property))
        }
      }
    }
  }

  // MARK: History

  private var history: some View {
    VStack(alignment: .leading, spacing: Space.s3) {
      VStack(alignment: .leading, spacing: 2) {
        Text("Attempt history").font(.ui(Typography.Size.md, weight: .semibold)).foregroundStyle(Palette.ink)
        Text("Most recent first.").font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted)
      }
      if attempts.isEmpty {
        Text("No attempts yet. Your first saved solution appears here.").font(.ui(Typography.Size.body)).foregroundStyle(Palette.inkMuted)
      } else {
        VStack(alignment: .leading, spacing: 0) {
          ForEach(Array(attempts.enumerated()), id: \.element.id) { offset, attempt in
            attemptRow(attempt, number: attempts.count - offset)
            if offset < attempts.count - 1 { Hairline() }
          }
        }
      }
    }
  }

  private func attemptRow(_ attempt: ProblemAttempt, number: Int) -> some View {
    VStack(alignment: .leading, spacing: Space.s2) {
      HStack(spacing: Space.s3) {
        Text("Attempt \(number)").font(.ui(Typography.Size.sm, weight: .semibold)).foregroundStyle(Palette.ink).tabular()
        Text(ProblemDateLabels.day(attempt.date)).font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted).tabular()
        Spacer()
        if deleteCandidate == attempt.id {
          Text("Delete this attempt?").font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkBody)
          Button("Cancel") { deleteCandidate = nil }.buttonStyle(.manor(.ghost, size: .small)).disabled(submitting)
          Button("Delete") { delete(attempt) }.buttonStyle(.manor(.danger, size: .small)).disabled(submitting)
        } else if editing?.id != attempt.id {
          Button { startEditing(attempt) } label: { Label("Edit", systemImage: "pencil") }
            .buttonStyle(.manor(.ghost, size: .small)).disabled(submitting).accessibilityLabel("Edit attempt \(number)")
          Button { deleteCandidate = attempt.id } label: { Label("Delete", systemImage: "trash") }
            .buttonStyle(.manor(.ghost, size: .small)).disabled(submitting).accessibilityLabel("Delete attempt \(number)")
        }
      }
      if editing?.id == attempt.id {
        solutionFields(date: $editDate, solution: $editSolution, autofocus: false)
        HStack {
          Spacer()
          Button("Cancel") { editing = nil }.buttonStyle(.secondary).disabled(submitting)
          Button("Save changes") { saveEdit(attempt) }.buttonStyle(.primary)
            .disabled(submitting || editSolution.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
      } else if attempt.solution.isEmpty {
        Text("No solution was saved with this imported attempt.").font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted)
      } else {
        ProblemSolutionBlock(solution: attempt.solution)
      }
    }
    .padding(.vertical, Space.s3)
  }

  @ViewBuilder
  private var logSection: some View {
    if logging {
      VStack(alignment: .leading, spacing: Space.s3) {
        VStack(alignment: .leading, spacing: 2) {
          Text("Log a solve").font(.ui(Typography.Size.md, weight: .semibold)).foregroundStyle(Palette.ink)
          Text("Save the date and the exact solution you used.").font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted)
        }
        solutionFields(date: $newDate, solution: $newSolution, autofocus: true)
        HStack {
          Spacer()
          Button { saveNew() } label: { Label("Save attempt", systemImage: "plus") }
            .buttonStyle(.primary)
            .keyboardShortcut(.return, modifiers: .command)
            .disabled(submitting || newSolution.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
      }
    } else {
      Button { logging = true } label: { Label("Log a solve", systemImage: "plus") }.buttonStyle(.secondary)
    }
  }

  private func solutionFields(date: Binding<String>, solution: Binding<String>, autofocus: Bool) -> some View {
    VStack(alignment: .leading, spacing: Space.s2) {
      HStack(spacing: Space.s2) {
        Text("Solved or reviewed").font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkBody)
        ProblemDayPicker(label: "Solved or reviewed", value: Binding(get: { date.wrappedValue }, set: { date.wrappedValue = $0 ?? today }), maximum: today, start: today)
      }
      Text("Solution").font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkBody)
      ProblemSolutionEditor(text: solution, autofocus: autofocus)
        .frame(height: 200)
        .background(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).fill(Palette.surfaceCanvas))
        .overlay(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).strokeBorder(Palette.hairlineStrong))
        .overlay(alignment: .topLeading) {
          if solution.wrappedValue.isEmpty {
            Text("Paste your solution here").font(.code()).foregroundStyle(Palette.inkMuted).padding(13).allowsHitTesting(false)
          }
        }
    }
  }

  // MARK: Actions

  private func startEditing(_ attempt: ProblemAttempt) {
    editing = attempt
    editDate = attempt.date
    editSolution = attempt.solution
    deleteCandidate = nil
  }

  private func run(_ work: @escaping () async throws -> Void, then done: @escaping () -> Void) {
    submitting = true
    error = nil
    Task {
      do {
        try await work()
        done()
      } catch {
        self.error = error.localizedDescription
      }
      submitting = false
    }
  }

  private func saveNew() {
    let date = newDate, solution = newSolution
    run({ try await store.addAttempt(problemId: group.problem.id, date: date, solution: solution) }) {
      newSolution = ""
      newDate = today
    }
  }

  private func saveEdit(_ attempt: ProblemAttempt) {
    let date = editDate, solution = editSolution
    run({ try await store.updateAttempt(attempt, date: date, solution: solution) }) { editing = nil }
  }

  private func delete(_ attempt: ProblemAttempt) {
    run({ try await store.deleteAttempt(attempt) }) {
      deleteCandidate = nil
      if editing?.id == attempt.id { editing = nil }
    }
  }

  /// The index keeps only the newest company report of each catalog problem; the dialog joins the mirror's
  /// detail row back (or reads the server, whose rows are whole) so source details list every report.
  /// Without a connection it shows what the index holds.
  private func loadFullRecords() async {
    var records: [ProblemRecord] = []
    for source in group.sources {
      guard let row = await wholeRow(source), var record = try? ProblemRows.record(row, status: source.status, isCustom: source.isCustom) else { return }
      record.status = source.status
      records.append(record)
    }
    if var grouped = (try? ProblemGrouping.groups(records))?.first {
      grouped.problem.status = group.problem.status
      full = grouped
    }
  }

  private func wholeRow(_ source: ProblemRecord) async -> Row? {
    let gateway = store.gateway
    if source.isCustom {
      return try? await gateway.rows("leetcode_problems", where: [RowFilter("id", .string(source.id))]).first
    }
    if let mirror = gateway.localMirror, await mirror.isServing("problem_catalog"),
       case .row(let index?) = try? await mirror.row("problem_catalog", key: source.id) {
      let detail: Row?
      if case .row(let stored) = try? await mirror.row("problem_catalog_detail", key: source.id) { detail = stored } else { detail = nil }
      return try? CatalogRows.join(index, detail: detail)
    }
    return try? await gateway.rowsFromServer("problem_catalog", where: [RowFilter("id", .string(source.id))]).first
  }
}

/// Source recency and provenance: the reported facts, then company reports and source snapshots on demand.
struct ProblemSourceDetailsView: View {
  let metadata: ProblemSourceMetadata?
  let openURL: (URL) -> Void
  @State private var page = 0
  @State private var reportsOpen = false
  @State private var snapshotsOpen = false

  var body: some View {
    if let metadata, metadata.hasFacts || !(metadata.companyReports ?? []).isEmpty || !(metadata.snapshots ?? []).isEmpty {
      VStack(alignment: .leading, spacing: Space.s3) {
        if metadata.hasFacts { facts(metadata) }
        let reports = metadata.sortedReports
        if !reports.isEmpty {
          DisclosureGroup(isExpanded: $reportsOpen) {
            reportTable(reports).padding(.top, Space.s2)
          } label: {
            Text("Company reports \(Text("(\(reports.count.formatted()))").foregroundStyle(Palette.inkMuted))")
              .font(.ui(Typography.Size.sm, weight: .medium)).foregroundStyle(Palette.inkBody).tabular()
          }
        }
        if let snapshots = metadata.snapshots, !snapshots.isEmpty {
          DisclosureGroup(isExpanded: $snapshotsOpen) {
            VStack(alignment: .leading, spacing: Space.s1) {
              ForEach(Array(snapshots.enumerated()), id: \.offset) { _, snapshot in
                if let url = URL(string: snapshot.sourceUrl) {
                  Button(ProblemDateLabels.day(snapshot.snapshotDate)) { openURL(url) }
                    .buttonStyle(.plain).font(.ui(Typography.Size.sm)).foregroundStyle(Palette.link).tabular()
                    .help(snapshot.sourceUrl)
                }
              }
            }
            .padding(.top, Space.s1)
          } label: {
            Text("Source snapshots").font(.ui(Typography.Size.sm, weight: .medium)).foregroundStyle(Palette.inkBody)
          }
        }
      }
    }
  }

  private func facts(_ metadata: ProblemSourceMetadata) -> some View {
    ProblemFlowLayout(spacing: Space.s4) {
      if let asked = metadata.lastAsked { fact("Last asked", ProblemDateLabels.label(asked), help: precisionHelp(asked)) }
      if metadata.reportedFrom != nil || metadata.reportedTo != nil {
        let from = metadata.reportedFrom.map(ProblemDateLabels.label)
        let to = metadata.reportedTo.map(ProblemDateLabels.label)
        fact("Reported period", from.flatMap { from in to.map { "\(from) to \($0)" } } ?? from.map { "Since \($0)" } ?? "Through \(to ?? "")")
      }
      if let frequency = metadata.frequency { fact("Frequency", frequency) }
      if let count = metadata.reportCount { fact("Reports", count.formatted()) }
      if let minutes = metadata.durationMinutes { fact("Duration", "\(minutes) min") }
      if let status = metadata.status { fact("Source status", status) }
      if metadata.isNew == true { fact("Source listing", "New") }
    }
  }

  private func precisionHelp(_ date: ProblemSourceDate) -> String {
    date.precision == .month ? "Reported to the month" : date.precision == .year ? "Reported to the year" : ""
  }

  private func fact(_ term: String, _ value: String, help: String = "") -> some View {
    HStack(spacing: Space.s2) {
      Text(term).foregroundStyle(Palette.inkMuted)
      Text(value).foregroundStyle(Palette.inkBody).tabular().help(help)
    }
    .font(.ui(Typography.Size.sm))
  }

  private func reportTable(_ reports: [ProblemCompanyReport]) -> some View {
    let pages = max(1, (reports.count + 24) / 25)
    let current = min(page, pages - 1)
    let slice = Array(reports[(current * 25)..<min(reports.count, (current + 1) * 25)])
    return VStack(alignment: .leading, spacing: Space.s2) {
      Text("Reporting windows reflect the source snapshot.").font(.ui(Typography.Size.xs)).foregroundStyle(Palette.inkMuted)
      Grid(alignment: .leading, horizontalSpacing: Space.s4, verticalSpacing: Space.s2) {
        GridRow {
          ForEach(["Company", "Window", "Frequency", "Snapshot", ""], id: \.self) { Text($0).font(.ui(Typography.Size.xs, weight: .medium)).foregroundStyle(Palette.inkMuted) }
        }
        ForEach(Array(slice.enumerated()), id: \.offset) { _, report in
          GridRow {
            Text(report.company).foregroundStyle(Palette.ink)
            Text(report.window.label)
            Text(report.frequency.map { "\($0.formatted(.number.precision(.fractionLength(0...1))))%" } ?? "Not reported").tabular()
            Text(ProblemDateLabels.day(report.snapshotDate)).tabular()
            if let url = URL(string: report.sourceUrl) {
              Button("Source") { openURL(url) }.buttonStyle(.plain).foregroundStyle(Palette.link)
            } else {
              Text("")
            }
          }
          .font(.ui(Typography.Size.xs))
          .foregroundStyle(Palette.inkBody)
          .lineLimit(1)
        }
      }
      if pages > 1 {
        HStack(spacing: Space.s2) {
          Button("Previous") { page = current - 1 }.buttonStyle(.manor(.ghost, size: .small)).disabled(current == 0)
          Text("\(current + 1) / \(pages)").font(.ui(Typography.Size.xs)).foregroundStyle(Palette.inkMuted).tabular()
          Button("Next") { page = current + 1 }.buttonStyle(.manor(.ghost, size: .small)).disabled(current + 1 >= pages)
        }
      }
    }
  }
}

/// The retained sources grouped under this problem, each with its own identity, version, and evidence.
struct ProblemSourcesView: View {
  let group: ProblemGroup
  let openURL: (URL) -> Void
  @State private var open = false

  var body: some View {
    DisclosureGroup(isExpanded: $open) {
      VStack(alignment: .leading, spacing: Space.s3) {
        ForEach(group.sources) { source in
          VStack(alignment: .leading, spacing: Space.s1) {
            HStack(spacing: Space.s2) {
              Text(source.sourceName ?? source.title).font(.ui(Typography.Size.sm, weight: source.id == group.problem.id ? .semibold : .medium)).foregroundStyle(Palette.ink)
              Text("Version \(source.contentVersion)").font(.ui(Typography.Size.xs)).foregroundStyle(Palette.inkMuted).tabular()
              if source.id == group.problem.id {
                Text("Main problem").font(.ui(Typography.Size.xs, weight: .medium)).foregroundStyle(Palette.primary)
              }
              Spacer()
              if let url = source.sourceUrl.flatMap(URL.init(string:)) {
                RowIconButton(systemImage: "arrow.up.right.square", label: "Open original source") { openURL(url) }
              }
            }
            if let reason = source.duplicateReason {
              Text(reason).font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkBody).fixedSize(horizontal: false, vertical: true)
            }
            ProblemSourceDetailsView(metadata: source.sourceMetadata, openURL: openURL)
          }
          .padding(.vertical, Space.s1)
        }
      }
      .padding(.top, Space.s2)
    } label: {
      Text("Sources \(Text("(\(group.sources.count))").foregroundStyle(Palette.inkMuted))")
        .font(.ui(Typography.Size.sm, weight: .medium)).foregroundStyle(Palette.inkBody).tabular()
    }
  }
}
