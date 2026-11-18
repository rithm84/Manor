import AppKit
import ManorKit
import SwiftUI

/// How a picker's closed trigger sits in its context.
public enum ManorPickerStyle: Sendable {
  /// A bordered form field (dialogs with labelled fields, filter rows).
  case field
  /// Borderless until hovered, for property rows where the label column already frames the value.
  case inline
  /// A compact bordered control for page and section toolbars.
  case toolbar
}

// MARK: Trigger

/// The closed control every picker shares: label, optional clear button, optional chevron, Manor's focus
/// treatment instead of the system ring, and focus returning here when its popover closes.
struct PickerTrigger<Label: View, Popover: View>: View {
  let style: ManorPickerStyle
  @Binding var isOpen: Bool
  let accessibilityLabel: String
  let accessibilityValue: String
  var accessibilityHint = "Shows choices"
  var showsChevron = true
  var clearLabel: String?
  var onClear: (() -> Void)?
  var placement: ManorPopoverPlacement = .below(.leading)
  var matchTriggerWidth = false
  /// Keys pressed while the closed trigger has focus (Down and Space open; a date or time trigger takes typing).
  var onKey: ((KeyPress) -> KeyPress.Result)?
  @ViewBuilder let label: () -> Label
  @ViewBuilder let popover: () -> Popover

  @FocusState private var focused: Bool
  @State private var hovering = false
  @Environment(\.isEnabled) private var isEnabled

  var body: some View {
    HStack(spacing: Space.s1) {
      Button { isOpen.toggle() } label: {
        HStack(spacing: Space.s2) {
          label()
          Spacer(minLength: 0)
        }
        .frame(maxHeight: .infinity)
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .focused($focused)
      .focusEffectDisabled()
      .onKeyPress(phases: .down) { press in
        if press.key == .downArrow || press.key == .space {
          isOpen = true
          return .handled
        }
        return onKey?(press) ?? .ignored
      }
      .accessibilityLabel(accessibilityLabel)
      .accessibilityValue(accessibilityValue)
      .accessibilityHint(accessibilityHint)

      if let onClear {
        Button(action: onClear) {
          Image(systemName: "xmark.circle.fill").font(.system(size: 12)).foregroundStyle(Palette.inkMuted)
            .frame(width: 18, height: 18)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(clearLabel ?? "Clear")
        .accessibilityLabel(clearLabel ?? "Clear")
        .transition(.opacity)
      }
      if showsChevron {
        Image(systemName: "chevron.down")
          .font(.system(size: 9, weight: .semibold))
          .foregroundStyle(Palette.inkMuted)
          .rotationEffect(.degrees(isOpen ? 180 : 0))
          .allowsHitTesting(false)
          .accessibilityHidden(true)
      }
    }
    .modifier(PickerTriggerChrome(style: style, focused: focused, open: isOpen, hovering: hovering))
    .contentShape(Rectangle())
    .onTapGesture { isOpen.toggle() }
    .onHover { hovering = isEnabled && $0 }
    .opacity(isEnabled ? 1 : 0.5)
    .animation(Motion.fast, value: hovering)
    .animation(Motion.fast, value: isOpen)
    .manorPopover(isPresented: $isOpen, placement: placement, matchTriggerWidth: matchTriggerWidth, onClose: { returnFocus in
      guard returnFocus else { return }
      // Keyboard focus comes back to the trigger after Escape or a choice.
      DispatchQueue.main.async {
        focused = true
        // Without full keyboard access a button cannot hold focus; keep a dialog's text field from re-selecting.
        if let window = NSApp.keyWindow, !(window is ManorPopoverPanel), window.firstResponder is NSTextView {
          window.makeFirstResponder(nil)
        }
      }
    }, content: popover)
  }
}

/// The trigger's surface for each style. Pure, so the render harness can show every state.
struct PickerTriggerChrome: ViewModifier {
  let style: ManorPickerStyle
  let focused: Bool
  let open: Bool
  let hovering: Bool

  func body(content: Content) -> some View {
    let shape = RoundedRectangle(cornerRadius: Radius.control, style: .continuous)
    switch style {
    case .field:
      content
        .font(.ui(Typography.Size.body))
        .padding(.leading, Space.s3)
        .padding(.trailing, Space.s2 + 2)
        .frame(height: 32)
        .background(shape.fill(Palette.fieldFill))
        .modifier(FocusRing(shape: shape, focused: focused || open, border: hovering ? Palette.controlBorder.opacity(0.7) : Palette.fieldBorder))
    case .inline:
      content
        .font(.ui(Typography.Size.sm))
        .padding(.horizontal, Space.s2)
        .frame(height: 30)
        .background(shape.fill(open ? Palette.surfaceSelected : hovering ? Palette.surfaceHover : .clear))
        .modifier(FocusRing(shape: shape, focused: focused, border: .clear))
    case .toolbar:
      content
        .font(.ui(Typography.Size.sm, weight: .medium))
        .padding(.leading, Space.s2 + 2)
        .padding(.trailing, Space.s2)
        .frame(height: 28)
        .background(shape.fill(open ? Palette.surfaceSelected : hovering ? Palette.surfaceHover : .clear))
        .modifier(FocusRing(shape: shape, focused: focused, border: Palette.hairlineStrong))
    }
  }
}

/// Muted text for an unset value.
struct PickerPlaceholder: View {
  let text: String
  var body: some View { Text(text).foregroundStyle(Palette.inkMuted).lineLimit(1) }
}

// MARK: List rows

/// One row of a picker list: an optional leading checkbox (multi-select), icon or swatch, the label, a muted
/// detail, and a checkmark on the current value. Highlight follows the pointer and the arrow keys alike.
struct PickerRow: View {
  let label: String
  var systemImage: String?
  var swatch: Color?
  var detail: String?
  let selected: Bool
  let highlighted: Bool
  var muted = false
  var multiple = false
  var disabled = false

  var body: some View {
    HStack(spacing: Space.s2) {
      if multiple {
        RoundedRectangle(cornerRadius: 4, style: .continuous)
          .strokeBorder(selected ? Palette.primary : Palette.controlBorder, lineWidth: 1.5)
          .background(RoundedRectangle(cornerRadius: 4, style: .continuous).fill(selected ? Palette.primary : .clear))
          .overlay {
            if selected { Image(systemName: "checkmark").font(.system(size: 8, weight: .heavy)).foregroundStyle(Palette.onPrimary) }
          }
          .frame(width: 14, height: 14)
      }
      if let swatch {
        Circle().fill(swatch).frame(width: 8, height: 8).frame(width: 16)
      } else if let systemImage {
        Image(systemName: systemImage).font(.system(size: 12, weight: .medium))
          .foregroundStyle(selected ? Palette.primary : Palette.inkMuted)
          .frame(width: 16)
      }
      Text(label)
        .font(.ui(Typography.Size.sm, weight: selected && !multiple ? .semibold : .regular))
        .foregroundStyle(muted ? Palette.inkMuted : Palette.ink)
        .lineLimit(1)
        .truncationMode(.tail)
      Spacer(minLength: Space.s2)
      if let detail {
        Text(detail).font(.ui(Typography.Size.xs)).foregroundStyle(Palette.inkMuted).lineLimit(1).tabular()
      }
      if !multiple {
        Image(systemName: "checkmark").font(.system(size: 11, weight: .semibold)).foregroundStyle(Palette.primary)
          .opacity(selected ? 1 : 0)
          .frame(width: 14)
      }
    }
    .padding(.horizontal, Space.s2)
    .frame(height: 30)
    .background(
      RoundedRectangle(cornerRadius: Radius.chip, style: .continuous)
        .fill(highlighted && !disabled ? Palette.surfaceHover : .clear)
    )
    .opacity(disabled ? 0.45 : 1)
    .contentShape(Rectangle())
  }
}

/// A section's small heading inside a picker list.
struct PickerSectionHeader: View {
  let title: String
  var body: some View {
    Text(title)
      .font(.ui(Typography.Size.xs, weight: .semibold))
      .foregroundStyle(Palette.inkMuted)
      .padding(.horizontal, Space.s2)
      .padding(.top, Space.s2)
      .padding(.bottom, 2)
      .frame(maxWidth: .infinity, alignment: .leading)
      .accessibilityAddTraits(.isHeader)
  }
}

/// The text input at the top of a picker popover (search, typed date, typed time).
struct PickerInput: View {
  @Binding var text: String
  let prompt: String
  var systemImage = "magnifyingglass"
  var invalid = false
  var focused: FocusState<Bool>.Binding
  var accessibilityLabel: String

  var body: some View {
    let shape = RoundedRectangle(cornerRadius: Radius.control, style: .continuous)
    HStack(spacing: 6) {
      Image(systemName: systemImage).font(.system(size: 12, weight: .medium)).foregroundStyle(Palette.inkMuted)
      TextField(prompt, text: $text)
        .textFieldStyle(.plain)
        .font(.ui(Typography.Size.sm))
        .foregroundStyle(Palette.ink)
        .focused(focused)
        .accessibilityLabel(accessibilityLabel)
      if !text.isEmpty {
        Button { text = "" } label: {
          Image(systemName: "xmark.circle.fill").font(.system(size: 11)).foregroundStyle(Palette.inkMuted)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Clear")
      }
    }
    .padding(.horizontal, Space.s2 + 2)
    .frame(height: 30)
    .background(shape.fill(Palette.searchFill))
    .modifier(FocusRing(shape: shape, focused: focused.wrappedValue || invalid, border: .clear))
    .overlay(shape.strokeBorder(Palette.overdueError, lineWidth: 1.5).opacity(invalid ? 1 : 0))
    .animation(Motion.fast, value: invalid)
  }
}

/// Collects typed characters for type-to-select: letters typed within a moment of each other form one prefix.
struct TypeAheadBuffer {
  private(set) var text = ""
  private var last = Date.distantPast

  mutating func append(_ characters: String, now: Date = Date()) -> String {
    if now.timeIntervalSince(last) > 0.9 { text = "" }
    last = now
    // Repeating one letter cycles through the options that start with it, as menus do.
    if text.count == 1, characters.lowercased() == text { return text }
    text += characters.lowercased()
    return text
  }
}

/// Speaks a change the keyboard made inside a picker, for VoiceOver.
@MainActor
func announcePickerChange(_ text: String) {
  guard NSWorkspace.shared.isVoiceOverEnabled else { return }
  NSAccessibility.post(element: NSApp as Any, notification: .announcementRequested, userInfo: [
    .announcement: text, .priority: NSAccessibilityPriorityLevel.high.rawValue
  ])
}
