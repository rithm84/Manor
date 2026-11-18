import AVFoundation

/// Taps the default input device (read-only, shared with Zoom/Meet) and emits 16 kHz mono Int16 PCM.
///
/// Input-only: Alfred never touches the output device, never enables voice processing
/// (which would duck call audio), and never plays sound.
final class MicrophoneCapture: @unchecked Sendable {
    var onAudio: ((Data, Float) -> Void)?

    private let engine = AVAudioEngine()
    private let converter = PCMConverter()
    private var running = false
    private var configObserver: NSObjectProtocol?

    static func requestAccess() async -> Bool {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: return true
        case .notDetermined: return await AVCaptureDevice.requestAccess(for: .audio)
        default: return false
        }
    }

    func start() throws {
        guard !running else { return }
        try installTapAndStart()
        running = true
        // Default input changed (AirPods connected, USB mic unplugged…): the engine stops and the
        // tap's format is stale. Rebuild against the new device.
        configObserver = NotificationCenter.default.addObserver(
            forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main
        ) { [weak self] _ in
            guard let self, self.running else { return }
            Log.audio.info("Input device changed; restarting microphone capture")
            self.engine.inputNode.removeTap(onBus: 0)
            self.engine.stop()
            do { try self.installTapAndStart() } catch {
                Log.audio.error("Mic restart failed: \(error.localizedDescription, privacy: .public)")
            }
        }
    }

    func stop() {
        guard running else { return }
        running = false
        if let configObserver { NotificationCenter.default.removeObserver(configObserver) }
        configObserver = nil
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        Log.audio.info("Microphone capture stopped")
    }

    private func installTapAndStart() throws {
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else { throw MicError.noInput }
        // Tap blocks run serially on an AVAudioEngine worker thread (not the IO thread), so
        // converting inline is safe and avoids retaining buffers the engine may recycle.
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            guard let self, let (data, level) = self.converter.convert(buffer) else { return }
            self.onAudio?(data, level)
        }
        engine.prepare()
        try engine.start()
        Log.audio.info("Microphone capture started (\(format.sampleRate, privacy: .public) Hz)")
    }

    enum MicError: LocalizedError {
        case noInput
        var errorDescription: String? { "No microphone input is available." }
    }
}
