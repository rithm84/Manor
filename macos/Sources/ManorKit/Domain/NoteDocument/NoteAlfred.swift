import Foundation

/// One request made to Alfred for a block: the prompt and the images sent with it, stored as note attachments
/// (`manor-attachment://` URLs).
public struct NoteAlfredRequest: Hashable, Sendable {
  public var prompt: String
  public var images: [String]

  public init(prompt: String, images: [String] = []) {
    self.prompt = prompt
    self.images = images
  }

  /// Reads a stored request: `{"prompt", "images"}`, or a bare prompt string.
  public init?(_ value: JSONValue) {
    if let prompt = value.string { self.init(prompt: prompt); return }
    guard let prompt = value["prompt"]?.string else { return nil }
    self.init(prompt: prompt, images: value["images"]?.array?.compactMap(\.string) ?? [])
  }

  public var json: JSONValue {
    ["prompt": .string(prompt), "images": .array(images.map(JSONValue.string))]
  }
}

/// The `alfred` block: everything Alfred wrote for a request, kept as one Markdown `source` with ```diagram
/// and ```ui fences, plus the requests that produced it and the model that wrote it. No children.
///
/// ```json
/// {"type": "alfred", "props": {"source": "…", "requests": [{"prompt": "…", "images": []}], "model": "…"}}
/// ```
///
/// `diagram` and `generativeUI` blocks hold one visual each in `props.source`, for hand-editing after
/// "Turn into regular blocks".
public enum NoteAlfred {
  /// Fence languages of diagram and generative-UI parts, as the writer emits them.
  public static let diagramLanguages: Set<String> = ["diagram", "alfred", "dsviz"]
  public static let generativeUILanguages: Set<String> = ["ui", "genui"]

  public enum Segment: Hashable, Sendable {
    case markdown(String)
    case diagram(String)
    case generativeUI(String)
  }

  /// A new Alfred block for a request, with no content yet.
  public static func block(request: NoteAlfredRequest, model: String, id: String = NoteBlock.newID()) -> NoteBlock {
    NoteBlock(id: id, type: "alfred", props: ["source": "", "requests": .array([request.json]), "model": .string(model)], content: .absent)
  }

  public static func source(of block: NoteBlock) -> String { block.props["source"]?.string ?? "" }

  public static func requests(of block: NoteBlock) -> [NoteAlfredRequest] {
    (block.props["requests"]?.array ?? []).compactMap(NoteAlfredRequest.init)
  }

  /// Splits a source into prose and visuals in order. An unclosed visual (still streaming) is included.
  public static func segments(of source: String) -> [Segment] {
    var segments: [Segment] = []
    var prose: [String] = []
    var visual: (diagram: Bool, lines: [String])?
    var inOtherFence = false
    func flushProse() {
      let text = prose.joined(separator: "\n").trimmingCharacters(in: .newlines)
      if !text.trimmingCharacters(in: .whitespaces).isEmpty { segments.append(.markdown(text)) }
      prose = []
    }
    for line in source.components(separatedBy: "\n") {
      let trimmed = line.trimmingCharacters(in: .whitespaces)
      if let open = visual {
        if trimmed.hasPrefix("```") {
          let body = open.lines.joined(separator: "\n")
          segments.append(open.diagram ? .diagram(body) : .generativeUI(body))
          visual = nil
        } else {
          visual?.lines.append(line)
        }
        continue
      }
      if trimmed.hasPrefix("```") {
        if inOtherFence {
          inOtherFence = false
        } else {
          let language = trimmed.dropFirst(3).trimmingCharacters(in: .whitespaces).lowercased()
          if diagramLanguages.contains(language) || generativeUILanguages.contains(language) {
            flushProse()
            visual = (diagramLanguages.contains(language), [])
            continue
          }
          inOtherFence = true
        }
      }
      prose.append(line)
    }
    if let open = visual {
      let body = open.lines.joined(separator: "\n")
      segments.append(open.diagram ? .diagram(body) : .generativeUI(body))
    } else {
      flushProse()
    }
    return segments
  }

  /// The prose of a source as plain text (Markdown syntax and visuals left out), for search and export.
  public static func proseText(of source: String) -> String {
    let prose = segments(of: source).compactMap { segment -> String? in
      if case .markdown(let text) = segment { return text }
      return nil
    }
    guard !prose.isEmpty else { return "" }
    return NoteMarkdown.plainText(from: NoteMarkdown.blocks(from: prose.joined(separator: "\n\n")))
  }

  /// The blocks an Alfred block's source reads as: headings, paragraphs, lists, tables, code, quotes, callouts,
  /// toggles, dividers, block math, and `diagram` and `generativeUI` blocks for visual fences. Ids derive from
  /// the block's id and each block's position, so a source that grows while streaming keeps its ids.
  public static func blocks(of block: NoteBlock, streaming: Bool = false) -> [NoteBlock] {
    NoteMarkdown.blocks(from: source(of: block), options: .alfred(id: block.id, streaming: streaming))
  }

  /// "Turn into regular blocks": the converted blocks, with fresh ids, ready to stand in the note.
  public static func unwrap(source: String) -> [NoteBlock] {
    NoteMarkdown.blocks(from: source, options: NoteMarkdown.Options(joinParagraphLines: true))
  }

  /// Markdown for an Alfred block: the latest request as a quote line, then the source as written.
  public static func markdown(of block: NoteBlock) -> String {
    let latest = requests(of: block).last?.prompt.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    let quote = latest.components(separatedBy: "\n").map { "> \($0)" }.joined(separator: "\n")
    let source = source(of: block).trimmingCharacters(in: .newlines)
    return [latest.isEmpty ? "" : quote, source].filter { !$0.isEmpty }.joined(separator: "\n\n")
  }
}
