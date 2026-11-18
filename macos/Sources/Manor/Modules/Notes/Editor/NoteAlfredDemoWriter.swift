#if DEBUG
import Foundation

/// A scripted writer for reviewing `/alfred` without provider keys: debug builds launched with `ALFRED_NOTES_DEMO=1`
/// stream fixed Markdown with the same pacing as a model, so the thinking state, streaming conversion,
/// refinement, and selection previews can be exercised. Release builds never include it.
@MainActor
final class NoteAlfredDemoWriter: NoteAlfredWriting {
  static let shared = NoteAlfredDemoWriter()
  static var isEnabled: Bool { ProcessInfo.processInfo.environment["ALFRED_NOTES_DEMO"] != nil }

  var isAvailable: Bool { true }
  var modelName: String { "demo" }

  func write(_ turn: NoteAlfredTurn, in context: NoteAlfredContext) -> AsyncThrowingStream<String, Error> {
    let text = Self.reply(to: turn.prompt, in: context)
    let fails = turn.prompt.lowercased().contains("fail")
    return AsyncThrowingStream { continuation in
      let task = Task {
        do {
          try await Task.sleep(for: .milliseconds(1_400))
          if fails { throw DemoError() }
          var index = text.startIndex
          while index < text.endIndex {
            let end = text.index(index, offsetBy: 12, limitedBy: text.endIndex) ?? text.endIndex
            continuation.yield(String(text[index..<end]))
            index = end
            try await Task.sleep(for: .milliseconds(30))
          }
          continuation.finish()
        } catch {
          continuation.finish(throwing: error)
        }
      }
      continuation.onTermination = { _ in task.cancel() }
    }
  }

  struct DemoError: LocalizedError {
    var errorDescription: String? { "Alfred couldn't reach the network. Check your connection and try again." }
  }

  private static func reply(to prompt: String, in context: NoteAlfredContext) -> String {
    switch context.purpose {
    case .rewriteInline:
      return (context.selection ?? "").split(separator: " ").prefix(6).joined(separator: " ") + ", said more simply"
    case .rewriteBlocks where prompt.lowercased().contains("table"):
      return "| Item | Note |\n| --- | --- |\n| First | Rewritten from the selection |\n| Second | Kept short |\n"
    case .rewriteBlocks:
      return "A shorter version of the selection.\n\n- The main point, said once\n- One supporting detail\n"
    case .refineBlock:
      return "## Revised\n\nThis version follows the request \u{201C}\(prompt)\u{201D} and keeps the structure.\n\n- One\n- Two\n"
    case .insert:
      return """
      ## Two Sum

      Use one pass with a hash map: for each `x`, look up `target - x` among the values already seen.

      > [!TIP]
      > Storing **after** the check means an element never pairs with itself.

      | Approach | Time | Space |
      | --- | --- | --- |
      | Brute force | O(n²) | O(1) |
      | Hash map | O(n) | O(n) |

      ```diagram
      array nums = [2, 7, 11, 15]
      step "i = 1: need 9 - 7 = 2, already seen at index 0"
      pointer i -> nums[1] orange
      highlight nums[0] green
      arrow nums[1] -> nums[0] "9 - 7 = 2" green
      ```

      ```ui
      root = Table([Col("", ["Delivery", "Ordering"]), Col("TCP", [Tag("reliable", "success"), "in order"]), Col("UDP", [Tag("best effort", "warning"), "none"])])
      ```

      <details><summary>Why it works</summary>

      When the second number of the pair is reached, the first is already in `seen`.

      </details>

      1. Walk the array once
      2. Return the pair
      - [ ] Try it with duplicates

      """
    }
  }
}
#endif
