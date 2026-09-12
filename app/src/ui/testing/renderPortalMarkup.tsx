import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

/** Mount portal-based surfaces in a real DOM before inspecting their accessible markup. */
export async function renderPortalMarkup(node: ReactNode): Promise<string> {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(node))
    return document.body.innerHTML
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
}
