import { Check, Mic, Smile } from 'lucide-react'
import { useState } from 'react'
import type { ReactNode } from 'react'

import { Button, EmptyState } from '../components/ui'
import { TODAY_LABEL, moodFocusHistory } from '../data/mock'
import type { Focus, Mood } from '../data/mock'
import { HistoryPanel } from './moodfocus/HistoryPanel'
import { ScalePicker } from './moodfocus/ScalePicker'
import { focusOptions, moodOptions } from './moodfocus/scales'
import './moodfocus/moodfocus.css'

export function MoodFocusPage(): ReactNode {
  const [mood, setMood] = useState<Mood | null>(null)
  const [focus, setFocus] = useState<Focus | null>(null)
  const logged = mood !== null && focus !== null

  return (
    <div className="mf">
      <header className="mf-header">
        <h1 className="page-title">Mood &amp; Focus</h1>
        <span className="mf-date">{TODAY_LABEL}</span>
      </header>

      <div className="mf-main">
        <section className="mf-today ui-card">
          <div className="mf-today-pickers">
            <ScalePicker label="How was today?" options={moodOptions} value={mood} onChange={setMood} />
            <ScalePicker
              label="How was the focus?"
              options={focusOptions}
              value={focus}
              onChange={setFocus}
            />
          </div>
          <div className="mf-today-footer">
            {logged ? (
              <span className="mf-logged">
                <Check size={14} /> Logged for today.
              </span>
            ) : (
              <span className="mf-nudge">One tap each, once a day.</span>
            )}
            <Button variant="ghost" icon={<Mic size={14} />}>
              Talk it through with Alfred
            </Button>
          </div>
        </section>

        <section className="mf-panel ui-card">
          <h2 className="mf-panel-title">The last two weeks</h2>
          {moodFocusHistory.length === 0 ? (
            <EmptyState
              icon={<Smile size={20} />}
              title="Nothing here yet"
              message="Your first two weeks will draw themselves in as you log."
            />
          ) : (
            <HistoryPanel todayMood={mood} todayFocus={focus} />
          )}
        </section>
      </div>
    </div>
  )
}
