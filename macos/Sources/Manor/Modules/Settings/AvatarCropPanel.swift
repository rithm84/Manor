import AppKit
import SwiftUI

/// Square crop over a picked picture: drag to reposition, the slider or a scroll zooms, and Save renders the
/// circled region to a 512 point JPEG.
struct AvatarCropPanel: View {
  let image: NSImage
  let saving: Bool
  let onCancel: () -> Void
  let onSave: (Data) -> Void

  @State private var zoom: CGFloat = 1
  @State private var offset: CGSize = .zero
  @State private var dragStart: CGSize?

  private var pixelSize: CGSize {
    guard let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return image.size }
    return CGSize(width: cgImage.width, height: cgImage.height)
  }

  var body: some View {
    DialogPanel("Profile picture", onClose: onCancel) {
      VStack(spacing: Space.s4) {
        let size = pixelSize
        let scale = AvatarCrop.baseScale(size) * zoom
        ZStack {
          Image(nsImage: image)
            .resizable()
            .interpolation(.high)
            .frame(width: size.width * scale, height: size.height * scale)
            .offset(offset)
          // Everything outside the circle dims, so the saved region is obvious.
          Rectangle()
            .fill(Color.black.opacity(0.45))
            .mask {
              Rectangle().overlay(Circle().blendMode(.destinationOut)).compositingGroup()
            }
            .allowsHitTesting(false)
          Circle().strokeBorder(.white.opacity(0.85), lineWidth: 1.5).allowsHitTesting(false)
        }
        .frame(width: AvatarCrop.viewport, height: AvatarCrop.viewport)
        .clipShape(RoundedRectangle(cornerRadius: Radius.control, style: .continuous))
        .contentShape(Rectangle())
        .gesture(
          DragGesture(minimumDistance: 1)
            .onChanged { value in
              let start = dragStart ?? offset
              dragStart = start
              offset = AvatarCrop.clamp(CGSize(width: start.width + value.translation.width, height: start.height + value.translation.height), image: size, zoom: zoom)
            }
            .onEnded { _ in dragStart = nil }
        )
        .pointerStyle(dragStart == nil ? .grabIdle : .grabActive)
        .accessibilityLabel("Picture crop area. Drag to reposition.")

        HStack(spacing: Space.s3) {
          Image(systemName: "minus.magnifyingglass").foregroundStyle(Palette.inkMuted)
          Slider(value: Binding(get: { zoom }, set: { value in
            zoom = value
            offset = AvatarCrop.clamp(offset, image: size, zoom: value)
          }), in: 1...3)
          .accessibilityLabel("Zoom")
          Image(systemName: "plus.magnifyingglass").foregroundStyle(Palette.inkMuted)
        }
        .frame(width: AvatarCrop.viewport)
      }
      .frame(maxWidth: .infinity)
      .padding(.top, Space.s1)
    } footer: {
      Button("Cancel", action: onCancel).buttonStyle(.secondary).keyboardShortcut(.cancelAction).disabled(saving)
      Button(saving ? "Saving" : "Save") {
        if let jpeg = AvatarCrop.jpeg(image, zoom: zoom, offset: offset) { onSave(jpeg) }
      }
      .buttonStyle(.primary)
      .keyboardShortcut(.defaultAction)
      .disabled(saving)
    }
  }
}
