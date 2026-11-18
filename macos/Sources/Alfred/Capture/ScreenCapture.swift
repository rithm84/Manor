import AppKit
import ScreenCaptureKit
import UniformTypeIdentifiers

/// One-shot screenshot of the display under the cursor, leaving out every window of this process (Alfred's
/// overlay and Manor's own windows), so the model sees the app the user is working in.
enum ScreenCapture {
    /// Long edge in pixels sent to the model: sharp enough for code, small enough to upload fast.
    static let maxLongEdge: CGFloat = 2_048

    static func captureJPEGDataURL() async throws -> String {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        let mouse = NSEvent.mouseLocation
        let screen = NSScreen.screens.first { NSMouseInRect(mouse, $0.frame, false) } ?? NSScreen.main
        let screenID = screen?.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? CGDirectDisplayID
        guard let display = content.displays.first(where: { $0.displayID == screenID }) ?? content.displays.first else {
            throw CaptureError.noDisplay
        }

        let pid = ProcessInfo.processInfo.processIdentifier
        let ownApps = content.applications.filter { $0.processID == pid }
        let filter = SCContentFilter(display: display, excludingApplications: ownApps, exceptingWindows: [])

        let scale = CGFloat(screen?.backingScaleFactor ?? 2)
        var width = CGFloat(display.width) * scale
        var height = CGFloat(display.height) * scale
        let factor = min(1, maxLongEdge / max(width, height))
        width = (width * factor).rounded()
        height = (height * factor).rounded()

        let config = SCStreamConfiguration()
        config.width = Int(width)
        config.height = Int(height)
        config.showsCursor = false
        config.captureResolution = .best

        let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
        guard let jpeg = encodeJPEG(image) else { throw CaptureError.encodeFailed }
        return "data:image/jpeg;base64," + jpeg.base64EncodedString()
    }

    static var hasPermission: Bool { CGPreflightScreenCaptureAccess() }

    @discardableResult
    static func requestPermission() -> Bool { CGRequestScreenCaptureAccess() }

    static func encodeJPEG(_ image: CGImage) -> Data? {
        let data = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(data, UTType.jpeg.identifier as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(dest, image, [kCGImageDestinationLossyCompressionQuality: 0.82] as CFDictionary)
        return CGImageDestinationFinalize(dest) ? data as Data : nil
    }

    enum CaptureError: LocalizedError {
        case noDisplay, encodeFailed
        var errorDescription: String? {
            switch self {
            case .noDisplay: "No display found to capture."
            case .encodeFailed: "Couldn't encode the screenshot."
            }
        }
    }
}
