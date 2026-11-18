import Foundation

// Alfred operating the app it lives in. The host app (Manor) implements `AlfredToolbox`; Alfred offers its tools to
// the model through function calling in the in-app dialog, runs the calls the model makes, and shows each result
// as a compact row with Undo when the toolbox provides one. Alfred knows nothing about the app's data model.

/// One function the model can call.
public struct AlfredTool: @unchecked Sendable {
    /// snake_case, unique within the toolbox (`complete_tasks`).
    public let name: String
    /// What the tool does and when to use it, written for the model.
    public let description: String
    /// A JSON Schema object (`["type": "object", "properties": …, "required": […]]`). Supported for validation:
    /// `type` (string, integer, number, boolean, array, object), `enum`, `required`, `items`, `minimum`, `maximum`,
    /// `minItems`, `maxItems`, and `additionalProperties: false`.
    public let parameters: [String: Any]
    /// Set for tools that can't be undone: Alfred asks the user first and runs the call only once they approve.
    public let confirmation: AlfredToolConfirmation?

    public init(name: String, description: String, parameters: [String: Any], confirmation: AlfredToolConfirmation? = nil) {
        self.name = name
        self.description = description
        self.parameters = parameters
        self.confirmation = confirmation
    }

    /// The Responses API function-tool definition.
    var definition: [String: Any] {
        ["type": "function", "name": name, "description": description, "parameters": parameters, "strict": false]
    }

    /// Checks `arguments` against `parameters`; returns a reader-facing problem, or nil when they're valid.
    public func validate(_ arguments: [String: Any]) -> String? {
        AlfredSchema.problem(in: arguments, schema: parameters, path: "")
    }
}

/// The question Alfred asks before a tool that can't be undone ("End the focus session?") and the label of the
/// button that approves it ("End session").
public struct AlfredToolConfirmation: Sendable, Equatable {
    public let question: String
    public let action: String

    public init(question: String, action: String) {
        self.question = question
        self.action = action
    }
}

/// What a tool call did.
public struct AlfredToolResult: @unchecked Sendable {
    /// A short past-tense line shown in the conversation: "Completed 3 tasks". For failures, why it failed.
    public var summary: String
    /// Details for the model (IDs, what matched, what's next). Defaults to `summary`.
    public var output: String
    public var isError: Bool
    /// Reverses the action and returns its own summary ("Reopened 3 tasks"). Nil when there's no inverse.
    public var undo: (@MainActor () async throws -> String)?
    /// Read-only calls (find, list) don't add a row to the conversation.
    public var isQuiet: Bool

    public init(summary: String, output: String? = nil, isError: Bool = false, isQuiet: Bool = false,
                undo: (@MainActor () async throws -> String)? = nil) {
        self.summary = summary
        self.output = output ?? summary
        self.isError = isError
        self.isQuiet = isQuiet
        self.undo = undo
    }

    public static func done(_ summary: String, output: String? = nil, undo: (@MainActor () async throws -> String)? = nil) -> Self {
        Self(summary: summary, output: output, undo: undo)
    }

    /// A lookup: its output goes to the model, nothing shows in the conversation.
    public static func found(_ output: String) -> Self { Self(summary: "", output: output, isQuiet: true) }

    public static func failed(_ message: String) -> Self { Self(summary: message, isError: true) }
}

/// Where the user is and what's on screen there, as compact text for the model.
public struct AlfredAppSnapshot: Sendable, Equatable {
    /// The current page ("Home", "Notes").
    public var page: String
    /// Structured, compact facts with IDs the tools accept (today's tasks, today's habits, the open note's outline).
    public var details: String

    public init(page: String, details: String) {
        self.page = page
        self.details = details
    }
}

/// The app side of in-app Alfred. Implemented by Manor with its domain services; every call runs on the main actor.
@MainActor
public protocol AlfredToolbox: AnyObject {
    var tools: [AlfredTool] { get }
    /// A fresh snapshot of the current page, taken when the user sends a message.
    func snapshot() async -> AlfredAppSnapshot
    /// Runs one validated call. Never throws: failures come back as `.failed`.
    func call(_ name: String, arguments: [String: Any]) async -> AlfredToolResult
}

/// A small JSON Schema checker for tool arguments (the subset tools use).
enum AlfredSchema {
    static func problem(in value: Any, schema: [String: Any], path: String) -> String? {
        let name = path.isEmpty ? "arguments" : path
        if let options = schema["enum"] as? [Any] {
            let allowed = options.map { "\($0)" }
            if !allowed.contains("\(value)") { return "\(name) must be one of \(allowed.joined(separator: ", "))" }
        }
        switch schema["type"] as? String {
        case "object":
            guard let object = value as? [String: Any] else { return "\(name) must be an object" }
            for key in schema["required"] as? [String] ?? [] where object[key] == nil || object[key] is NSNull {
                return "\(path.isEmpty ? key : "\(path).\(key)") is required"
            }
            let properties = schema["properties"] as? [String: Any] ?? [:]
            if schema["additionalProperties"] as? Bool == false, let extra = object.keys.sorted().first(where: { properties[$0] == nil }) {
                return "\(path.isEmpty ? extra : "\(path).\(extra)") isn't a known argument"
            }
            for (key, sub) in object where !(sub is NSNull) {
                guard let subSchema = properties[key] as? [String: Any] else { continue }
                if let problem = problem(in: sub, schema: subSchema, path: path.isEmpty ? key : "\(path).\(key)") { return problem }
            }
        case "array":
            guard let array = value as? [Any] else { return "\(name) must be a list" }
            if let min = schema["minItems"] as? Int, array.count < min { return "\(name) needs at least \(min) item\(min == 1 ? "" : "s")" }
            if let max = schema["maxItems"] as? Int, array.count > max { return "\(name) takes at most \(max) items" }
            if let items = schema["items"] as? [String: Any] {
                for (index, item) in array.enumerated() {
                    if let problem = problem(in: item, schema: items, path: "\(name)[\(index)]") { return problem }
                }
            }
        case "string":
            guard value is String else { return "\(name) must be text" }
        case "boolean":
            guard let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else { return "\(name) must be true or false" }
        case "integer", "number":
            guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return "\(name) must be a number" }
            if schema["type"] as? String == "integer", number.doubleValue.rounded() != number.doubleValue { return "\(name) must be a whole number" }
            if let min = (schema["minimum"] as? NSNumber)?.doubleValue, number.doubleValue < min { return "\(name) must be at least \(min.clean)" }
            if let max = (schema["maximum"] as? NSNumber)?.doubleValue, number.doubleValue > max { return "\(name) must be at most \(max.clean)" }
        default:
            break
        }
        return nil
    }
}

private extension Double {
    var clean: String { rounded() == self ? String(Int(self)) : String(self) }
}
