import XCTest
@testable import Alfred

final class ResponseEventTests: XCTestCase {
    func testFunctionCallItemsAndText() throws {
        let call = try SSE.responseEvent(fromLine: #"data: {"type":"response.output_item.done","item":{"type":"function_call","call_id":"c1","name":"set_tasks_done","arguments":"{\"tasks\":[\"t1\"]}"}}"#)
        guard case .item(let item)? = call else { return XCTFail("expected an item") }
        XCTAssertEqual(item["call_id"] as? String, "c1")
        XCTAssertEqual(item["name"] as? String, "set_tasks_done")

        guard case .delta(let text)? = try SSE.responseEvent(fromLine: #"data: {"type":"response.output_text.delta","delta":"Done"}"#) else {
            return XCTFail("expected a delta")
        }
        XCTAssertEqual(text, "Done")
        guard case .completed? = try SSE.responseEvent(fromLine: #"data: {"type":"response.completed","response":{}}"#) else {
            return XCTFail("expected completion")
        }
        XCTAssertNil(try SSE.responseEvent(fromLine: #"data: {"type":"response.output_item.added","item":{}}"#))
    }
}

@MainActor
final class AssistantTests: XCTestCase {
    final class FakeToolbox: AlfredToolbox {
        var calls: [String] = []
        var undone = false
        let tools = [
            AlfredTool(name: "complete", description: "", parameters: ["type": "object", "properties": [:]]),
            AlfredTool(name: "end", description: "", parameters: ["type": "object", "properties": [:]],
                       confirmation: AlfredToolConfirmation(question: "End it?", action: "End")),
            AlfredTool(name: "broken", description: "", parameters: ["type": "object", "properties": [:]]),
        ]

        func snapshot() async -> AlfredAppSnapshot { AlfredAppSnapshot(page: "Home", details: "Tasks: none") }

        func call(_ name: String, arguments: [String: Any]) async -> AlfredToolResult {
            calls.append(name)
            switch name {
            case "complete": return .done("Completed 1 task", undo: { [weak self] in self?.undone = true; return "Reopened 1 task" })
            case "end": return .done("Ended the session")
            default: return .failed("That task is gone.")
            }
        }
    }

    private func settle(_ assistant: AlfredAssistant) async {
        for _ in 0..<200 where assistant.isWorking {
            if let pending = assistant.entries.first(where: { $0.kind == .confirmation && $0.approved == nil }) {
                assistant.decide(pending, approved: pending.text == "End it?" && approved)
            }
            try? await Task.sleep(for: .milliseconds(20))
        }
    }

    private var approved = true

    func testActionsShowAsRowsWithUndoAndFailuresStayWithTheModel() async {
        let toolbox = FakeToolbox()
        let assistant = AlfredAssistant(appName: "Manor")
        assistant.toolbox = toolbox
        assistant.script = { _, snapshot in
            XCTAssertEqual(snapshot?.page, "Home")
            return .init(calls: [("complete", [:]), ("broken", [:])], reply: "All set.")
        }
        assistant.send("check it off")
        await settle(assistant)
        XCTAssertEqual(toolbox.calls, ["complete", "broken"])
        XCTAssertEqual(assistant.entries.map(\.kind), [.request, .action, .answer])
        let action = assistant.entries[1]
        XCTAssertEqual(action.undoState, .available)
        assistant.undo(action)
        for _ in 0..<50 where action.undoState == .working || action.undoState == .available { try? await Task.sleep(for: .milliseconds(10)) }
        XCTAssertTrue(toolbox.undone)
        XCTAssertEqual(action.undoState, .done("Reopened 1 task"))
    }

    func testToolsWithoutUndoAskFirst() async {
        let toolbox = FakeToolbox()
        let assistant = AlfredAssistant(appName: "Manor")
        assistant.toolbox = toolbox
        assistant.script = { _, _ in .init(calls: [("end", [:])], reply: "") }

        approved = false
        assistant.send("stop")
        await settle(assistant)
        XCTAssertEqual(toolbox.calls, [], "declining runs nothing")
        XCTAssertEqual(assistant.entries.last?.approved, false)

        approved = true
        assistant.send("stop")
        await settle(assistant)
        XCTAssertEqual(toolbox.calls, ["end"])
        XCTAssertEqual(assistant.entries.last?.kind, .action)
    }
}
