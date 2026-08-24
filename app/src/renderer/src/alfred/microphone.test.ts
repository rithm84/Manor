import { describe, expect, it, vi } from 'vitest'

import { displayAudioLevel, MicrophoneCapture, rmsLevel } from './microphone'
import type { MicrophoneEnvironment } from './microphone'

describe('Alfred microphone capture', () => {
  it('normalizes quiet and strong samples into the orb range', () => {
    expect(rmsLevel(new Float32Array([0.1, -0.1]))).toBeCloseTo(0.1)
    expect(displayAudioLevel(0.005)).toBe(0)
    expect(displayAudioLevel(0.15)).toBe(1)
  })

  it('stops every media track and closes audio resources', async () => {
    const stop = vi.fn()
    const close = vi.fn(async () => undefined)
    const disconnect = vi.fn()
    const track = { enabled: true, stop } as unknown as MediaStreamTrack
    const stream = {
      getTracks: () => [track],
      getAudioTracks: () => [track]
    } as unknown as MediaStream
    const analyser = {
      fftSize: 1024,
      smoothingTimeConstant: 0,
      disconnect,
      getFloatTimeDomainData: vi.fn()
    } as unknown as AnalyserNode
    const source = { connect: vi.fn(), disconnect } as unknown as MediaStreamAudioSourceNode
    const context = {
      state: 'running',
      createMediaStreamSource: () => source,
      createAnalyser: () => analyser,
      close
    } as unknown as AudioContext
    const environment: MicrophoneEnvironment = {
      requestPermission: async () => 'granted',
      getStream: async () => stream,
      createAudioContext: () => context,
      requestFrame: () => 4,
      cancelFrame: vi.fn()
    }
    const capture = new MicrophoneCapture(environment, vi.fn())

    await expect(capture.start()).resolves.toBe('listening')
    capture.setMuted(true)
    expect(track.enabled).toBe(false)
    await capture.stop()
    expect(stop).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
  })

  it('does not ask the browser for audio after permission is denied', async () => {
    const getStream = vi.fn()
    const environment: MicrophoneEnvironment = {
      requestPermission: async () => 'denied',
      getStream,
      createAudioContext: () => new AudioContext(),
      requestFrame: () => 0,
      cancelFrame: vi.fn()
    }
    const capture = new MicrophoneCapture(environment, vi.fn())

    await expect(capture.start()).resolves.toBe('denied')
    expect(getStream).not.toHaveBeenCalled()
  })
})
