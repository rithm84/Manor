import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { HabitWeekDay } from './habitModel'
import { WeekStrip, weekProgressLabel } from './WeekStrip'

const WEEK: readonly HabitWeekDay[] = [
  { date: '2026-08-17', letter: 'Mo', mark: 'complete', selected: false },
  { date: '2026-08-18', letter: 'Tu', mark: 'complete', selected: false },
  { date: '2026-08-19', letter: 'We', mark: 'frozen', selected: false },
  { date: '2026-08-20', letter: 'Th', mark: 'pending', selected: true },
  { date: '2026-08-21', letter: 'Fr', mark: 'future', selected: false },
  { date: '2026-08-22', letter: 'Sa', mark: 'future', selected: false },
  { date: '2026-08-23', letter: 'Su', mark: 'future', selected: false }
]

describe('habit week progress', () => {
  it('summarizes real weekly states and streak risk for assistive technology', () => {
    expect(weekProgressLabel('Morning routine', WEEK, 6, true)).toBe(
      'Morning routine. This week: Mo complete; Tu complete; We frozen; Th pending, selected; Fr upcoming; Sa upcoming; Su upcoming. 6-day streak. At risk today. Open details.'
    )
  })

  it('renders one compact detail control with seven state segments', () => {
    const markup = renderToStaticMarkup(
      <WeekStrip
        atRisk
        habitId="morning-routine"
        habitName="Morning routine"
        onOpen={() => undefined}
        streak={6}
        week={WEEK}
      />
    )

    expect(markup.match(/<button/g)).toHaveLength(1)
    expect(markup.match(/habit-week-segment/g)).toHaveLength(7)
    expect(markup).toContain('habit-week-day is-selected')
    expect(markup).toContain('habit-week-segment is-pending')
    expect(markup).toContain('data-testid="habit-week-progress-morning-routine"')
    expect(markup.match(/habit-week-label/g)).toHaveLength(7)
    expect(markup).toContain('>Mo<')
    expect(markup).toContain('>Su<')
  })
})
