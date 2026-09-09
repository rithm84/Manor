import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { habitLadder, nearestLadderValue, QuantizedHabitControl } from './QuantizedHabitControl'

describe('quantized habit progress', () => {
  it('derives one step per unit from a small "N units" target', () => {
    expect(habitLadder('2 tablets')).toEqual([0, 50, 100])
    expect(habitLadder('3 tablets')).toEqual([0, 33, 66, 100])
    expect(habitLadder('8 glasses')).toEqual([0, 12, 25, 37, 50, 62, 75, 87, 100])
  })

  it('falls back to quarters for large or numberless targets', () => {
    expect(habitLadder('48 oz')).toEqual([0, 25, 50, 75, 100])
    expect(habitLadder('105 g')).toEqual([0, 25, 50, 75, 100])
    expect(habitLadder('a few stretches')).toEqual([0, 25, 50, 75, 100])
  })

  it('snaps values recorded under an older ladder to the nearest step', () => {
    expect(nearestLadderValue(habitLadder('3 tablets'), 25)).toBe(33)
    expect(nearestLadderValue(habitLadder('48 oz'), 66)).toBe(75)
  })

  it('exposes partial progress as one mixed-state checkbox announcing both directions', () => {
    const markup = renderToStaticMarkup(
      <QuantizedHabitControl
        habitId="water"
        habitName="Water"
        targetLabel="105 oz"
        value={50}
        onChange={() => Promise.resolve()}
      />
    )

    expect(markup).toContain('role="checkbox"')
    expect(markup).toContain('aria-checked="mixed"')
    expect(markup).toContain(
      'Water: 50% complete, 53 oz / 105 oz. Activate or arrow up to set 75%. Shift plus activate or arrow down to set 25%.'
    )
    expect(markup.match(/<button/g)).toHaveLength(1)
  })

  it('announces unit-sized steps for a small target', () => {
    const markup = renderToStaticMarkup(
      <QuantizedHabitControl
        habitId="tablets"
        habitName="Tablets"
        targetLabel="3 tablets"
        value={33}
        onChange={() => Promise.resolve()}
      />
    )

    expect(markup).toContain(
      'Tablets: 33% complete, 1 tablet / 3 tablets. Activate or arrow up to set 66%. Shift plus activate or arrow down to set 0%.'
    )
  })

  it('exposes zero and complete values as unchecked and checked', () => {
    const renderAt = (value: 0 | 100): string =>
      renderToStaticMarkup(
        <QuantizedHabitControl
          habitId="protein"
          habitName="Protein"
          targetLabel="105 g"
          value={value}
          onChange={() => Promise.resolve()}
        />
      )

    expect(renderAt(0)).toContain('aria-checked="false"')
    expect(renderAt(100)).toContain('aria-checked="true"')
  })

  it('renders the complete state as one fully filled control', () => {
    const markup = renderToStaticMarkup(
      <QuantizedHabitControl
        habitId="water"
        habitName="Water"
        targetLabel="48 oz"
        value={100}
        onChange={() => Promise.resolve()}
      />
    )

    expect(markup).not.toContain('is-gold')
    expect(markup).toContain('habit-quantized-control is-complete')
    expect(markup).toContain('--habit-fill-angle:360deg')
    expect(markup.match(/<button/g)).toHaveLength(1)
  })
})
