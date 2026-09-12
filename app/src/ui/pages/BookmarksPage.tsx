import { browserSurfaces } from '../../web/browserTools'
import { useManorService } from '../services/ManorServices'
import { RefreshCw, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { KbEntry } from '../../shared/kb'
import type { XConnectionStatus } from '../../shared/xConnection'
import { Button, Input, Modal } from '../components/ui'
import { CaptureRow } from './bookmarks/CaptureRow'
import { matchesCaptureQuery } from './bookmarks/captures'
import { useCaptures } from './bookmarks/useCaptures'
import './bookmarks/bookmarks.css'

/** The authenticated knowledge base contains only the current account's entries. */
export function BookmarksPage(): ReactNode {
  const xApi = useManorService('x')
  const captures = useCaptures()
  const [query, setQuery] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [removeTarget, setRemoveTarget] = useState<KbEntry | null>(null)
  const [removeBusy, setRemoveBusy] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const [xStatus, setXStatus] = useState<XConnectionStatus | null>(null)
  const [xStatusError, setXStatusError] = useState<string | null>(null)
  const [statusAttempt, setStatusAttempt] = useState(0)
  const [syncBusy, setSyncBusy] = useState(false)
  const [syncNote, setSyncNote] = useState<{ text: string; failed: boolean } | null>(null)

  useEffect(() => {
    let cancelled = false
    setXStatusError(null)
    void xApi.status().then(
      (status) => { if (!cancelled) setXStatus(status) },
      (error: unknown) => { if (!cancelled) setXStatusError(error instanceof Error ? error.message : String(error)) }
    )
    return (): void => { cancelled = true }
  }, [xApi, statusAttempt])

  const entries = captures.state.kind === 'ready' ? captures.state.entries : []
  const trimmed = query.trim().toLowerCase()
  const visible = entries.filter((entry) => matchesCaptureQuery(entry, trimmed))
  const screens = visible.filter((entry) => entry.source === 'capture')
  const xEntries = visible.filter((entry) => entry.source === 'x_bookmark')

  useEffect(() => browserSurfaces.attachModule({
    module: 'bookmarks',
    context: () => ({ ready: captures.state.kind === 'ready', selected_object_id: expandedId, navigation_blocked: removeTarget !== null, filters: { search: query }, presentation: 'inline_expansion' }),
    open: id => {
      const entry = entries.find(candidate => candidate.id === id)
      if (!entry) throw new Error(`Bookmark ${id} is not available in the current account`)
      if (entry.author === null) throw new Error(`Bookmark ${id} has no expandable detail in this interface`)
      if (removeTarget !== null) throw new Error('Close the bookmark removal dialog before opening a bookmark')
      setQuery(''); setExpandedId(id)
    },
    filter: request => {
      if (request.module !== 'bookmarks') throw new TypeError('Bookmarks requires a search query')
      setQuery(request.search)
    }
  }), [captures.state.kind, entries, expandedId, query, removeTarget])

  function closeRemove(): void {
    if (removeBusy) return
    setRemoveTarget(null); setRemoveError(null)
  }
  async function confirmRemove(): Promise<void> {
    if (removeTarget === null || removeBusy) return
    setRemoveBusy(true); setRemoveError(null)
    try { await captures.removeCapture(removeTarget.id); setRemoveTarget(null) }
    catch (error) { setRemoveError(error instanceof Error ? error.message : String(error)) }
    finally { setRemoveBusy(false) }
  }
  async function syncNow(): Promise<void> {
    if (syncBusy) return
    setSyncBusy(true); setSyncNote(null)
    try {
      const { added } = await xApi.ingestNow()
      captures.reload()
      setSyncNote({ text: added === 0 ? 'You are up to date.' : `${added} new ${added === 1 ? 'bookmark' : 'bookmarks'}.`, failed: false })
    } catch (error) {
      setSyncNote({ text: error instanceof Error ? error.message : String(error), failed: true })
    } finally { setSyncBusy(false) }
  }
  function row(entry: KbEntry): ReactNode {
    return <CaptureRow key={entry.id} entry={entry} expanded={expandedId === entry.id}
      onToggle={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
      onRetry={() => { void captures.retryCapture(entry.id) }}
      onRemoveRequest={() => { setRemoveError(null); setRemoveTarget(entry) }} />
  }

  return <div className="bm">
    <header className="bm-header"><div><h1 className="bm-title display">Bookmarks</h1>
      {captures.state.kind === 'ready' ? <span className="bm-meta tnum">{entries.length} saved</span> : null}
    </div></header>
    <div className="bm-toolbar">
      <div className="bm-search"><Input value={query} onChange={setQuery} placeholder="Search saved posts and captures" icon={<Search size={15} />} ariaLabel="Search bookmarks" /></div>
      {trimmed !== '' && captures.state.kind === 'ready' ? <span className="bm-count">{visible.length} {visible.length === 1 ? 'match' : 'matches'}</span> : null}
    </div>
    {captures.state.kind === 'loading' ? <div className="bm-cap-quiet" role="status">Loading bookmarks…</div> : null}
    {captures.state.kind === 'error' ? <div className="bm-cap-fault" role="alert"><span className="bm-cap-fault-text">Your bookmarks did not load. {captures.state.message}</span><Button variant="ghost" onClick={captures.reload}>Try again</Button></div> : null}
    {captures.state.kind === 'ready' ? <>
      {captures.state.notice !== null ? <div className="bm-cap-fault" role="alert"><span>{captures.state.notice}</span><Button variant="ghost" onClick={captures.reload}>Try again</Button></div> : null}
      <section className="bm-section"><h2 className="microlabel bm-section-label">Captures</h2>
        {screens.length > 0 ? <div className="bm-list">{screens.map(row)}</div> : <div className="bm-cap-quiet">{trimmed === '' ? 'Nothing captured yet.' : 'No captures match your search.'}</div>}
      </section>
      <section className="bm-section"><div className="bm-section-head"><h2 className="microlabel bm-section-label">From X</h2>
        {xStatus?.connected ? <button type="button" className={`bm-sync${syncBusy ? ' is-busy' : ''}`} onClick={() => { void syncNow() }} disabled={syncBusy} aria-label="Sync X bookmarks"><RefreshCw size={13} /></button> : null}
        {syncNote !== null ? <span role={syncNote.failed ? 'alert' : 'status'} className={`bm-sync-note${syncNote.failed ? ' is-failed' : ''}`}>{syncNote.text}</span> : null}
      </div>
        {xStatusError !== null ? <div className="bm-cap-fault" role="alert"><span>X connection status could not load. {xStatusError}</span><Button variant="ghost" onClick={() => setStatusAttempt((attempt) => attempt + 1)}>Try again</Button></div> : null}
        {xEntries.length > 0 ? <div className="bm-list">{xEntries.map(row)}</div> : trimmed !== '' ? <div className="bm-none">No X bookmarks match your search.</div>
          : xStatus === null ? xStatusError === null ? <div className="bm-none" role="status">Checking X connection…</div> : null
          : <div className="bm-none">{xStatus.connected ? 'No X bookmarks saved yet.' : 'Connect X in Settings to sync your bookmarks.'}</div>}
      </section>
    </> : null}
    <Modal open={removeTarget !== null} onClose={closeRemove} width={400} ariaLabel="Remove capture">
      <div className="bm-dialog"><h2 className="bm-dialog-title">{removeTarget?.source === 'x_bookmark' ? 'Remove this bookmark?' : 'Remove this capture?'}</h2>
        <p className="bm-dialog-body">It leaves your knowledge base.</p>
        {removeError !== null ? <p className="bm-dialog-error" role="alert">{removeError}</p> : null}
        <div className="bm-dialog-actions"><button type="button" className="bm-dialog-btn" onClick={closeRemove} disabled={removeBusy}>Cancel</button><button type="button" className="bm-dialog-btn is-danger" onClick={() => { void confirmRemove() }} disabled={removeBusy}>Remove</button></div>
      </div>
    </Modal>
  </div>
}
