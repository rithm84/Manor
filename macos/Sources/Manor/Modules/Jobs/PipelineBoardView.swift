import ManorKit
import SwiftUI
import UniformTypeIdentifiers

/// The actions a card or row offers, shared by the board, its menus, and the To apply table.
struct PipelineActions {
  let open: (String) -> Void
  let move: (String, JobStageRequest) -> Void
  let markOaDone: (String) -> Void
  let remove: (String) -> Void
}

/// Stage columns of compact company cards. Dragging a card onto another column, or choosing a stage from its
/// menu, opens the role dialog as an unsaved draft.
///
/// The five columns share the width down to a readable minimum, then the board scrolls sideways under edge
/// fades. Columns are as tall as their tallest stack until about five cards, then each scrolls on its own so the
/// flow below stays one short scroll away.
struct PipelineBoardView: View {
  /// Cards per column, already sorted by the store.
  let grouped: [JobColumn: [JobBoardCard]]
  let today: String
  let arrivedIds: Set<String>
  let actions: PipelineActions
  @Binding var draggingId: String?
  /// The natural height of each column's card stack, measured, so the board sizes to its content.
  @State private var stackHeights: [JobColumn: CGFloat] = [:]
  @State private var moreLeft = false
  @State private var moreRight = false

  static let gap: CGFloat = Space.s2 + 2
  static let minColumnWidth: CGFloat = 176
  /// About five two-row cards; taller columns scroll inside this.
  static let stackCap: CGFloat = CGFloat(jobBoardVisibleCards) * 100 + CGFloat(jobBoardVisibleCards - 1) * Space.s2
  /// The column header row and the column's own padding around the stack.
  static let headerHeight: CGFloat = 28
  private static let chrome: CGFloat = headerHeight + Space.s2 + Space.s2 * 2

  private var sourceColumn: JobColumn? {
    guard let draggingId else { return nil }
    return JobColumn.allCases.first { column in grouped[column]?.contains { $0.id == draggingId } == true }
  }

  var body: some View {
    let sourceColumn = sourceColumn
    let stackHeight = min(Self.stackCap, max(64, stackHeights.values.max() ?? 64))
    GeometryReader { proxy in
      let count = CGFloat(JobColumn.allCases.count)
      let available = proxy.size.width - Space.s8 * 2 - Self.gap * (count - 1)
      let width = max(Self.minColumnWidth, floor(available / count))
      ScrollView(.horizontal) {
        HStack(alignment: .top, spacing: Self.gap) {
          ForEach(JobColumn.allCases) { column in
            PipelineColumnView(
              column: column, cards: grouped[column] ?? [], today: today, arrivedIds: arrivedIds,
              stackHeight: stackHeight, actions: actions, draggingId: $draggingId, sourceColumn: sourceColumn,
              onMeasure: { height in if stackHeights[column] != height { stackHeights[column] = height } }
            )
            .frame(width: width)
          }
        }
        .padding(.horizontal, Space.s8)
      }
      .scrollIndicators(.never)
      .scrollBounceBehavior(.basedOnSize, axes: .horizontal)
      .onScrollGeometryChange(for: [Bool].self) { geometry in
        [geometry.contentOffset.x > 2, geometry.contentOffset.x < geometry.contentSize.width - geometry.containerSize.width - 2]
      } action: { _, edges in
        withAnimation(Motion.fast) {
          moreLeft = edges[0]
          moreRight = edges[1]
        }
      }
      .overlay(alignment: .leading) { fade(.leading).opacity(moreLeft ? 1 : 0) }
      .overlay(alignment: .trailing) { fade(.trailing).opacity(moreRight ? 1 : 0) }
    }
    .frame(height: stackHeight + Self.chrome)
  }

  private func fade(_ edge: HorizontalEdge) -> some View {
    LinearGradient(colors: [Palette.surfaceCanvas, Palette.surfaceCanvas.opacity(0)],
                   startPoint: edge == .leading ? .leading : .trailing, endPoint: edge == .leading ? .trailing : .leading)
      .frame(width: Space.s10)
      .allowsHitTesting(false)
  }
}

private struct PipelineColumnView: View {
  let column: JobColumn
  let cards: [JobBoardCard]
  let today: String
  let arrivedIds: Set<String>
  let stackHeight: CGFloat
  let actions: PipelineActions
  @Binding var draggingId: String?
  let sourceColumn: JobColumn?
  let onMeasure: (CGFloat) -> Void
  @State private var targeted = false
  @State private var moreBelow = false

  private var accepts: Bool { sourceColumn != nil && sourceColumn != column }
  private var showsDrop: Bool { targeted && accepts }

  var body: some View {
    let shape = RoundedRectangle(cornerRadius: Radius.card, style: .continuous)
    VStack(alignment: .leading, spacing: Space.s2) {
      HStack(spacing: Space.s2) {
        Circle().fill(column.tone.foreground).frame(width: 7, height: 7)
        Text(column.label).font(.ui(Typography.Size.sm, weight: .semibold)).foregroundStyle(Palette.ink).lineLimit(1)
        Text("\(cards.count)").font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted).tabular()
          .contentTransition(.numericText())
        Spacer(minLength: 0)
      }
      .frame(height: PipelineBoardView.headerHeight)
      .padding(.horizontal, Space.s1)
      .accessibilityElement(children: .combine)
      .accessibilityAddTraits(.isHeader)

      ScrollView(.vertical) {
        stack.onGeometryChange(for: CGFloat.self) { $0.size.height } action: { onMeasure($0) }
      }
      .scrollIndicators(.never)
      .scrollBounceBehavior(.basedOnSize)
      .onScrollGeometryChange(for: Bool.self) { geometry in
        geometry.contentOffset.y + geometry.containerSize.height < geometry.contentSize.height - 2
      } action: { _, more in
        withAnimation(Motion.fast) { moreBelow = more }
      }
      .overlay(alignment: .bottom) {
        LinearGradient(colors: [background.opacity(0), background], startPoint: .top, endPoint: .bottom)
          .frame(height: Space.s8)
          .opacity(moreBelow ? 1 : 0)
          .allowsHitTesting(false)
      }
      .frame(height: stackHeight)
    }
    .padding(Space.s2)
    .background(shape.fill(background))
    .overlay(shape.strokeBorder(Palette.primary.opacity(showsDrop ? 0.6 : 0), lineWidth: 1.5))
    .animation(Motion.fast, value: showsDrop)
    .onDrop(of: [UTType.plainText], isTargeted: $targeted) { providers in
      if let id = draggingId {
        drop(id)
        return true
      }
      guard let provider = providers.first else { return false }
      _ = provider.loadObject(ofClass: NSString.self) { value, _ in
        guard let id = (value as? NSString).map(String.init) else { return }
        Task { @MainActor in drop(id) }
      }
      return true
    }
    .accessibilityElement(children: .contain)
    .accessibilityLabel("\(column.label), \(cards.count) \(cards.count == 1 ? "role" : "roles")")
  }

  private var background: Color { showsDrop ? Palette.primaryTint : Palette.surfacePaper }

  private var stack: some View {
    LazyVStack(alignment: .leading, spacing: Space.s2) {
      if cards.isEmpty && !showsDrop {
        Text(column.emptyLine)
          .font(.ui(Typography.Size.sm))
          .foregroundStyle(Palette.inkMuted)
          .frame(maxWidth: .infinity, minHeight: 56)
          .overlay(
            RoundedRectangle(cornerRadius: Radius.control, style: .continuous)
              .strokeBorder(Palette.hairlineStrong, style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
          )
      }
      ForEach(cards) { card in
        PipelineCardView(card: card, today: today, arrived: arrivedIds.contains(card.id), dragging: draggingId == card.id, actions: actions)
          .onDrag {
            draggingId = card.id
            return NSItemProvider(object: card.id as NSString)
          } preview: {
            PipelineCardBody(card: card, today: today).frame(width: PipelineBoardView.minColumnWidth + Space.s8).padding(Space.s1)
          }
      }
      if showsDrop {
        RoundedRectangle(cornerRadius: Radius.control, style: .continuous)
          .strokeBorder(Palette.primary, style: StrokeStyle(lineWidth: 1.5, dash: [5, 4]))
          .background(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).fill(Palette.surfaceCard.opacity(0.6)))
          .frame(height: 40)
          .transition(.opacity)
          .accessibilityHidden(true)
      }
    }
    .padding(1)
  }

  /// A drop on the card's own column changes nothing; the page ignores requests that would not move it.
  private func drop(_ id: String) {
    draggingId = nil
    actions.move(id, .column(column))
  }
}

/// The card's visible content, also used as the drag preview: company, role, then the hiring cycle, the applied
/// or posted date, and the stage's current update as chips that wrap rather than truncate.
struct PipelineCardBody: View {
  let card: JobBoardCard
  let today: String

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(card.role.company)
        .font(.ui(Typography.Size.body, weight: .medium))
        .foregroundStyle(Palette.ink)
        .lineLimit(1)
        .padding(.trailing, Space.s5)
      Text(card.role.role)
        .font(.ui(Typography.Size.sm))
        .foregroundStyle(Palette.inkMuted)
        .lineLimit(2)
        .fixedSize(horizontal: false, vertical: true)
      HomeFlowLayout(spacing: Space.s1, lineSpacing: Space.s1) { chips }
        .padding(.top, Space.s1 + 2)
    }
    .padding(.horizontal, Space.s2 + 2)
    .padding(.vertical, Space.s2 + 2)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).fill(Palette.surfaceCard))
  }

  @ViewBuilder private var chips: some View {
    if let term = card.role.fields.term { JobPill(term, tone: JobLabels.termTone(term)) }
    if card.column == .toApply, let posted = card.role.fields.datePosted {
      JobPill(JobLabels.posted(posted, today: today), tone: JobLabels.postedTone(posted, today: today), systemImage: "calendar")
        .help("Posted \(JobDates.long(posted))")
    }
    if card.column != .toApply, let applied = card.role.fields.appliedDate {
      JobPill(JobLabels.applied(applied), tone: .neutral)
        .help("Applied \(JobDates.long(applied))")
    }
    if let tone = card.detailTone {
      JobPill(card.detail, tone: tone, systemImage: card.role.fields.oaCompletedDate != nil && card.role.stage == .oa ? "checkmark" : nil)
    }
  }
}

/// A draggable, focusable pipeline card with a hover menu and the same actions on right-click.
struct PipelineCardView: View {
  let card: JobBoardCard
  let today: String
  let arrived: Bool
  let dragging: Bool
  let actions: PipelineActions
  @State private var hovering = false
  @FocusState private var focused: Bool

  var body: some View {
    PipelineCardBody(card: card, today: today)
      .background(
        RoundedRectangle(cornerRadius: Radius.control, style: .continuous)
          .fill(arrived ? Palette.primaryTint : Palette.surfaceCard)
      )
      .overlay(
        RoundedRectangle(cornerRadius: Radius.control, style: .continuous)
          .strokeBorder(focused ? Palette.focusBorder : arrived ? Palette.primary.opacity(0.35) : hovering ? Palette.hairlineStrong : Palette.hairline,
                        lineWidth: focused ? 1.5 : 1)
      )
      .overlay(alignment: .topTrailing) {
        JobRoleMenu(role: card.role, actions: actions, compact: true)
          .opacity(hovering || focused ? 1 : 0)
          .padding(4)
      }
      .shadow(color: .black.opacity(hovering ? 0.06 : 0), radius: 6, y: 2)
      .opacity(dragging ? 0.4 : 1)
      .scaleEffect(dragging ? 0.98 : 1)
      .contentShape(RoundedRectangle(cornerRadius: Radius.control, style: .continuous))
      .onHover { hovering = $0 }
      .onTapGesture { actions.open(card.id) }
      .focusable(interactions: .activate)
      .focused($focused)
      .focusEffectDisabled()
      .onKeyPress(.return) {
        actions.open(card.id)
        return .handled
      }
      .contextMenu { JobRoleMenuItems(role: card.role, actions: actions) }
      .animation(Motion.fast, value: hovering)
      .animation(Motion.base, value: arrived)
      .animation(Motion.fast, value: dragging)
      .accessibilityElement(children: .ignore)
      .accessibilityLabel("\(card.role.company), \(card.role.role)")
      .accessibilityValue(card.detail)
      .accessibilityHint("Opens the role details")
      .accessibilityAddTraits(.isButton)
      .accessibilityAction { actions.open(card.id) }
      .accessibilityActions {
        if card.role.stage == .oa && card.role.fields.oaCompletedDate == nil {
          Button("Mark OA done") { actions.markOaDone(card.id) }
        }
        ForEach(JobRoleMenuItems.moveTargets(for: card.role)) { stage in
          Button("Move to \(stage.label)") { actions.move(card.id, .stage(stage)) }
        }
        Button("Remove") { actions.remove(card.id) }
      }
  }
}

/// The "More" button on a card or row.
struct JobRoleMenu: View {
  let role: JobRole
  let actions: PipelineActions
  var compact = false
  @State private var hovering = false

  var body: some View {
    ManorMenuButton {
      JobRoleMenuItems(role: role, actions: actions)
    } label: {
      Image(systemName: "ellipsis")
        .font(.system(size: 12, weight: .semibold))
        .foregroundStyle(hovering ? Palette.ink : Palette.inkMuted)
        .frame(width: 22, height: 22)
        .background(RoundedRectangle(cornerRadius: Radius.chip, style: .continuous).fill(hovering ? Palette.surfaceSoft : .clear))
        .contentShape(Rectangle())
    }
    .menuStyle(.button)
    .buttonStyle(.plain)
    .menuIndicator(.hidden)
    .fixedSize()
    .onHover { hovering = $0 }
    .help("Options for \(role.company)")
    .accessibilityLabel("Options for \(role.company)")
  }
}

/// Mark OA done, Move to, and Remove: the card menu and its right-click twin.
struct JobRoleMenuItems: View {
  let role: JobRole
  let actions: PipelineActions

  static func moveTargets(for role: JobRole) -> [JobStage] {
    JobStage.allCases.filter { $0 != .toApply && $0 != role.stage }
  }

  var body: some View {
    if role.stage == .oa && role.fields.oaCompletedDate == nil {
      Button { actions.markOaDone(role.id) } label: { Label("Mark OA done", systemImage: "checkmark.circle") }
      Divider()
    }
    Section("Move to") {
      ForEach(Self.moveTargets(for: role)) { stage in
        Button { actions.move(role.id, .stage(stage)) } label: { Label(stage.label, systemImage: "arrow.right") }
      }
    }
    Divider()
    Button(role: .destructive) { actions.remove(role.id) } label: { Label("Remove", systemImage: "trash") }
  }
}
