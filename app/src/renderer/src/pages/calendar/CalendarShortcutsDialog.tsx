import { X } from 'lucide-react'
import type { ReactNode } from 'react'

import { Kbd, Modal } from '../../components/ui'

const SHORTCUTS = [
  ['⌘ K', 'Command menu'],
  ['T', 'Today'], ['1', 'Day view'], ['2', 'Week view'], ['3', 'Month view'],
  ['N', 'Next period'], ['P', 'Previous period'], ['C', 'Create event'], ['/', 'Search'],
  ['?', 'Keyboard shortcuts'], ['Delete', 'Delete selected event']
] as const

export function CalendarShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }): ReactNode {
  return (
    <Modal open={open} onClose={onClose} width={520} ariaLabel="Calendar keyboard shortcuts">
      <section className="cal-compact-dialog">
        <header className="cal-dialog-header"><div><span className="cal-dialog-eyebrow">Calendar</span><h2>Keyboard shortcuts</h2></div><button type="button" className="cal-icon-btn" onClick={onClose} aria-label="Close shortcuts"><X size={16} /></button></header>
        <div className="cal-shortcuts-list">{SHORTCUTS.map(([key, label]) => <div key={key}><span>{label}</span><Kbd keys={[key]} /></div>)}</div>
      </section>
    </Modal>
  )
}
