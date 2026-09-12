import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import type { ReactNode } from 'react'
import { Tooltip } from '../../components/ui'

interface NotesPaneToggleProps {
  collapsed: boolean
  panelId: string
  label: string
  onToggle: () => void
}

export function NotesPaneToggle({ collapsed, panelId, label, onToggle }: NotesPaneToggleProps): ReactNode {
  const action = `${collapsed ? 'Show' : 'Hide'} ${label}`
  return <Tooltip label={action} side="bottom">
    <button type="button" className="notes-icon-button notes-pane-toggle" aria-label={action}
      aria-controls={panelId} aria-expanded={!collapsed} data-testid={`toggle-${panelId}`} onClick={onToggle}>
      {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
    </button>
  </Tooltip>
}
