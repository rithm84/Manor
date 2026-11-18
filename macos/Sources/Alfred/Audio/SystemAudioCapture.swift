import AVFoundation
import ScreenCaptureKit

/// Captures everything the Mac plays (Zoom, Meet, browser tabs…) via ScreenCaptureKit,
/// excluding Alfred's own process. Emits 16 kHz mono Int16 PCM.
final class SystemAudioCapture: NSObject, SCStreamOutput, SCStreamDelegate, @unchecked Sendable {
    var onAudio: ((Data, Float) -> Void)?
    var onStop: ((Error?) -> Void)?

    private let queue = DispatchQueue(label: "app.manor.alfred.system-audio", qos: .userInteractive)
    private let converter = PCMConverter()
    private var stream: SCStream?

    func start() async throws {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard let display = content.displays.first else { throw CaptureError.noDisplay }

        let filter = SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])
        let config = SCStreamConfiguration()
        config.capturesAudio = true
        config.excludesCurrentProcessAudio = true
        config.sampleRate = Int(PCMConverter.sampleRate)
        config.channelCount = 1
        // Video is mandatory for an SCStream; make it as cheap as possible.
        config.width = 2
        config.height = 2
        config.minimumFrameInterval = CMTime(value: 1, timescale: 1)
        config.queueDepth = 3
        config.showsCursor = false

        let stream = SCStream(filter: filter, configuration: config, delegate: self)
        try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: queue)
        try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
        try await stream.startCapture()
        self.stream = stream
        Log.audio.info("System audio capture started")
    }

    func stop() async {
        guard let stream else { return }
        self.stream = nil
        try? await stream.stopCapture()
        Log.audio.info("System audio capture stopped")
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sample: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio, sample.isValid,
              let buffer = PCMConverter.pcmBuffer(from: sample),
              let (data, level) = converter.convert(buffer) else { return }
        onAudio?(data, level)
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        Log.audio.error("System audio stream stopped: \(error.localizedDescription, privacy: .public)")
        self.stream = nil
        onStop?(error)
    }

    enum CaptureError: LocalizedError {
        case noDisplay
        var errorDescription: String? { "No display available for audio capture." }
    }
}
