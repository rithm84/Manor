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
  it('marks noted days with their provenance and keeps the note text for the day dialog', async () => {
    const markup = renderToStaticMarkup(
      <HistoryPanel
        state={STATE}
        month="2026-08"
        onMonthChange={() => undefined}
        onSaveRatings={async () => undefined}
      />
    )

    expect(markup).toContain('Thursday, August 20, 2026. Mood Great. Focus Locked In. Codex debrief.')
    expect(markup).toContain('Tuesday, August 18, 2026. Mood Bad. Focus Low. Manual note.')
    expect(markup).not.toContain('Protected the morning for one task.')
    expect(markup).not.toContain('<textarea')
    expect(markup).toContain('history-add-day')
    expect(markup).not.toContain('Daily record')

    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    await act(async () => root.render(<HistoryPanel state={STATE} month="2026-08" onMonthChange={() => undefined} onSaveRatings={async () => undefined} />))
    await act(async () => document.querySelector<HTMLButtonElement>('[data-testid="history-day-2026-08-20"]')?.click())
    expect(document.body.textContent).toContain('Protected the morning for one task.')
    expect(document.body.textContent).toContain('Codex debrief')
    expect(document.querySelector('[data-testid="history-save-ratings"]')?.textContent).toBe('Save changes')
    await act(async () => root.unmount())
    host.remove()
  })

  it('summarizes the month in scale words and lays out every day of the month', () => {
    const markup = renderToStaticMarkup(
      <HistoryPanel
        state={STATE}
        month="2026-08"
        onMonthChange={() => undefined}
        onSaveRatings={async () => undefined}
      />
    )

    expect(markup).toContain('Good</span><span class="mf-history-summarylabel">Average mood<span class="tnum">3.5</span>')
    expect(markup).toContain('High</span><span class="mf-history-summarylabel">Average focus<span class="tnum">3.5</span>')
    expect(markup.match(/data-testid="history-day-2026-08-\d\d"/g)).toHaveLength(31)
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*data-testid="history-day-2026-08-21"/)
    expect(markup).not.toMatch(/<button[^>]*disabled=""[^>]*data-testid="history-day-2026-08-20"/)
    expect(markup).toContain('Wednesday, August 19, 2026. No check-in.')
    expect(markup).toContain('<span class="mf-day-axis">Mood</span><span class="mf-day-level">Great</span>')
    expect(markup).toContain('<span class="mf-day-axis">Focus</span><span class="mf-day-level">Locked In</span>')
  })

  it('opens an empty past day from the month grid as a new record', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const saved: unknown[] = []
    await act(async () => root.render(<HistoryPanel state={STATE} month="2026-08" onMonthChange={() => undefined} onSaveRatings={async (mutation) => { saved.push(mutation) }} />))
    await act(async () => document.querySelector<HTMLButtonElement>('[data-testid="history-day-2026-08-19"]')?.click())
    expect(document.querySelector('[data-testid="history-save-ratings"]')?.textContent).toBe('Add record')
    await act(async () => document.querySelector<HTMLButtonElement>('[data-testid="history-focus-resting"]')?.click())
    await act(async () => document.querySelector<HTMLButtonElement>('[data-testid="history-save-ratings"]')?.click())
    expect(saved).toEqual([{ date: '2026-08-19', mood: null, focus: 'Resting', expectedUpdatedAt: null }])
    await act(async () => root.unmount())
    host.remove()
  })

  it('keeps the open draft and original baseline when refreshed data changes', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const saved: unknown[] = []
    const render = (state: MoodFocusState): void => root.render(<HistoryPanel state={state} month="2026-08" onMonthChange={() => undefined} onSaveRatings={async (mutation) => { saved.push(mutation) }} />)
    await act(async () => render(STATE))
    await act(async () => document.querySelector<HTMLButtonElement>('[data-testid="history-day-2026-08-18"]')?.click())
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
