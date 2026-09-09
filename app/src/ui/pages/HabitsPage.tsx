import { useManorService } from '../services/ManorServices'
import {
  ChevronLeft,
  ChevronRight,
  Flame,
  GripVertical,
  History,
  Info,
  ListChecks,
  Plus
} from 'lucide-react'
import { lazy, Suspense, useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import { addDays, monthKey, statusOn } from '../../shared/habits'
import { playCelebrationChime, playClick } from '../sound/sounds'
import type { HabitDraft, HabitsState } from '../../shared/habits'
import { Button, EmptyState, FreezeCrystal, HandCircle, Modal } from '../components/ui'
import { TODAY_ISO } from '../data/mock'
import { HabitEditorModal } from './habits/AddHabitModal'
import { HabitDetailDialog } from './habits/HabitDetailDialog'
import { HabitRow } from './habits/HabitRow'
import {
  activeOnDate,
  dateLabel,
  draftForHabit,
  fullDateLabel,
  habitViewModel
} from './habits/habitModel'
import './habits/habits.css'

type HabitsView = 'daily' | 'history'

const HabitHistory = lazy(async () => {
  const module = await import('./habits/HabitHistory')
  return { default: module.HabitHistory }
})

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'An unknown habit persistence error occurred'
}

export function HabitsPage(): ReactNode {
  const habitsApi = useManorService('habits')
  const [state, setState] = useState<HabitsState | null>(null)
  const [loading, setLoading] = useState(true)
  const [persistError, setPersistError] = useState<string | null>(null)
  const [view, setView] = useState<HabitsView>('daily')
  const [selectedDate, setSelectedDate] = useState(TODAY_ISO)
  const [historyMonth, setHistoryMonth] = useState(monthKey(TODAY_ISO))
  const [detailMonth, setDetailMonth] = useState(monthKey(TODAY_ISO))
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [peekOpen, setPeekOpen] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editTargetId, setEditTargetId] = useState<string | null>(null)
  const [retireTargetId, setRetireTargetId] = useState<string | null>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [freezeInfoOpen, setFreezeInfoOpen] = useState(false)
  const [reorderArmedId, setReorderArmedId] = useState<string | null>(null)
  const [reorderDragId, setReorderDragId] = useState<string | null>(null)
  const [reorderOverId, setReorderOverId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void habitsApi
      .load()
      .then((loaded) => {
        if (cancelled) {
          return
        }
        setState(loaded)
        setSelectedDate(loaded.today)
        setHistoryMonth(monthKey(loaded.today))
        setDetailMonth(monthKey(loaded.today))
        setLoading(false)
      })
      .catch((error: unknown) => {
        console.error('Habit persistence load failed', { error })
        if (!cancelled) {
          setPersistError(errorMessage(error))
          setLoading(false)
        }
      })
    return (): void => {
      cancelled = true
    }
  }, [])

  const persist = async (
    operation: string,
    mutation: () => Promise<HabitsState>
  ): Promise<HabitsState | null> => {
    try {
      const next = await mutation()
      setState(next)
      setPersistError(null)
      return next
    } catch (error) {
      console.error('Habit persistence operation failed', { operation, error })
      setPersistError(`${operation}: ${errorMessage(error)}`)
      return null
    }
  }

  if (loading) {
    return (
      <div className="habits">
        <header className="habits-header">
          <h1 className="page-title">Habits</h1>
        </header>
        <div className="habits-loading">Loading habits…</div>
      </div>
    )
  }

  if (state === null) {
    return (
      <div className="habits">
        <header className="habits-header">
          <h1 className="page-title">Habits</h1>
        </header>
        <div className="habits-error" role="alert">{persistError ?? 'Habit data could not be loaded.'}</div>
      </div>
    )
  }

  const today = state.today
  const yesterday = addDays(today, -1)
  const active = activeOnDate(state, selectedDate)
  const paused =
    selectedDate === today
      ? state.habits.filter((habit) => statusOn(habit.id, today, state.lifecycle) === 'paused')
      : []
  const archived = state.habits.filter(
    (habit) => statusOn(habit.id, today, state.lifecycle) === 'retired'
  )
  const activeModels = active.map((habit) => habitViewModel(state, habit, selectedDate))
  const pausedModels = paused.map((habit) => habitViewModel(state, habit, selectedDate))
  const completed = activeModels.filter((habit) => habit.entry?.value === 100).length
  const frozenCount = activeModels.filter((habit) => habit.frozen).length
  const remaining = active.length - completed
  // A frozen habit is resolved, not pending, so it never counts as "left";
  // it still keeps the day from being perfect.
  const uncovered = remaining - frozenCount
  const perfect = active.length > 0 && remaining === 0
  const selectedDefinition = state.habits.find((habit) => habit.id === selectedId) ?? null
  const selected =
    selectedDefinition === null ? null : habitViewModel(state, selectedDefinition, selectedDate)
  const currentPool = state.pools.find((pool) => pool.month === monthKey(today)) ?? null
  const editingDefinition = state.habits.find((habit) => habit.id === editTargetId) ?? null

  const openHabit = (habitId: string): void => {
    setSelectedId(habitId)
    setDetailMonth(view === 'history' ? historyMonth : monthKey(selectedDate))
    setPeekOpen(true)
  }

  const saveHabit = async (draft: HabitDraft): Promise<void> => {
    const result =
      editTargetId === null
        ? await persist('Could not create habit', () => habitsApi.createHabit(draft))
        : await persist('Could not update habit', () =>
            habitsApi.updateHabit(editTargetId, draft)
          )
    if (result !== null) {
      setEditorOpen(false)
      setEditTargetId(null)
    }
  }

  /** Move the dragged habit next to the target in the full list order, so
      paused and archived habits keep their relative places. */
  const commitReorder = async (dragId: string, targetId: string): Promise<void> => {
    if (state === null || dragId === targetId) return
    const order = state.habits.map((habit) => habit.id)
    const from = order.indexOf(dragId)
    const to = order.indexOf(targetId)
    if (from === -1 || to === -1) return
    const without = order.filter((id) => id !== dragId)
    const targetIndex = without.indexOf(targetId)
    without.splice(from < to ? targetIndex + 1 : targetIndex, 0, dragId)
    await persist('Could not reorder habits', () => habitsApi.reorder(without))
  }

  const freezeHabit = async (habitId: string): Promise<void> => {
    const saved = await persist('Could not use a freeze', () =>
      habitsApi.applyFreeze({ habitId, date: selectedDate })
    )
    if (saved !== null) {
      playClick()
    }
  }

  const unfreezeHabit = async (habitId: string): Promise<void> => {
    await persist('Could not return the freeze', () =>
      habitsApi.clearFreeze({ habitId, date: selectedDate })
    )
  }

  const setLifecycle = async (habitId: string, status: 'active' | 'paused' | 'retired'): Promise<void> => {
    const result = await persist(`Could not ${status === 'active' ? 'resume' : status} habit`, () =>
      habitsApi.setStatus({ habitId, date: today, status })
    )
    if (result !== null && status === 'retired') {
      setPeekOpen(false)
    }
  }

  const confirmRetire = async (): Promise<void> => {
    if (retireTargetId === null || confirmBusy) {
      return
    }
    setConfirmBusy(true)
    try {
      await setLifecycle(retireTargetId, 'retired')
      setRetireTargetId(null)
    } finally {
      setConfirmBusy(false)
    }
  }

  const habitToRetire = state.habits.find((habit) => habit.id === retireTargetId) ?? null

  return (
    <div className="habits">
      <header className="habits-header">
        <h1 className="page-title">Habits</h1>
        <div className="habits-header-actions">
          <div className="habits-viewtabs" role="tablist" aria-label="Habits view">
            <button
              type="button"
              role="tab"
              aria-selected={view === 'daily'}
              className={view === 'daily' ? 'is-selected' : ''}
              onClick={() => setView('daily')}
            >
              <ListChecks size={14} /> Daily
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'history'}
              className={view === 'history' ? 'is-selected' : ''}
              onClick={() => setView('history')}
            >
              <History size={14} /> History
            </button>
          </div>
          <Button
            variant="primary"
            icon={<Plus size={15} />}
            onClick={() => {
              setEditTargetId(null)
              setEditorOpen(true)
            }}
          >
            New habit
          </Button>
        </div>
      </header>

      {persistError !== null ? <div className="habits-error" role="alert">{persistError}</div> : null}

      {state.habits.length === 0 ? (
        <EmptyState
          icon={<Flame size={20} />}
          title="No habits yet"
          message="Add a habit to start daily tracking."
          action={
            <Button
              variant="primary"
              icon={<Plus size={15} />}
              onClick={() => {
                setEditTargetId(null)
                setEditorOpen(true)
              }}
            >
              New habit
            </Button>
          }
        />
      ) : view === 'history' ? (
        <Suspense fallback={<div className="habits-loading">Loading history…</div>}>
          <HabitHistory
            state={state}
            month={historyMonth}
            onMonthChange={setHistoryMonth}
            onOpenHabit={openHabit}
          />
        </Suspense>
      ) : (
        <>
          <div className="habits-daybar">
            <div>
              <span className="habits-daybar-title">{dateLabel(selectedDate, today)}</span>
              <span className="habits-daybar-date">{fullDateLabel(selectedDate)}</span>
            </div>
            <span className="habits-daynav">
              <button
                type="button"
                aria-label="Previous day"
                title={selectedDate === yesterday ? 'Backfill is limited to one day' : undefined}
                disabled={selectedDate === yesterday}
                onClick={() => setSelectedDate(yesterday)}
              >
                <ChevronLeft size={15} />
              </button>
              <button
                type="button"
                aria-label="Next day"
                disabled={selectedDate === today}
                onClick={() => setSelectedDate(today)}
              >
                <ChevronRight size={15} />
              </button>
            </span>
          </div>

          <div className="habits-main">
            <div className="habits-left">
              <section className="habits-list ui-card">
                {activeModels.map((habit) => (
                  <div
                    key={habit.definition.id}
                    className={`habit-reorder-wrap${
                      reorderOverId === habit.definition.id &&
                      reorderDragId !== null &&
                      reorderDragId !== habit.definition.id
                        ? ' is-dropover'
                        : ''
                    }`}
                    draggable={reorderArmedId === habit.definition.id}
                    onDragStart={(event) => {
                      if (reorderArmedId !== habit.definition.id) {
                        event.preventDefault()
                        return
                      }
                      event.dataTransfer.effectAllowed = 'move'
                      setReorderDragId(habit.definition.id)
                    }}
                    onDragEnd={() => {
                      setReorderArmedId(null)
                      setReorderDragId(null)
                      setReorderOverId(null)
                    }}
                    onDragOver={(event) => {
                      if (reorderDragId === null) return
                      event.preventDefault()
                      setReorderOverId(habit.definition.id)
                    }}
                    onDragLeave={() => {
                      if (reorderOverId === habit.definition.id) setReorderOverId(null)
                    }}
                    onDrop={(event) => {
                      event.preventDefault()
                      if (reorderDragId !== null) {
                        void commitReorder(reorderDragId, habit.definition.id)
                      }
                      setReorderOverId(null)
                    }}
                  >
                    <button
                      type="button"
                      className="habit-reorder-grip"
                      aria-label={`Reorder ${habit.definition.name}`}
                      onPointerDown={() => setReorderArmedId(habit.definition.id)}
                      onPointerUp={() => setReorderArmedId(null)}
                    >
                      <GripVertical size={13} />
                    </button>
                    <HabitRow
                    habit={habit}
                    isToday={selectedDate === today}
                    onLog={async (habitId, value) => {
                      const wasComplete =
                        activeModels.find((model) => model.definition.id === habitId)?.entry?.value === 100
                      if (value === 100 && !wasComplete) {
                        if (selectedDate === today && remaining === 1) playCelebrationChime()
                        else playClick()
                      }
                      await persist('Could not save habit entry', () =>
                        habitsApi.setEntry({ habitId, date: selectedDate, value })
                      )
                    }}
                    onOpen={openHabit}
                    onResume={(habitId) => void setLifecycle(habitId, 'active')}
                    onFreeze={freezeHabit}
                    onUnfreeze={unfreezeHabit}
                    />
                  </div>
                ))}
              </section>

              {pausedModels.length > 0 ? (
                <section className="habits-paused">
                  <span className="habits-paused-label">Paused</span>
                  <div className="habits-list ui-card">
                    {pausedModels.map((habit) => (
                      <HabitRow
                        key={habit.definition.id}
                        habit={habit}
                        isToday
                        onLog={() => Promise.resolve()}
                        onOpen={openHabit}
                        onResume={(habitId) => void setLifecycle(habitId, 'active')}
                        onFreeze={() => Promise.resolve()}
                        onUnfreeze={() => Promise.resolve()}
                      />
                    ))}
                  </div>
                </section>
              ) : null}

              {archived.length > 0 ? (
                <section className="habits-archive">
                  <button
                    type="button"
                    className="habits-archive-toggle"
                    aria-expanded={archiveOpen}
                    onClick={() => setArchiveOpen((open) => !open)}
                  >
                    <ChevronRight size={13} className={archiveOpen ? 'is-open' : ''} />
                    Archived
                    <span className="habits-archive-count tnum">{archived.length}</span>
                  </button>
                  {archiveOpen ? (
                    <div className="habits-archive-list ui-card">
                      {archived.map((habit) => (
                        <div className="habits-archive-row" key={habit.id}>
                          <button
                            type="button"
                            className="habits-archive-name"
                            onClick={() => openHabit(habit.id)}
                          >
                            {habit.name}
                          </button>
                          <Button
                            variant="ghost"
                            onClick={() => void setLifecycle(habit.id, 'active')}
                          >
                            Reactivate
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </section>
              ) : null}
            </div>

            <aside className="habits-rail">
              <div className="habits-status ui-card">
                <div className="habits-progress">
                  <span className="habits-card-label">{dateLabel(selectedDate, today)}</span>
                  <div className="habits-progress-line">
                    <HandCircle active={perfect && selectedDate === today}>
                      <span className="habits-progress-value tnum">
                        {completed}
                        <span className="habits-progress-total"> of {active.length}</span>
                      </span>
                    </HandCircle>
                    {perfect ? (
                      <span className="habits-progress-perfect display">A perfect day.</span>
                    ) : (
                      <span className="habits-progress-note">
                        {uncovered > 0 ? `${uncovered} left.` : `${frozenCount} frozen.`}
                      </span>
                    )}
                  </div>
                  <div className={`habits-progress-bar${perfect ? ' is-perfect' : ''}`}>
                    <div
                      className="habits-progress-fill"
                      style={{ width: `${active.length === 0 ? 0 : (completed / active.length) * 100}%` }}
                    />
                  </div>
                </div>

                <div className="habits-status-divider" />

                <div className="habits-freeze">
                  <div className="habits-freeze-head">
                    <span className="habits-card-label">
                      <FreezeCrystal size={14} /> Freeze pool
                    </span>
                    <span className={`habits-freeze-hint${freezeInfoOpen ? ' is-open' : ''}`}>
                      <button
                        type="button"
                        className="habit-row-iconbtn"
                        aria-label="About streak freezes"
                        aria-expanded={freezeInfoOpen}
                        aria-controls="habits-freeze-pop"
                        onClick={() => setFreezeInfoOpen((open) => !open)}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape' && freezeInfoOpen) {
                            setFreezeInfoOpen(false)
                          }
                        }}
                        onBlur={() => setFreezeInfoOpen(false)}
                      >
                        <Info size={13} />
                      </button>
                      <span className="habits-freeze-pop" id="habits-freeze-pop">
                        <span>Every month starts with a full pool, one freeze per habit.</span>
                        <span>Spend one on a habit you missed yesterday; perfect days earn spent freezes back.</span>
                      </span>
                    </span>
                  </div>
                  <div className="habits-freeze-line">
                    <span className="habits-freeze-value tnum">{currentPool?.balance ?? 0}</span>
                    <span className="habits-freeze-note">
                      of {currentPool?.capacity ?? 0} available this month
                    </span>
                  </div>
                  <div className="habits-freeze-dots" aria-hidden="true">
                    {Array.from({ length: currentPool?.capacity ?? 0 }, (_, index) => (
                      <span
                        key={index}
                        className={`habits-freeze-dot${index < (currentPool?.balance ?? 0) ? ' is-left' : ''}`}
                      />
                    ))}
                  </div>
                </div>
              </div>

            </aside>
          </div>
        </>
      )}

      {selected !== null ? (
        <HabitDetailDialog
          open={peekOpen}
          onClose={() => setPeekOpen(false)}
          state={state}
          habit={selected}
          month={detailMonth}
          onMonthChange={setDetailMonth}
          onEdit={() => {
            setEditTargetId(selected.definition.id)
            setEditorOpen(true)
          }}
          onPause={() => void setLifecycle(selected.definition.id, 'paused')}
          onResume={() => void setLifecycle(selected.definition.id, 'active')}
          onRetire={() => setRetireTargetId(selected.definition.id)}
        />
      ) : null}

      <HabitEditorModal
        open={editorOpen}
        initialDraft={editingDefinition === null ? null : draftForHabit(editingDefinition)}
        onClose={() => {
          setEditorOpen(false)
          setEditTargetId(null)
        }}
        onSave={saveHabit}
      />

      <Modal
        open={habitToRetire !== null}
        onClose={() => setRetireTargetId(null)}
        width={420}
        ariaLabel="Retire habit"
      >
        <div className="habit-confirm">
          <h2>Retire this habit?</h2>
          <p>
            {habitToRetire?.name ?? 'This habit'} moves to your archive and stops appearing in the
            daily list. Its history stays, and you can bring it back any time.
          </p>
          <div className="habit-add-footer">
            <Button variant="ghost" onClick={() => setRetireTargetId(null)} disabled={confirmBusy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void confirmRetire()} disabled={confirmBusy}>
              Retire
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
