import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import type { RealtimeSessionView } from './useRealtimeSession'

vi.mock('./useMicrophoneCapture', () => ({
  useMicrophoneCapture: () => ({
    state: 'listening',
    audioLevelRef: { current: 0.4 },
    muted: false,
    error: null,
    stream: null,
    setMuted: vi.fn()
  })
}))

const sessionView: RealtimeSessionView = {
  phase: 'idle',
  responding: false,
  needsSignIn: false,
  error: null
}

vi.mock('./useRealtimeSession', () => ({
  useRealtimeSession: () => ({ ...sessionView })
}))

import { AlfredExperience, pageMatches } from './AlfredExperience'

function render(): string {
  return renderToStaticMarkup(
    <AlfredExperience active variant="modal" onEnd={vi.fn()} onNavigate={vi.fn()} />
  )
}

describe('AlfredExperience', () => {
  it('renders voice controls and the page search without typed chat', () => {
    const markup = render()
    expect(markup).toContain('Alfred voice session')
    expect(markup).toContain('Voice controls')
    expect(markup).toContain('aria-label="Search Manor pages"')
    expect(markup).toContain('role="listbox"')
    expect(markup).toContain('Mood &amp; Focus')
    expect(markup).toContain('Journal')
    expect(markup).not.toContain('textarea')
    expect(markup).not.toContain('alfred-today')
  })

  it('filters pages by label, case-insensitively, and shows all pages when empty', () => {
    expect(pageMatches('').length).toBe(10)
    expect(pageMatches('jo').map((page) => page.route)).toEqual(['/jobs', '/journal'])
    expect(pageMatches('MOOD').map((page) => page.route)).toEqual(['/mood-focus'])
    expect(pageMatches('zzz')).toEqual([])
  })

  it('shows the local microphone status while no cloud session runs', () => {
    const markup = render()
    expect(markup).toContain('Listening')
    expect(markup).not.toContain('Sign in to talk to Alfred.')
  })

  it('surfaces the session lifecycle in product voice', () => {
    sessionView.phase = 'connecting'
    expect(render()).toContain('Connecting')

    sessionView.phase = 'live'
    sessionView.responding = true
    expect(render()).toContain('Thinking')

    sessionView.responding = false
    expect(render()).toContain('Listening')

    sessionView.phase = 'error'
    sessionView.error = 'The voice session hit an error'
    const markup = render()
    expect(markup).toContain('Alfred is unreachable')
    expect(markup).toContain('The voice session hit an error')

    sessionView.phase = 'idle'
    sessionView.error = null
  })

  it('asks for sign in quietly when signed out', () => {
    sessionView.needsSignIn = true
    expect(render()).toContain('Sign in to talk to Alfred.')
    sessionView.needsSignIn = false
  })
})
