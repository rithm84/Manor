import ManorKit
import SwiftUI

/// The Problems module: the library index and the mistakes notes. Opening a problem shows its solving workspace
/// over the library, which stays alive underneath so its scroll position, filters, and selection survive; the
/// open workspace survives leaving the page and coming back.
struct ProblemsPage: View {
  @Environment(AppContext.self) private var context
  @State private var store: ProblemLibraryStore?
  @State private var openProblemId: String?

  var body: some View {
    ZStack {
      if let store {
        ProblemLibraryView(store: store, covered: openProblemId != nil) { id in openProblemId = id }
          .opacity(openProblemId == nil ? 1 : 0)
          .allowsHitTesting(openProblemId == nil)
          .accessibilityHidden(openProblemId != nil)
      } else {
        Color.clear
      }
      if let id = openProblemId {
        ProblemWorkspaceView(problemId: id) { openProblemId = nil }
          .id(id)
          .background(Palette.surfaceCanvas)
          .transition(.opacity)
      }
    }
    .animation(Motion.base, value: openProblemId)
    .onAppear {
      if store == nil {
        let created = ProblemLibraryStore(gateway: context.gateway)
        store = created
        created.start()
        ProblemWorkspaceWarmup.libraryLoaded(gateway: context.gateway)
      }
    }
    .onChange(of: linkedProblem, initial: true) { _, id in
      guard let id else { return }
      openProblemId = id
      context.linkTarget = nil
    }
  }

  /// A deep link to one problem (`manor://leetcode/<id>`).
  private var linkedProblem: String? {
    guard let target = context.linkTarget, target.route == .problems else { return nil }
    return target.path.first
  }
}
