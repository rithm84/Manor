import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { HabitRow } from './HabitRow'
import type { HabitViewModel } from './habitModel'

const GOLD_HABIT: HabitViewModel = {
  definition: {
    id: 'read',
    name: 'Read',
    kind: 'binary',
    targetLabel: null,
    createdOn: '2026-08-01',
    createdAt: '2026-08-01T08:00:00.000Z'
  },
  status: 'active',
  selectedStatus: 'active',
  entry: null,
  metrics: {
    currentStreak: 9,
    bestStreak: 9,
    freezeFreeDays: 9,
    gold: true,
    completedDays: 9,
    trackedDays: 9,
    completionRate: 100,
    earnBackUsedThisMonth: false,
    earnBackProgress: 0
  },
  week: [
    { date: '2026-08-17', letter: 'Mo', mark: 'complete', selected: false },
    { date: '2026-08-18', letter: 'Tu', mark: 'complete', selected: false },
    { date: '2026-08-19', letter: 'We', mark: 'complete', selected: false },
    { date: '2026-08-20', letter: 'Th', mark: 'pending', selected: true },
    { date: '2026-08-21', letter: 'Fr', mark: 'future', selected: false },
    { date: '2026-08-22', letter: 'Sa', mark: 'future', selected: false },
    { date: '2026-08-23', letter: 'Su', mark: 'future', selected: false }
  ],
  selectedDateMark: 'pending',
  canDelete: false
}

describe('daily habit row status styling', () => {
  it('localizes gold to the completion control and risk to week progress', () => {
    const markup = renderToStaticMarkup(
      <HabitRow
        habit={GOLD_HABIT}
        isToday
        onLog={() => undefined}
        onOpen={() => undefined}
        onResume={() => undefined}
      />
    )

    expect(markup).toContain('class="habit-row"')
    expect(markup).toContain('class="habit-row-completion is-gold"')
    expect(markup).toContain('class="habit-week-progress is-atrisk"')
    expect(markup).not.toContain('habit-row is-gold')
    expect(markup).not.toContain('habit-row is-atrisk')
  })
})
