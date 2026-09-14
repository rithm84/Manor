// @vitest-environment happy-dom

import { act, useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'

import { DeepLinkNavigation, useLaunchRoute, type RouteRequest } from './DeepLinkNavigation'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLElement | null = null
let deliver: ((route: string) => void) | null = null

/** The signed-in tree's shape: one request at a time, cleared once the router has applied it. */
function Entry({ launch }: { launch: RouteRequest | null }): ReactNode {
  const [request, setRequest] = useState(launch)
  const applied = useCallback((): void => setRequest(null), [])
  const pending = useLaunchRoute(request, applied)
  useEffect(() => { deliver = (route: string): void => setRequest({ route }) }, [])
  return <BrowserRouter>
    <DeepLinkNavigation request={pending} onApplied={applied} />
    <Routes>
      <Route path="/oauth/consent" element={null} />
      <Route path="/settings" element={null} />
      <Route path="/home" element={null} />
      <Route path="*" element={<Navigate to="/home" replace />} />
    </Routes>
  </BrowserRouter>
}

async function render(launch: RouteRequest | null): Promise<void> {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => { root?.render(<Entry launch={launch} />) })
}

const address = (): string => `${location.pathname}${location.search}`

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
  deliver = null
  history.replaceState(null, '', '/')
})

describe('deep-link routing', () => {
  it('starts on a route that was waiting before the router existed', async () => {
    await render({ route: '/oauth/consent?authorization_id=b7e' })
    expect(address()).toBe('/oauth/consent?authorization_id=b7e')
  })

  it('sends an unknown launch address Home', async () => {
    await render(null)
    expect(address()).toBe('/home')
  })

  it('applies a route that arrives while the app is running', async () => {
    await render(null)
    await act(async () => { deliver?.('/settings?connection_error=denied') })
    expect(address()).toBe('/settings?connection_error=denied')
  })
})
