import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Check, History, X } from 'lucide-react'
import type { NotePage, NoteSuggestion, NoteVersion, NoteConflict } from '../../../shared/notes'
import { useManorService } from '../../services/ManorServices'
import { Modal } from '../../components/ui/Modal'
import { NoteReadOnlyPreview } from './NoteReadOnlyPreview'
import { formatNoteTime } from './notesModel'

/** Version restoration and optional suggestions always use persisted service outcomes. */
export function NoteReviewDialog({ mode, page, onClose, beforeChange, onApplied }: {
  mode: 'versions' | 'suggestions' | 'conflict' | null
  page: NotePage | null
  onClose: () => void
  beforeChange: () => Promise<boolean>
  onApplied: (page: NotePage) => void
}): ReactNode {
  const api = useManorService('notes')
  const [conflict, setConflict] = useState<NoteConflict | null>(null)
  const [versions, setVersions] = useState<readonly NoteVersion[]>([])
  const [suggestions, setSuggestions] = useState<readonly NoteSuggestion[]>([])
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (mode === null || page === null) return
    let active = true
    setLoading(true)
    setError(null)
    setSelectedVersion(null)
    const request = mode === 'conflict'
      ? api.readConflict(page.id).then((result) => { if (active) setConflict(result) })
      : mode === 'versions'
      ? api.listVersions(page.id).then((result) => { if (active) { setVersions(result); setSelectedVersion(result[0]?.id ?? null) } })
      : api.listSuggestions(page.id).then((result) => { if (active) setSuggestions(result) })
    void request.catch((failure: unknown) => { if (active) setError(failure instanceof Error ? failure.message : String(failure)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [api, mode, page?.id])

  const apply = async (action: () => Promise<NotePage>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      if (mode !== 'conflict' && !(await beforeChange())) return
      const saved = await action()
      onApplied(saved)
      if (mode === 'suggestions') setSuggestions(await api.listSuggestions(saved.id))
      else onClose()
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false) }
  }
  const pending = suggestions.filter((suggestion) => suggestion.status === 'pending')
  const version = versions.find((candidate) => candidate.id === selectedVersion)
  const review = (ids: readonly string[], decision: 'accepted' | 'rejected'): void => {
    if (page !== null) void apply(() => api.reviewSuggestions({ noteId: page.id, suggestionIds: ids, decision }))
  }

  return <Modal open={mode !== null && page !== null} onClose={onClose} width={820} ariaLabel={mode === 'versions' ? 'Version history' : mode === 'conflict' ? 'Resolve conflicting edits' : 'Suggestions'}>
    <div className="notes-dialog note-review-dialog">
      <div className="notes-dialog-head"><h2>{mode === 'versions' ? 'Version history' : mode === 'conflict' ? 'Resolve conflicting edits' : 'Suggestions'}</h2><button type="button" aria-label="Close review" onClick={onClose}><X size={17} /></button></div>
      {error !== null ? <p role="alert" className="note-media-error">{error}</p> : null}
      {loading ? <p>Loading…</p> : mode === 'conflict' ? <>
        <p>The cloud note changed while you were editing. Compare both versions. Saving yours keeps the current cloud version in history.</p>
        {conflict !== null ? <div className="note-suggestion-diff"><section><h4>Cloud version</h4><NoteReadOnlyPreview contentJson={conflict.current.contentJson} /></section><section><h4>Your draft</h4><NoteReadOnlyPreview contentJson={conflict.local.contentJson} /></section></div> : null}
        <div className="notes-dialog-actions"><button type="button" onClick={onClose}>Keep editing</button><button type="button" className="is-primary" disabled={busy || conflict === null} onClick={() => { if (conflict !== null) void apply(() => api.resolveConflict(conflict)) }}>Save my version</button></div>
      </> : mode === 'versions' ? <>
        <p>Versions are kept for seven days. Restoring creates a new version.</p>
        {versions.length === 0 ? <p>No earlier versions yet.</p> : <div className="note-version-layout">
          <div className="note-version-list" aria-label="Saved versions">{versions.map((item) => <button type="button" key={item.id}
            aria-pressed={item.id === selectedVersion} onClick={() => setSelectedVersion(item.id)}>
            <History size={14} /><span>{formatNoteTime(item.createdAt)}<small>Version {item.revision}</small></span>
          </button>)}</div>
          {version !== undefined ? <div className="note-version-preview"><h3>{version.title}</h3><NoteReadOnlyPreview contentJson={version.contentJson} /></div> : null}
        </div>}
        <div className="notes-dialog-actions"><button type="button" onClick={onClose}>Close</button><button type="button" className="is-primary" disabled={busy || version === undefined} onClick={() => {
          if (version !== undefined && page !== null) void apply(() => api.restoreVersion({ noteId: page.id, versionId: version.id }))
        }}>{busy ? 'Restoring…' : 'Restore version'}</button></div>
      </> : <>
        {pending.length === 0 ? <p>No suggestions to review.</p> : <>
          <div className="note-review-bulk"><span>{pending.length} pending</span><button type="button" disabled={busy} onClick={() => review(pending.map((item) => item.id), 'rejected')}>Reject all</button><button type="button" disabled={busy} onClick={() => review(pending.map((item) => item.id), 'accepted')}>Accept all</button></div>
          <div className="note-suggestion-list">{pending.map((item) => <article className="note-suggestion" key={item.id}>
            <h3>{item.summary}</h3>
            <div className="note-suggestion-diff"><section><h4>Current</h4><NoteReadOnlyPreview contentJson={item.beforeContentJson} /></section><section><h4>Suggested</h4><NoteReadOnlyPreview contentJson={item.afterContentJson} /></section></div>
            <div className="notes-dialog-actions"><button type="button" disabled={busy} aria-label={`Reject ${item.summary}`} onClick={() => review([item.id], 'rejected')}><X size={14} />Reject</button><button type="button" className="is-primary" disabled={busy} aria-label={`Accept ${item.summary}`} onClick={() => review([item.id], 'accepted')}><Check size={14} />Accept</button></div>
          </article>)}</div>
        </>}
      </>}
    </div>
  </Modal>
}
