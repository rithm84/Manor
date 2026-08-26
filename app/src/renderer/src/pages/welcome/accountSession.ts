import { useEffect, useState } from 'react'

import type { AccountInfo } from '../../../../shared/account'

/**
 * Live Manor account session, shared by the Welcome sign-in step and the
 * Settings Account section. The main process owns the Supabase session;
 * this module only reflects it through `window.manor.account`.
 */

/** Basic shape check (name@host.tld); real verification happens server-side. */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Local pre-flight for the sign-in form. Null when both fields look usable. */
export function validateSignIn(email: string, password: string): string | null {
  if (!EMAIL_PATTERN.test(email.trim())) return 'Enter a valid email address.'
  if (password === '') return 'Enter your password.'
  return null
}

/** Electron wraps IPC rejections; unwrap back to the handler's own message. */
const IPC_ERROR_PREFIX = /^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/

export function accountErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    const message = error.message.replace(IPC_ERROR_PREFIX, '').trim()
    if (message !== '') return message
  }
  return fallback
}

export interface CurrentAccountState {
  /** Undefined while the session lookup is in flight. */
  account: AccountInfo | null | undefined
  setAccount: (account: AccountInfo | null) => void
}

/** Queries the session once on mount; callers update it after sign-in/out. */
export function useCurrentAccount(): CurrentAccountState {
  const [account, setAccount] = useState<AccountInfo | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    void window.manor.account
      .current()
      .then((current) => {
        if (!cancelled) setAccount(current)
      })
      .catch((error: unknown) => {
        console.error('Account session lookup failed', { error })
        if (!cancelled) setAccount(null)
      })
    return (): void => {
      cancelled = true
    }
  }, [])

  return { account, setAccount }
}

export interface SignInFormState {
  busy: boolean
  error: string | null
  clearError: () => void
  submit: (email: string, password: string) => void
}

/** Busy/error plumbing around `account.signIn`; validate fields first. */
export function useSignIn(onSignedIn: (account: AccountInfo) => void): SignInFormState {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = (email: string, password: string): void => {
    setBusy(true)
    setError(null)
    window.manor.account
      .signIn({ email: email.trim(), password })
      .then((account) => {
        setBusy(false)
        onSignedIn(account)
      })
      .catch((cause: unknown) => {
        setBusy(false)
        setError(accountErrorMessage(cause, 'Sign in failed. Try again.'))
      })
  }

  return { busy, error, clearError: () => setError(null), submit }
}
