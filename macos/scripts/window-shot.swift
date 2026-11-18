// Captures the frontmost window of an app by name: swift scripts/window-shot.swift "Manor Staging" out.png
import CoreGraphics
import Foundation
let args = CommandLine.arguments
let owner = args[1], output = args[2]
let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
guard let window = windows.first(where: { ($0[kCGWindowOwnerName as String] as? String) == owner && ($0[kCGWindowLayer as String] as? Int) == 0 }),
      let id = window[kCGWindowNumber as String] as? Int else { print("no window"); exit(1) }
let task = Process()
task.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
task.arguments = ["-x", "-o", "-l", String(id), output]
try task.run(); task.waitUntilExit()
print("captured \(id)")
