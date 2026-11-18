import OSLog

/// Unified logging under Manor's subsystem. View with:
/// `log stream --predicate 'subsystem == "app.manor" AND category == "alfred"' --level debug`
enum Log {
    private static let logger = Logger(subsystem: "app.manor", category: "alfred")
    static let app = logger
    static let audio = logger
    static let stt = logger
    static let llm = logger
    static let ui = logger
}
