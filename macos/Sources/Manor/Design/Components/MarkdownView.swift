import SwiftUI

/// Renders GitHub-flavored Markdown in Manor's type and colors: headings, paragraphs, emphasis, inline code,
/// links (opened in the browser), ordered, unordered, and task lists with nesting, quotes, fenced code with
/// light highlighting, tables, remote images, thematic breaks, and TeX math shown as readable Unicode.
/// Text is selectable. Parsing is cached by source, so long documents re-render cheaply.
public struct MarkdownView: View {
  let markdown: String
  let size: CGFloat

  /// - Parameter size: the body text size; headings, code, and tables scale from it.
  public init(_ markdown: String, size: CGFloat = Typography.Size.md) {
    self.markdown = markdown
    self.size = size
  }

  public var body: some View {
    MarkdownBlocksView(blocks: RenderedMarkdown.parsed(markdown, size: size).blocks, size: size)
      .foregroundStyle(Palette.inkBody)
      .textSelection(.enabled)
      .environment(\.openURL, OpenURLAction { url in
        guard let scheme = url.scheme?.lowercased(), ["http", "https", "mailto"].contains(scheme) || scheme.hasPrefix("manor") else { return .discarded }
        NSWorkspace.shared.open(url)
        return .handled
      })
  }
}
