/* Manor sound layer — completion moments only (see docs/DESIGN.md "Sound").
   Synthesized via WebAudio; no assets. Master toggle lives in Settings.
   The voice is tactile, not tonal: filtered noise taps with a low thump,
   like a pen landing on paper, instead of pure sine beeps. */

const STORAGE_KEY = 'manor.sounds.enabled'

let audioContext: AudioContext | null = null
let cachedNoise: AudioBuffer | null = null
let warnedUnavailable = false

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

/** Soft felt-tip tap for checking something off. Quiet by design. */
export function playCompletionTick(): void {
  playTexture(
    [{ startOffset: 0, duration: 0.05, peakGain: 0.085, filterFrequency: 1900, filterQ: 0.9 }],
    [
      {
        startOffset: 0,
        duration: 0.085,
        peakGain: 0.055,
        startFrequency: 195,
        endFrequency: 145,
        type: 'sine'
      }
    ]
  )
}

/** Three soft mallet strikes reserved for perfect-day moments. */
export function playCelebrationChime(): void {
  const strikes = [
    { startOffset: 0, frequency: 523.25 },
    { startOffset: 0.095, frequency: 659.25 },
    { startOffset: 0.19, frequency: 783.99 }
  ]
  playTexture(
    strikes.map(({ startOffset }) => ({
      startOffset,
      duration: 0.03,
      peakGain: 0.028,
      filterFrequency: 2600,
      filterQ: 1.1
    })),
    strikes.flatMap(({ startOffset, frequency }) => [
      {
        startOffset,
        duration: 0.3,
        peakGain: 0.036,
        startFrequency: frequency,
        endFrequency: frequency * 0.995,
        type: 'sine' as OscillatorType
      },
      {
        startOffset,
        duration: 0.07,
        peakGain: 0.012,
        startFrequency: frequency * 4,
        endFrequency: frequency * 4,
        type: 'sine' as OscillatorType
      }
    ])
  )
}
