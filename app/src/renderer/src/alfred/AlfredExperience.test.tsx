import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('./useMicrophoneCapture', () => ({
  useMicrophoneCapture: () => ({
    state: 'listening',
    audioLevelRef: { current: 0.4 },
    muted: false,
    error: null,
    setMuted: vi.fn()
  })
}))

vi.mock('./useCompletionGlance', () => ({
  useCompletionGlance: () => ({
    loading: false,
    error: null,
    glance: {
      date: '2026-08-20',
      done: 3,
      total: 5,
      items: [{ key: 'habits', label: 'Habits', route: '/habits', done: 3, total: 5 }]
    }
  })
}))

import { AlfredExperience } from './AlfredExperience'

describe('AlfredExperience', () => {
  it('renders voice controls and the locked completion glance without typed chat', () => {
    const markup = renderToStaticMarkup(
      <AlfredExperience active variant="modal" onEnd={vi.fn()} onNavigate={vi.fn()} />
    )
    expect(markup).toContain('Alfred voice session')
    expect(markup).toContain('Voice controls')
    expect(markup).toContain('Today')
    expect(markup).not.toContain('textarea')
    expect(markup).not.toContain('input')
  })
})
