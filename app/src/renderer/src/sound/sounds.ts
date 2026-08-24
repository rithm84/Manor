/* Manor sound layer — completion moments only (see docs/DESIGN.md "Sound").
   Synthesized via WebAudio; no assets. Master toggle lives in Settings. */

const STORAGE_KEY = 'manor.sounds.enabled'

let audioContext: AudioContext | null = null
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

interface ToneStep {
  frequency: number
  startOffset: number
  duration: number
  peakGain: number
}

function playTones(steps: readonly ToneStep[]): void {
  if (!soundsEnabled()) return
  const context = contextForPlayback()
  if (context === null) return
  const now = context.currentTime
  for (const step of steps) {
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(step.frequency, now + step.startOffset)
    gain.gain.setValueAtTime(0, now + step.startOffset)
    gain.gain.linearRampToValueAtTime(step.peakGain, now + step.startOffset + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0004, now + step.startOffset + step.duration)
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.start(now + step.startOffset)
    oscillator.stop(now + step.startOffset + step.duration + 0.02)
  }
}

/** Soft two-partial tick for checking something off. Quiet by design. */
export function playCompletionTick(): void {
  playTones([
    { frequency: 660, startOffset: 0, duration: 0.09, peakGain: 0.045 },
    { frequency: 990, startOffset: 0.045, duration: 0.11, peakGain: 0.03 }
  ])
}

/** Short warm triad reserved for perfect-day moments. */
export function playCelebrationChime(): void {
  playTones([
    { frequency: 523.25, startOffset: 0, duration: 0.28, peakGain: 0.04 },
    { frequency: 659.25, startOffset: 0.09, duration: 0.3, peakGain: 0.035 },
    { frequency: 783.99, startOffset: 0.18, duration: 0.36, peakGain: 0.03 }
  ])
}
