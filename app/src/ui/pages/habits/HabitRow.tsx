import { ChevronRight, Play } from 'lucide-react'
import type { ReactNode } from 'react'

import { Checkbox, FreezeCrystal, StreakFlame, Tooltip } from '../../components/ui'
import { QuantizedHabitControl } from './QuantizedHabitControl'
import { WeekStrip } from './WeekStrip'
import type { HabitViewModel } from './habitModel'

export interface HabitRowProps {
  habit: HabitViewModel
  isToday: boolean
  /** Value is a percent on the habit's step ladder; 0 clears the entry. */
  onLog: (habitId: string, value: number) => Promise<void>
  onOpen: (habitId: string) => void
  onResume: (habitId: string) => void
  onFreeze: (habitId: string) => Promise<void>
  onUnfreeze: (habitId: string) => Promise<void>
}

function requiredTargetLabel(habitName: string, targetLabel: string | null): string {
  if (targetLabel === null) {
    throw new Error(`Quantized habit "${habitName}" requires a target label`)
  }

  return targetLabel
}

export function HabitRow({
  habit,
  isToday,
  onLog,
  onOpen,
  onResume,
  onFreeze,
  onUnfreeze
}: HabitRowProps): ReactNode {
  const { definition, entry, metrics, selectedStatus } = habit
  const value = entry?.value ?? 0
  const complete = value === 100
  const atRisk = isToday && !complete && metrics.currentStreak > 0 && selectedStatus === 'active'
  const rowClass = [
    'habit-row',
    complete ? 'is-done' : '',
    habit.frozen ? 'is-frozen' : '',
    selectedStatus === 'paused' ? 'is-paused' : ''
  ]
    .filter((part) => part !== '')
    .join(' ')

  return (
    <div className={rowClass} data-testid={`habit-row-${definition.id}`}>
      <span className="habit-row-completion">
        {selectedStatus === 'paused' ? (
          <span className="habit-row-resthole" aria-hidden="true" />
        ) : definition.kind === 'binary' ? (
          <Checkbox
            shape="round"
            checked={complete}
            onChange={() => void onLog(definition.id, complete ? 0 : 100)}
            ariaLabel={`${complete ? 'Clear' : 'Complete'} ${definition.name}`}
          />
        ) : (
          <QuantizedHabitControl
            habitId={definition.id}
            habitName={definition.name}
            targetLabel={requiredTargetLabel(definition.name, definition.targetLabel)}
            value={value}
            onChange={(nextValue) => onLog(definition.id, nextValue)}
          />
        )}
      </span>

      <button type="button" className="habit-row-name" onClick={() => onOpen(definition.id)}>
        <span className="habit-row-title">{definition.name}</span>
        {selectedStatus === 'paused' ? <span className="habit-row-restnote">Paused</span> : null}
      </button>

      {selectedStatus === 'active' ? (
        <WeekStrip
          atRisk={atRisk}
          gold={metrics.gold}
          habitId={definition.id}
          habitName={definition.name}
          onOpen={() => onOpen(definition.id)}
          streak={metrics.currentStreak}
          week={habit.week}
        />
      ) : (
        <span className="habit-row-pausedmeta">
          <span className="habit-row-pausedstreak tnum" aria-label={`${metrics.currentStreak} day streak`}>
            <StreakFlame size={16} state="ember" />
            {metrics.currentStreak}
          </span>
          {isToday ? (
            <Tooltip label="Resume today" side="top">
              <button
                type="button"
                className="habit-row-iconbtn"
                aria-label={`Resume ${definition.name}`}
                onClick={() => onResume(definition.id)}
              >
                <Play size={14} />
              </button>
            </Tooltip>
          ) : (
            <button
              type="button"
              className="habit-row-iconbtn"
              aria-label={`Open ${definition.name} details`}
              onClick={() => onOpen(definition.id)}
            >
              <ChevronRight size={14} />
            </button>
          )}
        </span>
      )}

      {habit.frozen || habit.canFreeze ? (
        <Tooltip label={habit.frozen ? 'Give the freeze back' : 'Cover this miss with a freeze'} side="top">
          <button
            type="button"
            className={`habit-row-freeze${habit.frozen ? ' is-spent' : ''}`}
            data-testid={`habit-freeze-${definition.id}`}
            aria-label={`${habit.frozen ? 'Return the freeze on' : 'Use a freeze on'} ${definition.name}`}
            aria-pressed={habit.frozen}
            onClick={() => void (habit.frozen ? onUnfreeze(definition.id) : onFreeze(definition.id))}
          >
            <FreezeCrystal size={13} />
            {habit.frozen ? 'Frozen' : 'Freeze'}
          </button>
        </Tooltip>
      ) : null}
    </div>
  )
}
