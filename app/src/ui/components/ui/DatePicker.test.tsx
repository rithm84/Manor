import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { DatePicker, datePickerMonthCells } from './DatePicker'

describe('DatePicker', () => {
  it('renders an unset custom date trigger without a native date input', () => {
    const markup = renderToStaticMarkup(
      <DatePicker value={null} onChange={() => undefined} ariaLabel="Date posted" min={null} max={null} />
    )

    expect(markup).toContain('class="ui-datepicker-trigger"')
    expect(markup).toContain('aria-label="Date posted"')
    expect(markup).toContain('Not set')
    expect(markup).not.toContain('type="date"')
  })

  it('builds local calendar months without UTC date shifts', () => {
    const cells = datePickerMonthCells({ year: 2026, month: 7 }).filter((cell) => cell !== null)
    expect(cells.at(0)).toBe('2026-08-01')
    expect(cells.at(-1)).toBe('2026-08-31')
  })
})
