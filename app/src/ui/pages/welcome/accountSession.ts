import { useManorService } from '../../services/ManorServices'
import { useEffect, useState } from 'react'

import type { AccountInfo } from '../../../shared/account'

/** Account UI state backed by injected services. */

/** Supabase's own wording, rewritten in product voice. */
const FRIENDLY_MESSAGES: readonly { pattern: RegExp; message: string }[] = [
  { pattern: /invalid login credentials/i, message: 'That email and password do not match.' },
  { pattern: /email not confirmed/i, message: 'Confirm your email address, then sign in.' },
  { pattern: /rate limit|too many requests/i, message: 'Too many tries. Wait a minute and retry.' },
  { pattern: /fetch failed|network|ENOTFOUND|ETIMEDOUT/i, message: 'Manor could not reach the server. Check your connection.' }
]

export function accountErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback
  let message = error.message
  message = message.trim()
  if (message === '') return fallback
  for (const friendly of FRIENDLY_MESSAGES) {
    if (friendly.pattern.test(message)) return friendly.message
  }
  // Handler messages read "Sign in failed for you@example.com: reason".
  const detail = message.match(/^[^:]*failed for [^:]+:\s*(.+)$/)
  if (detail !== null) {
    for (const friendly of FRIENDLY_MESSAGES) {
      if (friendly.pattern.test(detail[1])) return friendly.message
    }
    return fallback
  }
  return message
}

export interface CurrentAccountState {
  /** Undefined while the session lookup is in flight. */
  account: AccountInfo | null | undefined
  setAccount: (account: AccountInfo | null) => void
}

/** Queries the session once on mount; callers update it after sign-in/out. */
export function useCurrentAccount(): CurrentAccountState {
  const accountApi = useManorService('account')
  const [account, setAccount] = useState<AccountInfo | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    void accountApi
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

export interface AvatarState {
  /** Signed display URL; null while unset or signed out. */
  url: string | null
  setUrl: (url: string | null) => void
}

/** Queries the profile picture once the session is known to exist. */
export function useAvatar(signedIn: boolean): AvatarState {
  const accountApi = useManorService('account')
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!signedIn) {
      setUrl(null)
      return
    }
    let cancelled = false
    void accountApi
      .avatarUrl()
      .then((signedUrl) => {
        if (!cancelled) setUrl(signedUrl)
      })
      .catch((error: unknown) => {
        console.error('Profile picture lookup failed', { error })
      })
    return (): void => {
      cancelled = true
    }
  }, [signedIn])

  return { url, setUrl }
}
