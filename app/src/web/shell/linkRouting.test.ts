// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { departingUrl, installLinkRouting, ownFragment } from './DesktopShell'

describe('desktop link routing', () => {
  afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = '' })

  it('tells outside addresses from the app origin and from fragments inside the page', () => {
    expect(departingUrl('https://example.com/docs')).toBe('https://example.com/docs')
    expect(departingUrl(`${location.origin}/notes`)).toBeNull()
    expect(departingUrl('#recap')).toBeNull()
    expect(departingUrl('mailto:someone@example.com')).toBeNull()
    expect(departingUrl(undefined)).toBeNull()
    expect(ownFragment('#recap')).toBe('#recap')
    expect(ownFragment(`${location.href.split('#')[0]}#block=abc`)).toBe('#block=abc')
    expect(ownFragment('https://example.com/#recap')).toBeNull()
  })

  it('opens a departing link once even when a click and window.open both ask, and relays fragments', async () => {
    const opened: string[] = []
    const relayed: string[] = []
    installLinkRouting(async (url) => { opened.push(url) }, (fragment) => relayed.push(fragment))
    const anchor = document.createElement('a')
    anchor.href = 'https://example.com/article'
    document.body.append(anchor)
    anchor.click()
    window.open('https://example.com/article', '_blank')
    expect(opened).toEqual(['https://example.com/article'])

    window.open('https://other.example/', '_blank')
    expect(opened).toEqual(['https://example.com/article', 'https://other.example/'])

    expect(window.open('#1-the-interview-mental-model', '_blank')).toBeNull()
    expect(relayed).toEqual(['#1-the-interview-mental-model'])
    expect(opened).toHaveLength(2)
  })
})
