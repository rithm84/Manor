import { describe, expect, it } from 'vitest'

import { parseAlfredRoute } from './alfred'

describe('parseAlfredRoute', () => {
  it('accepts Alfred completion destinations and rejects Journal', () => {
    expect(parseAlfredRoute('/habits')).toBe('/habits')
    expect(() => parseAlfredRoute('/journal')).toThrow('Alfred destination')
  })
})
