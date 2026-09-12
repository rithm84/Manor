/* Checkbox completion uses the supplied tap recording. Placement feedback
   uses WebAudio. Both respect the master Sounds setting. */

const STORAGE_KEY = 'manor.sounds.enabled'

let audioContext: AudioContext | null = null
let cachedNoise: AudioBuffer | null = null
let warnedUnavailable = false
let completionAudio: HTMLAudioElement | null = null

function completionPlayer(): HTMLAudioElement {
  if (completionAudio === null) {
    completionAudio = new Audio(new URL('./checkbox-tap.wav', import.meta.url).href)
    completionAudio.preload = 'auto'
    completionAudio.load()
  }
  return completionAudio
}

/** Decode the short recording before the first checkbox interaction. */
export function preloadCompletionSound(): void {
  completionPlayer()
}

export function soundsEnabled(): boolean {
  return window.localStorage.getItem(STORAGE_KEY) !== '0'
}

export function setSoundsEnabled(enabled: boolean): void {
  window.localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0')
}

function contextForPlayback(): AudioContext | null {
  if (!('AudioContext' in window)) {
    if (!warnedUnavailable) {
      warnedUnavailable = true
      console.warn('Manor sounds are unavailable', { reason: 'WebAudio is not supported in this renderer' })
    }
    return null
  }
  if (audioContext === null) audioContext = new AudioContext()
  if (audioContext.state === 'suspended') void audioContext.resume()
  return audioContext
}

function noiseBuffer(context: AudioContext): AudioBuffer {
  if (cachedNoise === null || cachedNoise.sampleRate !== context.sampleRate) {
    const length = Math.floor(context.sampleRate * 0.12)
    const buffer = context.createBuffer(1, length, context.sampleRate)
    const data = buffer.getChannelData(0)
    for (let index = 0; index < length; index += 1) data[index] = Math.random() * 2 - 1
    cachedNoise = buffer
  }
  return cachedNoise
}

/** A band-passed noise burst: the papery "tap" body of every Manor sound. */
interface TapStep {
  startOffset: number
  duration: number
  peakGain: number
  filterFrequency: number
  filterQ: number
}

/** A pitched thump or strike with a fast exponential decay. */
interface ThumpStep {
  startOffset: number
  duration: number
  peakGain: number
  startFrequency: number
  endFrequency: number
  type: OscillatorType
}

function scheduleTap(context: AudioContext, now: number, step: TapStep): void {
  const source = context.createBufferSource()
  source.buffer = noiseBuffer(context)
  const filter = context.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.setValueAtTime(step.filterFrequency, now + step.startOffset)
  filter.Q.setValueAtTime(step.filterQ, now + step.startOffset)
  const gain = context.createGain()
  gain.gain.setValueAtTime(0, now + step.startOffset)
  gain.gain.linearRampToValueAtTime(step.peakGain, now + step.startOffset + 0.004)
  gain.gain.exponentialRampToValueAtTime(0.0004, now + step.startOffset + step.duration)
  source.connect(filter)
  filter.connect(gain)
  gain.connect(context.destination)
  source.start(now + step.startOffset)
  source.stop(now + step.startOffset + step.duration + 0.02)
}

function scheduleThump(context: AudioContext, now: number, step: ThumpStep): void {
  const oscillator = context.createOscillator()
  oscillator.type = step.type
  oscillator.frequency.setValueAtTime(step.startFrequency, now + step.startOffset)
  oscillator.frequency.exponentialRampToValueAtTime(
    step.endFrequency,
    now + step.startOffset + step.duration
  )
  const gain = context.createGain()
  gain.gain.setValueAtTime(0, now + step.startOffset)
  gain.gain.linearRampToValueAtTime(step.peakGain, now + step.startOffset + 0.006)
  gain.gain.exponentialRampToValueAtTime(0.0004, now + step.startOffset + step.duration)
  oscillator.connect(gain)
  gain.connect(context.destination)
  oscillator.start(now + step.startOffset)
  oscillator.stop(now + step.startOffset + step.duration + 0.02)
}

function playTexture(taps: readonly TapStep[], thumps: readonly ThumpStep[]): void {
  if (!soundsEnabled()) return
  const context = contextForPlayback()
  if (context === null) return
  const now = context.currentTime
  for (const tap of taps) scheduleTap(context, now, tap)
  for (const thump of thumps) scheduleThump(context, now, thump)
}

/** Dry mechanical click for snappy placements: kanban drops, habit checks.
    Two noise stages read as a switch's down-and-up. */
export function playClick(): void {
  playTexture(
    [
      { startOffset: 0, duration: 0.018, peakGain: 0.1, filterFrequency: 3400, filterQ: 1.6 },
      { startOffset: 0.014, duration: 0.028, peakGain: 0.05, filterFrequency: 1600, filterQ: 1.2 }
    ],
    [
      {
        startOffset: 0,
        duration: 0.04,
        peakGain: 0.028,
        startFrequency: 320,
        endFrequency: 240,
        type: 'sine'
      }
    ]
  )
}

/** Replay the original tap without delaying the completion save. */
export function playCompletionTick(): void {
  if (!soundsEnabled()) return
  const player = completionPlayer()
  player.pause()
  player.currentTime = 0
  void player.play().catch((cause: Error) => {
    throw new Error('Could not play the checkbox completion sound.', { cause })
  })
}
