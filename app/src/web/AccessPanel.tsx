import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ManorLogo } from '../ui/components/brand/ManorLogo'
import { requestSignup, signInWithGoogle } from './auth'
import './access.css'

export function AccessPanel({ client }: { client: SupabaseClient }): ReactNode {
  const [creating, setCreating] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(() => new URLSearchParams(location.search).get('error_description'))

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const request = creating ? requestSignup(client, email, password) : signInWithGoogle(client)
    void request.catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : 'Sign-in failed. Please try again.')
      setBusy(false)
    })
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
      </form>
      <button type="button" className="access-switch" disabled={busy} onClick={() => { setCreating(!creating); setPassword(''); setError(null) }}>
        {creating ? 'Already have an account? Sign in' : 'New here? Create an account'}
      </button>
    </section>
  </main>
}
