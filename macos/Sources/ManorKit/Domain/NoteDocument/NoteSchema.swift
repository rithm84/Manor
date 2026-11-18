import Foundation

/// What the editor knows about each block type of Manor's block document format.
public enum NoteBlockKind: Hashable, Sendable {
  case paragraph, heading, bulletListItem, numberedListItem, checkListItem, toggleListItem, quote, callout
  case codeBlock, mathBlock
  case divider, table
  /// Content Alfred wrote for a request; `diagram` and `generativeUI` are visuals unwrapped from it.
  case alfred, diagram, generativeUI
  case image, video, audio, file
  case tableOfContents, webBookmark, webEmbed
  case twoColumns, noteColumn, columnList, column, documentTabs, documentTab
  case unknown(String)

  public init(type: String) {
    switch type {
    case "paragraph": self = .paragraph
    case "heading": self = .heading
    case "bulletListItem": self = .bulletListItem
    case "numberedListItem": self = .numberedListItem
    case "checkListItem": self = .checkListItem
    case "toggleListItem": self = .toggleListItem
    case "quote": self = .quote
    case "callout": self = .callout
    case "codeBlock": self = .codeBlock
    case "mathBlock": self = .mathBlock
    case "divider": self = .divider
    case "alfred": self = .alfred
    case "diagram": self = .diagram
    case "generativeUI": self = .generativeUI
    case "table": self = .table
    case "image": self = .image
    case "video": self = .video
    case "audio": self = .audio
    case "file": self = .file
    case "tableOfContents": self = .tableOfContents
    case "webBookmark": self = .webBookmark
    case "webEmbed": self = .webEmbed
    case "twoColumns": self = .twoColumns
    case "noteColumn": self = .noteColumn
    case "columnList": self = .columnList
    case "column": self = .column
    case "documentTabs": self = .documentTabs
    case "documentTab": self = .documentTab
    default: self = .unknown(type)
    }
  }

  public var type: String {
    switch self {
    case .paragraph: "paragraph"
    case .heading: "heading"
    case .bulletListItem: "bulletListItem"
    case .numberedListItem: "numberedListItem"
    case .checkListItem: "checkListItem"
    case .toggleListItem: "toggleListItem"
    case .quote: "quote"
    case .callout: "callout"
    case .codeBlock: "codeBlock"
    case .mathBlock: "mathBlock"
    case .divider: "divider"
    case .alfred: "alfred"
    case .diagram: "diagram"
    case .generativeUI: "generativeUI"
    case .table: "table"
    case .image: "image"
    case .video: "video"
    case .audio: "audio"
    case .file: "file"
    case .tableOfContents: "tableOfContents"
    case .webBookmark: "webBookmark"
    case .webEmbed: "webEmbed"
    case .twoColumns: "twoColumns"
    case .noteColumn: "noteColumn"
    case .columnList: "columnList"
    case .column: "column"
    case .documentTabs: "documentTabs"
    case .documentTab: "documentTab"
    case .unknown(let type): type
    }
  }

  /// Blocks whose content is styled inline text the reader types into.
  public var hasInlineContent: Bool {
    switch self {
    case .paragraph, .heading, .bulletListItem, .numberedListItem, .checkListItem, .toggleListItem, .quote, .callout: true
    default: false
    }
  }

  /// Blocks whose content is one unstyled string.
  public var hasPlainContent: Bool { self == .codeBlock || self == .mathBlock }

  /// Blocks the reader edits as text (inline or plain).
  public var isTextual: Bool { hasInlineContent || hasPlainContent }

  public var isListItem: Bool {
    switch self {
    case .bulletListItem, .numberedListItem, .checkListItem, .toggleListItem: true
    default: false
    }
  }

  /// Layout containers whose children are laid out by the container rather than indented under it.
  public var isLayoutContainer: Bool {
    switch self {
    case .twoColumns, .noteColumn, .columnList, .column, .documentTabs, .documentTab: true
    default: false
    }
  }

  /// Media blocks that reference a file by URL.
  public var isFileBlock: Bool {
    switch self {
    case .image, .video, .audio, .file: true
    default: false
    }
  }

  /// Blocks that can be converted into one another through Turn into, keeping their text.
  public var isConvertibleText: Bool { hasInlineContent }
}

/// Factories for new blocks, with the props Manor's block document format gives each type so new blocks match what the
/// React editor stored.
public enum NoteSchema {
  public static let textProps: [String: JSONValue] = ["backgroundColor": "default", "textColor": "default", "textAlignment": "left"]

  public static func defaultProps(for kind: NoteBlockKind) -> [String: JSONValue] {
    switch kind {
    case .paragraph, .bulletListItem, .numberedListItem, .toggleListItem: return textProps
    case .heading: return textProps.merging(["level": 1, "isToggleable": false]) { $1 }
    case .checkListItem: return textProps.merging(["checked": false]) { $1 }
    case .quote: return ["backgroundColor": "default", "textColor": "default"]
    case .callout: return ["tone": "plum"]
    case .codeBlock: return ["language": "javascript"]
    case .table: return ["textColor": "default"]
    case .image:
      return ["textAlignment": "left", "backgroundColor": "default", "name": "", "url": "", "caption": "", "showPreview": true,
              "alt": "", "crop": "original", "focalX": 50, "focalY": 50]
    case .video: return ["textAlignment": "left", "backgroundColor": "default", "name": "", "url": "", "caption": "", "showPreview": true]
    case .audio: return ["backgroundColor": "default", "name": "", "url": "", "caption": "", "showPreview": true]
    case .file: return ["backgroundColor": "default", "name": "", "url": "", "caption": ""]
    case .webBookmark, .webEmbed: return ["url": "", "title": ""]
    case .alfred: return ["source": "", "requests": [], "model": ""]
    case .diagram, .generativeUI: return ["source": ""]
    case .twoColumns: return ["ratio": 50]
    case .documentTab: return ["title": "Tab"]
    default: return [:]
    }
  }

  public static func defaultContent(for kind: NoteBlockKind) -> NoteBlockContent {
    if kind.hasInlineContent { return .inline([]) }
    if kind.hasPlainContent { return .plain("") }
    if kind == .table { return .table(.empty(rows: 2, columns: 3)) }
    return .absent
  }

  /// A new, empty block of a kind with the format's default props.
  public static func block(_ kind: NoteBlockKind, props: [String: JSONValue] = [:], content: NoteBlockContent? = nil, children: [NoteBlock] = []) -> NoteBlock {
    NoteBlock(type: kind.type, props: defaultProps(for: kind).merging(props) { $1 }, content: content ?? defaultContent(for: kind), children: children)
  }

  public static func paragraph(_ inlines: [NoteInline] = []) -> NoteBlock { block(.paragraph, content: .inline(inlines)) }

  /// Two columns with an empty paragraph in each, as the slash menu inserts them.
  public static func twoColumns() -> NoteBlock {
    block(.twoColumns, children: [block(.noteColumn, children: [paragraph()]), block(.noteColumn, children: [paragraph()])])
  }

  /// Two tabs with an empty paragraph in each, as the slash menu inserts them.
  public static func documentTabs() -> NoteBlock {
    block(.documentTabs, children: [
      block(.documentTab, props: ["title": "Tab 1"], children: [paragraph()]),
      block(.documentTab, props: ["title": "Tab 2"], children: [paragraph()])
    ])
  }

  /// The format's text and background color names.
  public static let colorNames = ["default", "gray", "brown", "red", "orange", "yellow", "green", "blue", "purple", "pink"]

  public static let calloutTones = ["plum", "info", "warning", "success"]

  /// The code block languages the React editor offered, as `(id, name, aliases)`.
  public static let codeLanguages: [(id: String, name: String, aliases: [String])] = [
    ("text", "Plain Text", ["text", "txt", "plain"]), ("c", "C", ["c"]), ("cpp", "C++", ["cpp", "c++"]), ("css", "CSS", ["css"]),
    ("glsl", "GLSL", ["glsl"]), ("graphql", "GraphQL", ["graphql", "gql"]), ("haml", "Ruby Haml", ["haml"]), ("html", "HTML", ["html"]),
    ("java", "Java", ["java"]), ("javascript", "JavaScript", ["javascript", "js"]), ("json", "JSON", ["json"]),
    ("jsonc", "JSON with Comments", ["jsonc"]), ("jsonl", "JSON Lines", ["jsonl"]), ("jsx", "JSX", ["jsx"]), ("julia", "Julia", ["julia", "jl"]),
    ("less", "Less", ["less"]), ("markdown", "Markdown", ["markdown", "md"]), ("mdx", "MDX", ["mdx"]), ("php", "PHP", ["php"]),
    ("postcss", "PostCSS", ["postcss"]), ("pug", "Pug", ["pug", "jade"]), ("python", "Python", ["python", "py"]), ("r", "R", ["r"]),
    ("regexp", "RegExp", ["regexp", "regex"]), ("sass", "Sass", ["sass"]), ("scss", "SCSS", ["scss"]),
    ("shellscript", "Shell", ["shellscript", "bash", "sh", "shell", "zsh"]), ("sql", "SQL", ["sql"]), ("svelte", "Svelte", ["svelte"]),
    ("typescript", "TypeScript", ["typescript", "ts"]), ("vue", "Vue", ["vue"]), ("vue-html", "Vue HTML", ["vue-html"]),
    ("wasm", "WebAssembly", ["wasm"]), ("wgsl", "WGSL", ["wgsl"]), ("xml", "XML", ["xml"]), ("yaml", "YAML", ["yaml", "yml"]),
    ("tsx", "TSX", ["tsx"]), ("haskell", "Haskell", ["haskell", "hs"]), ("csharp", "C#", ["c#", "csharp", "cs"]),
    ("latex", "LaTeX", ["latex"]), ("lua", "Lua", ["lua"]), ("mermaid", "Mermaid", ["mermaid", "mmd"]), ("ruby", "Ruby", ["ruby", "rb"]),
    ("rust", "Rust", ["rust", "rs"]), ("scala", "Scala", ["scala"]), ("swift", "Swift", ["swift"]), ("kotlin", "Kotlin", ["kotlin", "kt", "kts"]),
    ("objective-c", "Objective C", ["objective-c", "objc"]), ("go", "Go", ["go"])
  ]

  /// The language id for a fence tag or stored value, falling back to plain text.
  public static func codeLanguage(for tag: String) -> String {
    let wanted = tag.trimmingCharacters(in: .whitespaces).lowercased()
    if wanted.isEmpty { return "text" }
    return codeLanguages.first { $0.id == wanted || $0.aliases.contains(wanted) }?.id ?? wanted
  }

  public static func codeLanguageName(_ id: String) -> String {
    codeLanguages.first { $0.id == id || $0.aliases.contains(id) }?.name ?? (id.isEmpty ? "Plain Text" : id)
  }
}
