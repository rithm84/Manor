import AppKit
import ManorKit
import SwiftUI

// MARK: Surface

/// The look every Manor popover shares: the solid card fill (lists and calendars stay legible, so no glass), a
/// hairline edge that holds up over a dialog of the same fill, the overlay shadow, and `Radius.card` corners.
public struct ManorPopoverSurface<Content: View>: View {
  let content: Content
  @Environment(\.colorScheme) private var colorScheme

  public init(@ViewBuilder content: () -> Content) { self.content = content() }

  public var body: some View {
    let shape = RoundedRectangle(cornerRadius: Radius.card, style: .continuous)
    content
      .background(shape.fill(Palette.surfaceCard))
      .clipShape(shape)
      .overlay(shape.strokeBorder(Palette.hairlineStrong, lineWidth: 1))
      .shadow(color: .black.opacity(colorScheme == .dark ? 0.42 : 0.14), radius: 18, y: 8)
      .shadow(color: .black.opacity(colorScheme == .dark ? 0.30 : 0.06), radius: 2, y: 1)
  }
}

/// Where a popover opens relative to its trigger. It flips to the other side when the screen runs out.
public enum ManorPopoverPlacement: Sendable {
  case below(HorizontalAlignment)
  case above(HorizontalAlignment)

  var prefersBelow: Bool { if case .below = self { return true } else { return false } }
  var alignment: HorizontalAlignment {
    switch self {
    case .below(let alignment), .above(let alignment): return alignment
    }
  }
}

// MARK: Keys

/// A key that reached an open popover. Content handles what it understands and returns whether it did; Escape
/// that content leaves alone closes the popover.
public struct ManorPopoverKeyPress {
  public enum Key: Equatable {
    case up, down, left, right, pageUp, pageDown, home, end, returnKey, escape, tab, character(String)
  }
  public let key: Key
  public let shift: Bool
  public let option: Bool
  public let command: Bool
  /// Whether a text field in the popover is taking typing (arrows then belong to it, except Up and Down).
  public let editingText: Bool
}

/// The open popover's controls for its content: closing it and receiving keys before the focused view does.
@MainActor
public final class ManorPopoverContext {
  fileprivate var handler: ((ManorPopoverKeyPress) -> Bool)?
  fileprivate var closeAction: () -> Void = {}
  fileprivate var resizeAction: () -> Void = {}
  /// Where the card sits relative to the trigger, so the entrance grows from the trigger's side.
  public fileprivate(set) var opensBelow = true
  /// The trigger's width when the popover matches it, as a select's list does.
  public fileprivate(set) var minimumWidth: CGFloat = 0

  public init() {}

  /// Closes the popover and returns focus to its trigger.
  public func close() { closeAction() }

  /// Measures the content again after it changed size, such as a list narrowed by a search.
  public func contentChanged() { resizeAction() }

  /// Installs the key handler for the popover's content.
  public func onKey(_ handler: @escaping (ManorPopoverKeyPress) -> Bool) { self.handler = handler }
}

private struct ManorPopoverContextKey: EnvironmentKey {
  static let defaultValue: ManorPopoverContext? = nil
}

public extension EnvironmentValues {
  /// The popover this view is inside, if any.
  var manorPopover: ManorPopoverContext? {
    get { self[ManorPopoverContextKey.self] }
    set { self[ManorPopoverContextKey.self] = newValue }
  }
}

public extension View {
  /// Presents `content` in Manor's popover, anchored to this view. Escape and a click outside close it (the
  /// topmost one first when popovers nest) and focus returns to the trigger. Content that reads environment
  /// objects should pass them on with `.environment(...)`, as with any separate window.
  func manorPopover<PopoverContent: View>(
    isPresented: Binding<Bool>,
    placement: ManorPopoverPlacement = .below(.leading),
    matchTriggerWidth: Bool = false,
    onDismiss: (() -> Void)? = nil,
    @ViewBuilder content: @escaping () -> PopoverContent
  ) -> some View {
    modifier(ManorPopoverModifier(isPresented: isPresented, placement: placement, matchTriggerWidth: matchTriggerWidth,
                                  onClose: onDismiss.map { dismiss in { _ in dismiss() } }, popover: content))
  }

  /// The pickers' variant: `onClose` learns whether focus should return to the trigger (Escape, a choice) or
  /// stay where the person clicked.
  internal func manorPopover<PopoverContent: View>(
    isPresented: Binding<Bool>,
    placement: ManorPopoverPlacement = .below(.leading),
    matchTriggerWidth: Bool = false,
    onClose: @escaping (_ returnFocus: Bool) -> Void,
    @ViewBuilder content: @escaping () -> PopoverContent
  ) -> some View {
    modifier(ManorPopoverModifier(isPresented: isPresented, placement: placement, matchTriggerWidth: matchTriggerWidth, onClose: onClose, popover: content))
  }
}

private struct ManorPopoverModifier<PopoverContent: View>: ViewModifier {
  @Binding var isPresented: Bool
  let placement: ManorPopoverPlacement
  let matchTriggerWidth: Bool
  let onClose: ((Bool) -> Void)?
  let popover: () -> PopoverContent
  @Environment(AppContext.self) private var appContext: AppContext?
  @Environment(\.locale) private var locale
  @Environment(\.calendar) private var calendar
  @Environment(\.timeZone) private var timeZone

  func body(content: Content) -> some View {
    content.background(
      ManorPopoverAnchor(
        isPresented: $isPresented,
        placement: placement,
        matchTriggerWidth: matchTriggerWidth,
        onClose: onClose,
        content: { [appContext, locale, calendar, timeZone] context in
          AnyView(
            ManorPopoverRoot(context: context) { popover() }
              .environment(\.locale, locale)
              .environment(\.calendar, calendar)
              .environment(\.timeZone, timeZone)
              .environment(appContext)
          )
        }
      )
      .allowsHitTesting(false)
      .accessibilityHidden(true)
    )
  }
}

/// The popover's root inside its panel: the surface, the entrance, and the context in the environment.
private struct ManorPopoverRoot<Content: View>: View {
  let context: ManorPopoverContext
  @ViewBuilder let content: () -> Content
  @State private var shown = false

  var body: some View {
    ManorPopoverSurface { content().frame(minWidth: context.minimumWidth, alignment: .leading) }
      // At its ideal size, so content that grows or shrinks (a new filter rule, a filtered list) resizes the panel.
      .fixedSize()
      .onGeometryChange(for: CGSize.self) { $0.size } action: { _ in context.contentChanged() }
      .environment(\.manorPopover, context)
      .scaleEffect(shown || Motion.isReduced ? 1 : 0.97, anchor: context.opensBelow ? .top : .bottom)
      .offset(y: shown || Motion.isReduced ? 0 : (context.opensBelow ? -4 : 4))
      .opacity(shown ? 1 : 0)
      .padding(ManorPopoverController.margin)
      .onAppear { withAnimation(Motion.fast) { shown = true } }
  }
}

// MARK: Anchor and panel

private struct ManorPopoverAnchor: NSViewRepresentable {
  @Binding var isPresented: Bool
  let placement: ManorPopoverPlacement
  let matchTriggerWidth: Bool
  let onClose: ((Bool) -> Void)?
  let content: (ManorPopoverContext) -> AnyView

  func makeCoordinator() -> ManorPopoverController { ManorPopoverController() }

  func makeNSView(context: Context) -> NSView {
    let view = AnchorView()
    view.controller = context.coordinator
    return view
  }

  func updateNSView(_ view: NSView, context: Context) {
    let controller = context.coordinator
    controller.anchor = view
    controller.placement = placement
    controller.matchTriggerWidth = matchTriggerWidth
    controller.context.minimumWidth = matchTriggerWidth ? view.bounds.width : 0
    controller.onClosed = { [binding = $isPresented, onClose] refocus in
      if binding.wrappedValue { binding.wrappedValue = false }
      onClose?(refocus)
    }
    if isPresented {
      controller.present(content(controller.context))
    } else if controller.isOpen {
      controller.close(refocus: false)
    }
  }

  static func dismantleNSView(_ view: NSView, coordinator: ManorPopoverController) {
    coordinator.close(refocus: false)
  }

  final class AnchorView: NSView {
    weak var controller: ManorPopoverController?
    override func viewDidMoveToWindow() {
      super.viewDidMoveToWindow()
      if window == nil { controller?.close(refocus: false) }
    }

    // The trigger moved or resized (a toolbar reflowed around it): the open popover follows.
    override func setFrameOrigin(_ newOrigin: NSPoint) {
      super.setFrameOrigin(newOrigin)
      controller?.anchorMoved()
    }

    override func setFrameSize(_ newSize: NSSize) {
      super.setFrameSize(newSize)
      controller?.anchorMoved()
    }
  }
}

/// A borderless panel: no arrow, no system chrome, and it takes key so the popover's keys reach it first.
final class ManorPopoverPanel: NSPanel {
  var keyHandler: ((NSEvent) -> Bool)?

  init() {
    super.init(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
    isOpaque = false
    backgroundColor = .clear
    hasShadow = false
    isReleasedWhenClosed = false
    animationBehavior = .none
    hidesOnDeactivate = false
    worksWhenModal = true
    becomesKeyOnlyIfNeeded = false
    collectionBehavior = [.transient, .ignoresCycle, .fullScreenAuxiliary, .moveToActiveSpace]
    setAccessibilitySubrole(.unknown)
  }

  override var canBecomeKey: Bool { true }
  override var canBecomeMain: Bool { false }

  override func sendEvent(_ event: NSEvent) {
    if event.type == .keyDown, keyHandler?(event) == true { return }
    super.sendEvent(event)
  }
}

/// Owns one popover's panel: placement beside the trigger, resizing with its content, the dismissal layer
/// (Escape, outside clicks, app switches), and returning focus.
@MainActor
final class ManorPopoverController: NSObject {
  /// Room around the card for its whole shadow (18-point blur, 8 points down); a tighter panel cuts the shadow
  /// off in a visible rectangle.
  static let margin: CGFloat = 40
  private static let gap: CGFloat = 4
  /// Open popovers, oldest first, so Escape and outside clicks close the topmost and nested ones stay open.
  private static var stack: [ManorPopoverController] = []

  weak var anchor: NSView?
  var placement: ManorPopoverPlacement = .below(.leading)
  var matchTriggerWidth = false
  var onClosed: (_ refocus: Bool) -> Void = { _ in }
  let context = ManorPopoverContext()

  private var panel: ManorPopoverPanel?
  private var host: PopoverHostingView?
  private var monitors: [Any] = []
  private var observers: [NSObjectProtocol] = []
  private weak var parentWindow: NSWindow?
  private var opensBelow = true
  /// The last mouse event a popover acted on, so one click never closes two popovers.
  private static var handledClick: TimeInterval = -1

  var isOpen: Bool { panel != nil }

  override init() {
    super.init()
    context.closeAction = { [weak self] in self?.close(refocus: true) }
    context.resizeAction = { [weak self] in self?.contentChanged() }
  }

  func present(_ root: AnyView) {
    if let host {
      host.rootView = root
      return
    }
    guard let anchor, let window = anchor.window else { return }
    let panel = ManorPopoverPanel()
    panel.appearance = window.effectiveAppearance
    // Above tooltip windows: a tooltip from the trigger otherwise draws over the popover it just opened.
    panel.level = NSWindow.Level(rawValue: max(window.level.rawValue, Int(CGWindowLevelForKey(.helpWindow)) + 1))
    let host = PopoverHostingView(rootView: root)
    host.sizingOptions = [.intrinsicContentSize]
    host.onSizeChange = { [weak self] in self?.reposition() }
    // A hosting view that is a window's content view resizes that window on every layout, overriding the size
    // measured here (a list's scroll view collapsed the panel to the trigger's width); a plain container keeps
    // the panel's size the controller's.
    let container = NSView()
    host.autoresizingMask = [.width, .height]
    container.addSubview(host)
    panel.contentView = container
    panel.keyHandler = { [weak self] event in self?.handle(event) ?? false }
    self.panel = panel
    self.host = host
    parentWindow = window
    Self.stack.append(self)

    opensBelow = placement.prefersBelow
    reposition(choosingSide: true)
    window.addChildWindow(panel, ordered: .above)
    panel.makeKeyAndOrderFront(nil)
    installDismissal()
    NSAccessibility.post(element: panel, notification: .created)
  }

  func close(refocus: Bool) {
    guard let panel else { return }
    // Nested popovers close with their parent.
    if let index = Self.stack.firstIndex(where: { $0 === self }) {
      for child in Self.stack[(index + 1)...].reversed() { child.close(refocus: false) }
    }
    Self.stack.removeAll { $0 === self }
    monitors.forEach(NSEvent.removeMonitor)
    monitors = []
    observers.forEach(NotificationCenter.default.removeObserver)
    observers = []
    self.panel = nil
    host = nil
    panel.keyHandler = nil
    let parent = parentWindow
    if refocus, let parent, parent.isVisible { parent.makeKey() }
    NSAnimationContext.runAnimationGroup({ group in
      group.duration = Motion.isReduced ? 0.05 : 0.1
      panel.animator().alphaValue = 0
    }, completionHandler: {
      MainActor.assumeIsolated {
        parent?.removeChildWindow(panel)
        panel.orderOut(nil)
        panel.contentView = nil
      }
    })
    onClosed(refocus)
  }

  // MARK: Placement

  func anchorMoved() {
    guard panel != nil else { return }
    DispatchQueue.main.async { [weak self] in self?.reposition() }
  }

  /// Content changed size without changing its intrinsic size (a filtered list): measure again.
  func contentChanged() {
    guard panel != nil else { return }
    DispatchQueue.main.async { [weak self] in self?.reposition() }
  }

  private func reposition(choosingSide: Bool = false) {
    guard let panel, let host, let anchor, let window = anchor.window else { return }
    let anchorRect = window.convertToScreen(anchor.convert(anchor.bounds, to: nil))
    let size = host.fittingSize
    let margin = Self.margin
    let card = CGSize(width: size.width - margin * 2, height: size.height - margin * 2)
    let screen = (window.screen ?? NSScreen.main)?.visibleFrame ?? .infinite

    if choosingSide {
      let roomBelow = anchorRect.minY - screen.minY
      let roomAbove = screen.maxY - anchorRect.maxY
      let needed = card.height + Self.gap + 8
      if placement.prefersBelow {
        opensBelow = roomBelow >= needed || roomBelow >= roomAbove
      } else {
        opensBelow = !(roomAbove >= needed || roomAbove >= roomBelow)
      }
      context.opensBelow = opensBelow
    }

    var x: CGFloat
    switch placement.alignment {
    case .trailing: x = anchorRect.maxX - card.width
    case .center: x = anchorRect.midX - card.width / 2
    default: x = anchorRect.minX
    }
    // Stay inside the window (with the same margin as the screen edge) so a popover never sits flush on its edge.
    let bounds = window.frame.intersection(screen).insetBy(dx: Space.s3, dy: 0)
    x = min(max(x, bounds.minX), bounds.maxX - card.width)
    var y = opensBelow ? anchorRect.minY - Self.gap - card.height : anchorRect.maxY + Self.gap
    y = min(max(y, screen.minY + 8), screen.maxY - card.height - 8)
    let frame = NSRect(x: x - margin, y: y - margin, width: size.width, height: size.height)
    if panel.frame != frame { panel.setFrame(frame, display: true) }
    if host.frame.size != size { host.frame = NSRect(origin: .zero, size: size) }
  }

  // MARK: Dismissal

  private var isTopmost: Bool { Self.stack.last === self }

  private func installDismissal() {
    let mouse: NSEvent.EventTypeMask = [.leftMouseDown, .rightMouseDown, .otherMouseDown]
    if let local = NSEvent.addLocalMonitorForEvents(matching: mouse.union(.scrollWheel), handler: { [weak self] event in
      // Local monitors run on the main thread; the decision crosses back as a Bool, the event never moves.
      nonisolated(unsafe) let event = event
      let keep = MainActor.assumeIsolated { self?.keepsOutsideClick(event) ?? true }
      return keep ? event : nil
    }) { monitors.append(local) }
    if let global = NSEvent.addGlobalMonitorForEvents(matching: mouse, handler: { [weak self] _ in
      MainActor.assumeIsolated { self?.close(refocus: false) }
    }) { monitors.append(global) }
    let center = NotificationCenter.default
    observers.append(center.addObserver(forName: NSApplication.didResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
      MainActor.assumeIsolated { self?.close(refocus: false) }
    })
    if let parentWindow {
      observers.append(center.addObserver(forName: NSWindow.willCloseNotification, object: parentWindow, queue: .main) { [weak self] _ in
        MainActor.assumeIsolated { self?.close(refocus: false) }
      })
      observers.append(center.addObserver(forName: NSWindow.didResizeNotification, object: parentWindow, queue: .main) { [weak self] _ in
        MainActor.assumeIsolated { self?.reposition() }
      })
    }
  }

  /// A click outside the topmost popover closes it and goes no further, so the page or dialog underneath keeps its
  /// state. A click on the trigger closes it too instead of reopening it.
  /// Whether a click or scroll outside the popover goes on to its target (false swallows it).
  private func keepsOutsideClick(_ event: NSEvent) -> Bool {
    guard isTopmost, let panel, event.timestamp != Self.handledClick else { return true }
    if event.window === panel { return true }
    if event.type == .scrollWheel {
      close(refocus: false)
      return true
    }
    Self.handledClick = event.timestamp
    // A click inside a popover further down the stack belongs to that one; it handles it after this closes.
    let insideLower = Self.stack.contains { $0 !== self && $0.panel === event.window }
    close(refocus: !insideLower)
    return insideLower
  }

  private func handle(_ event: NSEvent) -> Bool {
    guard isTopmost, let panel else { return false }
    let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
    let editing = panel.firstResponder is NSTextView
    let key: ManorPopoverKeyPress.Key
    switch event.keyCode {
    case 126: key = .up
    case 125: key = .down
    case 123: key = .left
    case 124: key = .right
    case 116: key = .pageUp
    case 121: key = .pageDown
    case 115: key = .home
    case 119: key = .end
    case 36, 76: key = .returnKey
    case 53: key = .escape
    case 48: key = .tab
    default:
      guard !flags.contains(.command), !flags.contains(.control), let characters = event.characters, !characters.isEmpty,
            characters.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) }) else { return false }
      key = .character(characters)
    }
    let press = ManorPopoverKeyPress(key: key, shift: flags.contains(.shift), option: flags.contains(.option), command: flags.contains(.command), editingText: editing)
    if context.handler?(press) == true { return true }
    if key == .escape {
      close(refocus: true)
      return true
    }
    return false
  }
}

/// Reports content size changes so the panel follows its content (a filtered list, a revealed error).
final class PopoverHostingView: NSHostingView<AnyView> {
  var onSizeChange: (() -> Void)?
  private var scheduled = false

  required init(rootView: AnyView) { super.init(rootView: rootView) }
  @MainActor required dynamic init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

  override func invalidateIntrinsicContentSize() {
    super.invalidateIntrinsicContentSize()
    guard !scheduled else { return }
    scheduled = true
    DispatchQueue.main.async { [weak self] in
      self?.scheduled = false
      self?.onSizeChange?()
    }
  }

  override var acceptsFirstResponder: Bool { true }
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}
