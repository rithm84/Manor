import { describe, expect, it } from 'vitest'

import { formatTimePickerValue, parseTimePickerText, TIME_PICKER_OPTIONS } from './TimePicker'

describe('TimePicker', () => {
  it('offers the full day in fifteen-minute increments', () => {
    expect(TIME_PICKER_OPTIONS).toHaveLength(96)
    expect(TIME_PICKER_OPTIONS[0]).toBe('00:00')
    expect(TIME_PICKER_OPTIONS[95]).toBe('23:45')
  })

  it('accepts common typed twelve and twenty-four hour times', () => {
    expect(parseTimePickerText('9:15 AM')).toBe('09:15')
    expect(parseTimePickerText('9pm')).toBe('21:00')
    expect(parseTimePickerText('21:15')).toBe('21:15')
    expect(parseTimePickerText('25:00')).toBeNull()
  })

  it('formats values without native time input chrome', () => {
    expect(formatTimePickerValue('00:00', '12h')).toBe('12:00 AM')
    expect(formatTimePickerValue('13:45', '12h')).toBe('1:45 PM')
    expect(formatTimePickerValue('13:45', '24h')).toBe('13:45')
  })
})
