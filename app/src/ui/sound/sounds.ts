/* Every Manor sound runs through one WebAudio context: checkbox completion
   plays the supplied tap recording, placement feedback is synthesized. Both
   respect the master Sounds setting. */

import tapDataUrl from './checkbox-tap.wav?inline'

const STORAGE_KEY = 'manor.sounds.enabled'
const BASE64_MARKER = ';base64,'

let audioContext: AudioContext | null = null
let cachedNoise: AudioBuffer | null = null
let warnedUnavailable = false
let completionTick: AudioBuffer | null = null
/** The context clock against the wall clock at the last playback, to notice a context that stopped advancing. */
let lastClock: { audio: number; wall: number } | null = null

/** The bundler inlines the recording as a base64 data URL, so its bytes come
    straight out of the bundle rather than back over the network. */
function completionTickBytes(): ArrayBuffer {
  const marker = tapDataUrl.indexOf(BASE64_MARKER)
  if (!tapDataUrl.startsWith('data:') || marker === -1) {
    throw new TypeError(
      `The checkbox recording was not inlined as a base64 data URL: "${tapDataUrl.slice(0, 40)}"`
    )
  }
  const binary = window.atob(tapDataUrl.slice(marker + BASE64_MARKER.length))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes.buffer
}

/** Decode the recording and open the context before the first checkbox
    interaction. WebKit holds a new context suspended until a user gesture, so
    the session's first gesture resumes it, so every tick after that gesture is on time. */
export function preloadCompletionSound(): void {
  const context = audioContextOrNull()
  if (context === null) return
  // Reading the bytes inside the chain keeps a broken inline from taking the
  // renderer down at startup; it surfaces as a console error instead.
  void Promise.resolve()
    .then(() => context.decodeAudioData(completionTickBytes()))
    .then((decoded) => {
      completionTick = decoded
    })
    .catch((error: unknown) => {
      console.error('Manor could not decode the checkbox completion sound', { error })
    })
  const resume = (): void => {
    void contextForPlayback()
  }
  window.addEventListener('pointerdown', resume, { capture: true, once: true })
  window.addEventListener('keydown', resume, { capture: true, once: true })
  /* macOS pauses the context while the Mac sleeps or another app takes the
     output, and the pause outlives the wake. Coming back to the window is the
     moment to bring it back, so the next check plays instead of the one after. */
  window.addEventListener('focus', resume)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') resume()
  })
}

export function soundsEnabled(): boolean {
  return window.localStorage.getItem(STORAGE_KEY) !== '0'
}

export function setSoundsEnabled(enabled: boolean): void {
  window.localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0')
}

function audioContextOrNull(): AudioContext | null {
  if (!('AudioContext' in window)) {
    if (!warnedUnavailable) {
      warnedUnavailable = true
      console.warn('Manor sounds are unavailable', { reason: 'WebAudio is not supported in this renderer' })
    }
    return null
  }
  if (audioContext === null) audioContext = new AudioContext()
  return audioContext
}

/** A context that reports `running` but whose clock stopped is dead: WebKit
    leaves it that way after the output device changes (headphones, AirPods,
    a display's speakers). Nothing scheduled on it will ever sound. */
function clockStalled(context: AudioContext): boolean {
  if (context.state !== 'running' || lastClock === null) return false
  const wallElapsed = (performance.now() - lastClock.wall) / 1000
  const audioElapsed = context.currentTime - lastClock.audio
  return wallElapsed > 1.5 && audioElapsed < 0.05
}

function replaceContext(): AudioContext | null {
  const stale = audioContext
  audioContext = null
  cachedNoise = null
  lastClock = null
  if (stale !== null) void stale.close().catch(() => undefined)
  // The decoded recording is not tied to a context; a new one resamples it if its rate differs.
  return audioContextOrNull()
}

/** The context to schedule on, running. Resolves once it is running again if
    the system paused it; `null` when WebAudio is unavailable. A state other
    than `running` includes WebKit's `interrupted`, which the type omits. */
function contextForPlayback(): Promise<AudioContext | null> {
  let context = audioContextOrNull()
  if (context === null) return Promise.resolve(null)
  if (context.state === 'closed' || clockStalled(context)) {
    context = replaceContext()
    if (context === null) return Promise.resolve(null)
  }
  const ready: Promise<unknown> = (context.state as string) === 'running'
    ? Promise.resolve()
    : Promise.race([context.resume(), new Promise((resolve) => window.setTimeout(resolve, 250))])
  const settled = context
  return ready
    .catch(() => undefined)
    .then(() => {
      lastClock = { audio: settled.currentTime, wall: performance.now() }
      return settled
    })
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
  void contextForPlayback().then((context) => {
    if (context === null) return
    const now = context.currentTime
    for (const tap of taps) scheduleTap(context, now, tap)
    for (const thump of thumps) scheduleThump(context, now, thump)
  })
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

/** A soft two-note chime when a timer runs out. A finished focus session rises;
    a finished break settles lower, so the two read apart without looking. */
export function playSessionChime(kind: 'focus' | 'break'): void {
  const notes: readonly [number, number] = kind === 'focus' ? [659.25, 987.77] : [587.33, 440]
  playTexture(
    [],
    [
      { startOffset: 0, duration: 0.55, peakGain: 0.11, startFrequency: notes[0], endFrequency: notes[0], type: 'sine' },
      { startOffset: 0.16, duration: 0.7, peakGain: 0.1, startFrequency: notes[1], endFrequency: notes[1], type: 'sine' },
      { startOffset: 0.16, duration: 0.45, peakGain: 0.02, startFrequency: notes[1] * 2, endFrequency: notes[1] * 2, type: 'sine' }
    ]
  )
}

/** Replay the original tap. The recording is decoded at startup, so the sound
    starts on the click itself rather than after a media element warms up. */
export function playCompletionTick(): void {
  if (!soundsEnabled()) return
  // A tick that beats the startup decode plays nothing rather than waiting on
  // the decoder; a decode that failed already reported itself.
  if (completionTick === null) return
  void contextForPlayback().then((context) => {
    if (context === null || completionTick === null) return
    const source = context.createBufferSource()
    source.buffer = completionTick
    source.connect(context.destination)
    source.start()
  })
}
