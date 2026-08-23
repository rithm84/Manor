import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import type { QuickActionPoint } from '../../components/ui'
import type { ContextDefinition, Task, TaskBucket } from '../../data/mock'
import { taskBuckets } from '../../data/mock'
import { KanbanColumn } from './KanbanColumn'
import { bucketForDue, compareWeeklyTasks } from './taskModel'

export interface KanbanBoardProps {
  tasks: readonly Task[]
  contexts: readonly ContextDefinition[]
  today: string
  completingIds: ReadonlySet<string>
  onOpenComposer: (bucket: TaskBucket, trigger: HTMLElement) => void
  onOpenTask: (taskId: string) => void
  onQuickActions: (taskId: string, point: QuickActionPoint) => void
  onToggleComplete: (taskId: string) => void
}

/**
 * The four due buckets as a Notion-style board inside its own horizontal
 * scroll region. The region ends before the Today panel; edge fades appear
 * whenever more columns sit beyond either edge, so a cut-off column always
 * reads as scrollable rather than clipped.
 */
export function KanbanBoard({
  tasks,
  contexts,
  today,
  completingIds,
  onOpenComposer,
  onOpenTask,
  onQuickActions,
  onToggleComplete
}: KanbanBoardProps): ReactNode {
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const [moreLeft, setMoreLeft] = useState(false)
  const [moreRight, setMoreRight] = useState(false)

  const updateEdges = useCallback((): void => {
    const scroller = scrollerRef.current
    if (scroller === null) {
      return
    }
    const maxScroll = scroller.scrollWidth - scroller.clientWidth
    setMoreLeft(scroller.scrollLeft > 2)
    setMoreRight(scroller.scrollLeft < maxScroll - 2)
  }, [])

  useEffect(() => {
    updateEdges()
    const scroller = scrollerRef.current
    if (scroller === null) {
      return
    }
    const observer = new ResizeObserver(updateEdges)
    observer.observe(scroller)
    return (): void => {
      observer.disconnect()
    }
  }, [updateEdges])

  useEffect(() => {
    updateEdges()
  }, [tasks, updateEdges])

  return (
    <div className="home-board">
      <div className="kanban" aria-label="Tasks by due date" ref={scrollerRef} onScroll={updateEdges}>
        {taskBuckets.map((meta) => (
          <KanbanColumn
            key={meta.bucket}
            meta={meta}
            tasks={tasks
              .filter((task) => bucketForDue(task.due, today) === meta.bucket)
              .sort(compareWeeklyTasks)}
            contexts={contexts}
            today={today}
            completingIds={completingIds}
            onOpenComposer={(trigger) => onOpenComposer(meta.bucket, trigger)}
            onOpenTask={onOpenTask}
            onQuickActions={onQuickActions}
            onToggleComplete={onToggleComplete}
          />
        ))}
      </div>
      <span className={`home-board-fade home-board-fade--left${moreLeft ? ' is-on' : ''}`} aria-hidden="true" />
      <span className={`home-board-fade home-board-fade--right${moreRight ? ' is-on' : ''}`} aria-hidden="true" />
    </div>
  )
}
