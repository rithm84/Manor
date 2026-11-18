import AppKit
import SwiftUI

/// A plain-text editor for pasted solutions. Every automatic substitution is off (quotes, dashes, text
/// replacement, spelling), lines never wrap, and the text is kept exactly as typed or pasted.
struct ProblemSolutionEditor: NSViewRepresentable {
  @Binding var text: String
  var autofocus = false

  func makeCoordinator() -> Coordinator { Coordinator(text: $text) }

  func makeNSView(context: Context) -> NSScrollView {
    let scroll = NSTextView.scrollableTextView()
    scroll.hasHorizontalScroller = true
    scroll.autohidesScrollers = true
    scroll.drawsBackground = false
    guard let textView = scroll.documentView as? NSTextView else { return scroll }
    textView.delegate = context.coordinator
    textView.isRichText = false
    textView.importsGraphics = false
    textView.allowsUndo = true
    textView.isAutomaticQuoteSubstitutionEnabled = false
    textView.isAutomaticDashSubstitutionEnabled = false
    textView.isAutomaticTextReplacementEnabled = false
    textView.isAutomaticSpellingCorrectionEnabled = false
    textView.isContinuousSpellCheckingEnabled = false
    textView.isGrammarCheckingEnabled = false
    textView.isAutomaticLinkDetectionEnabled = false
    textView.isAutomaticDataDetectionEnabled = false
    textView.smartInsertDeleteEnabled = false
    textView.font = .monospacedSystemFont(ofSize: 13, weight: .regular)
    textView.textColor = NSColor(Palette.ink)
    textView.insertionPointColor = NSColor(Palette.primary)
    textView.drawsBackground = false
    textView.textContainerInset = NSSize(width: 8, height: 8)
    textView.isHorizontallyResizable = true
    textView.textContainer?.widthTracksTextView = false
    textView.textContainer?.containerSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
    textView.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
    textView.string = text
    textView.setAccessibilityLabel("Solution")
    if autofocus { DispatchQueue.main.async { textView.window?.makeFirstResponder(textView) } }
    return scroll
  }

  func updateNSView(_ scroll: NSScrollView, context: Context) {
    guard let textView = scroll.documentView as? NSTextView, textView.string != text else { return }
    textView.string = text
  }

  final class Coordinator: NSObject, NSTextViewDelegate {
    var text: Binding<String>
    init(text: Binding<String>) { self.text = text }
    func textDidChange(_ notification: Notification) {
      guard let textView = notification.object as? NSTextView else { return }
      text.wrappedValue = textView.string
    }
  }
}

/// A pasted solution, shown exactly: monospaced, unwrapped, and selectable.
struct ProblemSolutionBlock: View {
  let solution: String

  var body: some View {
    ScrollView([.horizontal, .vertical]) {
      Text(solution)
        .font(.code())
        .foregroundStyle(Palette.inkBody)
        .textSelection(.enabled)
        .fixedSize(horizontal: true, vertical: true)
        .padding(Space.s3)
    }
    .frame(maxHeight: 320)
    .background(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).fill(Palette.surfacePaper))
    .overlay(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).strokeBorder(Palette.hairline))
  }
}
