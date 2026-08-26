import { Check, ChevronLeft, ChevronRight, Mic } from 'lucide-react'
import type { ReactNode } from 'react'

import type { Focus, Mood, MoodFocusEntry } from '../../../../shared/moodFocus'
import { Button } from '../../components/ui'
import { ScalePicker } from './ScalePicker'
import { focusOptions, moodOptions } from './scales'

export interface DailyCaptureProps {
  dayTitle: string
  dayDate: string
  previousDisabled: boolean
  nextDisabled: boolean
  onPreviousDay: () => void
  onNextDay: () => void
  entry: MoodFocusEntry | null
  saving: boolean
  onMoodChange: (mood: Mood) => void
  onFocusChange: (focus: Focus) => void
  onDebrief: () => void
}

export function DailyCapture({
  dayTitle,
  dayDate,
  previousDisabled,
  nextDisabled,
  onPreviousDay,
  onNextDay,
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
      <header className="mf-capture-head">
        <button
          type="button"
          className="mf-capture-nav"
          aria-label="Previous day"
          disabled={previousDisabled}
          title={previousDisabled ? 'Backfill is limited to one day' : undefined}
          onClick={onPreviousDay}
        >
          <ChevronLeft size={16} />
        </button>
        <div className="mf-capture-daytitle">
          <h2 id="mf-capture-title">{dayTitle}</h2>
          <span>{dayDate}</span>
        </div>
        <button
          type="button"
          className="mf-capture-nav"
          aria-label="Next day"
          disabled={nextDisabled}
          onClick={onNextDay}
        >
          <ChevronRight size={16} />
        </button>
      </header>

      <div className="mf-capture-body">
        <ScalePicker
          id="mood"
          prompt="How was today?"
          kind="mood"
          options={moodOptions}
          value={entry?.mood ?? null}
          onChange={onMoodChange}
        />
        <ScalePicker
          id="focus"
          prompt="How locked in were you?"
          kind="focus"
          options={focusOptions}
          value={entry?.focus ?? null}
          onChange={onFocusChange}
        />
      </div>

      <footer className="mf-capture-footer">
        <span className={`mf-save-state${loggedCount === 2 ? ' is-complete' : ''}`} aria-live="polite">
          {saving ? 'Saving…' : loggedCount === 2 ? <><Check size={13} /> Complete</> : `${loggedCount} of 2`}
        </span>
        <Button variant="subtle" icon={<Mic size={14} />} onClick={onDebrief}>
          Debrief with Alfred
        </Button>
      </footer>
    </section>
  )
}
