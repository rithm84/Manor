import { Flame, Pause, Play } from 'lucide-react'
import type { ReactNode } from 'react'

import { Checkbox, Tooltip } from '../../components/ui'
import { StepMeter } from './StepMeter'
import { WeekStrip } from './WeekStrip'
import type { HabitVM } from './habitModel'

export interface HabitRowProps {
  habit: HabitVM
  selected: boolean
  onToggle: (id: string) => void
  onStep: (id: string, value: number) => void
  onSelect: (id: string) => void
  onPause: (id: string) => void
  onResume: (id: string) => void
}

/** One check-off row: checkbox, name, step meter, week strip, streak. */
export function HabitRow({
  habit,
  selected,
  onToggle,
  onStep,
  onSelect,
  onPause,
  onResume
}: HabitRowProps): ReactNode {
  const atRisk = habit.atRiskTonight && !habit.doneToday && !habit.paused
  const rowClass = [
    'habit-row',
    habit.doneToday ? 'is-done' : '',
    atRisk ? 'is-atrisk' : '',
    habit.gold ? 'is-gold' : '',
    habit.paused ? 'is-paused' : '',
    selected ? 'is-selected' : ''
  ]
    .filter((part) => part !== '')
    .join(' ')

  return (
    <div className={rowClass}>
      {habit.paused ? (
        <span className="habit-row-resthole" aria-hidden="true" />
      ) : (
        <Checkbox
          shape="round"
          checked={habit.doneToday}
          onChange={() => onToggle(habit.id)}
          ariaLabel={`Mark ${habit.name} done`}
        />
      )}

      <button type="button" className="habit-row-name" onClick={() => onSelect(habit.id)}>
        <span className="habit-row-title">{habit.name}</span>
        {habit.paused ? <span className="habit-row-restnote">Resting</span> : null}
      </button>

      <div className="habit-row-middle">
        {habit.quantized !== null && !habit.paused ? (
          <StepMeter
            steps={habit.quantized.steps}
            value={habit.quantized.value}
            targetLabel={habit.quantized.targetLabel}
            onChange={(value) => onStep(habit.id, value)}
          />
        ) : null}
      </div>

      {!habit.paused ? <WeekStrip week={habit.week} /> : null}

      <span className={`habit-row-streak tnum${atRisk ? ' is-amber' : habit.gold ? ' is-gold' : ''}`}>
        <Flame size={15} />
        {habit.streak}
      </span>

      <span className="habit-row-actions">
        {habit.paused ? (
          <Tooltip label="Pick it back up" side="top">
            <button
              type="button"
              className="habit-row-iconbtn"
              aria-label={`Resume ${habit.name}`}
              onClick={() => onResume(habit.id)}
            >
              <Play size={14} />
            </button>
          </Tooltip>
        ) : (
          <Tooltip label="Let it rest a while" side="top">
            <button
              type="button"
              className="habit-row-iconbtn habit-row-iconbtn--hover"
              aria-label={`Pause ${habit.name}`}
              onClick={() => onPause(habit.id)}
            >
              <Pause size={14} />
            </button>
          </Tooltip>
        )}
      </span>
    </div>
  )
}
