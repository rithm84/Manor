import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

import {
  browserMicrophoneEnvironment,
  MicrophoneCapture
} from './microphone'
import type { MicrophoneCaptureState } from './microphone'

export interface MicrophoneCaptureView {
  state: MicrophoneCaptureState
  audioLevelRef: RefObject<number>
  muted: boolean
  error: string | null
  /** The live microphone stream once capture starts; shared with the voice session. */
  stream: MediaStream | null
  setMuted: (muted: boolean) => void
}

export function useMicrophoneCapture(active: boolean): MicrophoneCaptureView {
  const captureRef = useRef<MicrophoneCapture | null>(null)
  const audioLevelRef = useRef(0)
  const [state, setState] = useState<MicrophoneCaptureState>('idle')
  const [muted, setMutedState] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)

  useEffect(() => {
    if (!active) {
      const capture = captureRef.current
      captureRef.current = null
      setState('idle')
      audioLevelRef.current = 0
      setMutedState(false)
      setError(null)
      setStream(null)
      if (capture !== null) {
        void capture.stop().catch((stopError: unknown) => {
          console.error('Alfred microphone cleanup failed', { error: stopError })
        })
      }
      return
    }

    let cancelled = false
    const capture = new MicrophoneCapture(browserMicrophoneEnvironment(), (level) => {
      audioLevelRef.current = level
    })
    captureRef.current = capture
    setState('requesting')
    setError(null)
    void capture
      .start()
      .then((nextState) => {
        if (cancelled) {
          return capture.stop()
        }
        setState(nextState)
        setStream(capture.streamOf())
      })
      .catch((captureError: unknown) => {
        console.error('Alfred microphone start failed', { error: captureError })
        if (!cancelled) {
          setState('error')
          setError(captureError instanceof Error ? captureError.message : 'Microphone unavailable')
        }
      })

    return (): void => {
      cancelled = true
      if (captureRef.current === capture) captureRef.current = null
      setStream(null)
      void capture.stop().catch((stopError: unknown) => {
        console.error('Alfred microphone cleanup failed', { error: stopError })
      })
    }
  }, [active])

  const setMuted = useCallback((nextMuted: boolean): void => {
    captureRef.current?.setMuted(nextMuted)
    setMutedState(nextMuted)
    setState((current) => {
      if (current !== 'listening' && current !== 'muted') return current
      return nextMuted ? 'muted' : 'listening'
    })
  }, [])

  return { state, audioLevelRef, muted, error, stream, setMuted }
}
