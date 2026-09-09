import { describe, expect, it } from 'vitest'

import { isSecurePostUrl } from './BookmarkRow'

describe('isSecurePostUrl', () => {
  it('permits only https post URLs for external open', () => {
    expect(isSecurePostUrl('https://x.com/karpathy')).toBe(true)
    expect(isSecurePostUrl('http://x.com/karpathy')).toBe(false)
    expect(isSecurePostUrl('javascript:alert(1)')).toBe(false)
    expect(isSecurePostUrl('file:///etc/passwd')).toBe(false)
    expect(isSecurePostUrl('not a url')).toBe(false)
  })
})
