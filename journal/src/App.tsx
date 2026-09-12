import { useEffect, useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { LockKeyhole, Moon, Sun } from 'lucide-react'
import { createJournalKey, unlockJournalKey } from './crypto'
import { JournalApi } from './JournalApi'
import type { JournalState } from './JournalApi'
import { JournalEditor } from './JournalEditor'

function JournalSession({ client, session }: { client: SupabaseClient; session: Session }): ReactNode {
  const api = useMemo(() => new JournalApi(client), [client])
  const [state, setState] = useState<JournalState | null>(null)
  const [dataKey, setDataKey] = useState<CryptoKey | null>(null)
  const [passphrase, setPassphrase] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    void api.load().then((result) => { if (!cancelled) setState(result) }).catch((cause: Error) => { if (!cancelled) setError(cause.message) })
    return (): void => { cancelled = true }
  }, [api])
  const unlock = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (state === null || busy) return
    if (state.keyring === null && passphrase !== confirmation) { setError('The passphrases do not match.'); return }
    setBusy(true); setError(null)
    const opening = state.keyring === null
      ? createJournalKey(session.user.id, passphrase).then(async ({ key, envelope }) => { const keyring = await api.saveKeyring(envelope, 0); setState({ ...state, keyring }); return key })
      : unlockJournalKey(session.user.id, passphrase, state.keyring.envelope)
    void opening.then((key) => { setDataKey(key); setPassphrase(''); setConfirmation('') }).catch((cause: Error) => setError(cause.name === 'OperationError' ? 'The passphrase could not unlock this Journal.' : cause.message)).finally(() => setBusy(false))
  }
  const lock = (): void => { setDataKey(null); setState(null); void api.load().then(setState).catch((cause: Error) => setError(cause.message)) }
  if (dataKey !== null && state !== null) return <JournalEditor key={session.user.id} api={api} state={state} accountId={session.user.id} dataKey={dataKey} onLock={lock} />
  return <main className="journal-gate"><form onSubmit={unlock}><LockKeyhole size={28} /><h1>{state?.keyring === null ? 'A space just for you.' : 'Welcome back.'}</h1><p>{state?.keyring === null ? 'Choose a separate passphrase for your Journal. Only you can unlock what you write.' : 'Enter your Journal passphrase to unlock your days.'}</p>
    {state !== null ? <><label>Journal passphrase<input type="password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} autoComplete={state.keyring === null ? 'new-password' : 'current-password'} minLength={state.keyring === null ? 16 : undefined} required autoFocus /></label>{state.keyring === null ? <><label>Repeat passphrase<input type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" minLength={16} required /></label><p className="privacy-note">There is no recovery key. Losing this passphrase means losing access to your Journal, even if you recover your Google account.</p></> : null}<button type="submit" className="button primary" disabled={busy}>{busy ? 'Unlocking…' : state.keyring === null ? 'Create Journal' : 'Unlock Journal'}</button></> : error === null ? <p role="status">Loading encrypted Journal…</p> : null}
    {error !== null ? <p className="error" role="alert">{error}</p> : null}<p className="privacy-note">Use a private browser window outside Codex and keep screen sharing off.</p><button type="button" className="button" onClick={() => { void client.auth.signOut().then(({ error: cause }) => { if (cause !== null) setError(cause.message) }) }}>Sign out</button>
  </form></main>
}

export function App({ client }: { client: SupabaseClient }): ReactNode {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [dark, setDark] = useState(() => localStorage.getItem('manor-journal-theme') === 'dark' || (localStorage.getItem('manor-journal-theme') === null && matchMedia('(prefers-color-scheme: dark)').matches))
  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; localStorage.setItem('manor-journal-theme', dark ? 'dark' : 'light') }, [dark])
  useEffect(() => {
    let cancelled = false
    void client.auth.getSession().then(({ data, error: cause }) => { if (cancelled) return; if (cause !== null) setError(cause.message); else setSession(data.session) })
    const { data } = client.auth.onAuthStateChange((_event, next) => setSession(next))
    return (): void => { cancelled = true; data.subscription.unsubscribe() }
  }, [client])
  const signIn = (): void => { void client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } }).then(({ error: cause }) => { if (cause !== null) setError(cause.message) }) }
  return <><header className="journal-brand"><img src="/manor-mark.svg" alt="" /><span>Manor <span className="brand-section">Journal</span></span><span className="spacer" /><button type="button" className="icon-button" aria-label={dark ? 'Use light theme' : 'Use dark theme'} onClick={() => setDark(!dark)}>{dark ? <Sun size={18} /> : <Moon size={18} />}</button></header>
    {session ? <JournalSession key={session.user.id} client={client} session={session} /> : <main className="journal-gate"><section><LockKeyhole size={28} /><h1>Your private Journal.</h1><p>Sign in with Google, then unlock with your separate Journal passphrase.</p>{session === undefined ? <p role="status">Checking your session…</p> : <button type="button" className="primary button" onClick={signIn}>Continue with Google</button>}{error !== null ? <p className="error" role="alert">{error}</p> : null}</section></main>}
  </>
}
