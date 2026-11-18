import Darwin
import Foundation
import QuartzCore

/// Launch and navigation timings for performance work. Launched with `MANOR_PERF_LOG=/path/to/file`, Manor appends
/// one line per mark: the label and milliseconds since the process started (or since a page switch began).
/// Without the variable every call returns at once.
@MainActor
enum PerfLog {
  private static let path = ProcessInfo.processInfo.environment["MANOR_PERF_LOG"]
  private static var marked: Set<String> = []
  private static var switchStart: (route: String, time: CFTimeInterval)?

  static var isEnabled: Bool { path != nil }

  /// Milliseconds since the kernel started this process.
  private static var sinceLaunch: Double {
    var info = kinfo_proc()
    var size = MemoryLayout<kinfo_proc>.stride
    var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
    guard sysctl(&mib, 4, &info, &size, nil, 0) == 0 else { return -1 }
    let start = info.kp_proc.p_starttime
    let started = Double(start.tv_sec) + Double(start.tv_usec) / 1_000_000
    return (Date().timeIntervalSince1970 - started) * 1000
  }

  /// Records a launch milestone once per process.
  static func launch(_ label: String) {
    guard path != nil, marked.insert(label).inserted else { return }
    let elapsed = sinceLaunch
    // The frame that shows it is committed on the next turn of the run loop.
    DispatchQueue.main.async { write(String(format: "launch %@ %.0f ms, footprint %.0f MB", label, elapsed, footprintMB)) }
  }

  static func beginSwitch(to route: String) {
    guard path != nil else { return }
    switchStart = (route, CACurrentMediaTime())
  }

  /// Called when the new page has laid out; logs after the frame that shows it.
  static func endSwitch(to route: String) {
    guard path != nil, let start = switchStart, start.route == route else { return }
    switchStart = nil
    DispatchQueue.main.async {
      write(String(format: "switch %@ %.1f ms, footprint %.0f MB", route, (CACurrentMediaTime() - start.time) * 1000, footprintMB))
    }
  }

  /// The process's physical footprint, as Activity Monitor's Memory column reports it.
  static var footprintMB: Double {
    var info = task_vm_info_data_t()
    var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<natural_t>.size)
    let result = withUnsafeMutablePointer(to: &info) {
      $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count) }
    }
    return result == KERN_SUCCESS ? Double(info.phys_footprint) / 1_048_576 : -1
  }

  private static func write(_ line: String) {
    guard let path else { return }
    if !FileManager.default.fileExists(atPath: path) { FileManager.default.createFile(atPath: path, contents: nil) }
    guard let handle = FileHandle(forWritingAtPath: path) else { return }
    handle.seekToEndOfFile()
    handle.write(Data((line + "\n").utf8))
    try? handle.close()
  }
}
