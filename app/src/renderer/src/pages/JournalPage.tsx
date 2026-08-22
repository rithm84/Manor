import { useState } from 'react'
import type { ReactNode } from 'react'

import { journal } from '../data/mock'
import { PageShell } from './PageShell'
import { LockedView } from './journal/LockedView'
import { UnlockedView } from './journal/UnlockedView'
import type { JournalEntry } from './journal/journalEntries'
import { journalEntries, todayEntryTemplate } from './journal/journalEntries'
import './journal/journal.css'

const TODAY_ENTRY_ID = 'jr-0820'

/** Journal: locked by default, unlocked only by hand, sealed again on demand. */
export function JournalPage(): ReactNode {
  const [locked, setLocked] = useState(journal.locked)
  const [entries, setEntries] = useState<readonly JournalEntry[]>(journalEntries)
  const [selectedId, setSelectedId] = useState<string | null>(
    journalEntries.length > 0 ? journalEntries[0].id : null
  )

  const editEntry = (entryId: string, text: string): void => {
    setEntries((current) =>
      current.map((entry) => (entry.id === entryId ? { ...entry, text } : entry))
    )
  }

  const newEntry = (): void => {
    const existing = entries.find((entry) => entry.id === TODAY_ENTRY_ID)
    if (existing !== undefined) {
      setSelectedId(existing.id)
      return
    }
    const entry: JournalEntry = {
      id: TODAY_ENTRY_ID,
      dateShort: todayEntryTemplate.dateShort,
      dateLong: todayEntryTemplate.dateLong,
      text: ''
    }
    setEntries((current) => [entry, ...current])
    setSelectedId(entry.id)
  }

  return (
    <PageShell title="Journal" fullBleed={true}>
      {locked ? (
        <LockedView onUnlock={() => setLocked(false)} />
      ) : (
        <UnlockedView
          entries={entries}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onEdit={editEntry}
          onNewEntry={newEntry}
          onLock={() => setLocked(true)}
        />
      )}
    </PageShell>
  )
}
