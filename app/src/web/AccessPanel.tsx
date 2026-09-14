import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ManorLogo } from '../ui/components/brand/ManorLogo'
import { requestSignup, signInWithGoogle } from './auth'
import type { DesktopShell } from './shell/DesktopShell'
import './access.css'

export function AccessPanel({ client, shell, signInError }: { client: SupabaseClient; shell: DesktopShell; signInError: string | null }): ReactNode {
  const [creating, setCreating] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [inBrowser, setInBrowser] = useState(false)
  const [error, setError] = useState<string | null>(signInError)

  // A callback that came back refused ends the attempt it belongs to, so the panel can be used again.
  useEffect(() => {
    setError(signInError)
    if (signInError !== null) setInBrowser(false)
  }, [signInError])

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setInBrowser(false)
    const request = creating ? requestSignup(client, shell, email, password) : signInWithGoogle(client, shell)
    // Once the browser has the authorization page the panel waits for the callback, and a closed tab can be retried here.
    void request.then(() => setInBrowser(true)).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : 'Sign-in failed. Please try again.')
    }).finally(() => setBusy(false))
  }

  return <main className="access-page">
    <ManorLogo className="access-brand" />
    <section className="access-content">
      <p className="access-eyebrow">A little more room for your day</p>
      <h1>{creating ? 'Make yourself at home.' : 'Welcome to Manor.'}</h1>
      <p className="access-description">Your plans, notes, and daily perspective. Together in one place.</p>
      <form className="access-form" onSubmit={submit}>
        {creating && <>
          <label htmlFor="signup-email">Google email address</label>
          <input id="signup-email" type="email" required autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} />
          <label htmlFor="signup-password">Invitation password</label>
          <input id="signup-password" type="password" required autoComplete="off" value={password} onChange={event => setPassword(event.target.value)} />
          <p className="access-hint">Use the same Google account in the next step.</p>
        </>}
        <button type="submit" className="ui-button ui-button--primary access-submit" disabled={busy} data-testid="google-sign-in">
          {busy ? 'Connecting…' : 'Continue with Google'}
        </button>
        {error && <p role="alert" className="access-error">{error}</p>}
        {inBrowser && error === null && <p role="status" className="access-hint">Finish signing in with Google in your browser. Manor opens again when you are done.</p>}
      </form>
      <button type="button" className="access-switch" disabled={busy} onClick={() => { setCreating(!creating); setPassword(''); setError(null) }}>
        {creating ? 'Already have an account? Sign in' : 'New here? Create an account'}
      </button>
    </section>
  </main>
}
