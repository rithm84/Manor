import AppKit
import Foundation
import PDFKit
import UniformTypeIdentifiers

/// A piece of personal context the model should know: résumé, project notes, a job description…
public struct KnowledgeDoc: Identifiable, Codable, Equatable, Sendable {
    public enum Kind: String, Codable, CaseIterable, Identifiable, Sendable {
        case resume, experience, jobDescription, notes
        public var id: String { rawValue }
        public var title: String {
            switch self {
            case .resume: "Résumé"
            case .experience: "Experience and stories"
            case .jobDescription: "Job and company"
            case .notes: "Notes"
            }
        }
        public var icon: String {
            switch self {
            case .resume: "person.text.rectangle"
            case .experience: "star.bubble"
            case .jobDescription: "building.2"
            case .notes: "note.text"
            }
        }
    }

    public var id = UUID()
    public var title: String
    public var kind: Kind
    public var text: String
    public var enabled = true
    public var source: String?
    public var addedAt = Date.now
}

public extension KnowledgeDoc {
    /// A new, enabled document (kept in an extension so the memberwise initializer stays available).
    init(title: String, kind: Kind, text: String) {
        self.init(title: title, kind: kind, text: text, enabled: true, source: nil)
    }
}

/// Personal context library, persisted as JSON in Application Support. Enabled documents are
/// injected into every model prompt (stable per session → served from the prompt cache).
@MainActor
public final class KnowledgeStore: ObservableObject {
    @Published public private(set) var docs: [KnowledgeDoc] = []

    /// Hard cap on characters sent to the model (~15k tokens). Keeps hotkey TTFT low.
    public nonisolated static let budget = 60_000

    private let url: URL

    init(url: URL = Paths.support.appendingPathComponent("knowledge.json")) {
        self.url = url
        if let data = try? Data(contentsOf: url), let decoded = try? JSONDecoder().decode([KnowledgeDoc].self, from: data) {
            docs = decoded
        }
    }

    public var enabledCharacters: Int { docs.filter(\.enabled).reduce(0) { $0 + $1.text.count } }

    public func add(_ doc: KnowledgeDoc) {
        docs.append(doc)
        save()
    }

    public func update(_ doc: KnowledgeDoc) {
        guard let i = docs.firstIndex(where: { $0.id == doc.id }), docs[i] != doc else { return }
        docs[i] = doc
        save()
    }

    public func remove(_ ids: Set<UUID>) {
        docs.removeAll { ids.contains($0.id) }
        save()
    }

    /// Imports files, extracting their text. Returns names that couldn't be read.
    public func importFiles(_ urls: [URL]) -> [String] {
        var failed: [String] = []
        for url in urls {
            let access = url.startAccessingSecurityScopedResource()
            defer { if access { url.stopAccessingSecurityScopedResource() } }
            guard let text = DocumentText.extract(url), !text.isEmpty else {
                failed.append(url.lastPathComponent)
                continue
            }
            let name = url.deletingPathExtension().lastPathComponent
            add(KnowledgeDoc(title: name, kind: Self.guessKind(name: name, text: text), text: text, source: url.lastPathComponent))
        }
        return failed
    }

    /// Prompt section for all enabled documents, trimmed to the budget.
    nonisolated static func promptBlock(_ docs: [KnowledgeDoc], budget: Int = budget) -> String {
        var remaining = budget
        var parts: [String] = []
        for doc in docs where doc.enabled && remaining > 0 {
            let body = String(doc.text.prefix(remaining))
            remaining -= body.count
            parts.append("### \(doc.kind.title): \(doc.title)\n\(body)")
        }
        return parts.joined(separator: "\n\n")
    }

    nonisolated static func guessKind(name: String, text: String) -> KnowledgeDoc.Kind {
        let n = name.lowercased()
        if n.contains("resume") || n.contains("résumé") || n.contains("cv") { return .resume }
        if n.contains("job") || n.contains("jd") || n.contains("role") || n.contains("posting") { return .jobDescription }
        let head = text.prefix(3_000).lowercased()
        if head.contains("experience") && head.contains("education") { return .resume }
        if head.contains("responsibilities") || head.contains("qualifications") { return .jobDescription }
        return .notes
    }

    private func save() {
        do {
            let data = try JSONEncoder().encode(docs)
            try data.write(to: url, options: .atomic)
        } catch {
            Log.app.error("Knowledge save failed: \(error.localizedDescription, privacy: .public)")
        }
    }
}

public enum DocumentText {
    public static let importable: [UTType] = [.pdf, .plainText, .rtf, .rtfd, .html,
                                       UTType(filenameExtension: "md") ?? .plainText,
                                       UTType(filenameExtension: "docx") ?? .data,
                                       UTType(filenameExtension: "doc") ?? .data,
                                       UTType(filenameExtension: "odt") ?? .data]

    static func extract(_ url: URL) -> String? {
        let ext = url.pathExtension.lowercased()
        let raw: String?
        switch ext {
        case "pdf":
            raw = PDFDocument(url: url)?.string
        case "docx", "doc", "rtf", "rtfd", "odt", "html", "htm", "webarchive":
            raw = (try? NSAttributedString(url: url, options: [:], documentAttributes: nil))?.string
        default:
            raw = (try? String(contentsOf: url, encoding: .utf8)) ?? (try? String(contentsOf: url, encoding: .isoLatin1))
        }
        return raw.map(clean)
    }

    /// Collapse PDF extraction noise: trailing spaces, runs of blank lines.
    static func clean(_ text: String) -> String {
        text.replacingOccurrences(of: "\r\n", with: "\n")
            .components(separatedBy: "\n")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .joined(separator: "\n")
            .replacingOccurrences(of: "\n{3,}", with: "\n\n", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
