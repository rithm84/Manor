import ManorKit
import SwiftUI

/// The semantic colorways Home's pills, columns, and contexts use, each a foreground and a tint.
enum HomeTone: Hashable {
  case overdue, today, tomorrow, week, neutral, success, gold, info, plum, forest

  var foreground: Color {
    switch self {
    case .overdue: return Palette.pillOverdue
    case .today: return Palette.pillToday
    case .tomorrow: return Palette.pillTomorrow
    case .week: return Palette.pillWeek
    case .neutral: return Palette.inkMuted
    case .success: return Palette.success
    case .gold: return Palette.gold
    case .info: return Palette.frozenInfo
    case .plum: return Palette.thisWeekPlum
    case .forest: return Palette.forest
    }
  }

  var tint: Color {
    switch self {
    case .overdue: return Palette.pillOverdueTint
    case .today: return Palette.pillTodayTint
    case .tomorrow: return Palette.pillTomorrowTint
    case .week: return Palette.pillWeekTint
    case .neutral: return Palette.surfaceSoft
    case .success: return Palette.successSoft
    case .gold: return Palette.goldSoft
    case .info: return Palette.frozenInfoTint
    case .plum: return Palette.thisWeekPlumTint
    case .forest: return Palette.forestSoft
    }
  }

  /// The solid fill of a group pill (column headers, context groups).
  var solid: Color {
    switch self {
    case .neutral: return Palette.inkMuted
    default: return foreground
    }
  }

  init(_ bucket: TaskBucket?) {
    switch bucket {
    case .overdue: self = .overdue
    case .today: self = .today
    case .tomorrow: self = .tomorrow
    case .week: self = .week
    case nil: self = .neutral
    }
  }

  init(_ color: ContextColor) {
    switch color {
    case .forest: self = .forest
    case .success: self = .success
    case .gold: self = .gold
    case .info: self = .info
    case .plum: self = .plum
    case .today: self = .today
    }
  }

  init(_ estimate: TaskEstimate) {
    switch estimate {
    case .quarterHour: self = .success
    case .halfHour: self = .forest
    case .hour: self = .info
    case .twoHours: self = .gold
    case .threeHours: self = .plum
    case .fourHours: self = .overdue
    }
  }

  init(_ priority: TaskPriority) {
    switch priority {
    case .low: self = .neutral
    case .medium: self = .today
    case .high: self = .overdue
    }
  }

  init(_ status: TaskStatus) {
    switch status {
    case .notStarted: self = .neutral
    case .inProgress: self = .info
    case .done: self = .success
    }
  }
}

extension ContextIcon {
  /// The SF Symbol drawn for each context icon.
  var systemImage: String {
    switch self {
    case .bookOpen: return "book"
    case .graduationCap: return "graduationcap"
    case .library: return "books.vertical"
    case .notebookTabs: return "text.book.closed"
    case .brain: return "brain"
    case .calculator: return "function"
    case .briefcase: return "briefcase"
    case .laptop: return "laptopcomputer"
    case .rocket: return "paperplane"
    case .presentation: return "rectangle.on.rectangle"
    case .landmark: return "building.columns"
    case .badgeDollarSign: return "dollarsign.circle"
    case .house: return "house"
    case .heart: return "heart"
    case .users: return "person.2"
    case .shoppingBag: return "bag"
    case .utensils: return "fork.knife"
    case .car: return "car"
    case .code: return "chevron.left.forwardslash.chevron.right"
    case .terminal: return "terminal"
    case .gitBranch: return "arrow.triangle.branch"
    case .bug: return "ladybug"
    case .database: return "cylinder.split.1x2"
    case .cpu: return "cpu"
    case .target: return "target"
    case .trophy: return "trophy"
    case .dumbbell: return "dumbbell"
    case .activity: return "waveform.path.ecg"
    case .flame: return "flame"
    case .mountain: return "mountain.2"
    case .sparkles: return "sparkles"
    case .palette: return "paintpalette"
    case .music: return "music.note"
    case .camera: return "camera"
    case .plane: return "airplane"
    case .globe: return "globe"
    }
  }
}

// MARK: Pills

/// A tag pill in one of Home's tones.
struct HomePill: View {
  let text: String
  var systemImage: String?
  let tone: HomeTone

  var body: some View {
    Pill(text, systemImage: systemImage, foreground: tone.foreground, fill: tone.tint)
  }
}

/// A filled group pill with a muted count beside it: the board's column signature.
struct HomeGroupPill: View {
  let text: String
  var systemImage: String?
  let tone: HomeTone
  var count: Int?

  var body: some View {
    HStack(spacing: Space.s2) {
      HStack(spacing: 5) {
        if let systemImage { Image(systemName: systemImage).font(.system(size: 11, weight: .semibold)) }
        Text(text).font(.ui(Typography.Size.sm, weight: .medium)).lineLimit(1)
      }
      .foregroundStyle(Palette.pillText)
      .padding(.horizontal, Space.s2)
      .frame(height: 22)
      .background(RoundedRectangle(cornerRadius: Radius.chip, style: .continuous).fill(tone.solid))
      if let count {
        Text("\(count)").font(.ui(Typography.Size.sm, weight: .medium)).foregroundStyle(Palette.inkMuted).tabular()
          .contentTransition(.numericText())
      }
    }
  }
}

struct HomeContextPill: View {
  let name: String
  let contexts: [TaskContext]

  var body: some View {
    if let context = contexts.first(where: { $0.name == name }) {
      HomePill(text: context.name, systemImage: context.icon.systemImage, tone: HomeTone(context.color))
    } else {
      HomePill(text: name, tone: .neutral)
    }
  }
}

// MARK: Layout

/// Lays children left to right, wrapping onto new lines: the chip rows on cards.
struct HomeFlowLayout: SwiftUI.Layout {
  var spacing: CGFloat = 4
  var lineSpacing: CGFloat = 4

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let width = proposal.width ?? .infinity
    var x: CGFloat = 0, y: CGFloat = 0, lineHeight: CGFloat = 0, widest: CGFloat = 0
    for subview in subviews {
      let size = subview.sizeThatFits(.unspecified)
      if x > 0, x + size.width > width {
        y += lineHeight + lineSpacing
        x = 0
        lineHeight = 0
      }
      x += size.width + spacing
      widest = max(widest, x - spacing)
      lineHeight = max(lineHeight, size.height)
    }
    return CGSize(width: proposal.width ?? widest, height: subviews.isEmpty ? 0 : y + lineHeight)
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    var x = bounds.minX, y = bounds.minY, lineHeight: CGFloat = 0
    for subview in subviews {
      let size = subview.sizeThatFits(.unspecified)
      if x > bounds.minX, x + size.width > bounds.maxX {
        y += lineHeight + lineSpacing
        x = bounds.minX
        lineHeight = 0
      }
      subview.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
      x += size.width + spacing
      lineHeight = max(lineHeight, size.height)
    }
  }
}

// MARK: Controls

/// The square task checkbox: completion lives on the card.
struct TaskCheckbox: View {
  let isOn: Bool
  let label: String
  let action: () -> Void
  @State private var hovering = false

  var body: some View {
    Button(action: action) {
      ZStack {
        RoundedRectangle(cornerRadius: 4, style: .continuous)
          .strokeBorder(isOn ? Palette.completion : (hovering ? Palette.ink : Palette.controlBorder), lineWidth: 1.5)
          .background(RoundedRectangle(cornerRadius: 4, style: .continuous).fill(isOn ? Palette.completion : Palette.surfaceCanvas.opacity(0.001)))
        if isOn {
          Image(systemName: "checkmark").font(.system(size: 9, weight: .heavy)).foregroundStyle(Palette.onPrimary)
            .transition(.scale(scale: 0.4).combined(with: .opacity))
        }
      }
      .frame(width: 16, height: 16)
      .contentShape(Rectangle().inset(by: -5))
    }
    .buttonStyle(.plain)
    .onHover { hovering = $0 }
    .animation(Motion.settle, value: isOn)
    .help(isOn ? "Mark not started" : "Mark complete")
    .accessibilityLabel(label)
    .accessibilityAddTraits(isOn ? .isSelected : [])
  }
}

/// A compact menu button for property rows and filters: the current value, a chevron, and a menu of choices.
struct HomePropertyMenu<Content: View, Label: View>: View {
  let accessibilityLabel: String
  @ViewBuilder let content: () -> Content
  @ViewBuilder let label: () -> Label
  @State private var hovering = false

  @State private var open = false

  var body: some View {
    // Manor's own menu in a popover rather than the system menu, so it matches the other pickers in both themes.
    Button { open.toggle() } label: {
      HStack(spacing: Space.s1) {
        label()
        Spacer(minLength: Space.s1)
        Image(systemName: open ? "chevron.up" : "chevron.down").font(.system(size: 9, weight: .semibold)).foregroundStyle(Palette.inkMuted)
      }
      .padding(.horizontal, Space.s2)
      .frame(height: 30)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .manorPopover(isPresented: $open) { ManorMenuList(content: content) }
    .frame(height: 30)
    .background(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).fill(hovering ? Palette.surfaceHover : .clear))
    .onHover { hovering = $0 }
    .accessibilityLabel(accessibilityLabel)
  }
}

/// A scroll view that is only as tall as its content, so dialogs size to what they hold and scroll past the cap.
struct HomeFittedScroll<Content: View>: View {
  @ViewBuilder let content: () -> Content
  @State private var height: CGFloat = 1

  var body: some View {
    ScrollView {
      content().onGeometryChange(for: CGFloat.self) { $0.size.height } action: { height = $0 }
    }
    .scrollBounceBehavior(.basedOnSize)
    .frame(idealHeight: height, maxHeight: height)
  }
}

// MARK: Dialog host

/// Home's centered dialog: the shared recipe (backdrop, spring, Escape and backdrop dismissal), but the panel
/// sizes to its content up to the window's height instead of always filling the 720-point cap.
struct HomeDialog<Item: Identifiable, Panel: View>: ViewModifier {
  @Binding var item: Item?
  let width: CGFloat
  let onDismiss: () -> Void
  @ViewBuilder let panel: (Item) -> Panel

  func body(content: Content) -> some View {
    // The page behind is inert while a dialog shows: Tab stays in the panel and the sidebar dims with the page.
    content.disabled(item != nil).overlay {
      GeometryReader { proxy in
        ZStack {
          if let value = item {
            Palette.overlayBackdrop
              .ignoresSafeArea()
              .transition(.opacity)
              .onTapGesture(perform: onDismiss)
              .accessibilityHidden(true)
            panel(value)
              .frame(width: width)
              .frame(maxHeight: min(720, max(240, proxy.size.height - Space.s8 * 2)))
              .fixedSize(horizontal: false, vertical: true)
              .background(RoundedRectangle(cornerRadius: Radius.cardLarge, style: .continuous).fill(Palette.surfaceCard))
              .overlay(RoundedRectangle(cornerRadius: Radius.cardLarge, style: .continuous).strokeBorder(Palette.hairline, lineWidth: 1))
              .clipShape(RoundedRectangle(cornerRadius: Radius.cardLarge, style: .continuous))
              .shadow(color: .black.opacity(0.14), radius: 30, y: 14)
              .shadow(color: .black.opacity(0.05), radius: 4, y: 2)
              .transition(.scale(scale: 0.96).combined(with: .opacity))
              .onExitCommand(perform: onDismiss)
              .accessibilityAddTraits(.isModal)
          }
        }
        .frame(width: proxy.size.width, height: proxy.size.height)
        .animation(Motion.panel, value: item?.id)
      }
    }
    .countsAsOpenDialog(item != nil)
  }
}

extension View {
  func homeDialog<Item: Identifiable, Panel: View>(item: Binding<Item?>, width: CGFloat, onDismiss: @escaping () -> Void, @ViewBuilder panel: @escaping (Item) -> Panel) -> some View {
    modifier(HomeDialog(item: item, width: width, onDismiss: onDismiss, panel: panel))
  }
}

/// Placeholder text for an unset property.
struct HomeEmptyValue: View {
  let text: String
  var body: some View { Text(text).font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted) }
}

/// A property-row date for account-local `YYYY-MM-DD` dates: Manor's calendar with Today, Tomorrow, and Next week.
struct HomeDateField: View {
  let date: String?
  var placeholder = "Choose a date"
  var minimum: String?
  let today: String
  var accessibilityLabel = "Date"
  let onChange: (String) -> Void

  var body: some View {
    ManorDatePicker(accessibilityLabel, selection: Binding(get: { date }, set: { if let value = $0 { onChange(value) } }), today: today,
                    minimum: minimum, placeholder: placeholder, clearable: false, style: .inline)
      .fixedSize()
  }
}

/// A property-row time for an `HH:MM` value, on the system's 12- or 24-hour clock.
struct HomeTimeField: View {
  let time: String
  let onChange: (String) -> Void

  var body: some View {
    ManorTimePicker("Due time", selection: Binding(get: { time }, set: { onChange($0) }), style: .inline)
      .fixedSize()
  }
}

/// A dismissible error line for saves that failed.
struct HomeErrorBanner: View {
  let message: String
  let onDismiss: () -> Void

  var body: some View {
    HStack(spacing: Space.s2) {
      Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(Palette.overdueError).font(.system(size: 12))
      Text(message).font(.ui(Typography.Size.sm)).foregroundStyle(Palette.ink).lineLimit(3).textSelection(.enabled)
      Spacer()
      Button("Dismiss", action: onDismiss).buttonStyle(.manor(.ghost, size: .small))
    }
    .padding(.horizontal, Space.s3)
    .padding(.vertical, Space.s2)
    .background(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).fill(Palette.overdueErrorTint))
    .transition(.move(edge: .top).combined(with: .opacity))
  }
}
