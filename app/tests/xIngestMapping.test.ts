/* Pure-mapper coverage for the x-ingest Edge Function. Lives outside src/ so
   tsc's composite projects skip it while vitest still picks it up. */

import { describe, expect, it } from 'vitest'

import {
  authorOf,
  externalUrlOf,
  kbRowOf,
  needsRefresh,
  postUrlOf,
  titleOf
} from '../../supabase/functions/_shared/xBookmarks'
import type { XPost, XUser } from '../../supabase/functions/_shared/xBookmarks'

const author: XUser = { id: 'u1', username: 'karpathy', name: 'Andrej Karpathy' }

function post(overrides: Partial<XPost>): XPost {
  return { id: '19001', text: 'Hand-written CUDA kernels are a lost art.', author_id: 'u1', ...overrides }
}

describe('titleOf', () => {
  it('collapses whitespace and keeps short text intact', () => {
    expect(titleOf('a  post\nwith   breaks')).toBe('a post with breaks')
  })

  it('truncates around 80 characters with an ellipsis', () => {
    const long = 'word '.repeat(40)
    const title = titleOf(long)
    expect(title.length).toBeLessThanOrEqual(81)
    expect(title.endsWith('…')).toBe(true)
  })
})

describe('postUrlOf and authorOf', () => {
  it('builds the canonical status URL', () => {
    expect(postUrlOf('karpathy', '19001')).toBe('https://x.com/karpathy/status/19001')
  })

  it('formats the author from the expansion and tolerates a missing one', () => {
    expect(authorOf(author)).toBe('Andrej Karpathy (@karpathy)')
    expect(authorOf({ id: 'u2', username: 'swyx', name: '' })).toBe('@swyx')
    expect(authorOf(undefined)).toBe(null)
  })
})

describe('externalUrlOf', () => {
  it('ignores posts without entities and links back into X', () => {
    expect(externalUrlOf(post({}))).toBe(null)
    expect(
      externalUrlOf(
        post({
          entities: {
            urls: [{ url: 'https://t.co/abc', expanded_url: 'https://x.com/swyx/status/2' }]
          }
        })
      )
    ).toBe(null)
  })

  it('returns the first genuinely external expanded URL', () => {
    expect(
      externalUrlOf(
        post({
          entities: {
            urls: [
              { url: 'https://t.co/a', expanded_url: 'https://twitter.com/x/status/1' },
              { url: 'https://t.co/b', expanded_url: 'https://simonwillison.net/cuda' }
            ]
          }
        })
      )
    ).toBe('https://simonwillison.net/cuda')
  })
})

describe('kbRowOf', () => {
  const now = '2026-08-26T10:00:00.000Z'

  it('maps a plain post to a normalized entry pointing at the post', () => {
    const row = kbRowOf('user-1', post({}), author, now)
    expect(row).toMatchObject({
      user_id: 'user-1',
      source: 'x_bookmark',
      source_ref: '19001',
      url: 'https://x.com/karpathy/status/19001',
      author: 'Andrej Karpathy (@karpathy)',
      title: 'Hand-written CUDA kernels are a lost art.',
      content_md: 'Hand-written CUDA kernels are a lost art.',
      status: 'normalized',
      captured_at: now
    })
    expect(row.raw.article_url).toBe(null)
  })

  it('maps an article post to a pending entry that keeps the post URL in raw', () => {
    const withArticle = post({
      entities: { urls: [{ url: 'https://t.co/z', expanded_url: 'https://simonwillison.net/cuda' }] }
    })
    const row = kbRowOf('user-1', withArticle, author, now)
    expect(row.status).toBe('pending')
    expect(row.url).toBe('https://simonwillison.net/cuda')
    expect(row.raw.post_url).toBe('https://x.com/karpathy/status/19001')
    expect(row.raw.article_url).toBe('https://simonwillison.net/cuda')
  })

  it('falls back to the author-agnostic status URL without an expansion', () => {
    expect(kbRowOf('user-1', post({}), undefined, now).url).toBe('https://x.com/i/status/19001')
  })
})

describe('needsRefresh', () => {
  const now = Date.parse('2026-08-26T10:00:00Z')

  it('refreshes within five minutes of expiry and not before', () => {
    expect(needsRefresh('2026-08-26T10:04:00Z', now)).toBe(true)
    expect(needsRefresh('2026-08-26T09:00:00Z', now)).toBe(true)
    expect(needsRefresh('2026-08-26T10:06:00Z', now)).toBe(false)
  })
})
