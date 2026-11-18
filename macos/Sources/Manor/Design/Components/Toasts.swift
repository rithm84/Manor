import AppKit
import Observation
import SwiftUI

/// Short-lived notices at the bottom of the window, optionally with an Undo action.
@MainActor
@Observable
public final class ToastCenter {
  public struct Toast: Identifiable, Equatable {
    public let id = UUID()
    public let message: String
    public let actionLabel: String?
    let action: (() -> Void)?
    public static func == (lhs: Toast, rhs: Toast) -> Bool { lhs.id == rhs.id }
  }

  public private(set) var current: Toast?
  @ObservationIgnored private var dismissal: Task<Void, Never>?

  public init() {}

  /// Shows a notice. With an action (usually Undo) it stays for six seconds, otherwise four.
  public func show(_ message: String, actionLabel: String? = nil, action: (() -> Void)? = nil) {
    let toast = Toast(message: message, actionLabel: actionLabel, action: action)
    current = toast
    dismissal?.cancel()
    dismissal = Task { [weak self] in
      try? await Task.sleep(for: .seconds(action == nil ? 4 : 6))
      if !Task.isCancelled, self?.current == toast { self?.current = nil }
    }
  }

  public func showError(_ error: Error) { show(error.localizedDescription) }

  /// Shows a notice with Undo that Edit > Undo (Command-Z) also performs, under `undoName`. Whichever runs first
  /// undoes; the other then does nothing. `undoManager` defaults to the main window's.
  public func showUndoable(_ message: String, undoName: String, undoManager: UndoManager? = nil, undo: @escaping () -> Void) {
    let action = UndoableAction.register(undoName, on: undoManager, undo)
    show(message, actionLabel: "Undo") { action.run() }
  }

  public func perform(_ toast: Toast) {
    toast.action?()
    if current == toast { current = nil }
  }

  public func dismiss() { current = nil }
}

struct ToastHost: View {
  @Environment(ToastCenter.self) private var toasts

  var body: some View {
    VStack {
      Spacer()
      if let toast = toasts.current {
        HStack(spacing: Space.s3) {
          Text(toast.message).font(.ui(Typography.Size.body))
            .foregroundStyle(GlassSupport.isActive ? Palette.ink : Palette.surfaceCanvas).lineLimit(2)
          if let label = toast.actionLabel {
            Button(label) { toasts.perform(toast) }
              .buttonStyle(.plain)
              .font(.ui(Typography.Size.body, weight: .semibold))
              .foregroundStyle(GlassSupport.isActive ? Palette.primary : Palette.primaryTint)
          }
        }
        .padding(.horizontal, Space.s4)
        .frame(minHeight: 40)
        .glassSurface(Capsule(), fallback: Palette.ink)
        .shadow(color: .black.opacity(0.18), radius: 16, y: 6)
        .padding(.bottom, Space.s6)
        .transition(.move(edge: .bottom).combined(with: .opacity))
        .id(toast.id)
      }
    }
    .frame(maxWidth: .infinity)
    .animation(Motion.panel, value: toasts.current)
    .allowsHitTesting(toasts.current != nil)
  }
}

/// One undo that both a toast and Edit > Undo can perform, at most once. Running it from the toast withdraws the
/// Edit > Undo entry, so Command-Z then moves on to the change before it.
@MainActor
public final class UndoableAction {
  private var undo: (() -> Void)?
  private weak var manager: UndoManager?

  private init(_ undo: @escaping () -> Void) { self.undo = undo }

  /// Registers `undo` with `manager` (or the main window's) and returns the shared action.
  @discardableResult
  public static func register(_ name: String, on manager: UndoManager? = nil, _ undo: @escaping () -> Void) -> UndoableAction {
    let action = UndoableAction(undo)
    if let manager = manager ?? NSApp.mainWindow?.undoManager ?? NSApp.keyWindow?.undoManager {
      action.manager = manager
      manager.registerUndo(withTarget: action) { action in MainActor.assumeIsolated { action.fire() } }
      manager.setActionName(name)
    }
    return action
  }

  /// Runs the undo once, withdrawing its Edit > Undo entry.
  public func run() {
    manager?.removeAllActions(withTarget: self)
    fire()
  }

  private func fire() {
    guard let undo else { return }
    self.undo = nil
    undo()
  }
}
