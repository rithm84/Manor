import { describe, expect, it } from 'vitest'

import { ALFRED_ROUTES, parseAlfredRoute } from './alfred'

describe('parseAlfredRoute', () => {
  it('accepts every navigable page and rejects unknown destinations', () => {
    expect(parseAlfredRoute('/habits')).toBe('/habits')
    expect(parseAlfredRoute('/journal')).toBe('/journal')
    expect(parseAlfredRoute('/settings')).toBe('/settings')
    expect(ALFRED_ROUTES).toHaveLength(10)
    expect(() => parseAlfredRoute('/welcome')).toThrow('Alfred destination')
    expect(() => parseAlfredRoute('/nowhere')).toThrow('Alfred destination')
  })
})
