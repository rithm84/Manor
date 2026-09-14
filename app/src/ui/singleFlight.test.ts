import { describe, expect, it } from 'vitest'

import { singleFlight } from './singleFlight'

describe('singleFlight', () => {
  it('shares one request between overlapping callers and keeps the result', async () => {
    let loads = 0
    const load = singleFlight(async () => { loads += 1; return 'chunk' })
    const [first, second] = await Promise.all([load(), load()])
    expect([first, second, await load()]).toEqual(['chunk', 'chunk', 'chunk'])
    expect(loads).toBe(1)
  })

  it('forgets a failed request so the next caller tries again', async () => {
    let attempts = 0
    const load = singleFlight(async () => { attempts += 1; if (attempts === 1) throw new Error('offline'); return 'chunk' })
    await expect(load()).rejects.toThrow('offline')
    await expect(load()).resolves.toBe('chunk')
    expect(attempts).toBe(2)
  })
})
