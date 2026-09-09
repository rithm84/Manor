import { describe, expect, it } from 'vitest'

import type { KbEntry } from '../../../shared/kb'
import {
  captureHost,
  captureTimeLabel,
  captureTitle,
  hasPendingCaptures,
  matchesCaptureQuery
} from './captures'

function entry(overrides: Partial<KbEntry>): KbEntry {
  return {
    id: 'kb-1',
    source: 'capture',
    url: 'https://example.com/post',
    title: 'A post',
    author: 'Ada',
    summary: 'A summary.',
    contentMd: null,
    status: 'normalized',
    error: null,
    capturedAt: '2026-08-25T09:41:00',
    normalizedAt: '2026-08-25T09:42:00',
    screenshotPath: null,
    ...overrides
  }
}

describe('captureHost', () => {
  it('strips www. and rejects unparsable URLs', () => {
    expect(captureHost('https://www.simonwillison.net/2026/aug')).toBe('simonwillison.net')
    expect(captureHost('https://x.com/karpathy/status/1')).toBe('x.com')
    expect(captureHost('not a url')).toBe(null)
    expect(captureHost(null)).toBe(null)
  })
})

describe('captureTitle', () => {
  it('falls back from title to host to a plain label', () => {
    expect(captureTitle(entry({ title: 'Kernel tuning notes' }))).toBe('Kernel tuning notes')
    expect(captureTitle(entry({ title: null, url: 'https://www.example.com/a' }))).toBe('example.com')
    expect(captureTitle(entry({ title: '  ', url: null }))).toBe('Screen capture')
  })
})

describe('captureTimeLabel', () => {
  const now = new Date('2026-08-25T12:00:00')

  it('shows clock time today, a short date otherwise, and the year when it differs', () => {
    expect(captureTimeLabel('2026-08-25T09:41:00', now)).toBe('9:41 AM')
    expect(captureTimeLabel('2026-08-25T15:05:00', now)).toBe('3:05 PM')
    expect(captureTimeLabel('2026-08-22T09:41:00', now)).toBe('Aug 22')
    expect(captureTimeLabel('2025-12-31T09:41:00', now)).toBe('Dec 31, 2025')
  })
})

describe('hasPendingCaptures', () => {
  it('detects pending entries only', () => {
    expect(hasPendingCaptures([entry({ status: 'pending' }), entry({ id: 'kb-2' })])).toBe(true)
    expect(hasPendingCaptures([entry({}), entry({ id: 'kb-2', status: 'failed' })])).toBe(false)
    expect(hasPendingCaptures([])).toBe(false)
  })
})

describe('matchesCaptureQuery', () => {
  it('matches title, author, summary, and url; empty query matches all', () => {
    const subject = entry({
      title: 'CUDA occupancy',
      author: 'Simon',
      summary: 'Bank conflicts explained.',
      url: 'https://simonwillison.net/cuda'
    })
    expect(matchesCaptureQuery(subject, '')).toBe(true)
    expect(matchesCaptureQuery(subject, 'occupancy')).toBe(true)
    expect(matchesCaptureQuery(subject, 'simon')).toBe(true)
    expect(matchesCaptureQuery(subject, 'bank conflicts')).toBe(true)
    expect(matchesCaptureQuery(subject, 'simonwillison.net')).toBe(true)
    expect(matchesCaptureQuery(subject, 'rendering')).toBe(false)
    expect(matchesCaptureQuery(entry({ title: null, author: null, summary: null, url: null }), 'x')).toBe(false)
  })
})
