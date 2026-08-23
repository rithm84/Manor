import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { MoodFocusState } from '../../../../shared/moodFocus'
import { HistoryPanel } from './HistoryPanel'

const STATE: MoodFocusState = {
  today: '2026-08-20',
  entries: [
    {
      date: '2026-08-20',
      mood: 'Great',
      focus: 'Locked In',
      note: 'Protected the morning for one task.',
      noteSource: 'alfred',
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
  it('shows Alfred provenance and preserves legacy manual provenance', () => {
    const markup = renderToStaticMarkup(
      <HistoryPanel
        state={STATE}
        month="2026-08"
        onMonthChange={() => undefined}
        onEditDate={() => undefined}
      />
    )

    expect(markup).toContain('Alfred debrief')
    expect(markup).toContain('Protected the morning for one task.')
    expect(markup).toContain('Manual')
    expect(markup).toContain('Legacy note.')
    expect(markup).not.toContain('<textarea')
  })
})
