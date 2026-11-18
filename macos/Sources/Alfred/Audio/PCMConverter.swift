import AVFoundation
import CoreMedia

/// Converts arbitrary PCM buffers to 16 kHz mono signed 16-bit little-endian — the format
/// Deepgram Flux expects (`encoding=linear16&sample_rate=16000`).
/// Not thread-safe: own one per capture source and call it from that source's queue.
final class PCMConverter {
    static let sampleRate: Double = 16_000
    static let outputFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: sampleRate,
                                            channels: 1, interleaved: true)!

    private var converter: AVAudioConverter?
    private var inputFormat: AVAudioFormat?

    /// Returns little-endian Int16 PCM bytes plus a 0…1 loudness estimate.
    func convert(_ buffer: AVAudioPCMBuffer) -> (data: Data, level: Float)? {
        if inputFormat != buffer.format {
            inputFormat = buffer.format
            converter = AVAudioConverter(from: buffer.format, to: Self.outputFormat)
            converter?.sampleRateConverterQuality = AVAudioQuality.medium.rawValue
        }
        guard let converter, buffer.frameLength > 0 else { return nil }

        let ratio = Self.sampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 32
        guard let out = AVAudioPCMBuffer(pcmFormat: Self.outputFormat, frameCapacity: capacity) else { return nil }

        var consumed = false
        var error: NSError?
        converter.convert(to: out, error: &error) { _, status in
            if consumed { status.pointee = .noDataNow; return nil }
            consumed = true
            status.pointee = .haveData
            return buffer
        }
        if let error { Log.audio.error("Convert failed: \(error.localizedDescription, privacy: .public)"); return nil }
        guard out.frameLength > 0, let samples = out.int16ChannelData?[0] else { return nil }

        let count = Int(out.frameLength)
        let data = Data(bytes: samples, count: count * MemoryLayout<Int16>.size)
        return (data, Self.level(samples, count: count))
    }

    /// Wraps a CoreMedia audio sample buffer (ScreenCaptureKit) as an AVAudioPCMBuffer.
    static func pcmBuffer(from sample: CMSampleBuffer) -> AVAudioPCMBuffer? {
        guard let desc = sample.formatDescription,
              var asbd = desc.audioStreamBasicDescription,
              let format = AVAudioFormat(streamDescription: &asbd) else { return nil }
        let frames = AVAudioFrameCount(sample.numSamples)
        guard frames > 0, let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames) else { return nil }
        buffer.frameLength = frames
        let status = CMSampleBufferCopyPCMDataIntoAudioBufferList(sample, at: 0, frameCount: Int32(frames),
                                                                  into: buffer.mutableAudioBufferList)
        return status == noErr ? buffer : nil
    }

    /// RMS mapped onto a perceptual 0…1 scale (≈ -50 dBFS → 0, 0 dBFS → 1).
    static func level(_ samples: UnsafePointer<Int16>, count: Int) -> Float {
        guard count > 0 else { return 0 }
        var sum: Float = 0
        for i in 0..<count {
            let s = Float(samples[i]) / Float(Int16.max)
            sum += s * s
        }
        let rms = sqrt(sum / Float(count))
        let db = 20 * log10(max(rms, 1e-6))
        return max(0, min(1, (db + 50) / 50))
    }
}
