import AppKit
import ApplicationServices
import ScreenCaptureKit

/// What Alfred sees of the screen for one answer: an image of the window you're working in and, when macOS allows
/// it, that window's text.
struct ScreenSnapshot: Sendable {
    /// JPEG data URL.
    var image: String
    var appName: String?
    var windowTitle: String?
    /// Text read from the window through Accessibility, including text scrolled out of view.
    var text: String?
}

/// Captures the front window of the app you're working in, the way a share sheet's window picker does: only that
/// window is composited, so Alfred's notch panel, other apps, and the desktop never appear in it. Nothing in the
/// window is clicked, selected, or highlighted; its text is read through the Accessibility API at the same time.
/// The window is the topmost ordinary window that isn't Manor's, so asking from the notch (which can make Manor the
/// active app while you type) still captures what you were looking at. With no such window it falls back to the
/// display under the cursor, still without Manor's windows.
enum WindowCapture {
    @MainActor
    static func capture(readText: Bool) async throws -> ScreenSnapshot {
        guard let target = frontWindowOutsideManor() else {
            return ScreenSnapshot(image: try await ScreenCapture.captureJPEGDataURL())
        }
        let pid = target.pid
        let appName = NSRunningApplication(processIdentifier: pid)?.localizedName ?? target.owner
        // The window's text is read off the main thread while the image is captured.
        let text = Task.detached(priority: .userInitiated) { readText ? WindowText.read(pid: pid) : nil }
        do {
            let image = try await captureWindow(target.id, frame: target.frame)
            return ScreenSnapshot(image: image, appName: appName, windowTitle: target.title, text: await text.value)
        } catch {
            text.cancel()
            return ScreenSnapshot(image: try await ScreenCapture.captureJPEGDataURL())
        }
    }

    /// The topmost ordinary window of another app, from the window server's front-to-back list.
    private static func frontWindowOutsideManor() -> (id: CGWindowID, pid: pid_t, owner: String?, frame: CGRect, title: String?)? {
        let ownPID = ProcessInfo.processInfo.processIdentifier
        guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { return nil }
        for info in list {
            guard let pid = info[kCGWindowOwnerPID as String] as? pid_t, pid != ownPID,
                  (info[kCGWindowLayer as String] as? Int) == 0,
                  (info[kCGWindowAlpha as String] as? Double ?? 1) > 0,
                  let id = info[kCGWindowNumber as String] as? CGWindowID,
                  let boundsDict = info[kCGWindowBounds as String] as? NSDictionary,
                  let bounds = CGRect(dictionaryRepresentation: boundsDict),
                  bounds.width > 120, bounds.height > 80 else { continue }
            let title = (info[kCGWindowName as String] as? String).flatMap { $0.isEmpty ? nil : $0 }
            return (id, pid, info[kCGWindowOwnerName as String] as? String, bounds, title)
        }
        return nil
    }

    private static func captureWindow(_ id: CGWindowID, frame: CGRect) async throws -> String {
        let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true)
        guard let window = content.windows.first(where: { $0.windowID == id }) else { throw ScreenCapture.CaptureError.noDisplay }
        let filter = SCContentFilter(desktopIndependentWindow: window)
        let scale = CGFloat(filter.pointPixelScale)
        var width = frame.width * scale
        var height = frame.height * scale
        let factor = min(1, ScreenCapture.maxLongEdge / max(width, height))
        width = (width * factor).rounded()
        height = (height * factor).rounded()

        let config = SCStreamConfiguration()
        config.width = Int(width)
        config.height = Int(height)
        config.showsCursor = false
        config.captureResolution = .best
        config.ignoreShadowsSingleWindow = true
        let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
        guard let jpeg = ScreenCapture.encodeJPEG(image) else { throw ScreenCapture.CaptureError.encodeFailed }
        return "data:image/jpeg;base64," + jpeg.base64EncodedString()
    }
}

/// Reads a window's text through the Accessibility API, without changing anything on screen: no clicks, focus,
/// selection, or scrolling. Password fields are never read. The walk is capped in time and size so a slow or huge
/// app can't hold up an answer.
public enum WindowText {
    public static var isTrusted: Bool { AXIsProcessTrusted() }

    /// Shows the system prompt that sends you to Privacy & Security > Accessibility.
    public static func requestTrust() {
        let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
        _ = AXIsProcessTrustedWithOptions([key: true] as CFDictionary)
    }

    static func read(pid: pid_t, budget: TimeInterval = 0.4, maxCharacters: Int = 12_000) -> String? {
        guard AXIsProcessTrusted() else { return nil }
        let app = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(app, 0.25)
        // Chromium and Electron apps build their accessibility tree only when an assistive app asks for it. This
        // changes nothing visible; other apps ignore it.
        AXUIElementSetAttributeValue(app, "AXManualAccessibility" as CFString, kCFBooleanTrue)

        guard let window = element(app, kAXFocusedWindowAttribute) ?? element(app, kAXMainWindowAttribute) else { return nil }
        let deadline = Date.now.addingTimeInterval(budget)
        var lines: [String] = []
        var total = 0
        if let focused = element(app, kAXFocusedUIElementAttribute), !isSecure(focused),
           let selected = string(focused, kAXSelectedTextAttribute), !selected.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            let clipped = String(selected.prefix(maxCharacters / 3))
            lines.append("[Selected text]\n\(clipped)\n[End of selected text]")
            total += clipped.count
        }

        var stack: [AXUIElement] = [window]
        var visited = 0
        while let node = stack.popLast(), visited < 6_000, total < maxCharacters, Date.now < deadline {
            visited += 1
            let role = string(node, kAXRoleAttribute) ?? ""
            if isSecure(node) { continue }
            switch role {
            case kAXStaticTextRole, kAXTextAreaRole, kAXTextFieldRole, kAXComboBoxRole, "AXHeading":
                if let value = string(node, kAXValueAttribute) ?? (role == "AXHeading" ? string(node, kAXTitleAttribute) : nil) {
                    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
                    if !trimmed.isEmpty, lines.last != trimmed {
                        let clipped = String(trimmed.prefix(maxCharacters - total))
                        lines.append(clipped)
                        total += clipped.count
                    }
                }
                // A text area's value already holds its text; its children repeat it.
                if role == kAXTextAreaRole || role == kAXTextFieldRole { continue }
            case kAXMenuBarRole, kAXMenuRole, kAXScrollBarRole:
                continue
            default:
                break
            }
            if let children = elements(node, kAXChildrenAttribute) {
                // Depth-first in reading order.
                stack.append(contentsOf: children.reversed())
            }
        }
        let text = lines.joined(separator: "\n")
        return text.count >= 20 ? text : nil
    }

    private static func isSecure(_ element: AXUIElement) -> Bool {
        string(element, kAXSubroleAttribute) == kAXSecureTextFieldSubrole || string(element, kAXRoleAttribute) == "AXSecureTextField"
    }

    private static func value(_ element: AXUIElement, _ attribute: String) -> CFTypeRef? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success else { return nil }
        return value
    }

    private static func string(_ element: AXUIElement, _ attribute: String) -> String? {
        value(element, attribute) as? String
    }

    private static func element(_ element: AXUIElement, _ attribute: String) -> AXUIElement? {
        guard let value = value(element, attribute), CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
        return (value as! AXUIElement)
    }

    private static func elements(_ element: AXUIElement, _ attribute: String) -> [AXUIElement]? {
        value(element, attribute) as? [AXUIElement]
    }
}
