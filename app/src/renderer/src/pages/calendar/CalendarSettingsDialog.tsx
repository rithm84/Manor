import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import type { CalendarSettings } from '../../../../shared/calendar'
import { Button, Modal, Select, TimePicker } from '../../components/ui'

const TIME_ZONES = [
  'America/Los_Angeles', 'America/New_York', 'UTC', 'Europe/London',
  'Asia/Kolkata', 'Asia/Tokyo', 'Australia/Sydney'
] as const

export interface CalendarSettingsDialogProps {
  open: boolean
  settings: CalendarSettings
  onClose: () => void
  onSave: (settings: CalendarSettings) => void
}

export function CalendarSettingsDialog({
  open,
  settings,
  onClose,
  onSave
}: CalendarSettingsDialogProps): ReactNode {
  const [draft, setDraft] = useState(settings)
  useEffect(() => {
    if (open) setDraft(settings)
  }, [open, settings])

  return (
    <Modal open={open} onClose={onClose} width={560} ariaLabel="Calendar settings">
      <form className="cal-compact-dialog" onSubmit={(event) => { event.preventDefault(); onSave(draft) }}>
        <header className="cal-dialog-header">
          <div><span className="cal-dialog-eyebrow">Calendar</span><h2>View settings</h2></div>
          <button type="button" className="cal-icon-btn" onClick={onClose} aria-label="Close calendar settings"><X size={16} /></button>
        </header>
        <div className="cal-dialog-body cal-settings-form">
          <label className="cal-field"><span>Week starts</span><Select value={draft.weekStart} options={[{ value: 'monday', label: 'Monday' }, { value: 'sunday', label: 'Sunday' }]} onChange={(weekStart) => setDraft({ ...draft, weekStart: weekStart as CalendarSettings['weekStart'] })} placeholder="Week start" ariaLabel="Week starts" /></label>
          <label className="cal-field"><span>Time format</span><Select value={draft.timeFormat} options={[{ value: '12h', label: '12 hour' }, { value: '24h', label: '24 hour' }]} onChange={(timeFormat) => setDraft({ ...draft, timeFormat: timeFormat as CalendarSettings['timeFormat'] })} placeholder="Time format" ariaLabel="Time format" /></label>
          <div className="cal-field cal-switch-field"><span>Show weekends</span><button type="button" role="switch" aria-checked={draft.showWeekends} className={`cal-switch${draft.showWeekends ? ' is-on' : ''}`} onClick={() => setDraft({ ...draft, showWeekends: !draft.showWeekends })}><span /></button></div>
          <span />
          <label className="cal-field"><span>Working day starts</span><TimePicker value={draft.workingHoursStart} format={draft.timeFormat} onChange={(workingHoursStart) => setDraft({ ...draft, workingHoursStart })} ariaLabel="Working day start time" /></label>
          <label className="cal-field"><span>Working day ends</span><TimePicker value={draft.workingHoursEnd} format={draft.timeFormat} onChange={(workingHoursEnd) => setDraft({ ...draft, workingHoursEnd })} ariaLabel="Working day end time" /></label>
          <label className="cal-field"><span>Primary time zone</span><Select value={draft.primaryTimeZone} options={TIME_ZONES.map((zone) => ({ value: zone, label: zone.replaceAll('_', ' ') }))} onChange={(primaryTimeZone) => setDraft({ ...draft, primaryTimeZone })} placeholder="Primary zone" ariaLabel="Primary time zone" /></label>
          <label className="cal-field"><span>Secondary time zone</span><Select value={draft.secondaryTimeZone ?? 'none'} options={[{ value: 'none', label: 'None' }, ...TIME_ZONES.map((zone) => ({ value: zone, label: zone.replaceAll('_', ' ') }))]} onChange={(secondaryTimeZone) => setDraft({ ...draft, secondaryTimeZone: secondaryTimeZone === 'none' ? null : secondaryTimeZone })} placeholder="None" ariaLabel="Secondary time zone" /></label>
        </div>
        <footer className="cal-dialog-footer"><span /><span className="cal-dialog-actions"><Button variant="ghost" onClick={onClose}>Cancel</Button><button type="submit" className="ui-button ui-button--primary">Save settings</button></span></footer>
      </form>
    </Modal>
  )
}
