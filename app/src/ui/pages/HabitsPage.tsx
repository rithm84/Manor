import { Popover } from '@base-ui/react/popover'
import { useCommitVersion } from '../services/useCommitVersion'
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
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { addDays, monthKey, statusOn } from '../../shared/habits'
import { playClick, playCompletionTick } from '../sound/sounds'
import type { HabitDraft, HabitsState } from '../../shared/habits'
import { useCreateShortcut } from '../app/shortcuts'
import { Button, EmptyState, FreezeCrystal, Modal, Toast, ViewTabs } from '../components/ui'
import { useDevicePreference } from '../preferences/devicePreference'
import { useAccountTimezone } from '../../web/accountContext'
import { dateInTimezone } from '../../shared/timezone'
import { HabitEditorModal } from './habits/AddHabitModal'
import { HabitDetailDialog } from './habits/HabitDetailDialog'
import { HabitRow } from './habits/HabitRow'
import { overlayPendingEntries, pendingEntryKey } from './habits/pendingEntries'
import type { PendingEntry } from './habits/pendingEntries'
import {
  activeOnDate,
  dateLabel,
  draftForHabit,
  fullDateLabel,
  habitViewModel,
  reorderedHabitIds
} from './habits/habitModel'
import { useArmedGrip } from './habits/useArmedGrip'
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
  const commitVersion = useCommitVersion()
  const habitsApi = useManorService('habits')
  const [state, setState] = useState<HabitsState | null>(null)
  const [loading, setLoading] = useState(true)
  const [persistError, setPersistError] = useState<string | null>(null)
  const [view, setView] = useDevicePreference<HabitsView>('habits.view', ['daily', 'history'], 'daily')
  const timezone = useAccountTimezone()
  const [initialDate] = useState(() => dateInTimezone(new Date(), timezone))
  const [selectedDate, setSelectedDate] = useState(initialDate)
  const [historyMonth, setHistoryMonth] = useState(monthKey(initialDate))
  const [detailMonth, setDetailMonth] = useState(monthKey(initialDate))
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [peekOpen, setPeekOpen] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editTargetId, setEditTargetId] = useState<string | null>(null)
  const [retireTargetId, setRetireTargetId] = useState<string | null>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [reorderArmedId, setReorderArmedId] = useArmedGrip()
  const [reorderDragId, setReorderDragId] = useState<string | null>(null)
  const [reorderOverId, setReorderOverId] = useState<string | null>(null)

  const [toast, setToast] = useState<{ message: string; action: { label: string; onSelect: () => void } | null } | null>(null)
  const dismissToast = useCallback((): void => setToast(null), [])

  const createFromKeyboard = useCallback((): void => {
    setEditTargetId(null)
    setEditorOpen(true)
  }, [])
  useCreateShortcut(loading ? null : createFromKeyboard)

  /** Check-offs the user has made that no server round trip has confirmed yet.
      The service serializes the commands; these keep the page from letting an
      earlier command's result outrank a later click. */
  const pendingEntries = useRef<Map<string, PendingEntry>>(new Map())
  const clickSequence = useRef(0)

  useEffect(() => {
    let cancelled = false
    void habitsApi
      .load()
      .then((loaded) => {
        if (cancelled) {
          return
        }
        setState(overlayPendingEntries(loaded, pendingEntries.current))
        if (state === null) {
          setSelectedDate(loaded.today)
          setHistoryMonth(monthKey(loaded.today))
        }
        if (state === null) setDetailMonth(monthKey(loaded.today))
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
  }, [habitsApi, commitVersion])

  const persist = async (
    operation: string,
    mutation: () => Promise<HabitsState>
  ): Promise<HabitsState | null> => {
    try {
      const next = await mutation()
      setState(overlayPendingEntries(next, pendingEntries.current))
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
  const commitOrder = async (order: readonly string[]): Promise<void> => {
    if (state === null) return
    // The habit lands where it was dropped; the committed order replaces it, or the old order returns on failure.
    const before = state
    const byId = new Map(state.habits.map((habit) => [habit.id, habit]))
    setState({ ...state, habits: order.flatMap((id) => { const habit = byId.get(id); return habit === undefined ? [] : [habit] }) })
    if (await persist('Could not reorder habits', () => habitsApi.reorder([...order])) === null) setState(before)
  }

  const commitReorder = async (dragId: string, targetId: string): Promise<void> => {
    if (state === null) return
    const order = reorderedHabitIds(state.habits.map((habit) => habit.id), dragId, targetId)
    if (order !== null) await commitOrder(order)
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
    if (result === null) return
    const name = result.habits.find((habit) => habit.id === habitId)?.name ?? 'Habit'
    if (status === 'retired') {
      setPeekOpen(false)
      // Retiring is reversible while the toast is up: the same-day reactivation leaves no gap.
      setToast({ message: `${name} moved to the archive`, action: { label: 'Undo', onSelect: () => { setToast(null); void setLifecycle(habitId, 'active') } } })
    } else if (status === 'paused') {
      setToast({ message: `${name} paused`, action: { label: 'Undo', onSelect: () => { setToast(null); void setLifecycle(habitId, 'active') } } })
    } else {
      setToast(null)
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
          <ViewTabs
            label="Habits view"
            value={view}
            onChange={setView}
            tabs={[
              { value: 'daily', label: 'Daily', icon: <ListChecks size={14} /> },
              { value: 'history', label: 'History', icon: <History size={14} /> }
            ]}
          />
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
            onReorder={(order) => { void commitOrder(order) }}
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
              {activeModels.length > 0 ? <section className="habits-list ui-card">
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
                        playCompletionTick()
                      }
                      // The check-off shows at once; streaks and the pool settle on the committed state.
                      const before = state
                      const key = pendingEntryKey(habitId, selectedDate)
                      clickSequence.current += 1
                      const sequence = clickSequence.current
                      pendingEntries.current.set(key, { sequence, habitId, date: selectedDate, value, stamp: new Date().toISOString() })
                      setState((current) => current === null
                        ? current
                        : overlayPendingEntries(current, pendingEntries.current))
                      const saved = await persist('Could not save habit entry', () =>
                        habitsApi.setEntry({ habitId, date: selectedDate, value })
                      )
                      // A later click on the same box owns the outcome from here.
                      const latest = pendingEntries.current.get(key)?.sequence === sequence
                      if (!latest) return
                      pendingEntries.current.delete(key)
                      if (saved === null) {
                        // Only this box goes back; the streaks and pool that other results brought in stay.
                        const prior = before?.entries.find((entry) => entry.habitId === habitId && entry.date === selectedDate)
                        setState((current) => current === null ? current : { ...current, entries: [
                          ...current.entries.filter((entry) => !(entry.habitId === habitId && entry.date === selectedDate)),
                          ...(prior === undefined ? [] : [prior])
                        ] })
                      }
                    }}
                    onOpen={openHabit}
                    onResume={(habitId) => void setLifecycle(habitId, 'active')}
                    onFreeze={freezeHabit}
                    onUnfreeze={unfreezeHabit}
                    />
                  </div>
                ))}
              </section> : <p className="habits-empty-day">No active habits for this day.</p>}

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
                {activeModels.length > 0 ? (
                  <>
                    <div className="habits-progress">
                      <span className="habits-card-label">{dateLabel(selectedDate, today)}</span>
                      <div className="habits-progress-line">
                        <span className={perfect && selectedDate === today ? 'habit-perfect-complete' : undefined}>
                          <span className="habits-progress-value tnum">
                            {completed}
                            <span className="habits-progress-total"> of {active.length}</span>
                          </span>
                        </span>
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
                  </>
                ) : null}

                <div className="habits-freeze">
                  <div className="habits-freeze-head">
                    <span className="habits-card-label">
                      <FreezeCrystal size={14} /> Freeze pool
                    </span>
                    <Popover.Root>
                      <Popover.Trigger className="habit-row-iconbtn" aria-label="About streak freezes"><Info size={14} /></Popover.Trigger>
                      <Popover.Portal>
                        <Popover.Positioner className="ui-popover-positioner" align="end" sideOffset={6} collisionPadding={12}>
                          <Popover.Popup className="habits-freeze-pop" aria-label="About streak freezes">
                            <strong>Keep a streak going</strong>
                            <p>One freeze covers one habit missed yesterday. Checking it off later returns the freeze.</p>
                            <p>Perfect days replenish the pool. Each month starts full, with one freeze per active habit.</p>
                          </Popover.Popup>
                        </Popover.Positioner>
                      </Popover.Portal>
                    </Popover.Root>
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
            setPeekOpen(false)
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

      {toast !== null ? <Toast message={toast.message} action={toast.action} duration={6000} onDismiss={dismissToast} /> : null}

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
