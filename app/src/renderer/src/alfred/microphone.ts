import type { AlfredMicrophonePermission } from '../../../shared/alfred'

export type MicrophoneCaptureState =
  | 'idle'
  | 'requesting'
  | 'listening'
  | 'muted'
  | 'denied'
  | 'error'

export interface MicrophoneEnvironment {
  requestPermission: () => Promise<AlfredMicrophonePermission>
  getStream: () => Promise<MediaStream>
  createAudioContext: () => AudioContext
  requestFrame: (callback: FrameRequestCallback) => number
  cancelFrame: (handle: number) => void
}

export class MicrophoneCaptureError extends Error {
  constructor(message: string, options: ErrorOptions) {
    super(message, options)
    this.name = 'MicrophoneCaptureError'
  }
}

export function rmsLevel(samples: Float32Array): number {
  if (samples.length === 0) return 0
  const energy = samples.reduce((sum, sample) => sum + sample * sample, 0)
  return Math.sqrt(energy / samples.length)
}

export function displayAudioLevel(rms: number): number {
  if (!Number.isFinite(rms) || rms <= 0.01) return 0
  if (rms >= 0.15) return 1
  return Math.min(1, (rms - 0.01) / 0.14)
}

export class MicrophoneCapture {
  readonly #environment: MicrophoneEnvironment
  readonly #onLevel: (level: number) => void
  #stream: MediaStream | null = null
  #context: AudioContext | null = null
  #source: MediaStreamAudioSourceNode | null = null
  #analyser: AnalyserNode | null = null
  #frame = 0
  #muted = false

  constructor(environment: MicrophoneEnvironment, onLevel: (level: number) => void) {
    this.#environment = environment
    this.#onLevel = onLevel
  }

  async start(): Promise<Exclude<MicrophoneCaptureState, 'idle' | 'requesting' | 'error'>> {
    const permission = await this.#environment.requestPermission()
    if (permission === 'denied' || permission === 'restricted') return 'denied'

    try {
      const stream = await this.#environment.getStream()
      const context = this.#environment.createAudioContext()
      const source = context.createMediaStreamSource(stream)
      const analyser = context.createAnalyser()
      analyser.fftSize = 1024
      analyser.smoothingTimeConstant = 0.72
      source.connect(analyser)
      this.#stream = stream
      this.#context = context
      this.#source = source
      this.#analyser = analyser
      this.#readLevel()
      return 'listening'
    } catch (cause) {
      await this.stop()
      throw new MicrophoneCaptureError('Manor could not start microphone capture', { cause })
    }
  }

  setMuted(muted: boolean): void {
    this.#muted = muted
    this.#stream?.getAudioTracks().forEach((track) => {
      track.enabled = !muted
    })
    if (muted) this.#onLevel(0)
  }

  async stop(): Promise<void> {
    if (this.#frame !== 0) this.#environment.cancelFrame(this.#frame)
    this.#frame = 0
    this.#source?.disconnect()
    this.#analyser?.disconnect()
    this.#stream?.getTracks().forEach((track) => track.stop())
    const context = this.#context
    this.#stream = null
    this.#source = null
    this.#analyser = null
    this.#context = null
    this.#onLevel(0)
    if (context !== null && context.state !== 'closed') await context.close()
  }

  #readLevel(): void {
    const analyser = this.#analyser
    if (analyser === null) return
    const samples = new Float32Array(analyser.fftSize)
    const read = (): void => {
      analyser.getFloatTimeDomainData(samples)
      this.#onLevel(this.#muted ? 0 : displayAudioLevel(rmsLevel(samples)))
      this.#frame = this.#environment.requestFrame(read)
    }
    this.#frame = this.#environment.requestFrame(read)
  }
}

export function browserMicrophoneEnvironment(): MicrophoneEnvironment {
  return {
    requestPermission: () => window.manor.alfred.requestMicrophonePermission(),
    getStream: () => navigator.mediaDevices.getUserMedia({
      audio: {
        autoGainControl: true,
        echoCancellation: true,
        noiseSuppression: true
      },
      video: false
    }),
    createAudioContext: () => new AudioContext(),
    requestFrame: (callback) => window.requestAnimationFrame(callback),
    cancelFrame: (handle) => window.cancelAnimationFrame(handle)
  }
}
