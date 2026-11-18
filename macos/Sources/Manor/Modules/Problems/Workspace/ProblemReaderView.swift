import AppKit
import ManorKit
import SwiftUI

/// The strip height shared by the reader tabs, the editor toolbar, the console tabs, and the action bar, so strips
/// that sit side by side line up across the split.
let workspaceStripHeight: CGFloat = 45

/// A strip tab: muted at rest, plum on a soft fill when selected.
struct WorkspaceStripTab: View {
  let title: String
  var count: Int? = nil
  let selected: Bool
  let action: () -> Void
  @State private var hovering = false

  var body: some View {
    Button(action: action) {
      HStack(spacing: Space.s2) {
        Text(title)
        if let count, count > 0 {
          Text("\(count)").tabular().foregroundStyle(selected ? Palette.primary : Palette.inkMuted)
        }
      }
      .font(.ui(Typography.Size.sm, weight: selected ? .semibold : .regular))
      .foregroundStyle(selected ? Palette.primary : hovering ? Palette.ink : Palette.inkMuted)
      .padding(.horizontal, Space.s3)
      .frame(height: 28)
      .background(selected ? Palette.surfaceSelected : hovering ? Palette.surfaceHover : .clear, in: RoundedRectangle(cornerRadius: Radius.chip))
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .onHover { hovering = $0 }
    .animation(Motion.press, value: hovering)
  }
}

/// The problem reader: Description, Submissions, and Solution over one scroll area, each starting at the top.
struct WorkspaceReader: View {
  @Bindable var model: ProblemWorkspaceModel
  let detail: ProblemDetail

  var body: some View {
    VStack(spacing: 0) {
      HStack(spacing: Space.s1) {
        WorkspaceStripTab(title: "Description", selected: model.readerTab == .description) { model.readerTab = .description }
        if model.coding {
          WorkspaceStripTab(title: "Submissions", count: ProblemSubmissionStats.listed(model.history).count, selected: model.readerTab == .submissions) { model.readerTab = .submissions }
        }
        WorkspaceStripTab(title: "Solution", selected: model.readerTab == .solution) { model.readerTab = .solution }
        Spacer(minLength: 0)
      }
      .padding(.horizontal, Space.s3)
      .frame(height: workspaceStripHeight - 1)
      Hairline()
      Group {
        switch model.readerTab {
        case .description:
          ScrollViewReader { proxy in
            ScrollView {
              ProblemDescription(model: model, detail: detail) { withAnimation(Motion.base) { proxy.scrollTo("hints", anchor: .top) } }
                .padding(.horizontal, Space.s6)
                .padding(.top, Space.s5)
                .padding(.bottom, Space.s10)
                .frame(maxWidth: 920, alignment: .leading)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
          }
        case .submissions:
          ScrollView {
            WorkspaceSubmissions(model: model)
              .padding(.horizontal, Space.s6)
              .padding(.top, Space.s5)
              .padding(.bottom, Space.s10)
              .frame(maxWidth: .infinity, alignment: .leading)
          }
        case .solution:
          ScrollView {
            Group {
              if let solution = detail.content?.solutionMarkdown, !solution.isEmpty {
                WorkspaceMarkdown(solution, fallbackLanguage: model.language ?? .python)
              } else {
                Text("No solution yet.").font(.ui()).foregroundStyle(Palette.inkMuted)
              }
            }
            .padding(.horizontal, Space.s6)
            .padding(.top, Space.s5)
            .padding(.bottom, Space.s10)
            .frame(maxWidth: 920, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .leading)
          }
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
    .background(Palette.surfaceCanvas)
  }
}

private enum Disclosure: Hashable { case topics, companies, collections }

private struct ProblemDescription: View {
  let model: ProblemWorkspaceModel
  let detail: ProblemDetail
  let showHints: () -> Void
  @State private var open: Disclosure?

  private var problem: ProblemRecord { detail.problem }

  var body: some View {
    let statement = detail.content.map { ProblemTestcases.splitStatement($0.statementMarkdown) }
    VStack(alignment: .leading, spacing: 0) {
      Text(problem.title)
        .font(.display(Typography.Size.displayMD))
        .foregroundStyle(Palette.ink)
        .textSelection(.enabled)
        .padding(.bottom, Space.s3)
      meta.padding(.bottom, Space.s3)
      if let open {
        disclosure(open).padding(.bottom, Space.s4).transition(.opacity)
      }
      facets
      if let content = detail.content, let statement {
        VStack(alignment: .leading, spacing: Space.s4) {
          WorkspaceMarkdown(statement.description)
          if !statement.hasInlineExamples, !content.examples.isEmpty { ProblemExamples(examples: content.examples) }
          if !statement.rest.isEmpty { WorkspaceMarkdown(statement.rest) }
          if !content.hints.isEmpty { ProblemHints(hints: content.hints).id("hints").padding(.top, Space.s4) }
        }
      } else {
        Text("This problem has no statement yet.").font(.ui()).foregroundStyle(Palette.inkMuted)
      }
      if !detail.canExecute, problem.kind == .coding, problem.sourceType != .stock, detail.content != nil {
        Text("Ask Codex to clarify this problem and add tests before solving it here.")
          .font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted).padding(.top, Space.s5)
      }
      ProblemReaderFooter(model: model, detail: detail).padding(.top, Space.s8)
    }
    .animation(Motion.fast, value: open)
  }

  /// Wraps onto a second line in a narrow reader rather than breaking a chip's word.
  private var meta: some View {
    WorkspaceFlow(spacing: Space.s2, lineSpacing: Space.s2) {
      // Each item takes a chip's height so the wrapped row lines up on one center.
      WorkspaceDifficulty(problem: problem).frame(minHeight: 24)
      if problem.kind != .coding { Text(problem.kind.label).font(.ui(Typography.Size.xs)).foregroundStyle(Palette.inkMuted).frame(minHeight: 24) }
      if model.solved {
        Label("Solved", systemImage: "checkmark.circle").font(.ui(Typography.Size.xs, weight: .semibold)).foregroundStyle(Palette.completion)
          .frame(minHeight: 24)
      } else if problem.status == .attempted {
        Text("Attempted").font(.ui(Typography.Size.xs)).foregroundStyle(Palette.inkMuted).frame(minHeight: 24)
      }
      if !problem.topics.isEmpty { chip("Topics", icon: "tag", value: .topics) }
      if !problem.companies.isEmpty { chip("Companies", icon: "building.2", value: .companies) }
      if !problem.collections.isEmpty { chip("Collections", icon: nil, value: .collections) }
      if let hints = detail.content?.hints, !hints.isEmpty {
        WorkspaceMetaChip(title: "Hint", icon: "lightbulb", selected: false, action: showHints)
      }
    }
  }

  private func chip(_ title: String, icon: String?, value: Disclosure) -> some View {
    WorkspaceMetaChip(title: title, icon: icon, selected: open == value) { open = open == value ? nil : value }
  }

  @ViewBuilder private func disclosure(_ value: Disclosure) -> some View {
    switch value {
    case .topics:
      let categories = ProblemTopics.categories(for: problem.topics)
      let other = problem.topics.filter { ProblemTopics.category(of: $0) == nil }
      Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: Space.s4, verticalSpacing: Space.s2) {
        ForEach(categories, id: \.self) { category in
          GridRow {
            Text(category).font(.ui(Typography.Size.xs, weight: .semibold)).foregroundStyle(Palette.inkMuted)
            WorkspaceLabels(labels: problem.topics.filter { ProblemTopics.category(of: $0) == category })
          }
        }
        if !other.isEmpty {
          GridRow {
            Text("Other").font(.ui(Typography.Size.xs, weight: .semibold)).foregroundStyle(Palette.inkMuted)
            WorkspaceLabels(labels: other)
          }
        }
      }
    case .companies: WorkspaceLabels(labels: problem.companies)
    case .collections: WorkspaceLabels(labels: problem.collections)
    }
  }

  @ViewBuilder private var facets: some View {
    let groups = ProblemTagFacet.groups(problem.tags)
    if !groups.isEmpty {
      Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: Space.s4, verticalSpacing: Space.s1) {
        ForEach(Array(groups.enumerated()), id: \.offset) { _, group in
          GridRow {
            Text(group.facet == .other ? "Tags" : group.facet.rawValue).font(.ui(Typography.Size.xs, weight: .semibold)).foregroundStyle(Palette.inkMuted)
            Text(group.values.map(\.label).joined(separator: ", ")).font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkBody)
          }
        }
      }
      .padding(.bottom, Space.s4)
    }
  }
}

struct WorkspaceMetaChip: View {
  let title: String
  let icon: String?
  let selected: Bool
  let action: () -> Void
  @State private var hovering = false

  var body: some View {
    Button(action: action) {
      HStack(spacing: Space.s1) {
        if let icon { Image(systemName: icon).font(.system(size: 11)) }
        Text(title).lineLimit(1)
      }
      .fixedSize()
      .font(.ui(Typography.Size.xs, weight: selected ? .semibold : .regular))
      .foregroundStyle(selected ? Palette.primary : hovering ? Palette.ink : Palette.inkBody)
      .padding(.horizontal, Space.s2)
      .frame(minHeight: 24)
      .background(selected ? Palette.surfaceSelected : hovering ? Palette.surfaceHover : Palette.surfaceSoft, in: RoundedRectangle(cornerRadius: Radius.chip))
    }
    .buttonStyle(.plain)
    .onHover { hovering = $0 }
  }
}

/// Wrapping label pills.
struct WorkspaceLabels: View {
  let labels: [String]
  var body: some View {
    WorkspaceFlow(spacing: Space.s2, lineSpacing: Space.s2) {
      ForEach(labels, id: \.self) { label in Pill(label) }
    }
  }
}

/// A left-aligned layout that wraps its children onto new lines.
struct WorkspaceFlow: Layout {
  var spacing: CGFloat
  var lineSpacing: CGFloat

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let width = proposal.width ?? .infinity
    var x: CGFloat = 0, y: CGFloat = 0, line: CGFloat = 0, widest: CGFloat = 0
    for subview in subviews {
      let size = subview.sizeThatFits(.unspecified)
      if x > 0, x + size.width > width { y += line + lineSpacing; x = 0; line = 0 }
      x += size.width + spacing
      line = max(line, size.height)
      widest = max(widest, x - spacing)
    }
    return CGSize(width: proposal.width ?? widest, height: y + line)
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    var x = bounds.minX, y = bounds.minY, line: CGFloat = 0
    for subview in subviews {
      let size = subview.sizeThatFits(.unspecified)
      if x > bounds.minX, x + size.width > bounds.maxX { y += line + lineSpacing; x = bounds.minX; line = 0 }
      subview.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
      x += size.width + spacing
      line = max(line, size.height)
    }
  }
}

/// Official difficulties read in their color; an estimated one keeps its hue and says so on hover.
struct WorkspaceDifficulty: View {
  let problem: ProblemRecord
  var body: some View {
    if let difficulty = problem.difficulty {
      // The same pair the library index uses, so a difficulty reads identically in both places.
      let (color, tint) = ProblemDifficultyBadge.colors(difficulty)
      let estimated = problem.sourceMetadata?.difficultySource == .estimated
      Text(difficulty.rawValue)
        .font(.ui(Typography.Size.xs, weight: .semibold))
        .foregroundStyle(color)
        .padding(.horizontal, Space.s2)
        .frame(minHeight: 22)
        .background(estimated ? Color.clear : tint, in: RoundedRectangle(cornerRadius: Radius.chip))
        .overlay { if estimated { RoundedRectangle(cornerRadius: Radius.chip).strokeBorder(color.opacity(0.5)) } }
        .help(estimated ? "Estimated difficulty" : "")
    }
  }
}

private struct ProblemExamples: View {
  let examples: [ProblemExample]
  var body: some View {
    VStack(alignment: .leading, spacing: Space.s4) {
      ForEach(Array(examples.enumerated()), id: \.offset) { index, example in
        VStack(alignment: .leading, spacing: Space.s2) {
          Text("Example \(index + 1)").font(.ui(Typography.Size.body, weight: .semibold)).foregroundStyle(Palette.ink)
          Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: Space.s3, verticalSpacing: Space.s2) {
            GridRow {
              label("Input")
              WorkspaceFlow(spacing: Space.s2, lineSpacing: Space.s1) {
                ForEach(Array(ProblemTestcases.exampleAssignments(example.input).enumerated()), id: \.offset) { _, pair in
                  Text(pair).font(.code(Typography.Size.sm)).foregroundStyle(Palette.inkBody)
                }
              }
            }
            GridRow {
              label("Output")
              ScrollView(.horizontal, showsIndicators: false) {
                Text(example.output).font(.code(Typography.Size.sm)).foregroundStyle(Palette.inkBody).fixedSize()
              }
            }
            if let explanation = example.explanation, !explanation.isEmpty {
              GridRow {
                label("Explanation")
                WorkspaceMarkdown(explanation)
              }
            }
          }
          .padding(.horizontal, Space.s4)
          .padding(.vertical, Space.s3)
          .frame(maxWidth: .infinity, alignment: .leading)
          .background(Palette.surfacePaper, in: RoundedRectangle(cornerRadius: Radius.control))
          .textSelection(.enabled)
        }
      }
    }
  }

  private func label(_ text: String) -> some View {
    Text(text).font(.ui(Typography.Size.body, weight: .semibold)).foregroundStyle(Palette.ink).frame(width: 96, alignment: .leading)
  }
}

private struct ProblemHints: View {
  let hints: [String]
  @State private var open: Set<Int> = []

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      ForEach(Array(hints.enumerated()), id: \.offset) { index, hint in
        if index > 0 { Hairline() }
        VStack(alignment: .leading, spacing: Space.s2) {
          Button {
            if open.contains(index) { open.remove(index) } else { open.insert(index) }
          } label: {
            HStack(spacing: Space.s2) {
              Image(systemName: "chevron.right")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Palette.inkMuted)
                .rotationEffect(.degrees(open.contains(index) ? 90 : 0))
              Text("Hint \(index + 1)").font(.ui(Typography.Size.body)).foregroundStyle(Palette.ink)
              Spacer()
            }
            .frame(minHeight: 40)
            .contentShape(Rectangle())
          }
          .buttonStyle(.plain)
          if open.contains(index) {
            WorkspaceMarkdown(hint).padding(.leading, Space.s5).padding(.bottom, Space.s3)
          }
        }
      }
    }
    .animation(Motion.fast, value: open)
  }
}

/// Source evidence, retained group sources with their protected code, and the original link.
private struct ProblemReaderFooter: View {
  let model: ProblemWorkspaceModel
  let detail: ProblemDetail
  @State private var recovered: [LocalCodeDraft] = []
  @State private var statements: [String: ProblemContent?] = [:]
  @State private var loadingSource: String?
  @State private var error: String?

  var body: some View {
    VStack(alignment: .leading, spacing: Space.s4) {
      if let metadata = detail.problem.sourceMetadata { WorkspaceSourceFacts(metadata: metadata) }
      if detail.sourceRecords.count > 1 || !recovered.isEmpty { groupSources }
      if let link = detail.problem.sourceUrl, let url = URL(string: link) {
        Button { NSWorkspace.shared.open(url) } label: {
          Label("Open original source", systemImage: "arrow.up.right.square").font(.ui(Typography.Size.sm))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Palette.link)
      }
    }
    .task(id: detail.sourceRecords.map(\.id)) { await loadRecovered() }
  }

  private func loadRecovered() async {
    let ids = Set(detail.sourceRecords.filter { $0.id != detail.problem.id || !detail.canExecute }.map(\.id))
    guard !ids.isEmpty, let store = try? model.services.draftStore() else { return }
    do {
      recovered = try await store.drafts(accountId: model.accountId).filter { ids.contains($0.problemId) && $0.pending }
    } catch { self.error = error.localizedDescription }
  }

  private var groupSources: some View {
    VStack(alignment: .leading, spacing: Space.s3) {
      if detail.requestedId != detail.problem.id {
        Text("This source is grouped with \(detail.problem.title). The workspace uses that problem's statement and tests.")
          .font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted)
      }
      if !recovered.isEmpty {
        VStack(alignment: .leading, spacing: Space.s2) {
          Text("Code from a retained source").font(.ui(Typography.Size.body, weight: .semibold)).foregroundStyle(Palette.ink)
          Text("Your code stays with its original source and has not been copied into this problem. Copy what you need into the editor to keep working on it.")
            .font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted)
          ForEach(recovered, id: \.self) { draft in
            DisclosureGroup {
              ScrollView(.horizontal) { WorkspaceCode(code: draft.code, language: draft.problemLanguage).padding(Space.s3) }
                .background(Palette.surfacePaper, in: RoundedRectangle(cornerRadius: Radius.control))
            } label: {
              Text("\(sourceName(draft.problemId)) · \(draft.problemLanguage?.label ?? draft.language) · Version \(draft.contentVersion)")
                .font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkBody)
            }
          }
        }
      }
      if let error { ErrorBanner(error) }
      DisclosureGroup {
        VStack(alignment: .leading, spacing: Space.s3) {
          ForEach(detail.sourceRecords) { source in sourceRow(source) }
        }
        .padding(.top, Space.s2)
      } label: {
        HStack(spacing: Space.s1) {
          Text("Sources").font(.ui(Typography.Size.body, weight: .semibold)).foregroundStyle(Palette.ink)
          Text("\(detail.sourceRecords.count)").font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted).tabular()
        }
      }
    }
  }

  private func sourceName(_ id: String) -> String {
    let source = detail.sourceRecords.first { $0.id == id }
    return source?.sourceName ?? source?.name ?? id
  }

  private func sourceRow(_ source: ProblemRecord) -> some View {
    DisclosureGroup {
      VStack(alignment: .leading, spacing: Space.s2) {
        if let reason = source.duplicateReason { Text(reason).font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkBody) }
        if let metadata = source.sourceMetadata { WorkspaceSourceFacts(metadata: metadata) }
        if let link = source.sourceUrl, let url = URL(string: link) {
          Button("Open original source") { NSWorkspace.shared.open(url) }.buttonStyle(.plain).foregroundStyle(Palette.link).font(.ui(Typography.Size.sm))
        }
        if let content = statements[source.id] {
          if let content {
            WorkspaceMarkdown(content.statementMarkdown)
            ForEach(Array(content.examples.enumerated()), id: \.offset) { index, example in
              VStack(alignment: .leading, spacing: Space.s1) {
                Text("Example \(index + 1)").font(.ui(Typography.Size.sm, weight: .semibold))
                Text("Input: \(example.input)").font(.code(Typography.Size.sm))
                Text("Output: \(example.output)").font(.code(Typography.Size.sm))
              }
            }
          } else {
            Text("No statement is stored for this source.").font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted)
          }
        } else {
          Button(loadingSource == source.id ? "Loading source…" : "Read source statement") { Task { await readSource(source) } }
            .buttonStyle(.manor(.ghost, size: .small))
            .disabled(loadingSource != nil)
        }
      }
      .padding(.vertical, Space.s2)
    } label: {
      Text("\(source.sourceName ?? source.title) · Version \(source.contentVersion)\(source.id == detail.problem.id ? " · Main problem" : "")")
        .font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkBody)
    }
  }

  private func readSource(_ source: ProblemRecord) async {
    loadingSource = source.id
    error = nil
    defer { loadingSource = nil }
    do {
      if source.id == detail.requestedId { statements[source.id] = .some(detail.requestedContent); return }
      statements[source.id] = .some(try await model.services.details.load(source.id).requestedContent)
    } catch { self.error = error.localizedDescription }
  }
}

/// Reported recency, frequency, and counts with their original precision.
struct WorkspaceSourceFacts: View {
  let metadata: ProblemSourceMetadata

  var body: some View {
    let facts = rows
    if !facts.isEmpty {
      Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: Space.s4, verticalSpacing: Space.s1) {
        ForEach(Array(facts.enumerated()), id: \.offset) { _, fact in
          GridRow {
            Text(fact.0).font(.ui(Typography.Size.xs, weight: .semibold)).foregroundStyle(Palette.inkMuted)
            Text(fact.1).font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkBody).tabular()
          }
        }
      }
    }
  }

  private var rows: [(String, String)] {
    var rows: [(String, String)] = []
    if let asked = metadata.lastAsked { rows.append(("Last asked", Self.label(asked))) }
    if metadata.reportedFrom != nil || metadata.reportedTo != nil {
      let from = metadata.reportedFrom.map(Self.label)
      let to = metadata.reportedTo.map(Self.label)
      rows.append(("Reported period", from.map { start in to.map { "\(start) to \($0)" } ?? "Since \(start)" } ?? "Through \(to ?? "")"))
    }
    if let frequency = metadata.frequency { rows.append(("Frequency", frequency)) }
    if let count = metadata.reportCount { rows.append(("Reports", count.formatted())) }
    if let minutes = metadata.durationMinutes { rows.append(("Duration", "\(minutes) min")) }
    if let status = metadata.status { rows.append(("Source status", status)) }
    if metadata.isNew == true { rows.append(("Source listing", "New")) }
    return rows
  }

  /// Date-only values keep their recorded precision and never shift with the Mac's time zone.
  static func label(_ date: ProblemSourceDate) -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US")
    formatter.timeZone = TimeZone(identifier: "UTC")
    switch date.precision {
    case .year: return date.value
    case .month:
      formatter.dateFormat = "yyyy-MM"
      guard let value = formatter.date(from: date.value) else { return date.value }
      formatter.dateFormat = "MMM yyyy"
      return formatter.string(from: value)
    case .day:
      formatter.dateFormat = "yyyy-MM-dd"
      guard let value = formatter.date(from: date.value) else { return date.value }
      formatter.dateFormat = "MMM d, yyyy"
      return formatter.string(from: value)
    case .instant:
      guard let value = ProblemSourceDate.instant(date.value) else { return date.value }
      formatter.dateFormat = "MMM d, yyyy, h:mm a zzz"
      return formatter.string(from: value)
    }
  }
}
