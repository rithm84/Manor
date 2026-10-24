// @vitest-environment happy-dom
import { act, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { Link, MemoryRouter, Route, useLocation, useNavigate } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { ModulePageCache } from './ModulePageCache'
import { hasOpenDismissLayer } from '../components/ui/dismissLayer'
import { Modal } from '../components/ui/Modal'
import { usePortalContainer } from '../components/ui/PortalContainer'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

function Probe({ name }: { name: string }): ReactNode {
  const portal = usePortalContainer()
  const location = useLocation()
  const [draft, setDraft] = useState('')
  const [signals, setSignals] = useState(0)
  useEffect(() => {
    const receive = (): void => setSignals(value => value + 1)
    window.addEventListener('module-cache-signal', receive)
    return () => window.removeEventListener('module-cache-signal', receive)
  }, [])
  return <>
    <textarea data-testid={`${name}-draft`} value={draft} onInput={event => setDraft(event.currentTarget.value)} />
    <span data-testid={`${name}-signals`}>{signals}</span>
    <span data-testid={`${name}-location`}>{location.pathname}{location.search}</span>
    {createPortal(<div role={name === 'first' ? 'menu' : undefined} data-testid={`${name}-portal`}>Context for {name}</div>, portal ?? document.body)}
  </>
}

function Controls(): ReactNode {
  const navigate = useNavigate()
  return <nav>
    <Link data-testid="first" to="/first?item=one">First</Link>
    <Link data-testid="second" to="/second?item=two">Second</Link>
    <Link data-testid="first-other" to="/first?item=other">Other item</Link>
    <button type="button" data-testid="back" onClick={() => navigate(-1)}>Back</button>
  </nav>
}

function Harness(): ReactNode {
  return <MemoryRouter initialEntries={['/first?item=one']}>
    <Controls />
    <ModulePageCache paths={['/first', '/second']}>
      <Route path="/first" element={<Probe name="first" />} />
      <Route path="/second" element={<Probe name="second" />} />
    </ModulePageCache>
  </MemoryRouter>
}

function DialogProbe(): ReactNode {
  const [open, setOpen] = useState(false)
  return <>
    <button type="button" data-testid="open-dialog" onClick={() => setOpen(true)}>Open</button>
    <Modal open={open} onClose={() => setOpen(false)} width={400} ariaLabel="Draft">
      <input data-testid="dialog-draft" aria-label="Draft value" />
    </Modal>
  </>
}

function element<T extends Element>(host: ParentNode, id: string, type: abstract new (...args: never[]) => T): T {
  const found = host.querySelector(`[data-testid="${id}"]`)
  if (!(found instanceof type)) throw new Error(`Missing ${id} with the required element type`)
  return found
}

describe('module navigation', () => {
  it('hides a real dialog and releases its focus boundary until its module returns', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(<MemoryRouter initialEntries={['/first']}>
        <Controls />
        <ModulePageCache paths={['/first', '/second']}>
          <Route path="/first" element={<DialogProbe />} />
          <Route path="/second" element={<textarea data-testid="second-page" />} />
        </ModulePageCache>
      </MemoryRouter>))
      await act(async () => element(host, 'open-dialog', HTMLButtonElement).click())
      const input = element(host, 'dialog-draft', HTMLInputElement)
      input.value = 'unfinished form'
      expect(input.checkVisibility()).toBe(true)
      await act(async () => element(host, 'second', HTMLAnchorElement).click())
      expect(input.checkVisibility()).toBe(false)
      expect(hasOpenDismissLayer()).toBe(false)
      expect(element(host, 'second-page', HTMLTextAreaElement).closest('[aria-hidden="true"], [inert]')).toBeNull()
      await act(async () => element(host, 'first', HTMLAnchorElement).click())
      expect(element(host, 'dialog-draft', HTMLInputElement)).toBe(input)
      expect(input.value).toBe('unfinished form')
      expect(input.checkVisibility()).toBe(true)
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  it('preserves drafts and scroll while disconnecting hidden listeners and portals', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(<Harness />))
      const draft = element(host, 'first-draft', HTMLTextAreaElement)
      await act(async () => {
        draft.value = 'unfinished solution'
        draft.dispatchEvent(new Event('input', { bubbles: true }))
        window.dispatchEvent(new Event('module-cache-signal'))
      })
      const page = host.querySelector<HTMLElement>('[data-module-page="/first"]')
      if (page === null) throw new Error('First module scroll container is missing')
      page.scrollTop = 147
      expect(hasOpenDismissLayer()).toBe(true)
      await act(async () => element(host, 'second', HTMLAnchorElement).click())
      expect(page.style.display).toBe('none')
      expect(hasOpenDismissLayer()).toBe(false)
      expect(element(document, 'first-portal', HTMLDivElement).parentElement?.style.display).toBe('none')
      await act(async () => window.dispatchEvent(new Event('module-cache-signal')))
      expect(element(host, 'first-signals', HTMLSpanElement).textContent).toBe('1')
      expect(element(host, 'second-signals', HTMLSpanElement).textContent).toBe('1')
      await act(async () => element(host, 'first', HTMLAnchorElement).click())
      expect(element(host, 'first-draft', HTMLTextAreaElement)).toBe(draft)
      expect(draft.value).toBe('unfinished solution')
      expect(page.scrollTop).toBe(147)
      expect(page.style.display).not.toBe('none')
      expect(element(document, 'first-portal', HTMLDivElement).parentElement?.style.display).not.toBe('none')
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  it('keeps hidden route context separate and honors explicit links and back navigation', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(<Harness />))
      await act(async () => element(host, 'second', HTMLAnchorElement).click())
      expect(element(host, 'first-location', HTMLSpanElement).textContent).toBe('/first?item=one')
      expect(element(host, 'second-location', HTMLSpanElement).textContent).toBe('/second?item=two')
      await act(async () => element(host, 'first-other', HTMLAnchorElement).click())
      expect(element(host, 'first-location', HTMLSpanElement).textContent).toBe('/first?item=other')
      await act(async () => element(host, 'back', HTMLButtonElement).click())
      expect(element(host, 'second-location', HTMLSpanElement).textContent).toBe('/second?item=two')
      expect(host.querySelector<HTMLElement>('[data-module-page="/second"]')?.style.display).not.toBe('none')
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  it('clears transient module state when the signed-in app is replaced', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(<Harness key="first-account" />))
      const draft = element(host, 'first-draft', HTMLTextAreaElement)
      await act(async () => {
        draft.value = 'private draft'
        draft.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await act(async () => root.render(<Harness key="second-account" />))
      expect(element(host, 'first-draft', HTMLTextAreaElement).value).toBe('')
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
