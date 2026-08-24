import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { nextQuantizedValue, QuantizedHabitControl } from './QuantizedHabitControl'

describe('quantized habit progress', () => {
  it('cycles every quarter and resets after completion', () => {
    const values = [0, 25, 50, 75, 100] as const

    expect(values.map((value) => nextQuantizedValue(value))).toEqual([25, 50, 75, 100, 0])
  })

  it('exposes partial progress as one mixed-state checkbox', () => {
    const markup = renderToStaticMarkup(
      <QuantizedHabitControl
        gold={false}
        habitId="water"
        habitName="Water"
        targetLabel="105 oz"
        value={50}
        onChange={() => undefined}
      />
    )

    expect(markup).toContain('role="checkbox"')
    expect(markup).toContain('aria-checked="mixed"')
    expect(markup).toContain('Water: 50% complete, 53 oz / 105 oz. Activate to set 75%.')
    expect(markup.match(/<button/g)).toHaveLength(1)
  })

  it('exposes zero and complete values as unchecked and checked', () => {
    const renderAt = (value: 0 | 100): string =>
      renderToStaticMarkup(
        <QuantizedHabitControl
          gold={false}
          habitId="protein"
          habitName="Protein"
          targetLabel="105 g"
          value={value}
          onChange={() => undefined}
        />
      )

    expect(renderAt(0)).toContain('aria-checked="false"')
    expect(renderAt(100)).toContain('aria-checked="true"')
  })

  it('announces gold without adding a second control', () => {
    const markup = renderToStaticMarkup(
      <QuantizedHabitControl
        gold
        habitId="water"
        habitName="Water"
        targetLabel="48 oz"
        value={100}
        onChange={() => undefined}
      />
    )

    expect(markup).toContain('Violet streak.')
    expect(markup).toContain('habit-quantized-control is-quarter-4 is-gold')
    expect(markup.match(/<button/g)).toHaveLength(1)
  })
})
