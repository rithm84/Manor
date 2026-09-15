import { Minus, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import { LONG_BREAK_EVERY_LIMIT, POMODORO_MINUTES_LIMIT } from '../../../shared/pomodoro'
import type { PomodoroSettings } from '../../../shared/pomodoro'
import { Button, DetailDialog } from '../../components/ui'

export interface TimerPreferencesDialogProps {
  open: boolean
  settings: PomodoroSettings
  busy: boolean
  onClose: () => void
  onSave: (patch: Partial<PomodoroSettings>) => Promise<boolean>
}

type NumberKey = 'focusMinutes' | 'shortBreakMinutes' | 'longBreakMinutes' | 'longBreakEvery'

function Stepper({ value, min, max, step, unit, ariaLabel, onChange }: { value: number; min: number; max: number; step: number; unit: string; ariaLabel: string; onChange: (value: number) => void }): ReactNode {
  const clamp = (next: number): number => Math.min(max, Math.max(min, next))
  return (
    <span className="pomo-stepper" role="group" aria-label={ariaLabel}>
      <button type="button" aria-label={`Decrease ${ariaLabel.toLowerCase()}`} disabled={value <= min} onClick={() => onChange(clamp(value - step))}><Minus size={14} /></button>
      <span className="tnum" aria-live="polite">{value}<span className="pomo-stepper-unit"> {unit}</span></span>
      <button type="button" aria-label={`Increase ${ariaLabel.toLowerCase()}`} disabled={value >= max} onClick={() => onChange(clamp(value + step))}><Plus size={14} /></button>
    </span>
  )
}

function Toggle({ checked, ariaLabel, onChange }: { checked: boolean; ariaLabel: string; onChange: (checked: boolean) => void }): ReactNode {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={ariaLabel} className={`pomo-toggle${checked ? ' is-on' : ''}`} onClick={() => onChange(!checked)}>
      <span className="pomo-toggle-knob" />
    </button>
  )
}

function Row({ label, description, children }: { label: string; description: string; children: ReactNode }): ReactNode {
  return (
    <div className="pomo-pref-row">
      <div className="pomo-pref-copy">
        <span className="pomo-pref-label">{label}</span>
        <span className="pomo-pref-desc">{description}</span>
      </div>
      <div className="pomo-pref-control">{children}</div>
    </div>
  )
}

export function TimerPreferencesDialog({ open, settings, busy, onClose, onSave }: TimerPreferencesDialogProps): ReactNode {
  const [draft, setDraft] = useState<PomodoroSettings>(settings)
  useEffect(() => { if (open) setDraft(settings) }, [open, settings])

  const patch = (Object.keys(draft) as (keyof PomodoroSettings)[]).reduce<Partial<PomodoroSettings>>((changes, key) => {
    if (draft[key] !== settings[key]) return { ...changes, [key]: draft[key] }
    return changes
  }, {})
  const dirty = Object.keys(patch).length > 0
  const setNumber = (key: NumberKey) => (value: number): void => setDraft((current) => ({ ...current, [key]: value }))

  const save = async (): Promise<void> => {
    if (!dirty) { onClose(); return }
    if (await onSave(patch)) onClose()
  }

  return (
    <DetailDialog open={open} onClose={onClose} title="Timer preferences" width={480} ariaLabel="Timer preferences">
      <div className="pomo-prefs">
        <Row label="Focus" description="How long each focus session runs.">
          <Stepper value={draft.focusMinutes} min={1} max={POMODORO_MINUTES_LIMIT} step={5} unit="min" ariaLabel="Focus length" onChange={setNumber('focusMinutes')} />
        </Row>
        <Row label="Short break" description="The break after most focus sessions.">
          <Stepper value={draft.shortBreakMinutes} min={1} max={POMODORO_MINUTES_LIMIT} step={1} unit="min" ariaLabel="Short break length" onChange={setNumber('shortBreakMinutes')} />
        </Row>
        <Row label="Long break" description="The longer break that closes a cycle.">
          <Stepper value={draft.longBreakMinutes} min={1} max={POMODORO_MINUTES_LIMIT} step={5} unit="min" ariaLabel="Long break length" onChange={setNumber('longBreakMinutes')} />
        </Row>
        <Row label="Cycle" description="Focus sessions before a long break.">
          <Stepper value={draft.longBreakEvery} min={1} max={LONG_BREAK_EVERY_LIMIT} step={1} unit={draft.longBreakEvery === 1 ? 'session' : 'sessions'} ariaLabel="Sessions per cycle" onChange={setNumber('longBreakEvery')} />
        </Row>
        <Row label="Start breaks automatically" description="A finished focus session flows straight into its break.">
          <Toggle checked={draft.autoStartBreaks} ariaLabel="Start breaks automatically" onChange={(checked) => setDraft((current) => ({ ...current, autoStartBreaks: checked }))} />
        </Row>
        <Row label="Start focus automatically" description="A finished break flows straight into the next focus session.">
          <Toggle checked={draft.autoStartFocus} ariaLabel="Start focus automatically" onChange={(checked) => setDraft((current) => ({ ...current, autoStartFocus: checked }))} />
        </Row>
        <p className="pomo-pref-note">Changes apply to sessions you start from now on.</p>
        <footer className="pomo-pref-footer">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={() => void save()} disabled={busy || !dirty} testId="pomodoro-save-preferences">Save</Button>
        </footer>
      </div>
    </DetailDialog>
  )
}
