import SwiftUI

/// A group of settings rows on a raised surface, with an optional small heading above it.
struct SettingsCard<Content: View>: View {
  let title: String?
  @ViewBuilder let content: () -> Content

  init(_ title: String? = nil, @ViewBuilder content: @escaping () -> Content) {
    self.title = title
    self.content = content
  }

  var body: some View {
    VStack(alignment: .leading, spacing: Space.s2) {
      if let title {
        Text(title).font(.ui(Typography.Size.sm, weight: .semibold)).foregroundStyle(Palette.inkMuted)
          .padding(.leading, Space.s1)
      }
      VStack(spacing: 0) {
        Group(subviews: content()) { rows in
          ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
            row
            if index < rows.count - 1 { Hairline() }
          }
        }
      }
      .padding(.horizontal, Space.s4)
      .background(RoundedRectangle(cornerRadius: Radius.card, style: .continuous).fill(Palette.surfaceCard))
      .overlay(RoundedRectangle(cornerRadius: Radius.card, style: .continuous).strokeBorder(Palette.hairline, lineWidth: 1))
    }
  }
}

/// Label and one product-voice sentence on the left, the control on the right.
struct SettingsRow<Control: View>: View {
  let label: String
  let description: String?
  var labelColor: Color = Palette.ink
  @ViewBuilder let control: () -> Control

  init(_ label: String, description: String? = nil, labelColor: Color = Palette.ink, @ViewBuilder control: @escaping () -> Control) {
    self.label = label
    self.description = description
    self.labelColor = labelColor
    self.control = control
  }

  var body: some View {
    HStack(alignment: .center, spacing: Space.s4) {
      VStack(alignment: .leading, spacing: 2) {
        Text(label).font(.ui(Typography.Size.body, weight: .medium)).foregroundStyle(labelColor)
          .fixedSize(horizontal: false, vertical: true)
        if let description {
          Text(description).font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted)
            .fixedSize(horizontal: false, vertical: true)
        }
      }
      Spacer(minLength: Space.s4)
      control().fixedSize(horizontal: true, vertical: false)
    }
    .padding(.vertical, Space.s3)
    .frame(minHeight: 56)
  }
}

extension SettingsRow where Control == EmptyView {
  init(_ label: String, description: String? = nil) {
    self.init(label, description: description) { EmptyView() }
  }
}

/// A keyboard key cap for the shortcut reference.
struct KeyCap: View {
  let key: String

  var body: some View {
    Text(key)
      .font(.ui(Typography.Size.xs, weight: .semibold))
      .foregroundStyle(Palette.ink)
      .frame(minWidth: 22, minHeight: 22)
      .padding(.horizontal, key.count > 1 ? 5 : 0)
      .background(RoundedRectangle(cornerRadius: 5, style: .continuous).fill(Palette.surfaceCanvas))
      .overlay(RoundedRectangle(cornerRadius: 5, style: .continuous).strokeBorder(Palette.hairlineStrong, lineWidth: 1))
      .shadow(color: Palette.hairlineStrong.opacity(0.9), radius: 0, y: 1)
  }
}

/// An inline status line: a success notice or an error with its sentence.
struct SettingsNotice: View {
  let text: String
  var failed = false
  var onDismiss: (() -> Void)?

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: Space.s2) {
      Image(systemName: failed ? "exclamationmark.circle.fill" : "checkmark.circle.fill")
        .foregroundStyle(failed ? Palette.overdueError : Palette.completion)
      Text(text).font(.ui(Typography.Size.sm)).foregroundStyle(Palette.ink)
        .fixedSize(horizontal: false, vertical: true)
        .textSelection(.enabled)
      Spacer(minLength: 0)
      if let onDismiss {
        Button(action: onDismiss) { Image(systemName: "xmark").font(.system(size: 10, weight: .semibold)) }
          .buttonStyle(.plain).foregroundStyle(Palette.inkMuted).help("Dismiss").accessibilityLabel("Dismiss")
      }
    }
    .padding(.horizontal, Space.s3)
    .padding(.vertical, Space.s2)
    .background(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).fill(failed ? Palette.overdueErrorTint : Palette.completionTint))
    .transition(.opacity)
  }
}

/// Dialogs a settings section raises. A section sits inside the page's scrolling column, which clips an overlay to
/// the section; the section publishes its dialogs here and the page draws them over the whole page instead.
struct SettingsDialogKey: PreferenceKey {
  static let defaultValue: [SettingsDialogLayer] = []
  static func reduce(value: inout [SettingsDialogLayer], nextValue: () -> [SettingsDialogLayer]) { value += nextValue() }
}

struct SettingsDialogLayer {
  let id: String
  let open: Bool
  let view: AnyView
}

extension View {
  /// Publishes a section's dialogs (built on a `Color.clear`) for `SettingsPage` to draw over the page.
  func settingsDialogs<Dialogs: View>(open: Bool, id: String = #fileID, @ViewBuilder _ dialogs: () -> Dialogs) -> some View {
    preference(key: SettingsDialogKey.self, value: [SettingsDialogLayer(id: id, open: open, view: AnyView(dialogs()))])
  }
}

/// Draws the published section dialogs; inert while none is open.
struct SettingsDialogHost: View {
  let layers: [SettingsDialogLayer]
  var body: some View {
    ZStack {
      ForEach(layers, id: \.id) { layer in layer.view.allowsHitTesting(layer.open) }
    }
  }
}
