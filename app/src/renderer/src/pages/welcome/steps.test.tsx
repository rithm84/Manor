// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'

import type { AccountInfo } from '../../../../shared/account'
import { accountErrorMessage } from './accountSession'
import { SignInStep } from './steps'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ACCOUNT: AccountInfo = { userId: 'user-1', email: 'user@example.com' }

interface AccountApiStub {
  signIn: ReturnType<typeof vi.fn>
  signOut: ReturnType<typeof vi.fn>
  current: ReturnType<typeof vi.fn>
}

function stubAccountApi(current: AccountInfo | null): AccountApiStub {
  const api: AccountApiStub = {
    signIn: vi.fn(() => Promise.resolve(ACCOUNT)),
    signOut: vi.fn(() => Promise.resolve()),
    current: vi.fn(() => Promise.resolve(current))
  }
  ;(window as unknown as { manor: { account: AccountApiStub } }).manor = { account: api }
  return api
}

async function mountSignIn(email: string, onContinue: () => void): Promise<HTMLDivElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      <SignInStep email={email} onEmailChange={() => undefined} onContinue={onContinue} />
    )
  })
  return container
}

async function submitForm(container: HTMLElement): Promise<void> {
  const form = container.querySelector('form')
  if (form === null) throw new Error('sign-in form not rendered')
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
}

function typeInto(input: HTMLInputElement, value: string): void {
  const setValue = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set
  if (setValue === undefined) throw new Error('HTMLInputElement value setter was unavailable')
  act(() => {
    setValue.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function passwordInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('input[type="password"]')
  if (input === null) throw new Error('password input not rendered')
  return input
}

describe('Welcome sign-in step', () => {
  it('renders email and password fields inside a form so Enter submits', async () => {
    stubAccountApi(null)
    const container = await mountSignIn('', vi.fn())
    const email = container.querySelector('input[type="email"]')
    expect(email).not.toBeNull()
    expect(email?.closest('form')).not.toBeNull()
    expect(passwordInput(container).closest('form')).not.toBeNull()
    expect(container.querySelector('button[type="submit"]')).not.toBeNull()
  })

  it('blocks an invalid email with an error instead of calling the API', async () => {
    const api = stubAccountApi(null)
    const onContinue = vi.fn()
    const container = await mountSignIn('not-an-email', onContinue)
    typeInto(passwordInput(container), 'hunter2')
    await submitForm(container)
    expect(api.signIn).not.toHaveBeenCalled()
    expect(onContinue).not.toHaveBeenCalled()
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'Enter a valid email address.'
    )
  })

  it('requires a password before calling the API', async () => {
    const api = stubAccountApi(null)
    const onContinue = vi.fn()
    const container = await mountSignIn('user@example.com', onContinue)
    await submitForm(container)
    expect(api.signIn).not.toHaveBeenCalled()
    expect(onContinue).not.toHaveBeenCalled()
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Enter your password.')
  })

  it('signs in with the entered credentials and advances on success', async () => {
    const api = stubAccountApi(null)
    const onContinue = vi.fn()
    const container = await mountSignIn('user@example.com', onContinue)
    typeInto(passwordInput(container), 'hunter2')
    await submitForm(container)
    expect(api.signIn).toHaveBeenCalledWith({ email: 'user@example.com', password: 'hunter2' })
    expect(onContinue).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('shows a busy submit button while sign-in is in flight', async () => {
    const api = stubAccountApi(null)
    let resolveSignIn: (account: AccountInfo) => void = () => undefined
    api.signIn.mockReturnValue(
      new Promise<AccountInfo>((resolve) => {
        resolveSignIn = resolve
      })
    )
    const onContinue = vi.fn()
    const container = await mountSignIn('user@example.com', onContinue)
    typeInto(passwordInput(container), 'hunter2')
    await submitForm(container)
    const submit = container.querySelector<HTMLButtonElement>('button[type="submit"]')
    expect(submit?.disabled).toBe(true)
    expect(submit?.textContent).toBe('Signing in…')
    await act(async () => {
      resolveSignIn(ACCOUNT)
    })
    expect(onContinue).toHaveBeenCalledTimes(1)
  })

  it('surfaces the API message inline when sign-in is rejected', async () => {
    const api = stubAccountApi(null)
    api.signIn.mockImplementation(() => Promise.reject(new Error('Invalid login credentials')))
    const onContinue = vi.fn()
    const container = await mountSignIn('user@example.com', onContinue)
    typeInto(passwordInput(container), 'wrong-password')
    await submitForm(container)
    expect(onContinue).not.toHaveBeenCalled()
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'Invalid login credentials'
    )
    const submit = container.querySelector<HTMLButtonElement>('button[type="submit"]')
    expect(submit?.disabled).toBe(false)
  })

  it('offers to continue as the signed-in account when a session exists', async () => {
    const api = stubAccountApi(ACCOUNT)
    const onContinue = vi.fn()
    const container = await mountSignIn('', onContinue)
    expect(container.querySelector('form')).toBeNull()
    const primary = container.querySelector<HTMLButtonElement>('.ui-button--primary')
    expect(primary?.textContent).toBe(`Continue as ${ACCOUNT.email}`)
    act(() => {
      primary?.click()
    })
    expect(onContinue).toHaveBeenCalledTimes(1)
    expect(api.signIn).not.toHaveBeenCalled()
  })

  it('signs out and shows the form when using a different account', async () => {
    const api = stubAccountApi(ACCOUNT)
    const container = await mountSignIn('', vi.fn())
    const switchButton = container.querySelector<HTMLButtonElement>('.welcome-skip')
    expect(switchButton).not.toBeNull()
    await act(async () => {
      switchButton?.click()
    })
    expect(api.signOut).toHaveBeenCalledTimes(1)
    expect(container.querySelector('input[type="email"]')).not.toBeNull()
    expect(container.querySelector('input[type="password"]')).not.toBeNull()
  })
})

describe('accountErrorMessage', () => {
  it('unwraps the Electron IPC prefix down to the handler message', () => {
    const wrapped = new Error(
      "Error invoking remote method 'account:sign-in': Error: Invalid login credentials"
    )
    expect(accountErrorMessage(wrapped, 'Sign in failed. Try again.')).toBe(
      'Invalid login credentials'
    )
  })

  it('falls back to the given message for messageless rejections', () => {
    expect(accountErrorMessage(undefined, 'Sign in failed. Try again.')).toBe(
      'Sign in failed. Try again.'
    )
  })
})
