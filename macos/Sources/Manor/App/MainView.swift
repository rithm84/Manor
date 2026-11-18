import ManorKit
import SwiftUI

/// The signed-in window: the sidebar and the current page. Visited pages stay alive while hidden, so
/// switching modules and coming back keeps their scroll, selection, open items, and unfinished controls.
struct MainView: View {
  @Environment(AppModel.self) private var model
  @Environment(AppContext.self) private var context
  @State private var visited: [Route] = []
  @State private var overlaySidebar = false

  var body: some View {
    HStack(spacing: 0) {
      if model.sidebarDocked {
        if GlassSupport.isActive {
          // macOS 26: the sidebar floats as a glass panel. It starts below the window buttons, which sit on the
          // window background above it, so the panel's rounded corner never runs through them.
          SidebarView(floating: true)
            .frame(width: ShellMetrics.sidebarWidth)
            .glassSurface(RoundedRectangle(cornerRadius: 18, style: .continuous), fallback: Palette.sidebarBackground)
            .padding([.leading, .bottom, .top], Space.s2)
            .transition(.move(edge: .leading))
        } else {
          SidebarView()
            .frame(width: ShellMetrics.sidebarWidth)
            .transition(.move(edge: .leading))
          Rectangle().fill(Palette.sidebarBorder).frame(width: 1).ignoresSafeArea()
        }
      }
      pages
        .environment(\.windowButtonsClearance, !model.sidebarDocked && !model.isFullScreen ? WindowButtonsMetrics.collapsedClearance : 0)
    }
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
    .onChange(of: context.route, initial: true) { _, route in
      if !visited.contains(route) { visited.append(route) }
      DispatchQueue.main.async { PerfLog.endSwitch(to: route.rawValue) }
      // Keystrokes never land in a field on a page that just went out of view.
      DispatchQueue.main.async {
        guard let window = NSApp.keyWindow, let responder = window.firstResponder as? NSView, responder.window == window else { return }
        if responder.convert(responder.bounds, to: nil).minX >= window.frame.width { window.makeFirstResponder(nil) }
      }
    }
  }

  private var pages: some View {
    ZStack {
      ForEach(visited) { route in
        let active = route == context.route
        page(for: route)
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
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .clipped()
  }

  @ViewBuilder
  private func page(for route: Route) -> some View {
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
            .glassSurface(RoundedRectangle(cornerRadius: 18, style: .continuous), fallback: Palette.sidebarBackground)
            // Over the page (not beside it), clear glass lets the page's title read through; a canvas tint behind keeps
            // the rows legible.
            .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Palette.surfaceCanvas.opacity(0.78)))
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(GlassSupport.isActive ? .clear : Palette.hairline))
            .shadow(color: .black.opacity(0.16), radius: 24, x: 4)
            .padding([.leading, .bottom, .top], Space.s2)
            .onHover { if !$0 { withAnimation(Motion.panel) { overlaySidebar = false } } }
            .transition(.move(edge: .leading).combined(with: .opacity))
        }
      }
      .frame(maxHeight: .infinity)
      // Measured from the window's top edge like the window buttons, not from below the hidden title bar.
      .ignoresSafeArea(.container, edges: .top)
    }
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
