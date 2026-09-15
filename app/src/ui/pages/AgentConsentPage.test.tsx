// @vitest-environment happy-dom

import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AccountApi } from '../../shared/account'
import type { DesktopShell } from '../../web/shell/DesktopShell'
import { ShellProvider } from '../../web/shell/ShellContext'
import { ManorServicesProvider } from '../services/ManorServices'
import { AgentConsentPage } from './AgentConsentPage'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLElement | null = null

const RETURN_URL = 'https://chat.example.com/oauth/callback?code=abc'

function Tree({ account, shell, entry }: { account: Partial<AccountApi>; shell: DesktopShell; entry: string }): ReactNode {
  return <ManorServicesProvider services={{ account: account as AccountApi }}>
    <ShellProvider shell={shell}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/oauth/consent" element={<AgentConsentPage />} />
          <Route path="/home" element={<h1 data-testid="home">Home</h1>} />
        </Routes>
      </MemoryRouter>
    </ShellProvider>
  </ManorServicesProvider>
}

async function render(account: Partial<AccountApi>, entry = '/oauth/consent?authorization_id=b7e'): Promise<{ openAuthorization: ReturnType<typeof vi.fn> }> {
  const openAuthorization = vi.fn(() => Promise.resolve())
  const shell = { openAuthorization } as unknown as DesktopShell
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => { root?.render(<Tree account={account} shell={shell} entry={entry} />) })
  return { openAuthorization }
}

const byTestId = (id: string): HTMLElement | null => host?.querySelector<HTMLElement>(`[data-testid="${id}"]`) ?? null

async function click(id: string): Promise<void> {
  const element = byTestId(id)
  if (element === null) throw new Error(`No element with test ID ${id}`)
  await act(async () => { element.click() })
}

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
})

describe('agent consent page', () => {
  it('offers a way back into the app after the agent is answered', async () => {
    const { openAuthorization } = await render({
      connectionRequest: () => Promise.resolve({ clientId: '3d3a8f1e-9d9a-4d0a-8f5c-2d5c1a1b2c3d', clientName: 'ChatGPT' }),
      approveConnection: () => Promise.resolve(RETURN_URL)
    })
    expect(byTestId('back-to-manor')).toBeNull()
    await click('approve-mcp')
    expect(openAuthorization).toHaveBeenCalledWith(RETURN_URL)
    expect(byTestId('agent-connection-answered')?.textContent).toBe('Return to ChatGPT in your browser to finish connecting.')
    await click('back-to-manor')
    expect(byTestId('home')).not.toBeNull()
  })

  it('offers a way back when the account already allowed the agent', async () => {
    await render({ connectionRequest: () => Promise.resolve({ redirectUrl: RETURN_URL }) })
    expect(byTestId('agent-connection-answered')).not.toBeNull()
    await click('back-to-manor')
    expect(byTestId('home')).not.toBeNull()
  })

  it('offers a way back when the request cannot be read', async () => {
    await render({}, '/oauth/consent')
    expect(host?.querySelector('[role="alert"]')).not.toBeNull()
    await click('back-to-manor')
    expect(byTestId('home')).not.toBeNull()
  })
})
