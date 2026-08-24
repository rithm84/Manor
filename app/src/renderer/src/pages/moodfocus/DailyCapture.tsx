import { Check, Mic } from 'lucide-react'
import type { ReactNode } from 'react'

import type { Focus, Mood, MoodFocusEntry } from '../../../../shared/moodFocus'
import { Button } from '../../components/ui'
import { ScalePicker } from './ScalePicker'
import { focusOptions, moodOptions } from './scales'

export interface DailyCaptureProps {
  dateLabel: string
  entry: MoodFocusEntry | null
  saving: boolean
  onMoodChange: (mood: Mood) => void
  onFocusChange: (focus: Focus) => void
  onDebrief: () => void
}

export function DailyCapture({
  dateLabel,
  entry,
  saving,
  onMoodChange,
  onFocusChange,
  onDebrief
}: DailyCaptureProps): ReactNode {
  const loggedCount = Number(entry?.mood !== null && entry?.mood !== undefined) +
    Number(entry?.focus !== null && entry?.focus !== undefined)

  return (
    <section className="mf-capture" aria-labelledby="mf-capture-title">
      <div className="mf-capture-head">
        <div>
          <span className="mf-capture-kicker">Check-in</span>
          <h2 id="mf-capture-title">{dateLabel}</h2>
        </div>
        <div className="mf-capture-actions">
          <span className={`mf-save-state${loggedCount === 2 ? ' is-complete' : ''}`} aria-live="polite">
            {saving ? 'Saving…' : loggedCount === 2 ? <><Check size={13} /> Complete</> : `${loggedCount} of 2`}
          </span>
          <Button variant="subtle" icon={<Mic size={14} />} onClick={onDebrief}>
            Debrief with Alfred
          </Button>
        </div>
      </div>

      <div className="mf-capture-body">
        <ScalePicker
          id="mood"
          step="01"
          label="Mood"
          hint="Overall feeling"
          kind="mood"
          options={moodOptions}
          value={entry?.mood ?? null}
          disabled={saving}
          onChange={onMoodChange}
        />
        <ScalePicker
          id="focus"
          step="02"
          label="Focus"
          hint="Attention level"
          kind="focus"
          options={focusOptions}
          value={entry?.focus ?? null}
          disabled={saving}
          onChange={onFocusChange}
        />
      </div>
    </section>
  )
}
