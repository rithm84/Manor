import { describe, expect, it } from 'vitest'

import { deepLinkRoute, signInOutcome } from './deepLinks'

describe('deepLinkRoute', () => {
  it('joins the host and path of a deep link into an app route', () => {
    expect(deepLinkRoute('manor-staging://settings?connection_error=x', 'manor-staging')).toBe('/settings?connection_error=x')
    expect(deepLinkRoute('manor-staging://auth/callback?code=abc', 'manor-staging')).toBe('/auth/callback?code=abc')
  })

  it('keeps the fragment a verify link carries', () => {
    expect(deepLinkRoute('manor://auth/callback#access_token=a&refresh_token=r', 'manor')).toBe('/auth/callback#access_token=a&refresh_token=r')
  })

  it('maps a link without a host onto a single leading slash', () => {
    expect(deepLinkRoute('manor://', 'manor')).toBe('/')
    expect(deepLinkRoute('manor:/settings', 'manor')).toBe('/settings')
    expect(deepLinkRoute('manor:settings', 'manor')).toBe('/settings')
  })

  it('refuses a link addressed to another build', () => {
    expect(() => deepLinkRoute('manor://settings', 'manor-staging')).toThrow(/opens manor-staging links/)
    expect(() => deepLinkRoute('https://manor.invalid/settings', 'manor')).toThrow(/opens manor links/)
  })

  it('refuses text that is not a URL', () => {
    expect(() => deepLinkRoute('not a link', 'manor')).toThrow(/not a URL/)
  })
})

describe('signInOutcome', () => {
  it('reads the authorization code of a PKCE callback', () => {
    expect(signInOutcome('/auth/callback?code=abc')).toEqual({ kind: 'code', code: 'abc' })
  })

  it('reads the session a verify link delivers in the fragment', () => {
    expect(signInOutcome('/auth/callback#access_token=a&refresh_token=r&type=magiclink')).toEqual({
      kind: 'tokens', accessToken: 'a', refreshToken: 'r'
    })
  })

  it('prefers the description of a refused sign-in, and falls back to the code', () => {
    expect(signInOutcome('/auth/callback?error=access_denied&error_description=Denied')).toEqual({ kind: 'error', message: 'Denied' })
    expect(signInOutcome('/auth/callback?error=access_denied')).toEqual({ kind: 'error', message: 'access_denied' })
    expect(signInOutcome('/auth/callback#error=server_error&error_description=Link+has+expired')).toEqual({
      kind: 'error', message: 'Link has expired'
    })
  })

  it('refuses a callback that carries nothing usable', () => {
    expect(() => signInOutcome('/auth/callback')).toThrow(/no authorization code/)
    expect(() => signInOutcome('/auth/callback#access_token=a')).toThrow(/no authorization code/)
  })

  it('keeps the code and the session out of its error text', () => {
    expect(() => signInOutcome('/auth/callback?state=xyz')).toThrow(/^The sign-in callback \/auth\/callback carried/)
  })
})
