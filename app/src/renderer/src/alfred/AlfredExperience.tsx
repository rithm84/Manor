import {
  Activity,
  Bookmark,
  Briefcase,
  Camera,
  Code2,
  CornerDownLeft,
  FileText,
  Flame,
  House,
  Lock,
  Mic,
  MicOff,
  Settings,
  Smile,
  X
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'

import type { AlfredRoute } from '../../../shared/alfred'
import { ThinkingOrb } from '../components/orb/ThinkingOrb'
import type { OrbState } from '../components/orb/ThinkingOrb'
import { Kbd } from '../components/ui'
import { useMicrophoneCapture } from './useMicrophoneCapture'
import { useRealtimeSession } from './useRealtimeSession'
import './alfred.css'

export interface AlfredExperienceProps {
  active: boolean
  variant: 'modal' | 'panel'
  onEnd: () => void
  onNavigate: (route: AlfredRoute) => void
}

const STATUS_LABEL = {
  idle: 'Session closed',
  requesting: 'Requesting microphone',
  listening: 'Listening',
  muted: 'Microphone muted',
  denied: 'Microphone access denied',
  error: 'Microphone unavailable'
} as const

interface PageEntry {
  route: AlfredRoute
  label: string
  icon: ReactNode
}

const PAGES: readonly PageEntry[] = [
  { route: '/home', label: 'Home', icon: <House size={15} /> },
  { route: '/habits', label: 'Habits', icon: <Flame size={15} /> },
  { route: '/mood-focus', label: 'Mood & Focus', icon: <Smile size={15} /> },
  { route: '/leetcode', label: 'LeetCode', icon: <Code2 size={15} /> },
  { route: '/jobs', label: 'Jobs', icon: <Briefcase size={15} /> },
  { route: '/notes', label: 'Notes', icon: <FileText size={15} /> },
  { route: '/bookmarks', label: 'Bookmarks', icon: <Bookmark size={15} /> },
  { route: '/journal', label: 'Journal', icon: <Lock size={15} /> },
  { route: '/alfred-activity', label: 'Alfred activity', icon: <Activity size={15} /> },
  { route: '/settings', label: 'Settings', icon: <Settings size={15} /> }
]

export function pageMatches(query: string): readonly PageEntry[] {
  const normalized = query.trim().toLocaleLowerCase()
  if (normalized === '') return PAGES
  return PAGES.filter((page) => page.label.toLocaleLowerCase().includes(normalized))
}

export function AlfredExperience({
  active,
  variant,
  onEnd,
  onNavigate
}: AlfredExperienceProps): ReactNode {
  const microphone = useMicrophoneCapture(active)
  const session = useRealtimeSession(active, microphone.stream)
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const listRef = useRef<HTMLDivElement | null>(null)
  const [captureState, setCaptureState] = useState<
    { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'failed'; message: string }
  >({ kind: 'idle' })
  const captureResetTimer = useRef<number | null>(null)

  useEffect(
    () => (): void => {
      if (captureResetTimer.current !== null) window.clearTimeout(captureResetTimer.current)
    },
    []
  )

  const captureScreen = async (): Promise<void> => {
    if (captureState.kind === 'saving') return
    setCaptureState({ kind: 'saving' })
    try {
      await window.manor.capture.captureToKnowledgeBase()
      setCaptureState({ kind: 'saved' })
    } catch (error) {
      setCaptureState({
        kind: 'failed',
        message: error instanceof Error ? error.message : 'The capture did not save'
      })
    }
    if (captureResetTimer.current !== null) window.clearTimeout(captureResetTimer.current)
    captureResetTimer.current = window.setTimeout(() => setCaptureState({ kind: 'idle' }), 5000)
  }

  useEffect(() => {
    if (!active) {
      setQuery('')
      setSelectedIndex(0)
    }
  }, [active])

  const matches = pageMatches(query)
  const highlightIndex = Math.min(selectedIndex, Math.max(0, matches.length - 1))

  useEffect(() => {
    if (matches.length === 0) return
    listRef.current
      ?.querySelector(`#alfred-search-option-${variant}-${highlightIndex}`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [highlightIndex, matches.length, variant])

  const orbState: OrbState =
    session.responding || session.phase === 'connecting' || microphone.state === 'requesting'
      ? 'thinking'
      : microphone.state === 'listening'
        ? 'listening'
        : 'idle'

  const sessionStatus: { key: string; label: string } | null =
    session.phase === 'connecting'
      ? { key: 'requesting', label: 'Connecting' }
      : session.phase === 'error'
        ? { key: 'error', label: 'Alfred is unreachable' }
        : session.phase === 'live'
          ? session.responding
            ? { key: 'listening', label: 'Thinking' }
            : microphone.muted
              ? { key: 'muted', label: 'Microphone muted' }
              : { key: 'listening', label: 'Listening' }
          : null

  const statusKey = sessionStatus?.key ?? microphone.state
  const statusLabel = sessionStatus?.label ?? STATUS_LABEL[microphone.state]

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (matches.length === 0) return
      const step = event.key === 'ArrowDown' ? 1 : -1
      setSelectedIndex((highlightIndex + step + matches.length) % matches.length)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const target = matches[highlightIndex]
      if (target !== undefined) onNavigate(target.route)
    }
  }

  return (
    <section
      className={`alfred-surface alfred-surface--${variant}`}
      aria-label="Alfred voice session"
      data-testid={`alfred-${variant}`}
    >
      <header className="alfred-header">
        <div>
          <h1>Alfred</h1>
          <span className="alfred-shortcut"><Kbd keys={['⌥', 'M']} /></span>
        </div>
        <button type="button" className="alfred-icon-button" onClick={onEnd} aria-label="End Alfred session">
          <X size={17} />
        </button>
      </header>

      <div className="alfred-presence">
        <ThinkingOrb
          size={variant === 'panel' ? 132 : 116}
          state={orbState}
          audioLevelRef={microphone.audioLevelRef}
        />
        <p className={`alfred-session-state is-${statusKey}`} aria-live="polite">
          <span className="alfred-state-dot" aria-hidden="true" />
          {statusLabel}
        </p>
        {microphone.state === 'denied' ? (
          <p className="alfred-permission-note">Allow microphone access in System Settings, then summon Alfred again.</p>
        ) : null}
        {microphone.state === 'error' && microphone.error !== null ? (
          <p className="alfred-permission-note" role="alert">{microphone.error}</p>
        ) : null}
        {session.needsSignIn ? (
          <p className="alfred-permission-note">Sign in to talk to Alfred.</p>
        ) : null}
        {session.phase === 'error' && session.error !== null ? (
          <p className="alfred-permission-note" role="alert">{session.error}</p>
        ) : null}
      </div>

      <div className="alfred-controls" aria-label="Voice controls">
        <button
          type="button"
          className={`alfred-mic-button${microphone.muted ? ' is-muted' : ''}`}
          onClick={() => microphone.setMuted(!microphone.muted)}
          disabled={microphone.state !== 'listening' && microphone.state !== 'muted'}
          aria-pressed={microphone.muted}
        >
          {microphone.muted ? <MicOff size={17} /> : <Mic size={17} />}
          {microphone.muted ? 'Unmute' : 'Mute'}
        </button>
        <button
          type="button"
          className="alfred-mic-button"
          onClick={() => void captureScreen()}
          disabled={captureState.kind === 'saving'}
        >
          <Camera size={17} />
          {captureState.kind === 'saving' ? 'Capturing' : 'Capture screen'}
        </button>
        <button type="button" className="alfred-end-button" onClick={onEnd}>
          End session
        </button>
      </div>
      {captureState.kind === 'saved' ? (
        <p className="alfred-capture-note" role="status">Saved to your knowledge base.</p>
      ) : null}
      {captureState.kind === 'failed' ? (
        <p className="alfred-capture-note is-error" role="alert">{captureState.message}</p>
      ) : null}

      <div className="alfred-search">
        <input
          className="alfred-search-input"
          type="text"
          autoFocus
          value={query}
          placeholder="Search Manor"
          aria-label="Search Manor pages"
          role="combobox"
          aria-expanded="true"
          aria-controls={`alfred-search-list-${variant}`}
          aria-activedescendant={
            matches.length === 0 ? undefined : `alfred-search-option-${variant}-${highlightIndex}`
          }
          onChange={(event) => {
            setQuery(event.target.value)
            setSelectedIndex(0)
          }}
          onKeyDown={onSearchKeyDown}
        />
        <div
          ref={listRef}
          className="alfred-search-list"
          id={`alfred-search-list-${variant}`}
          role="listbox"
          aria-label="Pages"
        >
          {matches.map((page, index) => (
            <button
              key={page.route}
              type="button"
              id={`alfred-search-option-${variant}-${index}`}
              className={`alfred-search-row${index === highlightIndex ? ' is-selected' : ''}`}
              role="option"
              aria-selected={index === highlightIndex}
              tabIndex={-1}
              onClick={() => onNavigate(page.route)}
              onPointerEnter={() => setSelectedIndex(index)}
            >
              <span className="alfred-search-icon" aria-hidden="true">{page.icon}</span>
              <span className="alfred-search-label">{page.label}</span>
              {index === highlightIndex ? (
                <CornerDownLeft className="alfred-search-enter" size={13} aria-hidden="true" />
              ) : null}
            </button>
          ))}
          {matches.length === 0 ? (
            <p className="alfred-search-empty">Nothing matches. Alfred still hears you.</p>
          ) : null}
        </div>
      </div>
    </section>
  )
}
