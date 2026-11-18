import Darwin
import Foundation
import os

/// A last-resort ceiling on Manor's memory. Manor normally stays in the low hundreds of megabytes; a runaway loop
/// that allocates on every pass can instead grow the process by gigabytes a second and push the whole Mac into swap.
/// A background timer checks the physical footprint (the number Activity Monitor shows as Memory) once a second and,
/// past the ceiling, ends Manor at once. The crash report macOS writes then holds every thread's stack, including
/// the main thread's mid-loop, which names the cause. Notes and code drafts are already protected on disk as you
/// type, so ending the process loses no work.
enum MemoryGuard {
  /// Far above anything Manor uses (its heaviest state measures under 400 MB) and far below where a Mac suffers.
  static let ceiling: UInt64 = {
    #if DEBUG
    // QA only: a lower ceiling, so the guard can be exercised in the remote sandbox.
    if let megabytes = ProcessInfo.processInfo.environment["MANOR_QA_MEMORY_CEILING_MB"].flatMap(UInt64.init) { return megabytes << 20 }
    #endif
    return 4 << 30
  }()

  private static let log = Logger(subsystem: "app.manor", category: "memory")
  nonisolated(unsafe) private static var timer: DispatchSourceTimer?

  static func start() {
    guard timer == nil else { return }
    let timer = DispatchSource.makeTimerSource(queue: DispatchQueue(label: "app.manor.memory-guard", qos: .utility))
    timer.schedule(deadline: .now() + 1, repeating: 1, leeway: .milliseconds(250))
    timer.setEventHandler {
      let footprint = physicalFootprint()
      guard footprint > ceiling else { return }
      let gigabytes = String(format: "%.1f", Double(footprint) / Double(1 << 30))
      log.fault("Manor's memory reached \(gigabytes, privacy: .public) GB; ending the process before it slows the Mac")
      fatalError("Manor's memory reached \(gigabytes) GB, past its \(ceiling >> 20) MB ceiling. The main thread's stack in this report shows the runaway work.")
    }
    timer.resume()
    self.timer = timer
    #if DEBUG
    // QA only: a runaway main-thread loop that allocates without returning to the run loop, like a layout loop.
    if ProcessInfo.processInfo.environment["MANOR_QA_RUNAWAY"] != nil {
      DispatchQueue.main.asyncAfter(deadline: .now() + 8) {
        var hoard: [[UInt8]] = []
        while true { hoard.append([UInt8](repeating: 1, count: 8 << 20)) }
      }
    }
    #endif
  }

  /// The process's physical footprint in bytes.
  static func physicalFootprint() -> UInt64 {
    var info = task_vm_info_data_t()
    var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<natural_t>.size)
    let result = withUnsafeMutablePointer(to: &info) {
      $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count) }
    }
    return result == KERN_SUCCESS ? info.phys_footprint : 0
  }
}
