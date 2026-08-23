import { ChevronRight, Flame, Play } from 'lucide-react'
import type { ReactNode } from 'react'

import { Checkbox, Tooltip } from '../../components/ui'
import { QuantizedHabitControl } from './QuantizedHabitControl'
import { WeekStrip } from './WeekStrip'
import type { HabitViewModel } from './habitModel'

export interface HabitRowProps {
  habit: HabitViewModel
  isToday: boolean
  onLog: (habitId: string, value: 0 | 25 | 50 | 75 | 100) => void
  onOpen: (habitId: string) => void
  onResume: (habitId: string) => void
}

function requiredTargetLabel(habitName: string, targetLabel: string | null): string {
  if (targetLabel === null) {
    throw new Error(`Quantized habit "${habitName}" requires a target label`)
  }

  return targetLabel
}

export function HabitRow({ habit, isToday, onLog, onOpen, onResume }: HabitRowProps): ReactNode {
  const { definition, entry, metrics, selectedStatus } = habit
  const value = entry?.value ?? 0
  const complete = value === 100
  const atRisk = isToday && !complete && metrics.currentStreak > 0 && selectedStatus === 'active'
  const rowClass = [
    'habit-row',
    complete ? 'is-done' : '',
    selectedStatus === 'paused' ? 'is-paused' : ''
  ]
    .filter((part) => part !== '')
    .join(' ')

  return (
    <div className={rowClass} data-testid={`habit-row-${definition.id}`}>
      <span className={`habit-row-completion${metrics.gold ? ' is-gold' : ''}`}>
        {selectedStatus === 'paused' ? (
          <span className="habit-row-resthole" aria-hidden="true" />
        ) : definition.kind === 'binary' ? (
          <Checkbox
            shape="round"
            checked={complete}
            onChange={() => onLog(definition.id, complete ? 0 : 100)}
            ariaLabel={`${complete ? 'Clear' : 'Complete'} ${definition.name}${metrics.gold ? '. Gold streak' : ''}`}
          />
        ) : (
          <QuantizedHabitControl
            gold={metrics.gold}
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
          habitId={definition.id}
          habitName={definition.name}
          onOpen={() => onOpen(definition.id)}
          streak={metrics.currentStreak}
          week={habit.week}
        />
      ) : (
        <span className="habit-row-pausedmeta">
          <span className="habit-row-pausedstreak tnum" aria-label={`${metrics.currentStreak} day streak`}>
            <Flame size={12} aria-hidden="true" />
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
    </div>
  )
}
