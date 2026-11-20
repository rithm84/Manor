import ManorKit
import SwiftUI

/// The signed-in window: the sidebar and the current page. Visited pages stay alive while hidden, so
/// switching modules and coming back keeps their scroll, selection, open items, and unfinished controls.
struct MainView: View {
  @Environment(AppModel.self) private var model
  @Environment(AppContext.self) private var context
  @State private var visited: [Route] = []
  @State private var overlaySidebar = false
  /// Whether the pointer is over the floating sidebar, and how many of its menus are open.
  @State private var overSidebar = false
  @State private var sidebarMenus = 0

  var body: some View {
    // The docked sidebar is an overlay beside the inset pages, not a stack sibling: its selection changes on every
    // page switch, and as a sibling that re-laid out every kept-alive page.
    pages
      .environment(\.windowButtonsClearance, !model.sidebarDocked && !model.isFullScreen ? WindowButtonsMetrics.collapsedClearance : 0)
      .padding(.leading, model.sidebarDocked ? dockedSidebarWidth : 0)
      .overlay(alignment: .leading) { dockedSidebar }
    // The title bar is hidden, so content runs to the window's top edge; the sidebar clears the window
    // buttons itself and pages start with their own header padding.
    .ignoresSafeArea(.container, edges: .top)
    .overlay(alignment: .leading) { floatingSidebar }
    .overlay(alignment: .leading) { sidebarScrim }
    .overlay { consentDialog }
    .modifier(AlfredDialogHost())
    .modifier(PomodoroAppHook())
    .background(alignment: .top) {
      WindowDragRegion().frame(height: model.isFullScreen ? 0 : WindowChromeMetrics.toolbarHeight).ignoresSafeArea()
    }
    .background(Palette.surfaceCanvas)
    .onAppear { PerfLog.launch("signed-in-window") }
    .task { await prewarmHeavyPages() }
    .onChange(of: context.route, initial: true) { _, route in
      if !visited.contains(route) { visited.append(route) }
      DispatchQueue.main.async { PerfLog.endSwitch(to: route.rawValue) }
      // Keystrokes never land in a field on a page that just went out of view.
      DispatchQueue.main.async { Self.releaseOffscreenFocus() }
    }
  }

  /// Notes and Problems take a few hundred milliseconds to build the first time (the editor, the catalog table).
  /// Visited pages stay alive anyway, so once the window has settled and input pauses they are built offscreen,
  /// one at a time, and the first click on them costs what a revisit does.
  private func prewarmHeavyPages() async {
    try? await Task.sleep(for: .seconds(1.5))
    for route in [Route.notes, .problems] {
      guard !Task.isCancelled else { return }
      while !Task.isCancelled, Self.secondsSinceInput < 0.4 || DialogPresence.shared.isAnyOpen {
        try? await Task.sleep(for: .milliseconds(250))
      }
      guard !visited.contains(route) else { continue }
      let start = CACurrentMediaTime()
      visited.append(route)
      DispatchQueue.main.async {
        PerfLog.mark(String(format: "prewarm %@ %.0f ms", route.rawValue, (CACurrentMediaTime() - start) * 1000))
        // A page built offscreen never keeps the keyboard.
        Self.releaseOffscreenFocus()
      }
      try? await Task.sleep(for: .milliseconds(800))
    }
  }

  private static func releaseOffscreenFocus() {
    guard let window = NSApp.keyWindow, let responder = window.firstResponder as? NSView, responder.window == window else { return }
    if responder.convert(responder.bounds, to: nil).minX >= window.frame.width { window.makeFirstResponder(nil) }
  }

  private static var secondsSinceInput: Double {
    CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: CGEventType(rawValue: ~0)!)
  }

  /// The room the docked sidebar takes at the leading edge.
  private var dockedSidebarWidth: CGFloat {
    ShellMetrics.sidebarWidth + (GlassSupport.isActive ? Space.s2 : 1)
  }

  @ViewBuilder
  private var dockedSidebar: some View {
    if model.sidebarDocked {
      Group {
        if GlassSupport.isActive {
          // macOS 26: the sidebar floats as a glass panel, inset from the window edge, with the window buttons inside
          // its top corner.
          SidebarView(floating: true)
            .frame(width: ShellMetrics.sidebarWidth)
            .glassBackground(RoundedRectangle(cornerRadius: 18, style: .continuous), fallback: Palette.sidebarBackground)
            .padding([.leading, .bottom, .top], Space.s2)
        } else {
          HStack(spacing: 0) {
            SidebarView().frame(width: ShellMetrics.sidebarWidth)
            Rectangle().fill(Palette.sidebarBorder).frame(width: 1)
          }
        }
      }
      .frame(maxHeight: .infinity)
      // While a dialog is open the sidebar is inert, so focus can't fall back onto it when one dialog replaces another.
      .disabled(DialogPresence.shared.isAnyOpen)
      .transition(.move(edge: .leading))
    }
  }

  private var pages: some View {
    ZStack {
      ForEach(visited) { route in PageSlot(route: route) }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .clipped()
  }

  /// While a centered dialog is open the page dims behind it; the docked sidebar dims with it and takes no clicks,
  /// so the dialog stays modal across the whole window.
  @ViewBuilder
  private var sidebarScrim: some View {
    let open = DialogPresence.shared.isAnyOpen
    Group {
      if open && model.sidebarDocked {
        Palette.overlayBackdrop
          .frame(width: ShellMetrics.sidebarWidth + (GlassSupport.isActive ? Space.s2 : 1))
          .contentShape(Rectangle())
          .onTapGesture {}
          .transition(.opacity)
          .accessibilityHidden(true)
      }
    }
    .frame(maxHeight: .infinity)
    .ignoresSafeArea()
    .animation(Motion.panel, value: open)
  }

  /// With the sidebar hidden, hovering the left edge reveals it floating over the page until the pointer leaves.
  @ViewBuilder
  private var floatingSidebar: some View {
    if !model.sidebarDocked {
      ZStack(alignment: .leading) {
        Color.clear.frame(width: 8).contentShape(Rectangle())
          .onHover { if $0, !DialogPresence.shared.isAnyOpen { withAnimation(Motion.panel) { overlaySidebar = true } } }
        if !overlaySidebar {
          // With the sidebar hidden, a toggle beside the window buttons brings it back (Command-backslash too).
          IconButton("sidebar.left", label: "Show sidebar", size: 26) { model.toggleSidebar() }
            .disabled(DialogPresence.shared.isAnyOpen)
            .padding(.leading, model.isFullScreen ? Space.s3 : WindowButtonsMetrics.toggleLeading)
            .padding(.top, model.isFullScreen ? Space.s2 : (WindowChromeMetrics.toolbarHeight - 26) / 2)
            .frame(maxHeight: .infinity, alignment: .top)
        }
        if overlaySidebar {
          SidebarView(floating: true)
            .frame(width: ShellMetrics.sidebarWidth)
            .frame(maxHeight: .infinity)
            .glassBackground(RoundedRectangle(cornerRadius: 18, style: .continuous), fallback: Palette.sidebarBackground)
            // Over the page (not beside it), clear glass lets the page's title read through; a canvas tint behind keeps
            // the rows legible.
            .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Palette.surfaceCanvas.opacity(0.78)))
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(GlassSupport.isActive ? .clear : Palette.hairline))
            .shadow(color: .black.opacity(0.16), radius: 24, x: 4)
            .padding([.leading, .bottom, .top], Space.s2)
            .onHover { inside in
              overSidebar = inside
              hideFloatingSidebarIfIdle()
            }
            // A menu opened from the sidebar keeps it showing; choosing from the menu or dismissing it away from
            // the sidebar hides it.
            .environment(\.holdsFloatingPanel) { held in
              sidebarMenus = max(0, sidebarMenus + (held ? 1 : -1))
              hideFloatingSidebarIfIdle()
            }
            .transition(.move(edge: .leading).combined(with: .opacity))
        }
      }
      .frame(maxHeight: .infinity)
      // Measured from the window's top edge like the window buttons, not from below the hidden title bar.
      .ignoresSafeArea(.container, edges: .top)
    }
  }

  private func hideFloatingSidebarIfIdle() {
    guard overlaySidebar, !overSidebar, sidebarMenus == 0 else { return }
    withAnimation(Motion.panel) { overlaySidebar = false }
  }

  @ViewBuilder
  private var consentDialog: some View {
    Color.clear.manorDialog(
      item: Binding(get: { context.consentAuthorizationId.map(IdentifiedString.init) }, set: { context.consentAuthorizationId = $0?.value }),
      width: 480
    ) { request in
      AgentConsentView(authorizationId: request.value) { context.consentAuthorizationId = nil }
    }
    .allowsHitTesting(context.consentAuthorizationId != nil)
  }
}

struct IdentifiedString: Identifiable, Hashable {
  let value: String
  var id: String { value }
}

/// One kept-alive page. The slot alone reads the route, so switching pages updates only the slots' visibility; the
/// page itself is an equatable view keyed by its route, so its tree isn't rebuilt and diffed on every switch.
private struct PageSlot: View {
  let route: Route
  @Environment(AppContext.self) private var context

  var body: some View {
    let active = route == context.route
    PageContent(route: route)
      .equatable()
      .environment(\.pageIsActive, active)
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
      .opacity(active ? 1 : 0)
      .allowsHitTesting(active)
      // AppKit-backed controls (text fields, the code editor, tables) ignore SwiftUI's hit-testing flag and
      // would take clicks meant for the visible page or a toast; a hidden page also moves out of the window.
      .offset(x: active ? 0 : 40_000)
      .accessibilityHidden(!active)
      .zIndex(active ? 1 : 0)
  }
}

private struct PageContent: View, Equatable {
  let route: Route

  var body: some View {
    switch route {
    case .home: HomePage()
    case .tracking: TrackingPage()
    case .pomodoro: PomodoroPage()
    case .problems: ProblemsPage()
    case .jobs: JobsPage()
    case .notes: NotesPage()
    case .bookmarks: BookmarksPage()
    case .settings: SettingsPage()
    }
  }
}
