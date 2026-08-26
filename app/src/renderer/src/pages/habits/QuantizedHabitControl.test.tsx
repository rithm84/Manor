import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import {
  nextQuantizedValue,
  previousQuantizedValue,
  QuantizedHabitControl
} from './QuantizedHabitControl'

describe('quantized habit progress', () => {
  it('cycles every quarter and resets after completion', () => {
    const values = [0, 25, 50, 75, 100] as const

    expect(values.map((value) => nextQuantizedValue(value))).toEqual([25, 50, 75, 100, 0])
  })

  it('steps backward through every quarter and wraps below zero', () => {
    const values = [0, 25, 50, 75, 100] as const

    expect(values.map((value) => previousQuantizedValue(value))).toEqual([100, 0, 25, 50, 75])
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

  it('renders the complete state as one green-quartered control', () => {
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
    expect(markup).toContain('habit-quantized-control is-quarter-4')
    expect(markup.match(/<button/g)).toHaveLength(1)
  })
})
