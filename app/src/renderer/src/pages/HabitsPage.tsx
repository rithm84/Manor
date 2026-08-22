import { Flame, Info, Plus, Snowflake } from 'lucide-react'
import { useState } from 'react'
import type { ReactNode } from 'react'

import { Button, EmptyState } from '../components/ui'
import { habits as mockHabits, habitsSummary } from '../data/mock'
import type { Habit } from '../data/mock'
import { AddHabitModal } from './habits/AddHabitModal'
import { HabitDetailCard } from './habits/HabitDetailCard'
import { HabitRow } from './habits/HabitRow'
import type { HabitDraft, HabitVM } from './habits/habitModel'
import './habits/habits.css'

const DEFAULT_SELECTED_ID = 'habit-family'

function initialItems(): readonly HabitVM[] {
  return mockHabits.map((habit) => ({ ...habit, paused: false, cadence: 'Every day' }))
}

function withDone(habit: HabitVM, nowDone: boolean): HabitVM {
  const week: Habit['week'] = [
    habit.week[0],
    habit.week[1],
    nowDone ? 'done' : 'pending',
    habit.week[3],
    habit.week[4],
    habit.week[5],
    habit.week[6]
  ]
  const streak = Math.max(0, habit.streak + (nowDone ? 1 : -1))
  return {
    ...habit,
    doneToday: nowDone,
    streak,
    bestStreak: Math.max(habit.bestStreak, streak),
    week
  }
}

export function HabitsPage(): ReactNode {
  const [items, setItems] = useState<readonly HabitVM[]>(initialItems)
  const [selectedId, setSelectedId] = useState<string>(DEFAULT_SELECTED_ID)
  const [adding, setAdding] = useState(false)

  const active = items.filter((habit) => !habit.paused)
  const paused = items.filter((habit) => habit.paused)
  const doneCount = active.filter((habit) => habit.doneToday).length
  const remaining = active.length - doneCount
  const perfect = active.length > 0 && remaining === 0
  const selected = items.find((habit) => habit.id === selectedId) ?? active[0] ?? null

  const update = (id: string, change: (habit: HabitVM) => HabitVM): void => {
    setItems((previous) => previous.map((habit) => (habit.id === id ? change(habit) : habit)))
  }

  const toggle = (id: string): void => {
    update(id, (habit) => {
      const nowDone = !habit.doneToday
      const next = withDone(habit, nowDone)
      if (next.quantized === null) {
        return next
      }
      return { ...next, quantized: { ...next.quantized, value: nowDone ? 100 : 0 } }
    })
  }

  const step = (id: string, value: number): void => {
    update(id, (habit) => {
      if (habit.quantized === null) {
        return habit
      }
      const nowDone = value === 100
      const base = nowDone !== habit.doneToday ? withDone(habit, nowDone) : habit
      return { ...base, quantized: { ...habit.quantized, value } }
    })
  }

  const addHabit = (draft: HabitDraft): void => {
    const habit: HabitVM = {
      id: `habit-local-${Date.now()}`,
      name: draft.name,
      doneToday: false,
      streak: 0,
      bestStreak: 0,
      gold: false,
      atRiskTonight: false,
      week: ['future', 'future', 'pending', 'future', 'future', 'future', 'future'],
      quantized:
        draft.kind === 'steps'
          ? { steps: [0, 25, 50, 75, 100], value: 0, targetLabel: draft.targetLabel }
          : null,
      paused: false,
      cadence: draft.cadence
    }
    setItems((previous) => [...previous, habit])
    setAdding(false)
  }

  const rowHandlers = {
    onToggle: toggle,
    onStep: step,
    onSelect: setSelectedId,
    onPause: (id: string): void => update(id, (h) => ({ ...h, paused: true })),
    onResume: (id: string): void => update(id, (h) => ({ ...h, paused: false }))
  }

  return (
    <div className="habits">
      <header className="habits-header">
        <h1 className="page-title">Habits</h1>
        <Button variant="primary" icon={<Plus size={15} />} onClick={() => setAdding(true)}>
          New habit
        </Button>
      </header>

      {items.length === 0 ? (
        <EmptyState
          icon={<Flame size={20} />}
          title="No habits yet"
          message="Start small. One habit tonight is enough."
          action={
            <Button variant="primary" icon={<Plus size={15} />} onClick={() => setAdding(true)}>
              New habit
            </Button>
          }
        />
      ) : (
        <div className="habits-main">
          <div className="habits-left">
            <section className="habits-list ui-card">
              {active.map((habit) => (
                <HabitRow
                  key={habit.id}
                  habit={habit}
                  selected={selected !== null && selected.id === habit.id}
                  {...rowHandlers}
                />
              ))}
            </section>

            {paused.length > 0 ? (
              <section className="habits-paused">
                <span className="habits-paused-label">Resting</span>
                <div className="habits-list ui-card">
                  {paused.map((habit) => (
                    <HabitRow
                      key={habit.id}
                      habit={habit}
                      selected={selected !== null && selected.id === habit.id}
                      {...rowHandlers}
                    />
                  ))}
                </div>
              </section>
            ) : null}
          </div>

          <aside className="habits-rail">
            <div className="habits-status ui-card">
              <div className="habits-progress">
                <span className="habits-card-label">Today</span>
                <div className="habits-progress-line">
                  <span className="habits-progress-value tnum">
                    {doneCount}
                    <span className="habits-progress-total"> of {active.length}</span>
                  </span>
                  {perfect ? (
                    <span className="habits-progress-perfect display">A perfect day.</span>
                  ) : (
                    <span className="habits-progress-note">
                      {remaining === 1 ? 'One left. The evening is yours.' : `${remaining} left tonight.`}
                    </span>
                  )}
                </div>
                <div className={`habits-progress-bar${perfect ? ' is-perfect' : ''}`}>
                  <div
                    className="habits-progress-fill"
                    style={{ width: `${active.length === 0 ? 0 : (doneCount / active.length) * 100}%` }}
                  />
                </div>
              </div>

              <div className="habits-status-divider" />

              <div className="habits-freeze">
                <div className="habits-freeze-head">
                  <span className="habits-card-label">
                    <Snowflake size={13} /> Streak freezes
                  </span>
                  <span className="habits-freeze-hint">
                    <button type="button" className="habit-row-iconbtn" aria-label="About streaks">
                      <Info size={13} />
                    </button>
                    <span className="habits-freeze-pop">
                      <span>{habitsSummary.goldRule}</span>
                      <span>{habitsSummary.earnBackRule}</span>
                    </span>
                  </span>
                </div>
                <div className="habits-freeze-line">
                  <span className="habits-freeze-value tnum">{habitsSummary.freezesLeft}</span>
                  <span className="habits-freeze-note">
                    of {habitsSummary.freezesPerMonth} left in {habitsSummary.freezeMonthLabel}
                  </span>
                </div>
                <div className="habits-freeze-dots" aria-hidden="true">
                  {Array.from({ length: habitsSummary.freezesPerMonth }, (_, index) => (
                    <span
                      key={index}
                      className={`habits-freeze-dot${index < habitsSummary.freezesLeft ? ' is-left' : ''}`}
                    />
                  ))}
                </div>
              </div>
            </div>

            {selected !== null ? <HabitDetailCard habit={selected} /> : null}
          </aside>
        </div>
      )}

      <AddHabitModal open={adding} onClose={() => setAdding(false)} onAdd={addHabit} />
    </div>
  )
}
