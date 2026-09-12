import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { KeyRound, LockKeyhole, Trash2, X } from 'lucide-react'
import { Modal } from './Modal'
import { changeJournalPassphrase, decryptEntry, encryptEntry } from './crypto'
import type { JournalApi, JournalEntry, JournalKeyring, JournalState } from './JournalApi'

function dateAtTimezone(timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const value = (part: Intl.DateTimeFormatPartTypes): string => {
    const text = parts.find((item) => item.type === part)?.value
    if (text === undefined) throw new Error('Journal date could not be formatted')
    return text
  }
  return `${value('year')}-${value('month')}-${value('day')}`
}
function dateLabel(date: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric', weekday: 'long' }).format(new Date(`${date}T12:00:00Z`))
}
function operationError(error: Error): string {
  return error.name === 'OperationError' ? 'The passphrase could not unlock this Journal, or the encrypted data has changed.' : error.message
}

export function JournalEditor({ api, state, accountId, dataKey, onLock }: {
  api: JournalApi; state: JournalState; accountId: string; dataKey: CryptoKey; onLock: () => void
}): ReactNode {
  const [entries, setEntries] = useState(state.entries)
  const [keyring, setKeyring] = useState<JournalKeyring | null>(state.keyring)
  const [date, setDate] = useState(dateAtTimezone(state.timezone))
  const [text, setText] = useState('')
  const [savedText, setSavedText] = useState('')
  const [selected, setSelected] = useState<JournalEntry | null>(null)
  const [busy, setBusy] = useState(true)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [changingPassphrase, setChangingPassphrase] = useState(false)
  const [currentPassphrase, setCurrentPassphrase] = useState('')
  const [newPassphrase, setNewPassphrase] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const dirty = text !== savedText

  useEffect(() => {
    let cancelled = false
    const entry = state.entries.find((item) => item.date === dateAtTimezone(state.timezone)) ?? null
    const decrypted = entry?.envelope ? decryptEntry(dataKey, accountId, entry.date, entry.revision, entry.envelope) : Promise.resolve('')
    void decrypted.then((value) => { if (!cancelled) { setSelected(entry); setText(value); setSavedText(value); setReady(true); setBusy(false) } }).catch((cause: Error) => { if (!cancelled) { setError(operationError(cause)); setBusy(false) } })
    return (): void => { cancelled = true }
  }, [accountId, dataKey])

  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent): void => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return (): void => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const persist = async (): Promise<void> => {
    if (!dirty) return
    const expected = selected?.revision ?? 0
    const encrypted = await encryptEntry(dataKey, accountId, date, expected + 1, text)
    const committed = await api.saveEntry(date, encrypted, expected)
    setSelected(committed)
    setEntries((current) => [...current.filter((entry) => entry.date !== committed.date), committed])
    setSavedText(text)
  }
  const save = (): void => {
    if (busy) return
    setBusy(true); setError(null)
    void persist().catch((cause: Error) => setError(operationError(cause))).finally(() => setBusy(false))
  }
  const chooseDate = (next: string): void => {
    if (busy || next === '') return
    setBusy(true); setError(null)
    void persist().then(async () => {
      const entry = entries.find((item) => item.date === next) ?? null
      const value = entry?.envelope ? await decryptEntry(dataKey, accountId, next, entry.revision, entry.envelope) : ''
      setSelected(entry); setDate(next); setText(value); setSavedText(value)
    }).catch((cause: Error) => setError(operationError(cause))).finally(() => setBusy(false))
  }
  const lock = (): void => {
    if (busy) return
    setBusy(true); setError(null)
    void persist().then(onLock).catch((cause: Error) => { setError(operationError(cause)); setBusy(false) })
  }
  const remove = (): void => {
    if (selected?.envelope === null || selected === null || busy) return
    setBusy(true); setError(null)
    void api.deleteEntry(date, selected.revision).then((tombstone) => {
      setSelected(tombstone); setEntries((current) => [...current.filter((entry) => entry.date !== date), tombstone]); setText(''); setSavedText(''); setDeleting(false)
    }).catch((cause: Error) => setError(operationError(cause))).finally(() => setBusy(false))
  }
  const changePassphrase = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (keyring === null || busy) return
    if (newPassphrase !== confirmation) { setError('The new passphrases do not match.'); return }
    setBusy(true); setError(null)
    void changeJournalPassphrase(accountId, currentPassphrase, newPassphrase, keyring.envelope)
      .then((envelope) => api.saveKeyring(envelope, keyring.revision))
      .then((saved) => { setKeyring(saved); setCurrentPassphrase(''); setNewPassphrase(''); setConfirmation(''); setChangingPassphrase(false) })
      .catch((cause: Error) => setError(operationError(cause))).finally(() => setBusy(false))
  }

  return <div className="journal-workspace">
    <aside className="journal-days"><div className="journal-days-head"><h2>Your days</h2><input type="date" aria-label="Journal date" value={date} onChange={(event) => chooseDate(event.target.value)} disabled={busy} /></div>
      {[...entries].filter((entry) => entry.envelope !== null).sort((a,b) => b.date.localeCompare(a.date)).map((entry) => <button type="button" className={entry.date === date ? 'is-selected' : ''} key={entry.date} onClick={() => chooseDate(entry.date)} disabled={busy}>{dateLabel(entry.date)}</button>)}
      {entries.every((entry) => entry.envelope === null) ? <p className="muted">Your first day starts here.</p> : null}
    </aside>
    <main className="journal-page"><div className="journal-toolbar"><span className="muted" role="status">{busy ? 'Working…' : dirty ? 'Unsaved changes' : 'Saved'}</span><span className="spacer" /><button type="button" className="icon-button" aria-label="Change Journal passphrase" onClick={() => setChangingPassphrase(true)}><KeyRound size={17} /></button><button type="button" className="button" onClick={lock} disabled={busy}><LockKeyhole size={15} /> Lock</button></div>
      <h1>{dateLabel(date)}</h1>
      {error !== null ? <p className="error" role="alert">{error}</p> : null}
      <textarea className="journal-writing" aria-label="Journal entry" placeholder="A little space for yourself." value={text} onChange={(event) => setText(event.target.value)} spellCheck={false} autoComplete="off" disabled={busy || !ready} />
      <footer className="journal-footer"><button type="button" className="primary button" onClick={save} disabled={busy || !dirty}>Save entry</button><span className="spacer" />{selected?.envelope ? <button type="button" className="danger button" aria-label="Permanently delete this Journal day" onClick={() => setDeleting(true)} disabled={busy}><Trash2 size={15} /> Delete day</button> : null}</footer>
    </main>
    {deleting ? <Modal labelledBy="delete-title" busy={busy} onClose={() => setDeleting(false)}><section className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-title"><h2 id="delete-title">Delete this day permanently?</h2><p>This removes the entry for {dateLabel(date)}. It cannot be restored in Journal.</p><div className="dialog-actions"><button type="button" className="button" onClick={() => setDeleting(false)} disabled={busy}>Cancel</button><button type="button" className="danger button" onClick={remove} disabled={busy}>Delete permanently</button></div></section></Modal> : null}
    {changingPassphrase ? <Modal labelledBy="passphrase-title" busy={busy} onClose={() => { setChangingPassphrase(false); setCurrentPassphrase(''); setNewPassphrase(''); setConfirmation('') }}><form className="dialog" role="dialog" aria-modal="true" aria-labelledby="passphrase-title" onSubmit={changePassphrase}><div className="dialog-head"><h2 id="passphrase-title">Change passphrase</h2><button type="button" className="icon-button" aria-label="Close passphrase settings" disabled={busy} onClick={() => { setChangingPassphrase(false); setCurrentPassphrase(''); setNewPassphrase(''); setConfirmation('') }}><X size={17} /></button></div><p>Keep your new passphrase safe. There is no recovery key.</p><label>Current passphrase<input type="password" value={currentPassphrase} onChange={(event) => setCurrentPassphrase(event.target.value)} autoComplete="current-password" required /></label><label>New passphrase<input type="password" value={newPassphrase} onChange={(event) => setNewPassphrase(event.target.value)} autoComplete="new-password" minLength={16} required /></label><label>Repeat new passphrase<input type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" minLength={16} required /></label>{error !== null ? <p className="error" role="alert">{error}</p> : null}<button type="submit" className="primary button" disabled={busy}>Change passphrase</button></form></Modal> : null}
  </div>
}
