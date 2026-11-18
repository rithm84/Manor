import Foundation
import Testing
@testable import ManorKit

/// Shapes of `note_pages.content_json` as the web editor stored them in Manor's block document format
/// (`noteEditorSchema.tsx`), covering every block type and every inline style.
private let canonicalDocument = #"""
[
  {"id":"p1","type":"paragraph","props":{"backgroundColor":"default","textColor":"default","textAlignment":"left"},"content":[
    {"type":"text","text":"Plain ","styles":{}},
    {"type":"text","text":"bold","styles":{"bold":true}},
    {"type":"text","text":"italic","styles":{"italic":true}},
    {"type":"text","text":"under","styles":{"underline":true}},
    {"type":"text","text":"strike","styles":{"strike":true}},
    {"type":"text","text":"code","styles":{"code":true}},
    {"type":"text","text":"red","styles":{"textColor":"red"}},
    {"type":"text","text":"yellow bg","styles":{"backgroundColor":"yellow"}},
    {"type":"text","text":"all","styles":{"bold":true,"italic":true,"underline":true,"strike":true,"textColor":"blue","backgroundColor":"gray"}},
    {"type":"link","href":"https://example.com/docs","content":[{"type":"text","text":"Docs","styles":{}},{"type":"text","text":"Page","styles":{"bold":true}}]},
    {"type":"math","props":{},"content":"E = mc^2"},
    {"type":"pageMention","props":{"pageId":"note-2","title":"Weekly plan"}}
  ],"children":[
    {"id":"p1c","type":"paragraph","props":{"backgroundColor":"default","textColor":"default","textAlignment":"center"},"content":[],"children":[]}
  ]},
  {"id":"h1","type":"heading","props":{"backgroundColor":"default","textColor":"default","textAlignment":"left","level":1,"isToggleable":false},"content":[{"type":"text","text":"Research notes","styles":{}}],"children":[]},
  {"id":"h2","type":"heading","props":{"backgroundColor":"default","textColor":"purple","textAlignment":"left","level":2,"isToggleable":true},"content":[{"type":"text","text":"Toggle heading","styles":{}}],"children":[
    {"id":"h2c","type":"paragraph","props":{"backgroundColor":"default","textColor":"default","textAlignment":"left"},"content":[{"type":"text","text":"Hidden","styles":{}}],"children":[]}
  ]},
  {"id":"b1","type":"bulletListItem","props":{"backgroundColor":"default","textColor":"default","textAlignment":"left"},"content":[{"type":"text","text":"Bullet","styles":{}}],"children":[
    {"id":"b2","type":"bulletListItem","props":{"backgroundColor":"default","textColor":"default","textAlignment":"left"},"content":[{"type":"text","text":"Nested","styles":{}}],"children":[]}
  ]},
  {"id":"n1","type":"numberedListItem","props":{"backgroundColor":"default","textColor":"default","textAlignment":"left","start":3},"content":[{"type":"text","text":"Third","styles":{}}],"children":[]},
  {"id":"n2","type":"numberedListItem","props":{"backgroundColor":"default","textColor":"default","textAlignment":"left"},"content":[{"type":"text","text":"Fourth","styles":{}}],"children":[]},
  {"id":"c1","type":"checkListItem","props":{"backgroundColor":"default","textColor":"default","textAlignment":"left","checked":true},"content":[{"type":"text","text":"Done","styles":{}}],"children":[]},
  {"id":"t1","type":"toggleListItem","props":{"backgroundColor":"blue","textColor":"default","textAlignment":"left"},"content":[{"type":"text","text":"Toggle","styles":{}}],"children":[
    {"id":"t1c","type":"paragraph","props":{"backgroundColor":"default","textColor":"default","textAlignment":"left"},"content":[{"type":"text","text":"Inside","styles":{}}],"children":[]}
  ]},
  {"id":"q1","type":"quote","props":{"backgroundColor":"default","textColor":"default"},"content":[{"type":"text","text":"Quoted\nsecond line","styles":{}}],"children":[]},
  {"id":"d1","type":"divider","props":{},"children":[]},
  {"id":"co1","type":"callout","props":{"tone":"warning"},"content":[{"type":"text","text":"Careful","styles":{}}],"children":[]},
  {"id":"code1","type":"codeBlock","props":{"language":"typescript"},"content":[{"type":"text","text":"const answer = 42\n  // intentional indentation","styles":{}}],"children":[]},
  {"id":"code2","type":"codeBlock","props":{"language":"javascript"},"content":[],"children":[]},
  {"id":"tb1","type":"table","props":{"textColor":"default"},"content":{"type":"tableContent","columnWidths":[120,null],"headerRows":1,"rows":[
    {"cells":[
      {"type":"tableCell","content":[{"type":"text","text":"Topic","styles":{"bold":true}}],"props":{"colspan":1,"rowspan":1,"backgroundColor":"default","textColor":"default","textAlignment":"left"}},
      {"type":"tableCell","content":[{"type":"text","text":"Status","styles":{}}],"props":{"colspan":1,"rowspan":1,"backgroundColor":"default","textColor":"default","textAlignment":"left"}}
    ]},
    {"cells":[
      {"type":"tableCell","content":[{"type":"text","text":"Notes","styles":{}}],"props":{"colspan":1,"rowspan":1,"backgroundColor":"green","textColor":"default","textAlignment":"center"}},
      {"type":"tableCell","content":[],"props":{"colspan":1,"rowspan":1,"backgroundColor":"default","textColor":"default","textAlignment":"left"}}
    ]}
  ]},"children":[]},
  {"id":"img1","type":"image","props":{"textAlignment":"left","backgroundColor":"default","name":"chart.png","url":"manor-attachment://att-1","caption":"Weekly chart","showPreview":true,"previewWidth":480,"alt":"A bar chart","crop":"landscape","focalX":40,"focalY":60},"children":[]},
  {"id":"vid1","type":"video","props":{"textAlignment":"left","backgroundColor":"default","name":"clip.mp4","url":"manor-attachment://att-2","caption":"","showPreview":true},"children":[]},
  {"id":"aud1","type":"audio","props":{"backgroundColor":"default","name":"memo.m4a","url":"https://example.com/memo.m4a","caption":"Memo","showPreview":true},"children":[]},
  {"id":"file1","type":"file","props":{"backgroundColor":"default","name":"paper.pdf","url":"manor-attachment://att-3","caption":""},"children":[]},
  {"id":"m1","type":"mathBlock","props":{},"content":[{"type":"text","text":"\\int_0^1 x^2 dx","styles":{}}],"children":[]},
  {"id":"toc1","type":"tableOfContents","props":{},"children":[]},
  {"id":"wb1","type":"webBookmark","props":{"url":"https://example.com/source","title":"Primary source"},"children":[]},
  {"id":"we1","type":"webEmbed","props":{"url":"https://example.com/embed","title":"Reference view"},"children":[]},
  {"id":"cols","type":"twoColumns","props":{"ratio":40},"children":[
    {"id":"left","type":"noteColumn","props":{},"children":[{"id":"lp","type":"paragraph","props":{"backgroundColor":"default","textColor":"default","textAlignment":"left"},"content":[{"type":"text","text":"Left column","styles":{}}],"children":[]}]},
    {"id":"right","type":"noteColumn","props":{},"children":[{"id":"rp","type":"paragraph","props":{"backgroundColor":"default","textColor":"default","textAlignment":"left"},"content":[{"type":"text","text":"Right column","styles":{}}],"children":[]}]}
  ]},
  {"id":"tabs","type":"documentTabs","props":{},"children":[
    {"id":"tab1","type":"documentTab","props":{"title":"Research"},"children":[{"id":"tp1","type":"paragraph","props":{"backgroundColor":"default","textColor":"default","textAlignment":"left"},"content":[{"type":"text","text":"First tab","styles":{}}],"children":[]}]},
    {"id":"tab2","type":"documentTab","props":{"title":"Plan"},"children":[{"id":"tp2","type":"paragraph","props":{"backgroundColor":"default","textColor":"default","textAlignment":"left"},"content":[],"children":[]}]}
  ]}
]
"""#

/// Shapes other writers store: the MCP Markdown importer (`markdownImport.ts`), legacy columns, partial
/// blocks, and things this editor does not know.
private let foreignDocument = #"""
[
  {"id":"i1","type":"mathBlock","props":{},"content":"\\frac{a}{b}","children":[]},
  {"id":"i2","type":"paragraph","props":{"textColor":"default","backgroundColor":"default","textAlignment":"left"},"content":[{"type":"text","text":"Inline ","styles":{}},{"type":"math","content":"x^2"}],"children":[]},
  {"id":"i3","type":"table","props":{"textColor":"default"},"content":{"type":"tableContent","columnWidths":[],"headerRows":1,"rows":[{"cells":[[{"type":"text","text":"A","styles":{}}],[{"type":"text","text":"B","styles":{}}]]}]},"children":[]},
  {"id":"i4","type":"image","props":{"backgroundColor":"default","name":"x.png","url":"","caption":"","textAlignment":"left","showPreview":true,"alt":"X"},"content":[],"children":[]},
  {"id":"i5","type":"paragraph","content":"Partial block"},
  {"id":"i6","type":"futureBlock","props":{"anything":{"nested":[1,2,3]}},"content":[{"type":"sparkle","props":{"size":3}}],"children":[],"meta":{"agent":"codex"}},
  {"id":"i7","type":"paragraph","props":{"backgroundColor":"default","textColor":"default","textAlignment":"left","customProp":"kept"},"content":[
    {"type":"text","text":"Odd style","styles":{"fontSize":"20px"}},
    {"type":"text","text":"no styles key"},
    "bare string",
    {"type":"unknownInline","value":7}
  ],"children":[]},
  {"id":"i8","type":"columnList","children":[{"id":"i8a","type":"column","props":{"width":1},"children":[{"id":"i8p","type":"paragraph","content":[],"children":[]}]}]},
  {"type":"divider","children":[]}
]
"""#

private func parse(_ json: String) throws -> [JSONValue] {
  try JSONDecoder().decode([JSONValue].self, from: Data(json.utf8))
}

/// Forces every block to re-encode its content canonically, as an edit would.
private func edited(_ blocks: [NoteBlock]) -> [NoteBlock] {
  blocks.map { block in
    var copy = block
    copy.source.storedContent = nil
    copy.source.parsedContent = nil
    copy.children = edited(block.children)
    return copy
  }
}

@Suite("Note document conversion")
struct NoteDocumentCodingTests {
  @Test("an unedited document writes back exactly what was stored")
  func untouchedRoundTrip() throws {
    for fixture in [canonicalDocument, foreignDocument] {
      let stored = try parse(fixture)
      let blocks = NoteDocumentCoding.blocks(from: stored)
      let written = NoteDocumentCoding.json(from: blocks)
      // A block stored without an id gains a stable one, as the editor assigns it.
      let comparable = zip(stored, written).map { stored, written -> JSONValue in
        guard stored["id"] == nil, case .object(var object) = written else { return written }
        #expect(object["id"]?.string?.isEmpty == false)
        object.removeValue(forKey: "id")
        return .object(object)
      }
      #expect(comparable == stored)
    }
  }

  @Test("canonical encoding matches the stored format for every block type and style")
  func canonicalEncoding() throws {
    let stored = try parse(canonicalDocument)
    let blocks = edited(NoteDocumentCoding.blocks(from: stored))
    let written = NoteDocumentCoding.json(from: blocks)
    for (expected, actual) in zip(stored, written) {
      #expect(actual == expected, "block \(expected["id"]?.string ?? "?")")
    }
  }

  @Test("every inline style and inline item parses into the model")
  func inlineModel() throws {
    let blocks = NoteDocumentCoding.blocks(from: try parse(canonicalDocument))
    let items = try #require(blocks[0].content.inlines)
    guard case .text(let bold) = items[1], case .text(let italic) = items[2], case .text(let underline) = items[3],
          case .text(let strike) = items[4], case .text(let code) = items[5], case .text(let red) = items[6],
          case .text(let highlight) = items[7], case .text(let all) = items[8] else {
      Issue.record("Styled text did not parse")
      return
    }
    #expect(bold.styles.bold && italic.styles.italic && underline.styles.underline && strike.styles.strike && code.styles.code)
    #expect(red.styles.textColor == "red")
    #expect(highlight.styles.backgroundColor == "yellow")
    #expect(all.styles == NoteStyles(bold: true, italic: true, underline: true, strike: true, textColor: "blue", backgroundColor: "gray"))
    guard case .link(let href, let runs, _) = items[9] else { Issue.record("Link did not parse"); return }
    #expect(href == "https://example.com/docs")
    #expect(runs.map(\.text) == ["Docs", "Page"])
    guard case .math(let latex, _) = items[10], case .mention(let pageID, let title, _) = items[11] else { Issue.record("Atoms did not parse"); return }
    #expect(latex == "E = mc^2")
    #expect(pageID == "note-2" && title == "Weekly plan")
    #expect(blocks[0].plainText == "Plain bolditalicunderstrikecoderedyellow bgallDocsPageE = mc^2Weekly plan")
  }

  @Test("block content kinds follow the schema")
  func contentKinds() throws {
    let blocks = NoteDocumentCoding.blocks(from: try parse(canonicalDocument))
    let byID = Dictionary(uniqueKeysWithValues: blocks.flattened().map { ($0.block.id, $0.block) })
    #expect(byID["code1"]?.content == .plain("const answer = 42\n  // intentional indentation"))
    #expect(byID["code2"]?.content == .plain(""))
    #expect(byID["m1"]?.content == .plain("\\int_0^1 x^2 dx"))
    #expect(byID["d1"]?.content == .absent)
    let table = try #require(byID["tb1"]?.content.table)
    #expect(table.rows.count == 2 && table.columnCount == 2 && table.headerRows == 1)
    #expect(table.rows[1].cells[0].props["backgroundColor"] == "green")
    #expect(byID["tab1"]?.children.first?.id == "tp1")
    #expect(byID["left"]?.kind == .noteColumn)
  }

  @Test("editing one block rewrites only that block's content")
  func editKeepsOtherBlocks() throws {
    let stored = try parse(foreignDocument)
    var blocks = NoteDocumentCoding.blocks(from: stored)
    blocks.update(id: "i2") { block in block.content = .inline([.text("Rewritten", NoteStyles(bold: true))]) }
    let written = NoteDocumentCoding.json(from: blocks)
    #expect(written[1]["content"] == .array([["type": "text", "text": "Rewritten", "styles": ["bold": true]]]))
    #expect(written[1]["props"] == stored[1]["props"])
    for index in [0, 2, 3, 4, 5, 6, 7] { #expect(written[index] == stored[index]) }
  }

  @Test("unknown inline items and style keys survive an edit elsewhere in the block")
  func unknownInlineSurvivesEdit() throws {
    let stored = try parse(foreignDocument)
    var blocks = NoteDocumentCoding.blocks(from: stored)
    blocks.update(id: "i7") { block in
      guard case .inline(var items) = block.content else { return }
      items.insert(.text("New "), at: 0)
      block.content = .inline(items)
    }
    let content = try #require(NoteDocumentCoding.json(from: blocks)[6]["content"]?.array)
    #expect(content[0] == ["type": "text", "text": "New ", "styles": [:]])
    #expect(content[1] == ["type": "text", "text": "Odd style", "styles": ["fontSize": "20px"]])
    #expect(content.last == ["type": "unknownInline", "value": 7])
    #expect(NoteDocumentCoding.json(from: blocks)[6]["props"]?["customProp"] == "kept")
  }

  @Test("unknown blocks keep their props, content, and extra keys")
  func unknownBlock() throws {
    let stored = try parse(foreignDocument)
    let blocks = NoteDocumentCoding.blocks(from: stored)
    #expect(blocks[5].kind == .unknown("futureBlock"))
    #expect(NoteDocumentCoding.json(from: edited(blocks))[5] == stored[5])
  }

  @Test("new blocks carry the format's default props")
  func newBlocks() {
    let paragraph = NoteDocumentCoding.json(from: NoteSchema.paragraph([.text("Hi")]))
    #expect(paragraph["props"] == ["backgroundColor": "default", "textColor": "default", "textAlignment": "left"])
    #expect(paragraph["content"] == .array([["type": "text", "text": "Hi", "styles": [:]]]))
    #expect(paragraph["children"] == .array([]))
    let divider = NoteDocumentCoding.json(from: NoteSchema.block(.divider))
    #expect(divider["content"] == nil)
    let columns = NoteSchema.twoColumns()
    #expect(columns.children.map(\.type) == ["noteColumn", "noteColumn"])
    #expect(columns.props["ratio"] == 50)
    let tabs = NoteSchema.documentTabs()
    #expect(tabs.children.map { $0.string("title") } == ["Tab 1", "Tab 2"])
    let math = NoteDocumentCoding.inlineJSON(.math("a^2"))
    #expect(math == ["type": "math", "props": [:], "content": "a^2"])
    let mention = NoteDocumentCoding.inlineJSON(.mention(pageID: "p", title: "Plan"))
    #expect(mention == ["type": "pageMention", "props": ["pageId": "p", "title": "Plan"]])
  }
}

private let alfredDocument = #"""
[
  {"id":"al1","type":"alfred","props":{"source":"## Request flow\n\nThe client calls the **API**.\n\n```diagram\nbox client \"Client\"\nbox api \"API\"\nclient -> api\n```\n\nThen a summary:\n\n```ui\nmetric \"Latency\" 120ms\n```\n\n```swift\nlet x = 1\n```","requests":[{"prompt":"Explain the request flow","images":["manor-attachment://img-1"]},"Make it shorter"],"model":"gpt-6.1-terra"},"children":[]},
  {"id":"dg1","type":"diagram","props":{"source":"box a \"A\""},"children":[]},
  {"id":"ui1","type":"generativeUI","props":{"source":"metric \"Users\" 12"},"children":[]}
]
"""#

@Suite("Alfred blocks")
struct NoteAlfredTests {
  @Test("alfred, diagram, and generativeUI blocks round-trip exactly")
  func roundTrip() throws {
    let stored = try parse(alfredDocument)
    let blocks = NoteDocumentCoding.blocks(from: stored)
    #expect(blocks.map(\.kind) == [.alfred, .diagram, .generativeUI])
    #expect(NoteDocumentCoding.json(from: blocks) == stored)
    #expect(NoteDocumentCoding.json(from: edited(blocks)) == stored)
  }

  @Test("requests read as prompts with images, from objects or bare strings")
  func requests() throws {
    let block = NoteDocumentCoding.blocks(from: try parse(alfredDocument))[0]
    #expect(NoteAlfred.requests(of: block) == [NoteAlfredRequest(prompt: "Explain the request flow", images: ["manor-attachment://img-1"]),
                                               NoteAlfredRequest(prompt: "Make it shorter")])
    let fresh = NoteAlfred.block(request: NoteAlfredRequest(prompt: "Draw it"), model: "m")
    #expect(NoteDocumentCoding.json(from: fresh)["props"] == ["source": "", "requests": [["prompt": "Draw it", "images": []]], "model": "m"])
    #expect(NoteDocumentCoding.json(from: fresh)["content"] == nil)
  }

  @Test("the source splits into prose and visuals, and search reads only the prose")
  func segmentsAndText() throws {
    let block = NoteDocumentCoding.blocks(from: try parse(alfredDocument))[0]
    let segments = NoteAlfred.segments(of: NoteAlfred.source(of: block))
    #expect(segments.count == 5)
    #expect(segments[1] == .diagram("box client \"Client\"\nbox api \"API\"\nclient -> api"))
    #expect(segments[3] == .generativeUI("metric \"Latency\" 120ms"))
    #expect(segments[4] == .markdown("```swift\nlet x = 1\n```"))
    #expect(block.plainText.contains("The client calls the API."))
    #expect(!block.plainText.contains("box client"))
    #expect(!block.plainText.contains("metric"))
    #expect(NoteFind.matches(of: "client", in: [block]).isEmpty)
    // A visual still streaming comes back unfinished but present.
    #expect(NoteAlfred.segments(of: "Intro\n```diagram\nbox a").last == .diagram("box a"))
  }

  @Test("turning into regular blocks keeps prose as blocks and visuals as standalone blocks")
  func unwrap() throws {
    let block = NoteDocumentCoding.blocks(from: try parse(alfredDocument))[0]
    let blocks = NoteAlfred.unwrap(source: NoteAlfred.source(of: block))
    #expect(blocks.map(\.type) == ["heading", "paragraph", "diagram", "paragraph", "generativeUI", "codeBlock"])
    #expect(blocks[2].string("source") == "box client \"Client\"\nbox api \"API\"\nclient -> api")
    #expect(blocks[1].inlines.contains(.text("API", NoteStyles(bold: true))))
  }

  @Test("Markdown export quotes the latest request, then the source as written; fences import back as blocks")
  func markdown() throws {
    let blocks = NoteDocumentCoding.blocks(from: try parse(alfredDocument))
    let markdown = NoteMarkdown.markdown(from: blocks)
    #expect(markdown.hasPrefix("> Make it shorter\n\n## Request flow"))
    #expect(markdown.contains("```diagram\nbox client"))
    #expect(markdown.contains("```diagram\nbox a \"A\"\n```"))
    #expect(markdown.contains("```ui\nmetric \"Users\" 12\n```"))
    let imported = NoteMarkdown.blocks(from: "```diagram\nbox a\n```\n\n```ui\nmetric \"x\" 1\n```")
    #expect(imported.map(\.type) == ["diagram", "generativeUI"])
  }
}

private let primitivesMarkdown = """
# Title
Some **bold** and *it* with [link](https://example.com) and $a^2$
continued line.

- one
  - nested
- [ ] todo
- [x] done
3. third
4. fourth

| Left | Center | Right |
| :--- | :---: | ---: |
| a | **b** | c \\| d |

```python
print(1)
```

```diagram
box a "A"
```

```ui
root = Card([])
```

> quoted
> on two lines

> [!WARNING]
> Careful here

> [!TIP] Short tip

---

$$
x^2
$$

<details><summary>More detail</summary>

Inside the **toggle**

- item
</details>

Last paragraph.
"""

@Suite("Markdown to native blocks")
struct NoteMarkdownPrimitiveTests {
  @Test("every primitive Alfred writes becomes a native block")
  func primitives() {
    let blocks = NoteMarkdown.blocks(from: primitivesMarkdown, options: .init(joinParagraphLines: true))
    #expect(blocks.map(\.type) == ["heading", "paragraph", "bulletListItem", "checkListItem", "checkListItem", "numberedListItem", "numberedListItem",
                                   "table", "codeBlock", "diagram", "generativeUI", "quote", "callout", "callout", "divider", "mathBlock",
                                   "toggleListItem", "paragraph"])
    #expect(blocks[1].plainText == "Some bold and it with link and a^2 continued line.")
    #expect(blocks[1].inlines.contains(.text("bold", NoteStyles(bold: true))))
    #expect(blocks[1].inlines.contains { if case .link("https://example.com", _, _) = $0 { return true }; return false })
    #expect(blocks[1].inlines.contains { if case .math("a^2", _) = $0 { return true }; return false })
    #expect(blocks[2].children.map(\.plainText) == ["nested"])
    #expect(blocks[3].props["checked"] == false && blocks[4].props["checked"] == true)
    #expect(blocks[5].props["start"] == 3 && blocks[6].props["start"] == nil)
    let table = blocks[7].content.table
    #expect(table?.headerRows == 1 && table?.rows.count == 2)
    #expect(table?.rows[1].cells.map { $0.props["textAlignment"] } == ["left", "center", "right"])
    #expect(table?.rows[1].cells[1].content == [.text("b", NoteStyles(bold: true))])
    #expect(table?.rows[1].cells[2].content.plainText == "c | d")
    #expect(blocks[8].string("language") == "python" && blocks[8].plainText == "print(1)")
    #expect(blocks[9].string("source") == "box a \"A\"")
    #expect(blocks[10].string("source") == "root = Card([])")
    #expect(blocks[11].plainText == "quoted\non two lines")
    #expect(blocks[12].string("tone") == "warning" && blocks[12].plainText == "Careful here")
    #expect(blocks[13].string("tone") == "success" && blocks[13].plainText == "Short tip")
    #expect(blocks[15].plainText == "x^2")
    #expect(blocks[16].plainText == "More detail")
    #expect(blocks[16].children.map(\.type) == ["paragraph", "bulletListItem"])
    #expect(blocks[16].children[0].inlines.contains(.text("toggle", NoteStyles(bold: true))))
  }

  @Test("streaming conversion grows in place: no block changes type, and unclosed constructs wait")
  func streaming() {
    let final = NoteMarkdown.blocks(from: primitivesMarkdown, options: .alfred(id: "al", streaming: false))
    var seen: [String: String] = [:]
    let characters = Array(primitivesMarkdown)
    var cursor = 0
    while cursor < characters.count {
      cursor = min(characters.count, cursor + 7)
      let partial = String(characters[0..<cursor])
      let blocks = NoteMarkdown.blocks(from: partial, options: .alfred(id: "al", streaming: true))
      for entry in blocks.flattened() {
        if let type = seen[entry.block.id] { #expect(type == entry.block.type, "\(entry.block.id) changed from \(type) to \(entry.block.type) at \(cursor)") }
        seen[entry.block.id] = entry.block.type
      }
      // Visuals and code only appear once their fence closes, complete.
      for block in blocks where block.kind == .diagram || block.kind == .generativeUI || block.kind == .codeBlock {
        #expect(final.contains { $0.id == block.id && $0 == block }, "\(block.type) shown before it was complete at \(cursor)")
      }
      #expect(!blocks.contains { $0.kind == .paragraph && $0.plainText.hasPrefix("|") }, "a table row showed as a paragraph at \(cursor)")
    }
    #expect(NoteMarkdown.blocks(from: primitivesMarkdown, options: .alfred(id: "al", streaming: true)).map(\.id) == final.map(\.id))
    #expect(final.first?.id == "al/0" && final[2].children.first?.id == "al/2/0")
  }

  @Test("an Alfred block renders as these blocks, and unwrapping gives them fresh ids")
  func alfredBlocks() {
    var block = NoteAlfred.block(request: NoteAlfredRequest(prompt: "x"), model: "m", id: "al")
    block.props["source"] = .string(primitivesMarkdown)
    let rendered = NoteAlfred.blocks(of: block)
    #expect(rendered.count == 18 && rendered.allSatisfy { $0.id.hasPrefix("al/") })
    let unwrapped = NoteAlfred.unwrap(source: primitivesMarkdown)
    #expect(unwrapped.map(\.type) == rendered.map(\.type))
    #expect(unwrapped.allSatisfy { !$0.id.hasPrefix("al/") })
  }
}

@Suite("Incremental encoding")
struct NoteDocumentEncoderTests {
  @Test("reusing unchanged blocks gives exactly the full encoding")
  func matchesFullEncoding() throws {
    let encoder = NoteDocumentEncoder()
    var blocks = NoteDocumentCoding.blocks(from: try parse(canonicalDocument))
    #expect(encoder.json(from: blocks, changed: nil) == NoteDocumentCoding.json(from: blocks))
    // A text edit inside a nested block, reported by its top-level ancestor.
    blocks.update(id: "lp") { $0.content = .inline([.text("Edited left", NoteStyles(italic: true))]) }
    #expect(encoder.json(from: blocks, changed: ["cols"]) == NoteDocumentCoding.json(from: blocks))
    // A structural change without a changed set compares every block.
    blocks.remove(ids: ["d1"])
    blocks.insert([NoteSchema.paragraph([.text("New")])], relativeTo: "p1", .after)
    #expect(encoder.json(from: blocks, changed: nil) == NoteDocumentCoding.json(from: blocks))
    encoder.reset()
    #expect(encoder.json(from: blocks, changed: []) == NoteDocumentCoding.json(from: blocks))
  }
}

@Suite("Note tree operations")
struct NoteTreeTests {
  @Test("blocks are found, moved, and removed by stable id at any depth")
  func treeOperations() throws {
    var blocks = NoteDocumentCoding.blocks(from: try parse(canonicalDocument))
    #expect(blocks.path(of: "lp") == [blocks.firstIndex { $0.id == "cols" }!, 0, 0])
    #expect(blocks.parentID(of: "b2") == "b1")
    let removed = blocks.remove(ids: ["b2", "tp1"])
    #expect(removed.map(\.id) == ["b2", "tp1"])
    #expect(!blocks.contains(id: "b2"))
    let inserted = blocks.insert(removed, relativeTo: "h1", .after)
    #expect(inserted)
    #expect(blocks[1].id == "h1" && blocks[2].id == "b2" && blocks[3].id == "tp1")
    let nested = blocks.insert([NoteSchema.paragraph()], relativeTo: "tab2", .firstChild)
    #expect(nested)
    #expect(blocks.block(id: "tab2")?.children.count == 2)
  }

  @Test("duplicates get fresh ids all the way down")
  func freshIDs() throws {
    let blocks = NoteDocumentCoding.blocks(from: try parse(canonicalDocument))
    let columns = try #require(blocks.block(id: "cols"))
    let copy = columns.withFreshIDs()
    let original = Set([columns].allIDs)
    #expect(Set([copy].allIDs).isDisjoint(with: original))
    #expect(copy.children.count == 2 && copy.children[0].children[0].plainText == "Left column")
  }

  @Test("headings feed the live contents in reading order")
  func headings() throws {
    let blocks = NoteDocumentCoding.blocks(from: try parse(canonicalDocument))
    #expect(blocks.headings.map(\.title) == ["Research notes", "Toggle heading"])
    #expect(blocks.headings.map(\.level) == [1, 2])
  }
}

@Suite("In-note fragment links")
struct NoteFragmentTests {
  private func heading(_ id: String, _ text: String, children: [NoteBlock] = []) -> NoteBlock {
    NoteBlock(id: id, type: "heading", props: ["level": 2], content: .inline([.text(text)]), children: children)
  }

  @Test("Markdown contents slugs resolve to headings, including nested and repeated titles")
  func resolvesSlugs() {
    let document: [NoteBlock] = [
      NoteBlock(id: "p1", type: "paragraph", content: .inline([.text("Intro")])),
      heading("h1", "1. The interview mental model"),
      heading("h2", "Variables, assignment & truthiness", children: [heading("h2b", "Nested: details")]),
      heading("h3", "Recap"),
      heading("h4", "Recap")
    ]
    #expect(NoteFragments.blockID(for: "#1-the-interview-mental-model", in: document) == "h1")
    #expect(NoteFragments.blockID(for: "#variables-assignment--truthiness", in: document) == "h2")
    #expect(NoteFragments.blockID(for: "#nested-details", in: document) == "h2b")
    #expect(NoteFragments.blockID(for: "#recap", in: document) == "h3")
    #expect(NoteFragments.blockID(for: "#recap-2", in: document) == "h4")
    #expect(NoteFragments.blockID(for: "#block=p1", in: document) == "p1")
    #expect(NoteFragments.blockID(for: "#missing", in: document) == nil)
    #expect(NoteFragments.blockID(for: "#", in: document) == nil)
  }

  @Test("only fragment links stay inside the note")
  func fragmentLinks() {
    #expect(NoteFragments.fragment(ofLink: "#recap") == "#recap")
    #expect(NoteFragments.fragment(ofLink: "https://example.com/#recap") == nil)
  }
}

@Suite("Find in note")
struct NoteFindTests {
  private func paragraph(_ items: [NoteInline]) -> NoteBlock { NoteSchema.paragraph(items) }

  @Test("finds every case-insensitive occurrence across blocks")
  func acrossBlocks() {
    let blocks = [paragraph([.text("Dijkstra relaxes edges.")]), paragraph([.text("Then dijkstra repeats, and DIJKSTRA halts.")])]
    let matches = NoteFind.matches(of: "dijkstra", in: blocks)
    #expect(matches.count == 3)
    #expect(matches.map(\.blockID) == [blocks[0].id, blocks[1].id, blocks[1].id])
  }

  @Test("finds repeated occurrences inside one run")
  func repeated() {
    #expect(NoteFind.matches(of: "aba", in: [paragraph([.text("aba aba aba")])]).count == 3)
  }

  @Test("returns nothing for missing text or an empty query")
  func missing() {
    let blocks = [paragraph([.text("Sliding window notes")])]
    #expect(NoteFind.matches(of: "heap", in: blocks).isEmpty)
    #expect(NoteFind.matches(of: "", in: blocks).isEmpty)
  }

  @Test("matches a phrase across formatting, with ranges in displayed text")
  func acrossFormatting() {
    let blocks = [paragraph([.text("Pri"), .text("ority", NoteStyles(bold: true)), .text(" queue"), .mention(pageID: "x", title: "Priority queue")])]
    let matches = NoteFind.matches(of: "priority queue", in: blocks)
    #expect(matches.count == 1)
    #expect(matches.first?.range == NSRange(location: 0, length: 14))
  }

  @Test("searches code and table cells")
  func codeAndTables() {
    let code = NoteSchema.block(.codeBlock, content: .plain("let heap = Heap()"))
    let table = NoteSchema.block(.table, content: .table(NoteTable(rows: [NoteTableRow(cells: [NoteTableCell(content: [.text("heap")])])])))
    let matches = NoteFind.matches(of: "heap", in: [code, table])
    #expect(matches.count == 3)
    #expect(matches.last?.cell == NoteCellAddress(row: 0, column: 0))
  }
}

@Suite("Notes Markdown interchange")
struct NoteMarkdownTests {
  @Test("imports document blocks and preserves code text")
  func importsBlocks() {
    let blocks = NoteMarkdown.blocks(from: ["# Imported heading", "", "> Quoted text", "", "```ts", "const answer = 42", "  // intentional indentation", "```"].joined(separator: "\n"))
    #expect(blocks.map(\.type) == ["heading", "quote", "codeBlock"])
    #expect(blocks[2].content == .plain("const answer = 42\n  // intentional indentation"))
    #expect(blocks[2].string("language") == "typescript")
  }

  @Test("imports lists with nesting, checkboxes, and numbering")
  func importsLists() {
    let blocks = NoteMarkdown.blocks(from: "- One\n  - Nested\n- [x] Done\n- [ ] Open\n3. Third\n4. Fourth")
    #expect(blocks.map(\.type) == ["bulletListItem", "checkListItem", "checkListItem", "numberedListItem", "numberedListItem"])
    #expect(blocks[0].children.map(\.plainText) == ["Nested"])
    #expect(blocks[1].props["checked"] == true && blocks[2].props["checked"] == false)
  }

  @Test("imports inline styles, links, and equations")
  func importsInline() {
    let items = NoteMarkdown.inlines(from: "Plain **bold** *italic* ~~gone~~ `code` [link](https://example.com) $x^2$ snake_case_name")
    #expect(items.contains(.text("bold", NoteStyles(bold: true))))
    #expect(items.contains(.text("italic", NoteStyles(italic: true))))
    #expect(items.contains(.text("gone", NoteStyles(strike: true))))
    #expect(items.contains(.text("code", NoteStyles(code: true))))
    #expect(items.contains(.link(href: "https://example.com", runs: [NoteTextRun("link")], other: [:])))
    #expect(items.contains { if case .math("x^2", _) = $0 { return true }; return false })
    #expect(items.plainText.hasSuffix("snake_case_name"))
  }

  @Test("imports tables, dividers, and block equations")
  func importsTables() {
    let blocks = NoteMarkdown.blocks(from: "| Topic | Status |\n| --- | --- |\n| Notes | Ready |\n\n---\n\n$$\n\\int_0^1 x^2 dx\n$$")
    #expect(blocks.map(\.type) == ["table", "divider", "mathBlock"])
    #expect(blocks[0].content.table?.rows.count == 2)
    #expect(blocks[2].content == .plain("\\int_0^1 x^2 dx"))
  }

  @Test("exports headings, lists, links, and tables as practical Markdown")
  func exportsMarkdown() {
    let blocks = NoteMarkdown.blocks(from: "## Reference\n\n- [Docs](https://example.com/docs)\n\n| Topic | Status |\n| --- | --- |\n| Notes | Ready |")
    let markdown = NoteMarkdown.markdown(from: blocks)
    #expect(markdown.contains("## Reference"))
    #expect(markdown.contains("[Docs](https://example.com/docs)"))
    #expect(markdown.contains("| Topic"))
    #expect(markdown.contains("| Notes"))
  }

  @Test("exports live contents, web blocks, equations, and columns through honest equivalents")
  func exportsAdvanced() throws {
    let blocks = NoteDocumentCoding.blocks(from: try parse(canonicalDocument))
    let markdown = NoteMarkdown.markdown(from: blocks)
    #expect(markdown.contains("- [Research notes](#research-notes)"))
    #expect(markdown.contains("[Primary source](https://example.com/source)"))
    #expect(markdown.contains("[Embedded page: Reference view](https://example.com/embed)"))
    #expect(markdown.contains("$E = mc^2$"))
    #expect(markdown.contains("$$\n\\int_0^1 x^2 dx\n$$"))
    #expect(markdown.contains("Left column\n\n***\n\nRight column"))
    #expect(markdown.contains("### Research\n\nFirst tab"))
  }

  @Test("recognizes Markdown in pasted plain text")
  func detection() {
    #expect(NoteMarkdown.looksLikeMarkdown("# Title\nBody"))
    #expect(NoteMarkdown.looksLikeMarkdown("- one\n- two"))
    #expect(!NoteMarkdown.looksLikeMarkdown("Just a sentence, nothing more."))
  }
}
