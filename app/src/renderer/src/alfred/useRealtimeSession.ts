/* The ephemeral Alfred voice session: mints a server-side client secret, opens
   a WebRTC peer connection to the OpenAI Realtime endpoint with the shared
   microphone stream, dispatches function calls through the tool executor, and
   audits every executed action. Nothing runs between sessions. */

import { useEffect, useRef, useState } from 'react'

import type {
  AlfredCloudApi,
  AlfredSessionPhase
} from '../../../shared/alfredVoice'
import {
  REALTIME_CALLS_URL,
  REALTIME_MODEL,
  SESSION_CAP_MINUTES
} from '../../../shared/alfredVoice'
import { createToolExecutor, rendererToolExecutorDeps } from './toolExecutor'
import type { AlfredToolCall } from './toolExecutor'

export interface RealtimeSessionView {
  phase: AlfredSessionPhase
  /** True while the model is producing a response or running a tool. */
  responding: boolean
  /** True when a cloud session is possible but the user is signed out. */
  needsSignIn: boolean
  error: string | null
}

interface RealtimeServerEvent {
  type: string
  item?: { type?: string; name?: string; call_id?: string; arguments?: string }
  error?: { message?: string }
}

function alfredCloudOf(): AlfredCloudApi | null {
  const manor = window.manor as typeof window.manor & { alfredCloud?: AlfredCloudApi }
  return manor.alfredCloud ?? null
}

function parseServerEvent(data: unknown): RealtimeServerEvent | null {
  if (typeof data !== 'string') return null
  try {
    const event = JSON.parse(data) as unknown
    if (typeof event !== 'object' || event === null) return null
    if (typeof (event as { type?: unknown }).type !== 'string') return null
    return event as RealtimeServerEvent
  } catch {
    return null
  }
}

function toolCallOf(event: RealtimeServerEvent): AlfredToolCall | null {
  const item = event.item
  if (item === undefined || item.type !== 'function_call') return null
  if (typeof item.name !== 'string' || typeof item.call_id !== 'string') return null
  let parsed: unknown = {}
  if (typeof item.arguments === 'string' && item.arguments !== '') {
    try {
      parsed = JSON.parse(item.arguments)
    } catch {
      parsed = {}
    }
  }
  const args =
    typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  return { callId: item.call_id, name: item.name, arguments: args }
}

export function useRealtimeSession(active: boolean, stream: MediaStream | null): RealtimeSessionView {
  const [phase, setPhase] = useState<AlfredSessionPhase>('idle')
  const [responding, setResponding] = useState(false)
  const [needsSignIn, setNeedsSignIn] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cloudRef = useRef<AlfredCloudApi | null>(null)
  if (cloudRef.current === null) cloudRef.current = alfredCloudOf()

  useEffect(() => {
    const cloud = cloudRef.current
    if (!active || stream === null || cloud === null) {
      setPhase('idle')
      setResponding(false)
      setNeedsSignIn(false)
      setError(null)
      return
    }

    let cancelled = false
    let peer: RTCPeerConnection | null = null
    let channel: RTCDataChannel | null = null
    let audio: HTMLAudioElement | null = null
    let capTimer: number | null = null
    let wasLive = false
    const executedSummaries: string[] = []
    const executor = createToolExecutor(rendererToolExecutorDeps(cloud))

    const closeTransport = (): void => {
      if (capTimer !== null) window.clearTimeout(capTimer)
      capTimer = null
      channel?.close()
      channel = null
      peer?.close()
      peer = null
      if (audio !== null) {
        audio.pause()
        audio.srcObject = null
        audio = null
      }
    }

    const sendSessionSummary = (): void => {
      if (!wasLive) return
      wasLive = false
      const summary =
        executedSummaries.length === 0
          ? 'Voice session with no actions taken.'
          : `Voice session actions: ${executedSummaries.join('; ')}.`
      void cloud.sessionSummary(summary).catch((summaryError: unknown) => {
        console.error('Alfred session summary write failed', { error: summaryError })
      })
    }

    const send = (payload: Record<string, unknown>): void => {
      if (channel !== null && channel.readyState === 'open') {
        channel.send(JSON.stringify(payload))
      }
    }

    const runToolCall = async (call: AlfredToolCall): Promise<void> => {
      const result = await executor.execute(call)
      if (result.audit !== null) {
        executedSummaries.push(result.audit.summary)
        void cloud.audit(result.audit).catch((auditError: unknown) => {
          console.error('Alfred audit write failed', { error: auditError, kind: call.name })
        })
      }
      send({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: result.callId,
          output: JSON.stringify(result.output)
        }
      })
      send({ type: 'response.create' })
    }

    const handleEvent = (event: RealtimeServerEvent): void => {
      if (cancelled) return
      switch (event.type) {
        case 'response.created':
          setResponding(true)
          break
        case 'response.done':
          setResponding(false)
          break
        case 'response.output_item.done': {
          const call = toolCallOf(event)
          if (call !== null) {
            setResponding(true)
            void runToolCall(call).catch((toolError: unknown) => {
              console.error('Alfred tool dispatch failed', { error: toolError, tool: call.name })
            })
          }
          break
        }
        case 'error':
          setPhase('error')
          setError(event.error?.message ?? 'The voice session hit an error')
          break
        default:
          break
      }
    }

    setError(null)
    void (async (): Promise<void> => {
      const account = await window.manor.account.current()
      if (cancelled) return
      if (account === null) {
        setNeedsSignIn(true)
        setPhase('idle')
        return
      }
      setNeedsSignIn(false)
      setPhase('connecting')

      const session = await cloud.mintSession()
      if (cancelled) return

      const track = stream.getAudioTracks()[0]
      if (track === undefined) {
        throw new Error('The microphone stream has no audio track')
      }

      peer = new RTCPeerConnection()
      audio = document.createElement('audio')
      audio.autoplay = true
      peer.ontrack = (trackEvent): void => {
        if (audio !== null) audio.srcObject = trackEvent.streams[0] ?? null
      }
      peer.addTrack(track, stream)

      channel = peer.createDataChannel('oai-events')
      channel.onopen = (): void => {
        if (cancelled) return
        wasLive = true
        setPhase('live')
      }
      channel.onmessage = (message: MessageEvent): void => {
        const event = parseServerEvent(message.data)
        if (event !== null) handleEvent(event)
      }

      const offer = await peer.createOffer()
      await peer.setLocalDescription(offer)
      const response = await fetch(`${REALTIME_CALLS_URL}?model=${REALTIME_MODEL}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${session.clientSecret}`,
          'content-type': 'application/sdp'
        },
        body: offer.sdp
      })
      if (!response.ok) {
        throw new Error(`Realtime handshake failed: ${response.status} ${await response.text()}`)
      }
      const answer = await response.text()
      if (cancelled) return
      await peer.setRemoteDescription({ type: 'answer', sdp: answer })

      capTimer = window.setTimeout(() => {
        sendSessionSummary()
        closeTransport()
        if (!cancelled) {
          setPhase('idle')
          setResponding(false)
        }
      }, SESSION_CAP_MINUTES * 60 * 1000)
    })().catch((sessionError: unknown) => {
      closeTransport()
      if (cancelled) return
      console.error('Alfred voice session failed', { error: sessionError })
      setPhase('error')
      setError(sessionError instanceof Error ? sessionError.message : 'Alfred is unreachable')
    })

    return (): void => {
      cancelled = true
      sendSessionSummary()
      closeTransport()
    }
  }, [active, stream])

  return { phase, responding, needsSignIn, error }
}
