import { describe, expect, it } from 'vitest'

import type { JsonObject } from '../ManorGateway'
import { newerRows } from './rows'

describe('newerRows', () => {
  it('keeps a cached row that a receipt already moved past what the read returned', () => {
    const cached: JsonObject[] = [{ id: 'a', revision: 3, deleted_at: '2026-09-14T09:00:00Z' }, { id: 'b', revision: 1 }]
    const read: JsonObject[] = [{ id: 'a', revision: 2, deleted_at: null }, { id: 'b', revision: 2 }, { id: 'c', revision: 1 }]
    expect(newerRows(cached, read)).toEqual([cached[0], read[1], read[2]])
  })

  it('takes the read as is when nothing was cached', () => {
    const read: JsonObject[] = [{ id: 'a', revision: 1 }]
    expect(newerRows(null, read)).toEqual(read)
  })
})
