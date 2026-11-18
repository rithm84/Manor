import AppKit
import AVFoundation

/// The session chime: two soft sine notes, rendered from the web app's WebAudio recipe. A finished focus
/// session rises; a finished break settles lower, so the two read apart without looking.
@MainActor
enum PomodoroSound {
  enum Chime: String {
    case focus = "pomodoro-focus-complete"
    case rest = "pomodoro-break-complete"
  }

  /// The app-wide Sounds preference (Settings). Sounds are on until turned off.
  static let enabledKey = "manor.sounds.enabled"

  static var enabled: Bool { UserDefaults.standard.object(forKey: enabledKey) as? Bool ?? true }

  private static var players: [Chime: AVAudioPlayer] = [:]

  static func playChime(_ chime: Chime) {
    guard enabled, let player = player(chime) else { return }
    player.currentTime = 0
    player.play()
  }

  private static func player(_ chime: Chime) -> AVAudioPlayer? {
    if let player = players[chime] { return player }
    guard let url = url(chime), let player = try? AVAudioPlayer(contentsOf: url) else { return nil }
    player.volume = 1
    player.prepareToPlay()
    players[chime] = player
    return player
  }

  /// The bundle's `Resources/Sounds`, or the source tree's for an unbundled development run.
  private static func url(_ chime: Chime) -> URL? {
    var directories: [URL] = []
    if let resources = Bundle.main.resourceURL { directories.append(resources.appendingPathComponent("Sounds")) }
    directories.append(URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../../../../Resources/Sounds").standardized)
    for directory in directories {
      let file = directory.appendingPathComponent("\(chime.rawValue).wav")
      if FileManager.default.fileExists(atPath: file.path) { return file }
    }
    return nil
  }
}
