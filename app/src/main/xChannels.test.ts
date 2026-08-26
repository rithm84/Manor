import { describe, expect, it } from 'vitest'

import { authorizeUrlOf, pkceChallengeOf, pkceVerifier } from './xChannels'

describe('pkceVerifier', () => {
  it('produces 43 base64url characters and never repeats', () => {
    const first = pkceVerifier()
    const second = pkceVerifier()
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(second).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(first).not.toBe(second)
  })
})

describe('pkceChallengeOf', () => {
  it('matches the RFC 7636 appendix B vector', () => {
    expect(pkceChallengeOf('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
    )
  })

  it('challenges its own verifiers with base64url output', () => {
    expect(pkceChallengeOf(pkceVerifier())).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })
})

describe('authorizeUrlOf', () => {
  it('builds the x.com authorize URL with the loopback redirect and full scopes', () => {
    const url = new URL(authorizeUrlOf('client-123', 'state-abc', 'challenge-xyz'))
    expect(url.origin).toBe('https://x.com')
    expect(url.pathname).toBe('/i/oauth2/authorize')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('client_id')).toBe('client-123')
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:17997/callback')
    expect(url.searchParams.get('state')).toBe('state-abc')
    expect(url.searchParams.get('code_challenge')).toBe('challenge-xyz')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('scope')?.split(' ')).toEqual([
      'bookmark.read',
      'tweet.read',
      'users.read',
      'offline.access'
    ])
  })
})
