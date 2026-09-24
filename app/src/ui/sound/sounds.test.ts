// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** A stand-in context: the clock only advances when the test says so. */
class FakeAudioContext {
  static created: FakeAudioContext[] = []
  state = 'suspended'
  currentTime = 0
  resumed = 0
  closed = false
  started: number[] = []
  readonly destination = {}
  readonly sampleRate = 48000
  constructor() { FakeAudioContext.created.push(this) }
  resume(): Promise<void> { this.resumed += 1; this.state = 'running'; return Promise.resolve() }
  close(): Promise<void> { this.closed = true; this.state = 'closed'; return Promise.resolve() }
  decodeAudioData(): Promise<object> { return Promise.resolve({ duration: 0.1 }) }
  createBuffer(): object { return { getChannelData: () => new Float32Array(16), sampleRate: this.sampleRate } }
  createBufferSource(): object {
    const self = this
    return { buffer: null, connect: () => undefined, start: () => { self.started.push(self.currentTime) }, stop: () => undefined }
  }
  createBiquadFilter(): object { return { type: '', frequency: { setValueAtTime: () => undefined }, Q: { setValueAtTime: () => undefined }, connect: () => undefined } }
  createOscillator(): object {
    const self = this
    return { type: '', frequency: { setValueAtTime: () => undefined, exponentialRampToValueAtTime: () => undefined }, connect: () => undefined, start: () => { self.started.push(self.currentTime) }, stop: () => undefined }
  }
  createGain(): object { return { gain: { setValueAtTime: () => undefined, linearRampToValueAtTime: () => undefined, exponentialRampToValueAtTime: () => undefined }, connect: () => undefined } }
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('sound playback recovery', () => {
  let now = 0
  beforeEach(() => {
    vi.resetModules()
    FakeAudioContext.created = []
    now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    Object.defineProperty(window, 'AudioContext', { value: FakeAudioContext, configurable: true, writable: true })
    window.localStorage.clear()
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('resumes a paused context before scheduling, so a check after sleep still sounds', async () => {
    const { playClick } = await import('./sounds')
    playClick()
    await flush()
    const [context] = FakeAudioContext.created
    expect(context?.resumed).toBe(1)
    expect(context?.started.length).toBeGreaterThan(0)

    context!.state = 'interrupted'
    context!.currentTime = 5
    now = 5000
    playClick()
    await flush()
    expect(context?.resumed).toBe(2)
    expect(context?.state).toBe('running')
    expect(FakeAudioContext.created).toHaveLength(1)
  })

  it('replaces a running context whose clock stopped, which is how a device change leaves it', async () => {
    const { playClick } = await import('./sounds')
    playClick()
    await flush()
    const [first] = FakeAudioContext.created
    first!.currentTime = 2
    now = 2000
    playClick()
    await flush()
    expect(FakeAudioContext.created).toHaveLength(1)

    now = 6000 // four seconds pass on the wall clock while currentTime stays at 2
    playClick()
    await flush()
    expect(FakeAudioContext.created).toHaveLength(2)
    expect(first?.closed).toBe(true)
    expect(FakeAudioContext.created[1]?.started.length).toBeGreaterThan(0)
  })

  it('stays quiet when sounds are turned off', async () => {
    const { playClick, setSoundsEnabled } = await import('./sounds')
    setSoundsEnabled(false)
    playClick()
    await flush()
    expect(FakeAudioContext.created).toHaveLength(0)
  })
})
