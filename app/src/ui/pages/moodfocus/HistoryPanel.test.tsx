// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { MoodFocusState } from '../../../shared/moodFocus'
import { HistoryPanel } from './HistoryPanel'

const STATE: MoodFocusState = {
  today: '2026-08-20',
  entries: [
    {
      date: '2026-08-20',
      mood: 'Great',
      focus: 'Locked In',
      note: 'Protected the morning for one task.',
      noteSource: 'codex',
      createdAt: '2026-08-20T21:00:00.000Z',
      updatedAt: '2026-08-20T21:00:00.000Z'
    },
    {
      date: '2026-08-18',
      mood: 'Bad',
      focus: 'Low',
      note: 'Legacy note.',
      noteSource: 'manual',
      createdAt: '2026-08-18T21:00:00.000Z',
      updatedAt: '2026-08-18T21:00:00.000Z'
    }
  ]
}

describe('HistoryPanel', () => {
  it('shows Codex provenance and preserves legacy manual provenance', () => {
    const markup = renderToStaticMarkup(
      <HistoryPanel
        state={STATE}
        month="2026-08"
        onMonthChange={() => undefined}
        onSaveRatings={async () => undefined}
      />
    )

    expect(markup).toContain('Codex debrief')
    expect(markup).toContain('Protected the morning for one task.')
    expect(markup).toContain('Manual')
    expect(markup).toContain('Legacy note.')
    expect(markup).not.toContain('<textarea')
    expect(markup).toContain('history-add-day')
    expect(markup.match(/Edit entry\./g)).toHaveLength(2)
  })

  it('keeps the open draft and original baseline when refreshed data changes', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const saved: unknown[] = []
    const render = (state: MoodFocusState): void => root.render(<HistoryPanel state={state} month="2026-08" onMonthChange={() => undefined} onSaveRatings={async (mutation) => { saved.push(mutation) }} />)
    await act(async () => render(STATE))
    await act(async () => document.querySelector<HTMLButtonElement>('[data-testid="history-record-2026-08-18"]')?.click())
    await act(async () => document.querySelector<HTMLButtonElement>('[data-testid="history-mood-great"]')?.click())
    const refreshed: MoodFocusState = { ...STATE, entries: STATE.entries.map((entry) => entry.date === '2026-08-18' ? { ...entry, mood: 'Awful', updatedAt: '2026-08-20T22:00:00.000Z' } : entry) }
    await act(async () => render(refreshed))
    expect(document.querySelector('[data-testid="history-mood-great"]')?.getAttribute('aria-checked')).toBe('true')
    await act(async () => document.querySelector<HTMLButtonElement>('[data-testid="history-save-ratings"]')?.click())
    expect(saved).toEqual([{ date: '2026-08-18', mood: 'Great', focus: 'Low', expectedUpdatedAt: '2026-08-18T21:00:00.000Z' }])
    await act(async () => root.unmount())
    host.remove()
  })
})
