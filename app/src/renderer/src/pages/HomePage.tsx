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
import { CheckCircle2, LayoutGrid, List, PanelRightOpen, Plus, RotateCcw, Sunrise, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { Button, EmptyState, QuickActionsMenu } from '../components/ui'
import type { QuickActionItem, QuickActionPoint } from '../components/ui'
import { user } from '../data/mock'
import type {
  ContextDefinition,
  ContextDraft,
  ScratchBlock,
  Task,
  TaskBucket
} from '../data/mock'
import type { SavedTaskView } from '../../../shared/home'
import { KanbanBoard } from './home/KanbanBoard'
import { MasterTaskTable } from './home/MasterTaskTable'
import { createHomeSeed } from './home/homeSeed'
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
  defaultPortion,
  dueForTaskCreation,
  dueForBucket,
  findFreeStart,
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
type HomeView = 'weekly' | 'master'

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
  const [now, setNow] = useState<Date>(() => new Date())
  const today = localTodayIso(now)
  const nowTime = localTime(now)
  const [tasks, setTasks] = useState<readonly Task[]>([])
  const [contexts, setContexts] = useState<readonly ContextDefinition[]>([])
  const [scratchBlocks, setScratchBlocks] = useState<readonly ScratchBlock[]>([])
  const [savedViews, setSavedViews] = useState<readonly SavedTaskView[]>([])
  const [loading, setLoading] = useState(true)
  const [persistError, setPersistError] = useState<string | null>(null)
  const [view, setView] = useState<HomeView>('weekly')
  const [scheduleDay, setScheduleDay] = useState<ScheduleDay>('today')
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const [dropPreview, setDropPreview] = useState<TimelineDropPreview | null>(null)
  const [completingIds, setCompletingIds] = useState<ReadonlySet<string>>(new Set())
  const [composerBucket, setComposerBucket] = useState<TaskBucket | null>(null)
  const [peekId, setPeekId] = useState<string | null>(null)
  const [peekOpen, setPeekOpen] = useState(false)
  const [dueAttention, setDueAttention] = useState(false)
  const [blockPeekId, setBlockPeekId] = useState<string | null>(null)
  const [blockPeekOpen, setBlockPeekOpen] = useState(false)
  const [quickTarget, setQuickTarget] = useState<TaskQuickTarget | null>(null)
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
    if (!('manor' in window)) {
      setPersistError('Home persistence requires the Electron app.')
      setLoading(false)
      return (): void => {
        cancelled = true
      }
    }
    void window.manor.home
      .load(createHomeSeed())
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
    }
  }, [])

  const reportPersistenceError = (operation: string, error: unknown): void => {
    console.error('Home persistence operation failed', { operation, error })
    setPersistError(`${operation}: ${errorMessage(error)}`)
  }

  const updateTask = async (updated: Task): Promise<void> => {
    try {
      const persisted = await window.manor.home.upsertTask(updated)
      setTasks((current) => current.map((task) => (task.id === persisted.id ? persisted : task)))
      setPersistError(null)
    } catch (error) {
      reportPersistenceError('Could not save task', error)
      throw error
    }
  }

  const addContext = async (context: ContextDraft): Promise<ContextDefinition> => {
    try {
      const persisted = await window.manor.home.addContext(context)
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
    try {
      const persisted = await window.manor.home.upsertTask(task)
      setTasks((current) => [...current, persisted])
      setComposerBucket(null)
      setPeekId(persisted.id)
      setDueAttention(false)
      setPeekOpen(true)
      setPersistError(null)
    } catch (error) {
      reportPersistenceError('Could not create task', error)
    }
  }

  const completeTask = async (taskId: string): Promise<void> => {
    const task = tasks.find((candidate) => candidate.id === taskId)
    if (task === undefined) throw new Error(`Cannot complete missing task ${taskId}`)
    setPeekOpen(false)
    setCompletingIds((current) => new Set(current).add(taskId))
    const timer = window.setTimeout(() => {
      completeTimers.current.delete(taskId)
      void updateTask({ ...task, status: 'Done' })
        .then(() => {
          setCompletingIds((current) => {
            const next = new Set(current)
            next.delete(taskId)
            return next
          })
        })
        .catch(() => {
          setCompletingIds((current) => {
            const next = new Set(current)
            next.delete(taskId)
            return next
          })
        })
    }, COMPLETE_FADE_MS)
    completeTimers.current.set(taskId, timer)
  }

  const toggleComplete = (taskId: string): void => {
    const pending = completeTimers.current.get(taskId)
    if (pending !== undefined) {
      window.clearTimeout(pending)
      completeTimers.current.delete(taskId)
      setCompletingIds((current) => {
        const next = new Set(current)
        next.delete(taskId)
        return next
      })
      return
    }
    void completeTask(taskId)
  }

  const deleteTask = async (taskId: string): Promise<void> => {
    try {
      await window.manor.home.deleteTask(taskId)
      setPeekOpen(false)
      setTasks((current) => current.filter((task) => task.id !== taskId))
      setScratchBlocks((current) => current.filter((block) => block.taskId !== taskId))
      setPersistError(null)
    } catch (error) {
      reportPersistenceError('Could not delete task', error)
      throw error
    }
  }

  const upsertScratchBlock = async (block: ScratchBlock): Promise<void> => {
    try {
      const persisted = await window.manor.home.upsertScratchBlock(block)
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
      await window.manor.home.deleteScratchBlock(blockId)
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
      const persisted = await window.manor.home.upsertSavedTaskView(savedView)
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
      await window.manor.home.deleteSavedTaskView(viewId)
      setSavedViews((current) => current.filter((candidate) => candidate.id !== viewId))
      setPersistError(null)
    } catch (error) {
      reportPersistenceError('Could not delete view', error)
      throw error
    }
  }

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
    await upsertScratchBlock(block)
    setBlockPeekId(block.id)
    setBlockPeekOpen(true)
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
      const start = findFreeStart(date, minutes, requested, scratchBlocks)
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
        setPersistError(preview?.error ?? 'Could not place this time block.')
        return
      }
      void createScratchBlock(task, date, preview.start).catch((error: unknown) => {
        reportPersistenceError('Could not create time block', error)
      })
      return
    }

    if (targetType !== 'bucket' || typeof sourceBucket !== 'string') return
    const targetBucket = event.over.data.current?.targetBucket
    if (targetBucket === 'week') {
      setPeekId(taskId)
      setDueAttention(true)
      setPeekOpen(true)
      return
    }
    const allowed =
      (sourceBucket === 'overdue' && (targetBucket === 'today' || targetBucket === 'tomorrow')) ||
      (sourceBucket === 'today' && targetBucket === 'tomorrow') ||
      (sourceBucket === 'tomorrow' && targetBucket === 'today')
    if (allowed && (targetBucket === 'today' || targetBucket === 'tomorrow')) {
      void updateTask({ ...task, due: dueForBucket(targetBucket, today) })
    }
  }

  const boardTasks = tasks.filter(
    (task) => task.status !== 'Done' && bucketForDue(task.due, today) !== null
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
  const scheduleDateLabel = formatLongDayLabel(scheduleDate)
  const activeTask = activeTaskId === null ? null : tasks.find((task) => task.id === activeTaskId) ?? null
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
          id: 'delete',
          label: 'Delete task',
          icon: <Trash2 size={15} />,
          tone: 'danger',
          onSelect: () => void deleteTask(quickTask.id)
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
            <h1 className="home-greeting display">{greetingFor(nowTime)}, {user.name}.</h1>
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
          />
        </div>

        <TaskCreateDialog
          bucket={composerBucket}
          today={today}
          contexts={contexts}
          onAddContext={addContext}
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
          onComplete={completeTask}
          onDelete={deleteTask}
        />
        <ScratchBlockDialog
          block={blockPeek}
          task={blockPeekTask}
          open={blockPeekOpen}
          onClose={() => setBlockPeekOpen(false)}
          onUpdate={upsertScratchBlock}
          onDelete={deleteScratchBlock}
        />
        <DragOverlay dropAnimation={null} zIndex={1000}>
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
      </div>
    </DndContext>
  )
}
