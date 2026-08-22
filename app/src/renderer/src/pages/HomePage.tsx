import { Plus, Sunrise } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { Button, EmptyState } from '../components/ui'
import { NOW_TIME, TODAY_LABEL, tasks as mockTasks, user } from '../data/mock'
import type { Task, TaskBucket } from '../data/mock'
import { KanbanBoard } from './home/KanbanBoard'
import type { DraftTask } from './home/KanbanColumn'
import { TaskPeek } from './home/TaskPeek'
import { TodayPanel } from './home/TodayPanel'
import {
  blockMinutesFor,
  dueForBucket,
  findFreeStart,
  minutesToTime,
  timeToMinutes,
  withDue
} from './home/taskModel'
import type { DroppedBlock } from './home/taskModel'
import './home/home.css'

const COMPLETE_FADE_MS = 480

function greetingFor(time: string): string {
  const hour = Math.floor(timeToMinutes(time) / 60)
  if (hour < 12) {
    return 'Good morning'
  }
  if (hour < 18) {
    return 'Good afternoon'
  }
  return 'Good evening'
}

/**
 * Home: the tasks board plus the day's timeline. Nothing else lives here.
 * All interactions mutate local state only; the mock data stays untouched.
 */
export function HomePage(): ReactNode {
  const [tasks, setTasks] = useState<readonly Task[]>(mockTasks)
  const [completingIds, setCompletingIds] = useState<ReadonlySet<string>>(new Set())
  const [composerBucket, setComposerBucket] = useState<TaskBucket | null>(null)
  const [peekId, setPeekId] = useState<string | null>(null)
  const [peekOpen, setPeekOpen] = useState(false)
  const [droppedBlocks, setDroppedBlocks] = useState<readonly DroppedBlock[]>([])
  const completeTimers = useRef<Map<string, number>>(new Map())

  useEffect(() => {
    const timers = completeTimers.current
    return (): void => {
      timers.forEach((timer) => window.clearTimeout(timer))
      timers.clear()
    }
  }, [])

  const boardTasks = tasks.filter((task) => task.status !== 'Done')

  const updateTask = (updated: Task): void => {
    setTasks((current) => current.map((task) => (task.id === updated.id ? updated : task)))
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
    setCompletingIds((current) => new Set(current).add(taskId))
    const timer = window.setTimeout(() => {
      completeTimers.current.delete(taskId)
      setCompletingIds((current) => {
        const next = new Set(current)
        next.delete(taskId)
        return next
      })
      setTasks((current) =>
        current.map((task) => (task.id === taskId ? { ...task, status: 'Done' } : task))
      )
    }, COMPLETE_FADE_MS)
    completeTimers.current.set(taskId, timer)
  }

  const completeFromPeek = (taskId: string): void => {
    setPeekOpen(false)
    toggleComplete(taskId)
  }

  const deleteTask = (taskId: string): void => {
    setPeekOpen(false)
    setTasks((current) => current.filter((task) => task.id !== taskId))
    setDroppedBlocks((current) => current.filter((block) => block.taskId !== taskId))
  }

  const createTask = (bucket: TaskBucket, draft: DraftTask): void => {
    const due = dueForBucket(bucket)
    const base: Task = {
      id: `task-local-${Date.now()}`,
      title: draft.title,
      bucket,
      context: draft.context,
      difficulty: draft.difficulty,
      priority: draft.priority,
      status: 'Not started',
      due,
      tags: [],
      daysLate: 0,
      recurrence: null,
      timeBlocks: []
    }
    setTasks((current) => [...current, withDue(base, due)])
  }

  const openTask = (taskId: string): void => {
    setPeekId(taskId)
    setPeekOpen(true)
  }

  const dropTaskOnToday = (taskId: string): void => {
    const task = tasks.find((candidate) => candidate.id === taskId)
    if (task === undefined) {
      return
    }
    const minutes = blockMinutesFor(task.difficulty)
    const start = findFreeStart(minutes, droppedBlocks)
    const end = minutesToTime(timeToMinutes(start) + minutes)
    setDroppedBlocks((current) => [
      ...current,
      { id: `block-local-${Date.now()}`, taskId: task.id, title: task.title, start, end }
    ])
  }

  const peekTask = peekId !== null ? (tasks.find((task) => task.id === peekId) ?? null) : null

  return (
    <div className="home">
      <header className="home-header">
        <div className="home-heading">
          <h1 className="home-greeting display">
            {greetingFor(NOW_TIME)}, {user.name}.
          </h1>
          <span className="home-date">{TODAY_LABEL}</span>
        </div>
        <div className="home-header-side">
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => setComposerBucket('today')}>
            New task
          </Button>
        </div>
      </header>

      <div className="home-main">
        {boardTasks.length > 0 || composerBucket !== null ? (
          <KanbanBoard
            tasks={boardTasks}
            completingIds={completingIds}
            composerBucket={composerBucket}
            onSetComposerBucket={setComposerBucket}
            onCreate={(bucket, draft) => {
              createTask(bucket, draft)
              setComposerBucket(null)
            }}
            onOpenTask={openTask}
            onToggleComplete={toggleComplete}
          />
        ) : (
          <div className="home-empty">
            <EmptyState
              icon={<Sunrise size={20} />}
              title="A clear board"
              message="Nothing is waiting on you. Add a task when something comes up."
              action={
                <Button
                  variant="primary"
                  icon={<Plus size={16} />}
                  onClick={() => setComposerBucket('today')}
                >
                  New task
                </Button>
              }
            />
          </div>
        )}

        <TodayPanel
          droppedBlocks={droppedBlocks}
          onDropTask={dropTaskOnToday}
          onOpenTask={openTask}
        />
      </div>

      <TaskPeek
        task={peekTask}
        open={peekOpen}
        onClose={() => setPeekOpen(false)}
        onUpdate={updateTask}
        onComplete={completeFromPeek}
        onDelete={deleteTask}
      />
    </div>
  )
}
