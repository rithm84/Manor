import { useManorService } from '../services/ManorServices'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors
} from '@dnd-kit/core'
import type { CollisionDetection, DragEndEvent, DragMoveEvent, DragStartEvent } from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { CheckCircle2, Copy, LayoutGrid, List, PanelRightOpen, Plus, RotateCcw, Sunrise, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { Button, EmptyState, QuickActionsMenu } from '../components/ui'
import type { QuickActionItem, QuickActionPoint } from '../components/ui'
import { events as demoEvents, user } from '../data/mock'
import { useCurrentAccount } from './welcome/accountSession'
import type {
  ContextDefinition,
  ContextDraft,
  ScratchBlock,
  Task,
  TaskBucket
} from '../data/mock'
import type { SavedTaskView } from '../../shared/home'
import { playClick, playCompletionTick } from '../sound/sounds'
import { KanbanBoard } from './home/KanbanBoard'
import { MasterTaskTable } from './home/MasterTaskTable'
import { ScratchBlockDialog } from './home/ScratchBlockDialog'
import { TaskCardPreview } from './home/TaskCard'
import { TaskCreateDialog } from './home/TaskCreateDialog'
import { TaskDetailDialog } from './home/TaskDetailDialog'
import { AXIS_START_MIN, HOUR_PX, TodayPanel } from './home/TodayPanel'
import type { ScheduleDay, TimelineDropPreview } from './home/TodayPanel'
import {
  addDays,
  blockMinutesFor,
  bucketForDue,
  canDropTaskOnBucket,
  defaultPortion,
  dueForTaskCreation,
  dueForBucket,
  findFreeStart,
  formatDayLabel,
  formatLongDayLabel,
  localTime,
  localTodayIso,
  minutesToTime,
  scratchExpiry,
  timeToMinutes
} from './home/taskModel'
import type { DraftTask } from './home/taskModel'
import './home/home.css'

const COMPLETE_FADE_MS = 480
const UNDO_WINDOW_MS = 10_000
const DROP_NOTICE_MS = 4_000
type HomeView = 'weekly' | 'master'

/** The one undoable action inside the Cmd+Z window; `task` is the snapshot
    to restore (previous status for completions, full row for deletes). */
type UndoRecord =
  | { kind: 'complete'; task: Task }
  | { kind: 'delete'; task: Task }

interface TaskQuickTarget {
  taskId: string
  point: QuickActionPoint
}

const homeCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args)
  return pointerCollisions.length > 0 ? pointerCollisions : closestCenter(args)
}

function greetingFor(time: string): string {
  const hour = Math.floor(timeToMinutes(time) / 60)
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'An unknown persistence error occurred'
}

export function HomePage(): ReactNode {
  const homeApi = useManorService('home')
  const [now, setNow] = useState<Date>(() => new Date())
  const today = localTodayIso(now)
  const nowTime = localTime(now)
  // The mock persona's name greets only the signed-out showroom; accounts
  // have no display name, so signed-in greetings stand alone.
  const { account } = useCurrentAccount()
  const greetingName = account === null ? user.name : null
  const [tasks, setTasks] = useState<readonly Task[]>([])
  const [contexts, setContexts] = useState<readonly ContextDefinition[]>([])
  const [scratchBlocks, setScratchBlocks] = useState<readonly ScratchBlock[]>([])
  const [savedViews, setSavedViews] = useState<readonly SavedTaskView[]>([])
  const [loading, setLoading] = useState(true)
  const [persistError, setPersistError] = useState<string | null>(null)
  const [view, setView] = useState<HomeView>('weekly')
  const [scheduleDay, setScheduleDay] = useState<ScheduleDay>('today')
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  /* A landed drop suppresses the overlay's return-home animation (the card is
     already in its new column); cancels and misses still settle back. */
  const [dropLanded, setDropLanded] = useState(false)
  const [dropPreview, setDropPreview] = useState<TimelineDropPreview | null>(null)
  const [completingIds, setCompletingIds] = useState<ReadonlySet<string>>(new Set())
  const [composerBucket, setComposerBucket] = useState<TaskBucket | null>(null)
  const [peekId, setPeekId] = useState<string | null>(null)
  const [peekOpen, setPeekOpen] = useState(false)
  const [dueAttention, setDueAttention] = useState(false)
  const [blockPeekId, setBlockPeekId] = useState<string | null>(null)
  const [blockPeekOpen, setBlockPeekOpen] = useState(false)
  const [quickTarget, setQuickTarget] = useState<TaskQuickTarget | null>(null)
  const [undoHintVisible, setUndoHintVisible] = useState(false)
  /** Transient validation feedback for a rejected timeline drop; never a
      persistence error, so it clears itself. */
  const [dropNotice, setDropNotice] = useState<string | null>(null)
  const dropNoticeTimer = useRef<number | null>(null)
  const undoRecord = useRef<UndoRecord | null>(null)
  const undoTimer = useRef<number | null>(null)
  const completeTimers = useRef<Map<string, number>>(new Map())
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  useEffect(() => {
    const clock = window.setInterval(() => setNow(new Date()), 60_000)
    return (): void => window.clearInterval(clock)
  }, [])

  useEffect(() => {
    let cancelled = false
    void homeApi
      .load()
      .then((state) => {
        if (cancelled) return
        setTasks(state.tasks)
        setContexts(state.contexts)
        setScratchBlocks(state.scratchBlocks)
        setSavedViews(state.savedTaskViews)
        setLoading(false)
      })
      .catch((error: unknown) => {
        console.error('Home persistence load failed', { error })
        if (!cancelled) {
          setPersistError(errorMessage(error))
          setLoading(false)
        }
      })
    return (): void => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const timers = completeTimers.current
    return (): void => {
      timers.forEach((timer) => window.clearTimeout(timer))
      timers.clear()
      if (undoTimer.current !== null) {
        window.clearTimeout(undoTimer.current)
        undoTimer.current = null
      }
      if (dropNoticeTimer.current !== null) {
        window.clearTimeout(dropNoticeTimer.current)
        dropNoticeTimer.current = null
      }
    }
  }, [])

  const showDropNotice = (message: string): void => {
    if (dropNoticeTimer.current !== null) window.clearTimeout(dropNoticeTimer.current)
    setDropNotice(message)
    dropNoticeTimer.current = window.setTimeout(() => {
      dropNoticeTimer.current = null
      setDropNotice(null)
    }, DROP_NOTICE_MS)
  }

  const clearUndo = (): void => {
    if (undoTimer.current !== null) {
      window.clearTimeout(undoTimer.current)
      undoTimer.current = null
    }
    undoRecord.current = null
    setUndoHintVisible(false)
  }

  const recordUndo = (record: UndoRecord): void => {
    if (undoTimer.current !== null) window.clearTimeout(undoTimer.current)
    undoRecord.current = record
    // Completions are too frequent to hint; Cmd+Z still covers them.
    setUndoHintVisible(record.kind === 'delete')
    undoTimer.current = window.setTimeout(() => {
      undoTimer.current = null
      undoRecord.current = null
      setUndoHintVisible(false)
    }, UNDO_WINDOW_MS)
  }

  const reportPersistenceError = (operation: string, error: unknown): void => {
    console.error('Home persistence operation failed', { operation, error })
    setPersistError(`${operation}: ${errorMessage(error)}`)
  }

  const updateTask = async (updated: Task): Promise<void> => {
    try {
      const persisted = await homeApi.upsertTask(updated)
      setTasks((current) => current.map((task) => (task.id === persisted.id ? persisted : task)))
      setPersistError(null)
    } catch (error) {
      reportPersistenceError('Could not save task', error)
      throw error
    }
  }

  const removeContext = async (name: string): Promise<void> => {
    // The store refuses while tasks still use the context or it is the last
    // one; the picker shows that refusal inline.
    await homeApi.deleteContext(name)
    setContexts((current) =>
      current.filter((candidate) => candidate.name.toLocaleLowerCase() !== name.toLocaleLowerCase())
    )
  }

  const addContext = async (context: ContextDraft): Promise<ContextDefinition> => {
    try {
      const persisted = await homeApi.addContext(context)
      setContexts((current) =>
        current.some(
          (candidate) => candidate.name.toLocaleLowerCase() === persisted.name.toLocaleLowerCase()
        )
          ? current
          : [...current, persisted].sort((left, right) => left.name.localeCompare(right.name))
      )
      setPersistError(null)
      return persisted
    } catch (error) {
      reportPersistenceError('Could not add context', error)
      throw error
    }
  }

  /** Rename cascades in the store, so tasks re-read from the returned state. */
  const updateContext = async (originalName: string, context: ContextDraft): Promise<ContextDefinition> => {
    try {
      const persisted = await homeApi.updateContext(originalName, context)
      const state = await homeApi.load()
      setContexts(state.contexts)
      setTasks(state.tasks)
      setPersistError(null)
      return persisted
    } catch (error) {
      reportPersistenceError('Could not save context', error)
      throw error
    }
  }

  const createTask = async (bucket: TaskBucket, draft: DraftTask): Promise<void> => {
    if (draft.context === null) {
      throw new Error('Choose a Context before creating this task')
    }
    const task: Task = {
      id: crypto.randomUUID(),
      title: draft.title,
      context: draft.context,
      estimateMinutes: draft.estimateMinutes,
      priority: draft.priority,
      status: 'Not started',
      due: dueForTaskCreation(bucket, today, draft.due),
      tags: [],
      recurrence: null
    }
    // Creation failures propagate so the dialog can show them inside itself;
    // the page banner would sit behind the dialog scrim.
    const persisted = await homeApi.upsertTask(task)
    setTasks((current) => [...current, persisted])
    setComposerBucket(null)
    setPersistError(null)
  }

  const duplicateTask = async (source: Task): Promise<void> => {
    const copy: Task = {
      ...source,
      id: crypto.randomUUID(),
      title: `${source.title} copy`,
      status: 'Not started',
      tags: [...source.tags]
    }
    try {
      const persisted = await homeApi.upsertTask(copy)
      setTasks((current) => [...current, persisted])
      setPersistError(null)
    } catch (error) {
      reportPersistenceError('Could not duplicate task', error)
    }
  }

  const removeCompleting = (taskId: string): void => {
    setCompletingIds((current) => {
      const next = new Set(current)
      next.delete(taskId)
      return next
    })
  }

  /** Takes the task snapshot to complete so callers with pending edits
      (the detail dialog's title) persist them in the same upsert. */
  const completeTask = async (task: Task): Promise<void> => {
    setPeekOpen(false)
    // Persist right away; the timer only decides when the faded card leaves
    // the board, so an unmount mid-fade cannot lose the completion.
    setCompletingIds((current) => new Set(current).add(task.id))
    const timer = window.setTimeout(() => {
      completeTimers.current.delete(task.id)
      removeCompleting(task.id)
    }, COMPLETE_FADE_MS)
    completeTimers.current.set(task.id, timer)
    try {
      await updateTask({ ...task, status: 'Done' })
      playCompletionTick()
      recordUndo({ kind: 'complete', task })
    } catch {
      // updateTask already surfaced the error; keep the card in place.
      window.clearTimeout(timer)
      completeTimers.current.delete(task.id)
      removeCompleting(task.id)
    }
  }

  const toggleComplete = (taskId: string): void => {
    const pending = completeTimers.current.get(taskId)
    if (pending !== undefined) {
      window.clearTimeout(pending)
      completeTimers.current.delete(taskId)
      removeCompleting(taskId)
      // The un-tick already reverts this completion; its undo record is stale.
      if (undoRecord.current?.kind === 'complete' && undoRecord.current.task.id === taskId) {
        clearUndo()
      }
      const task = tasks.find((candidate) => candidate.id === taskId)
      if (task !== undefined) {
        void updateTask({ ...task, status: 'Not started' })
      }
      return
    }
    const task = tasks.find((candidate) => candidate.id === taskId)
    if (task === undefined) throw new Error(`Cannot complete missing task ${taskId}`)
    void completeTask(task)
  }

  const deleteTask = async (taskId: string): Promise<void> => {
    const snapshot = tasks.find((task) => task.id === taskId) ?? null
    try {
      await homeApi.deleteTask(taskId)
      setPeekOpen(false)
      setTasks((current) => current.filter((task) => task.id !== taskId))
      setScratchBlocks((current) => current.filter((block) => block.taskId !== taskId))
      setPersistError(null)
      // Delete cascades the task's scratch blocks; undo restores the task only.
      if (snapshot !== null) recordUndo({ kind: 'delete', task: snapshot })
    } catch (error) {
      reportPersistenceError('Could not delete task', error)
      throw error
    }
  }

  const performUndo = async (): Promise<void> => {
    const record = undoRecord.current
    if (record === null) return
    clearUndo()
    if (record.kind === 'complete') {
      const pending = completeTimers.current.get(record.task.id)
      if (pending !== undefined) {
        window.clearTimeout(pending)
        completeTimers.current.delete(record.task.id)
      }
      removeCompleting(record.task.id)
      try {
        await updateTask(record.task)
      } catch {
        // updateTask already surfaced the error.
      }
      return
    }
    try {
      const persisted = await homeApi.upsertTask(record.task)
      setTasks((current) => [...current, persisted])
      setPersistError(null)
    } catch (error) {
      reportPersistenceError('Could not restore task', error)
    }
  }

  const upsertScratchBlock = async (block: ScratchBlock): Promise<void> => {
    try {
      const persisted = await homeApi.upsertScratchBlock(block)
      setScratchBlocks((current) => {
        const exists = current.some((candidate) => candidate.id === persisted.id)
        return exists
          ? current.map((candidate) => (candidate.id === persisted.id ? persisted : candidate))
          : [...current, persisted]
      })
      setPersistError(null)
    } catch (error) {
      reportPersistenceError('Could not save time block', error)
      throw error
    }
  }

  const deleteScratchBlock = async (blockId: string): Promise<void> => {
    try {
      await homeApi.deleteScratchBlock(blockId)
      setBlockPeekOpen(false)
      setScratchBlocks((current) => current.filter((block) => block.id !== blockId))
      setPersistError(null)
    } catch (error) {
      reportPersistenceError('Could not delete time block', error)
      throw error
    }
  }

  const saveTaskView = async (savedView: SavedTaskView): Promise<void> => {
    try {
      const persisted = await homeApi.upsertSavedTaskView(savedView)
      setSavedViews((current) => {
        const withoutCurrent = current.filter((candidate) => candidate.id !== persisted.id)
        return [persisted, ...withoutCurrent]
      })
      setPersistError(null)
    } catch (error) {
      reportPersistenceError('Could not save view', error)
      throw error
    }
  }

  const deleteTaskView = async (viewId: string): Promise<void> => {
    try {
      await homeApi.deleteSavedTaskView(viewId)
      setSavedViews((current) => current.filter((candidate) => candidate.id !== viewId))
      setPersistError(null)
    } catch (error) {
      reportPersistenceError('Could not delete view', error)
      throw error
    }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return
      if (event.key.toLowerCase() !== 'z') return
      if (undoRecord.current === null) return
      const target = event.target
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return
      }
      // Leave the shortcut alone while any modal or dialog is up.
      if (document.querySelector('.ui-overlay') !== null) return
      event.preventDefault()
      void performUndo()
    }
    window.addEventListener('keydown', onKeyDown)
    return (): void => window.removeEventListener('keydown', onKeyDown)
    // performUndo and its helpers only touch refs and stable setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openTask = (taskId: string): void => {
    setPeekId(taskId)
    setDueAttention(false)
    setPeekOpen(true)
  }

  const openTaskCreation = (bucket: TaskBucket, trigger: HTMLElement): void => {
    if (bucket === 'overdue') throw new RangeError('Overdue does not support task creation')
    trigger.focus()
    setComposerBucket(bucket)
  }

  const openQuickActions = (taskId: string, point: QuickActionPoint): void => {
    setQuickTarget({ taskId, point })
  }

  const createScratchBlock = async (task: Task, date: string, start: string): Promise<void> => {
    const minutes = blockMinutesFor(task.estimateMinutes)
    const end = minutesToTime(timeToMinutes(start) + minutes)
    const block: ScratchBlock = {
      id: crypto.randomUUID(),
      taskId: task.id,
      date,
      start,
      end,
      portion: defaultPortion(minutes, task.estimateMinutes),
      createdAt: new Date().toISOString(),
      expiresAt: scratchExpiry(date, end)
    }
    // The drag set date, time, and task; the block needs no follow-up dialog.
    await upsertScratchBlock(block)
  }

  const timelinePreviewFor = (
    event: DragMoveEvent | DragEndEvent,
    task: Task
  ): TimelineDropPreview | null => {
    if (event.over?.data.current?.type !== 'timeline') return null
    const date = event.over.data.current.date
    if (typeof date !== 'string') throw new Error('Timeline drop target is missing its date')
    const translated = event.active.rect.current.translated ?? event.active.rect.current.initial
    if (translated === null) throw new Error('Drag position was unavailable')
    const center = translated.top + translated.height / 2
    const relative = center - event.over.rect.top
    const requested = Math.max(
      AXIS_START_MIN,
      Math.round((AXIS_START_MIN + (relative / HOUR_PX) * 60) / 15) * 15
    )
    const minutes = blockMinutesFor(task.estimateMinutes)
    try {
      const start = findFreeStart(
        date,
        minutes,
        requested,
        scratchBlocks,
        account === null ? demoEvents : []
      )
      return { start, end: minutesToTime(timeToMinutes(start) + minutes), title: task.title, error: null }
    } catch (error) {
      if (!(error instanceof RangeError)) throw error
      return { start: null, end: null, title: task.title, error: 'No open slot before midnight fits this task.' }
    }
  }

  const onDragStart = (event: DragStartEvent): void => {
    const taskId = event.active.data.current?.taskId
    setActiveTaskId(typeof taskId === 'string' ? taskId : null)
    setDropPreview(null)
    setDropLanded(false)
  }

  const onDragMove = (event: DragMoveEvent): void => {
    const taskId = event.active.data.current?.taskId
    if (typeof taskId !== 'string') return
    const task = tasks.find((candidate) => candidate.id === taskId)
    if (task === undefined) return
    setDropPreview(timelinePreviewFor(event, task))
  }

  const onDragEnd = (event: DragEndEvent): void => {
    setActiveTaskId(null)
    setDropPreview(null)
    const taskId = event.active.data.current?.taskId
    const sourceBucket = event.active.data.current?.sourceBucket
    const targetType = event.over?.data.current?.type
    if (typeof taskId !== 'string' || event.over === null) return
    const task = tasks.find((candidate) => candidate.id === taskId)
    if (task === undefined) {
      setPersistError(`Dragged task ${taskId} no longer exists.`)
      return
    }

    if (targetType === 'timeline') {
      const date = event.over.data.current?.date
      const preview = timelinePreviewFor(event, task)
      if (typeof date !== 'string' || preview === null || preview.error !== null) {
        // Transient validation, not a save failure; it clears itself.
        showDropNotice(preview?.error ?? 'Could not place this time block.')
        return
      }
      setDropLanded(true)
      playClick()
      void createScratchBlock(task, date, preview.start).catch((error: unknown) => {
        reportPersistenceError('Could not create time block', error)
      })
      return
    }

    if (targetType !== 'bucket' || typeof sourceBucket !== 'string') return
    const targetBucket = event.over.data.current?.targetBucket
    if (targetBucket !== 'today' && targetBucket !== 'tomorrow' && targetBucket !== 'week') return
    if (!canDropTaskOnBucket(sourceBucket as TaskBucket, targetBucket)) return
    if (targetBucket === 'week') {
      setPeekId(taskId)
      setDueAttention(true)
      setPeekOpen(true)
      return
    }
    setDropLanded(true)
    playClick()
    void updateTask({ ...task, due: dueForBucket(targetBucket, today) })
  }

  // Done tasks stay on the board while their completion fade plays out.
  const boardTasks = tasks.filter(
    (task) =>
      (task.status !== 'Done' || completingIds.has(task.id)) &&
      bucketForDue(task.due, today) !== null
  )
  const peekTask = peekId === null ? null : tasks.find((task) => task.id === peekId) ?? null
  const blockPeek = blockPeekId === null
    ? null
    : scratchBlocks.find((block) => block.id === blockPeekId) ?? null
  const blockPeekTask = blockPeek === null
    ? null
    : tasks.find((task) => task.id === blockPeek.taskId) ?? null
  const todayLabel = formatLongDayLabel(today)
  const scheduleDate = scheduleDay === 'today' ? today : addDays(today, 1)
  const scheduleDateLabel = formatDayLabel(scheduleDate)
  const activeTask = activeTaskId === null ? null : tasks.find((task) => task.id === activeTaskId) ?? null
  const dragSourceBucket = activeTask === null ? null : bucketForDue(activeTask.due, today)
  const quickTask = quickTarget === null
    ? null
    : tasks.find((task) => task.id === quickTarget.taskId) ?? null
  const quickItems: readonly QuickActionItem[] = quickTask === null
    ? []
    : [
        {
          id: 'open',
          label: 'Open details',
          icon: <PanelRightOpen size={15} />,
          tone: 'default',
          onSelect: () => openTask(quickTask.id)
        },
        quickTask.status === 'Done'
          ? {
              id: 'reopen',
              label: 'Mark not started',
              icon: <RotateCcw size={15} />,
              tone: 'default',
              onSelect: () => void updateTask({ ...quickTask, status: 'Not started' })
            }
          : {
              id: 'complete',
              label: 'Mark complete',
              icon: <CheckCircle2 size={15} />,
              tone: 'default',
              onSelect: () => toggleComplete(quickTask.id)
            },
        {
          id: 'duplicate',
          label: 'Duplicate',
          icon: <Copy size={15} />,
          tone: 'default',
          onSelect: () => void duplicateTask(quickTask)
        },
        {
          id: 'delete',
          label: 'Delete task',
          icon: <Trash2 size={15} />,
          tone: 'danger',
          onSelect: () => void deleteTask(quickTask.id).catch(() => undefined)
        }
      ]

  if (loading) {
    return <div className="home-loading">Loading tasks…</div>
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={homeCollisionDetection}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragCancel={() => {
        setActiveTaskId(null)
        setDropPreview(null)
      }}
      onDragEnd={onDragEnd}
    >
      <div className={`home${view === 'weekly' ? ' is-weekly' : ''}`}>
        <header className="home-header">
          <div className="home-heading">
            <h1 className="home-greeting display">
              {greetingFor(nowTime)}
              {greetingName === null ? '.' : `, ${greetingName}.`}
            </h1>
            <span className="home-date">{todayLabel}</span>
          </div>
          <div className="home-header-side">
            <div className="home-view-toggle" role="group" aria-label="Task view">
              <button type="button" className={view === 'weekly' ? 'is-active' : ''} onClick={() => setView('weekly')}>
                <LayoutGrid size={14} /> Weekly
              </button>
              <button type="button" className={view === 'master' ? 'is-active' : ''} onClick={() => setView('master')}>
                <List size={14} /> Master
              </button>
            </div>
            <Button
              variant="primary"
              icon={<Plus size={16} />}
              onClick={(event) => openTaskCreation('today', event.currentTarget)}
            >
              New task
            </Button>
          </div>
        </header>

        {persistError !== null ? (
          <div className="home-error" role="alert">
            <span>{persistError}</span>
            <button type="button" onClick={() => setPersistError(null)}>Dismiss</button>
          </div>
        ) : null}

        <div className="home-main">
          {view === 'weekly' ? (
            boardTasks.length > 0 ? (
              <KanbanBoard
                tasks={boardTasks}
                contexts={contexts}
                today={today}
                completingIds={completingIds}
                dragSourceBucket={dragSourceBucket}
                onOpenComposer={openTaskCreation}
                onOpenTask={openTask}
                onQuickActions={openQuickActions}
                onToggleComplete={toggleComplete}
              />
            ) : (
              <div className="home-empty">
                <EmptyState
                  icon={<Sunrise size={20} />}
                  title="No tasks on this board"
                  message="Create a task for today, tomorrow, or this week."
                  action={(
                    <Button
                      variant="primary"
                      icon={<Plus size={16} />}
                      onClick={(event) => openTaskCreation('today', event.currentTarget)}
                    >
                      New task
                    </Button>
                  )}
                />
              </div>
            )
          ) : (
            <MasterTaskTable
              tasks={tasks}
              contexts={contexts}
              today={today}
              savedViews={savedViews}
              onOpenTask={openTask}
              onQuickActions={openQuickActions}
              onSaveView={saveTaskView}
              onDeleteView={deleteTaskView}
            />
          )}

          <TodayPanel
            tasks={tasks}
            scratchBlocks={scratchBlocks}
            date={scheduleDate}
            dateLabel={scheduleDateLabel}
            day={scheduleDay}
            nowTime={nowTime}
            dropPreview={dropPreview}
            onDayChange={setScheduleDay}
            onOpenTask={openTask}
            onOpenScratchBlock={(blockId) => {
              setBlockPeekId(blockId)
              setBlockPeekOpen(true)
            }}
            onMoveScratchBlock={(blockId, start, end) => {
              const block = scratchBlocks.find((candidate) => candidate.id === blockId)
              if (block === undefined) throw new Error(`Cannot move missing scratch block ${blockId}`)
              void upsertScratchBlock({ ...block, start, end, expiresAt: scratchExpiry(block.date, end) })
            }}
            onCreateScratch={(start, end) => {
              const block: ScratchBlock = {
                id: crypto.randomUUID(),
                taskId: null,
                date: scheduleDate,
                start,
                end,
                portion: '',
                createdAt: new Date().toISOString(),
                expiresAt: scratchExpiry(scheduleDate, end)
              }
              void upsertScratchBlock(block).then(() => {
                setBlockPeekId(block.id)
                setBlockPeekOpen(true)
              })
            }}
          />
        </div>

        <TaskCreateDialog
          bucket={composerBucket}
          today={today}
          contexts={contexts}
          onAddContext={addContext}
          onUpdateContext={updateContext}
          onDeleteContext={removeContext}
          onCreate={createTask}
          onClose={() => setComposerBucket(null)}
        />

        <TaskDetailDialog
          task={peekTask}
          open={peekOpen}
          contexts={contexts}
          dueAttention={dueAttention}
          onClose={() => setPeekOpen(false)}
          onUpdate={updateTask}
          onAddContext={addContext}
          onUpdateContext={updateContext}
          onDeleteContext={removeContext}
          onDuplicate={async (source) => {
            await duplicateTask(source)
            setPeekOpen(false)
          }}
          onDelete={(taskId) => void deleteTask(taskId).catch(() => undefined)}
        />
        <ScratchBlockDialog
          block={blockPeek}
          task={blockPeekTask}
          open={blockPeekOpen}
          onClose={() => setBlockPeekOpen(false)}
          onUpdate={upsertScratchBlock}
          onDelete={deleteScratchBlock}
        />
        {/* Default drop animation so a cancelled drag settles home visibly. */}
        <DragOverlay zIndex={1000} dropAnimation={dropLanded ? null : undefined}>
          {activeTask === null ? null : <TaskCardPreview task={activeTask} contexts={contexts} />}
        </DragOverlay>
        {quickTarget !== null && quickTask !== null ? (
          <QuickActionsMenu
            point={quickTarget.point}
            label={`Actions for ${quickTask.title}`}
            items={quickItems}
            onClose={() => setQuickTarget(null)}
          />
        ) : null}
        {undoHintVisible ? (
          <div className="ui-undo-hint" role="status">
            Task deleted. Press ⌘Z to bring it back.
          </div>
        ) : dropNotice !== null ? (
          <div className="ui-undo-hint" role="status">
            {dropNotice}
          </div>
        ) : null}
      </div>
    </DndContext>
  )
}
