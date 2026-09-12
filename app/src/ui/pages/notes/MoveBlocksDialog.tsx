import { X } from 'lucide-react'
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { NotePage } from '../../../shared/notes'
import { Modal } from '../../components/ui/Modal'
import { Select } from '../../components/ui/Select'

export function MoveBlocksDialog({ blockIds, pages, onClose, onMove }: {
  blockIds: readonly string[]; pages: readonly NotePage[]; onClose: () => void
  onMove: (blockIds: readonly string[], targetNoteId: string) => Promise<void>
}): ReactNode {
  const [targetId, setTargetId] = useState(pages[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestClose = (): void => {
    if (!busy) onClose()
  }
  return <Modal open={true} onClose={requestClose} width={440} ariaLabel="Move blocks to note">
    <form className="notes-dialog" onSubmit={(event) => {
      event.preventDefault()
      if (busy || targetId === '') return
      setBusy(true)
      setError(null)
      void onMove(blockIds, targetId).then(onClose).catch((failure: unknown) => {
        setError(failure instanceof Error ? failure.message : String(failure))
      }).finally(() => setBusy(false))
    }}><div className="notes-dialog-head"><h2>Move to note</h2><button type="button" aria-label="Close move dialog" disabled={busy} onClick={requestClose}><X size={17} /></button></div>
      {pages.length === 0 ? <p>Create another note to move these blocks.</p> : <label>Destination<Select value={targetId} onChange={setTargetId}
        options={pages.map((page) => ({ value: page.id, label: page.title }))} placeholder="Choose a note" ariaLabel="Move destination" /></label>}
      {error !== null ? <p role="alert" className="note-media-error">{error}</p> : null}
      <div className="notes-dialog-actions"><button type="button" onClick={requestClose} disabled={busy}>Cancel</button><button type="submit" className="is-primary" disabled={busy || targetId === ''}>{busy ? 'Moving…' : 'Move'}</button></div>
    </form>
  </Modal>
}
