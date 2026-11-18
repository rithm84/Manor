import AppKit
import ManorKit
import SwiftUI

extension ProblemSubmission {
  var toneColor: Color {
    switch tone {
    case .accepted: return Palette.completion
    case .failed: return Palette.overdueError
    case .neutral: return Palette.ink
    }
  }
}

/// The calm in-flight state shared by the console and the submission view: one small spinner and a word.
struct WorkspacePendingVerdict: View {
  let mode: ProblemExecutionMode
  var body: some View {
    HStack(spacing: Space.s2) {
      ProgressView().controlSize(.small)
      Text(mode == .submit ? "Judging" : "Running").font(.ui(Typography.Size.body, weight: .medium)).foregroundStyle(Palette.inkMuted)
    }
    .frame(minHeight: 28, alignment: .leading)
  }
}

private struct ResultValue: View {
  let label: String
  let text: String
  var error = false
  var body: some View {
    VStack(alignment: .leading, spacing: Space.s1) {
      Text(label).font(.ui(Typography.Size.xs, weight: .medium)).foregroundStyle(Palette.inkMuted)
      ScrollView(.horizontal, showsIndicators: false) {
        Text(text)
          .font(.code(Typography.Size.sm))
          .foregroundStyle(error ? Palette.overdueError : Palette.ink)
          .fixedSize()
          .textSelection(.enabled)
          .padding(.horizontal, Space.s3)
          .padding(.vertical, Space.s2)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(error ? Palette.errorSoft : Palette.surfacePaper, in: RoundedRectangle(cornerRadius: Radius.control))
    }
  }
}

/// One case: its labeled input, output, expected answer, printed output, and errors.
struct WorkspaceCaseDetail: View {
  let result: ProblemCaseResult
  let fields: [TestcaseField]?

  var body: some View {
    if result.hidden && result.input == nil {
      Text("This test case is hidden.").font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted)
    } else {
      VStack(alignment: .leading, spacing: Space.s3) {
        if let input = result.input {
          if let fields, let labeled = ProblemTestcases.labeledInput(fields, input) {
            VStack(alignment: .leading, spacing: Space.s1) {
              Text("Input").font(.ui(Typography.Size.xs, weight: .medium)).foregroundStyle(Palette.inkMuted)
              ForEach(Array(labeled.enumerated()), id: \.offset) { _, item in
                VStack(alignment: .leading, spacing: 2) {
                  Text(item.field.label).font(.ui(Typography.Size.xs)).foregroundStyle(Palette.inkMuted)
                  ScrollView(.horizontal, showsIndicators: false) {
                    Text(item.value).font(.code(Typography.Size.sm)).foregroundStyle(Palette.ink).fixedSize().textSelection(.enabled)
                      .padding(.horizontal, Space.s3).padding(.vertical, Space.s2)
                  }
                  .frame(maxWidth: .infinity, alignment: .leading)
                  .background(Palette.surfacePaper, in: RoundedRectangle(cornerRadius: Radius.control))
                }
              }
            }
          } else {
            ResultValue(label: "Input", text: input)
          }
        }
        if let output = result.output { ResultValue(label: "Output", text: output) }
        if let expected = result.expectedOutput { ResultValue(label: "Expected", text: expected) }
        if result.verdict == .wrongAnswer, result.output == nil {
          Text("Output was not saved for this submission. Submit again to see it.").font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted)
        }
        if let stdout = result.stdout, !stdout.isEmpty { ResultValue(label: "Stdout", text: stdout) }
        if let stderr = result.stderr, !stderr.isEmpty { ResultValue(label: result.verdict == .accepted ? "Errors" : result.verdict.label, text: stderr, error: true) }
      }
    }
  }
}

/// A failed submission shows its first failing case the account may see, and says when an earlier hidden case
/// failed first.
struct WorkspaceSubmissionFailure: View {
  let submission: ProblemSubmission
  let fields: [TestcaseField]?

  var body: some View {
    if submission.verdict != .compileError, let first = submission.results.firstIndex(where: { !$0.passed }) {
      let visible = ProblemSubmissionStats.firstFailingVisibleCase(submission.results)
      VStack(alignment: .leading, spacing: Space.s2) {
        Text(visible?.index == first ? "Failed on test case \(first + 1)." : "Failed on hidden test case \(first + 1).\(visible.map { " Test case \($0.index + 1) also failed." } ?? "")")
          .font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted)
        if let visible { WorkspaceCaseDetail(result: visible.result, fields: fields) }
      }
    }
  }
}

struct WorkspaceCompileOutput: View {
  let submission: ProblemSubmission
  var body: some View {
    if let output = submission.compileOutput {
      ScrollView(.horizontal, showsIndicators: false) {
        Text(output).font(.code(Typography.Size.sm)).foregroundStyle(Palette.overdueError).fixedSize().textSelection(.enabled)
          .padding(.horizontal, Space.s4).padding(.vertical, Space.s3)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(Palette.errorSoft, in: RoundedRectangle(cornerRadius: Radius.control))
    }
  }
}

/// LeetCode's result anatomy: one prominent verdict and its counts, then the cases. Submissions show only a
/// failing case.
struct WorkspaceTestResult: View {
  let submission: ProblemSubmission
  let fields: [TestcaseField]?
  @State private var selected: Int

  init(submission: ProblemSubmission, fields: [TestcaseField]?) {
    self.submission = submission
    self.fields = fields
    _selected = State(initialValue: submission.results.firstIndex { !$0.passed } ?? 0)
  }

  var body: some View {
    VStack(alignment: .leading, spacing: Space.s3) {
      HStack(alignment: .firstTextBaseline, spacing: Space.s4) {
        HStack(spacing: Space.s1) {
          if submission.verdict == .accepted, submission.isGraded { Image(systemName: "checkmark").font(.system(size: 15, weight: .bold)) }
          Text(submission.label).font(.display(Typography.Size.lg))
        }
        .foregroundStyle(submission.toneColor)
        if submission.verdict != .compileError, !submission.results.isEmpty {
          Text(submission.testsetVersion == nil ? "\(submission.results.count) \(submission.results.count == 1 ? "case" : "cases")" : "Passed test cases: \(submission.passedCases) / \(submission.totalCases)")
            .font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted).tabular()
        }
        if let runtime = submission.runtimeMs {
          Text("Runtime: \(ProblemSubmissionStats.formatRuntime(runtime))").font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted).tabular()
        }
        if let memory = submission.memoryKb {
          Text("Memory: \(ProblemSubmissionStats.formatMemory(memory))").font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted).tabular()
        }
      }
      if let error = submission.error { ErrorBanner(error) }
      WorkspaceCompileOutput(submission: submission)
      if submission.verdict != .compileError {
        if submission.mode == .submit {
          WorkspaceSubmissionFailure(submission: submission, fields: fields)
        } else {
          HStack(spacing: Space.s2) {
            ForEach(Array(submission.results.enumerated()), id: \.offset) { index, result in
              WorkspaceCaseChip(title: "\(result.hidden ? "Hidden" : "Case") \(index + 1)", selected: selected == index, invalid: false, mark: result.passed ? .passed : .failed) { selected = index }
            }
          }
          if submission.results.indices.contains(selected) {
            WorkspaceCaseDetail(result: submission.results[selected], fields: fields)
          }
        }
      }
    }
    .transition(.opacity.combined(with: .offset(y: 4)))
  }
}

/// A case selector chip; a dot shows a result's outcome by color.
struct WorkspaceCaseChip: View {
  enum Mark { case none, passed, failed }
  let title: String
  let selected: Bool
  let invalid: Bool
  var mark: Mark = .none
  var onRemove: (() -> Void)? = nil
  let action: () -> Void
  @State private var hovering = false

  var body: some View {
    HStack(spacing: Space.s1) {
      Button(action: action) {
        HStack(spacing: Space.s1) {
          if mark != .none {
            Circle().fill(mark == .passed ? Palette.completion : Palette.overdueError).frame(width: 6, height: 6)
          }
          Text(title).tabular()
        }
        .font(.ui(Typography.Size.sm, weight: selected ? .semibold : .regular))
        .foregroundStyle(invalid ? Palette.overdueError : selected ? Palette.ink : Palette.inkMuted)
      }
      .buttonStyle(.plain)
      if let onRemove, hovering || selected {
        Button(action: onRemove) { Image(systemName: "xmark").font(.system(size: 9, weight: .bold)).foregroundStyle(Palette.inkMuted) }
          .buttonStyle(.plain)
          .help("Remove case")
      }
    }
    .padding(.horizontal, Space.s3)
    .frame(height: 28)
    .background(selected ? Palette.surfaceSelected : hovering ? Palette.surfaceHover : Palette.surfaceSoft, in: RoundedRectangle(cornerRadius: Radius.chip))
    .overlay { if invalid { RoundedRectangle(cornerRadius: Radius.chip).strokeBorder(Palette.overdueError.opacity(0.6)) } }
    .onHover { hovering = $0 }
  }
}

// MARK: Submissions

/// LeetCode's Submissions tab: a compact history whose rows open a full submission view in place.
struct WorkspaceSubmissions: View {
  let model: ProblemWorkspaceModel

  var body: some View {
    if let opened = model.shownSubmission {
      SubmissionDetailView(model: model, submission: opened).id(opened.id)
    } else {
      SubmissionListView(model: model)
    }
  }
}

private struct SubmissionListView: View {
  let model: ProblemWorkspaceModel

  var body: some View {
    let history = ProblemSubmissionStats.listed(model.history)
    VStack(alignment: .leading, spacing: Space.s3) {
      if let error = model.historyError { ErrorBanner(error) { model.loadHistory() } }
      if history.isEmpty {
        Text("No submissions yet. Submit your code to see it here.").font(.ui()).foregroundStyle(Palette.inkMuted)
      } else {
        TimelineView(.periodic(from: .now, by: 60)) { context in
          VStack(spacing: 0) {
            row(status: "Status", language: "Language", runtime: "Runtime", memory: "Memory")
              .font(.ui(Typography.Size.xs, weight: .medium)).foregroundStyle(Palette.inkMuted)
              .padding(.bottom, Space.s2)
            Hairline()
            ForEach(history) { item in
              SubmissionRow(model: model, item: item, now: context.date)
              Hairline()
            }
          }
        }
      }
    }
  }

  private func row(status: String, language: String, runtime: String, memory: String) -> some View {
    HStack(spacing: Space.s3) {
      Text(status).frame(maxWidth: .infinity, alignment: .leading).layoutPriority(1.6)
      Text(language).frame(width: 84, alignment: .leading)
      Text(runtime).frame(width: 64, alignment: .leading)
      Text(memory).frame(width: 72, alignment: .leading)
    }
    .padding(.horizontal, Space.s2)
  }
}

private struct SubmissionRow: View {
  let model: ProblemWorkspaceModel
  let item: ProblemSubmission
  let now: Date
  @State private var hovering = false

  var body: some View {
    Button { model.openSubmission(item.id) } label: {
      HStack(spacing: Space.s3) {
        VStack(alignment: .leading, spacing: 2) {
          Text(item.label).font(.ui(Typography.Size.sm, weight: .semibold)).foregroundStyle(item.toneColor).lineLimit(1)
          Text(ProblemSubmissionStats.relativeTime(item.createdAt, now: now, timeZone: model.timeZone))
            .font(.ui(Typography.Size.xs)).foregroundStyle(Palette.inkMuted).lineLimit(1)
            .help(ProblemSubmissionStats.submittedAt(item.createdAt, timeZone: model.timeZone))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        Text(item.language.label).lineLimit(1).frame(width: 84, alignment: .leading)
        Text(item.runtimeMs.map(ProblemSubmissionStats.formatRuntime) ?? "").tabular().lineLimit(1).frame(width: 64, alignment: .leading)
        Text(item.memoryKb.map(ProblemSubmissionStats.formatMemory) ?? "").tabular().lineLimit(1).frame(width: 72, alignment: .leading)
      }
      .font(.ui(Typography.Size.sm))
      .foregroundStyle(Palette.inkBody)
      .padding(.horizontal, Space.s2)
      .frame(minHeight: 52)
      .background(model.openingSubmission == item.id ? Palette.surfaceSoft : hovering ? Palette.surfaceHover : .clear, in: RoundedRectangle(cornerRadius: Radius.chip))
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .disabled(model.openingSubmission != nil)
    .onHover { hovering = $0 }
  }
}

private struct SubmissionDetailView: View {
  let model: ProblemWorkspaceModel
  let submission: ProblemSubmission
  @State private var copied = false

  var body: some View {
    VStack(alignment: .leading, spacing: Space.s4) {
      Button { model.openedSubmission = nil } label: {
        Label("All submissions", systemImage: "arrow.left").font(.ui(Typography.Size.sm))
      }
      .buttonStyle(.manor(.ghost, size: .small))
      if submission.isPending {
        WorkspacePendingVerdict(mode: submission.mode)
      } else {
        VStack(alignment: .leading, spacing: Space.s1) {
          HStack(alignment: .firstTextBaseline, spacing: Space.s3) {
            Text(submission.label).font(.display(Typography.Size.displayMD)).foregroundStyle(submission.toneColor)
            if let summary = submission.caseSummary { Text(summary).font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted).tabular() }
          }
          Text("\(submission.language.label) · \(submission.mode == .run ? "Run" : "Submitted") \(ProblemSubmissionStats.submittedAt(submission.createdAt, timeZone: model.timeZone))")
            .font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted)
        }
      }
      if let error = submission.error { ErrorBanner(error) }
      if let runtime = submission.runtimeMs {
        HStack(spacing: Space.s3) {
          stat("Runtime", icon: "clock", value: ProblemSubmissionStats.formatRuntime(runtime))
          if let memory = submission.memoryKb { stat("Memory", icon: "memorychip", value: ProblemSubmissionStats.formatMemory(memory)) }
        }
      }
      if !submission.isPending {
        WorkspaceCompileOutput(submission: submission)
        WorkspaceSubmissionFailure(submission: submission, fields: model.fields)
      }
      if let source = submission.sourceCode {
        VStack(alignment: .leading, spacing: Space.s2) {
          HStack(spacing: Space.s2) {
            Text("Code").font(.ui(Typography.Size.body, weight: .semibold)).foregroundStyle(Palette.ink)
            Text(submission.language.label).font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted)
            Spacer()
            IconButton(copied ? "checkmark" : "doc.on.doc", label: copied ? "Copied" : "Copy code") {
              NSPasteboard.general.clearContents()
              NSPasteboard.general.setString(source, forType: .string)
              copied = true
              Task { try? await Task.sleep(for: .seconds(1.6)); copied = false }
            }
            Button { model.requestSubmissionCode(submission) } label: { Label("Use this code", systemImage: "square.and.pencil") }
              .buttonStyle(.manor(.ghost, size: .small))
              .disabled(!model.canUseCode(submission.language))
          }
          ScrollView(.horizontal) {
            WorkspaceCode(code: source, language: submission.language)
              .padding(.horizontal, Space.s4)
              .padding(.vertical, Space.s3)
          }
          .frame(maxWidth: .infinity, alignment: .leading)
          .background(Palette.surfacePaper, in: RoundedRectangle(cornerRadius: Radius.control))
          .overlay(RoundedRectangle(cornerRadius: Radius.control).strokeBorder(Palette.hairline))
        }
      }
    }
  }

  private func stat(_ label: String, icon: String, value: String) -> some View {
    VStack(alignment: .leading, spacing: Space.s2) {
      Label(label, systemImage: icon).font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted)
      Text(value).font(.display(Typography.Size.lg)).foregroundStyle(Palette.ink).tabular()
    }
    .padding(.horizontal, Space.s4)
    .padding(.vertical, Space.s3)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Palette.surfacePaper, in: RoundedRectangle(cornerRadius: Radius.card))
    .overlay(RoundedRectangle(cornerRadius: Radius.card).strokeBorder(Palette.hairline))
  }
}
