import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { XApi } from '../../../../shared/xConnection'
import { xApiOf } from '../bookmarks/xApi'
import { XConnectionSection, connectedSinceLabel } from './XConnectionSection'

describe('connectedSinceLabel', () => {
  it('drops the year for the current year and keeps it otherwise', () => {
    const now = new Date('2026-08-26T12:00:00')
    expect(connectedSinceLabel('2026-08-26T09:00:00', now)).toBe('Aug 26')
    expect(connectedSinceLabel('2025-12-02T09:00:00', now)).toBe('Dec 2, 2025')
  })
})

describe('XConnectionSection', () => {
  it('renders the connections row with a quiet placeholder before status loads', () => {
    const markup = renderToStaticMarkup(<XConnectionSection />)
    expect(markup).toContain('Sync your X bookmarks into Manor.')
    expect(markup).toContain('setx-ghost')
    expect(markup).not.toContain('Disconnect')
  })
})

describe('xApiOf', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the wired bridge api, and null when the shell has not wired it', () => {
    const api: XApi = {
      beginConnect: async () => ({ authorizeUrl: 'https://x.com/i/oauth2/authorize' }),
      completeConnect: async () => ({
        connected: true,
        username: 'user',
        connectedAt: '2026-08-26T09:00:00Z'
      }),
      status: async () => ({ connected: false, username: null, connectedAt: null }),
      disconnect: async () => undefined,
      ingestNow: async () => ({ added: 0 })
    }
    vi.stubGlobal('window', { manor: { x: api } })
    expect(xApiOf()).toBe(api)
    vi.stubGlobal('window', { manor: {} })
    expect(xApiOf()).toBe(null)
  })
})
