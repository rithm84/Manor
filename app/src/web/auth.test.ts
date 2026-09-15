// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'

import { cachedAccount } from './auth'

const KEY = 'manor.account:acct-1'

afterEach(() => localStorage.clear())

describe('cachedAccount', () => {
  it('returns the cached account when it matches the session', () => {
    localStorage.setItem(KEY, JSON.stringify({ id: 'acct-1', email: 'ada@example.invalid', name: 'Ada', timezone: 'America/Los_Angeles' }))
    expect(cachedAccount('acct-1', 'ada@example.invalid')).toEqual({ id: 'acct-1', email: 'ada@example.invalid', name: 'Ada', timezone: 'America/Los_Angeles' })
  })

  it('treats a cache written for another email as absent instead of failing the open', () => {
    localStorage.setItem(KEY, JSON.stringify({ id: 'acct-1', email: 'old@example.invalid', name: 'Ada', timezone: 'America/Los_Angeles' }))
    expect(cachedAccount('acct-1', 'ada@example.invalid')).toBeNull()
  })

  it('treats an unreadable cache as absent', () => {
    localStorage.setItem(KEY, '{not json')
    expect(cachedAccount('acct-1', 'ada@example.invalid')).toBeNull()
  })
})
