import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import type { Task, TaskBucket } from '../../data/mock'
import { taskBuckets } from '../../data/mock'
import { KanbanColumn } from './KanbanColumn'
import type { DraftTask } from './KanbanColumn'

export interface KanbanBoardProps {
  tasks: readonly Task[]
  completingIds: ReadonlySet<string>
  composerBucket: TaskBucket | null
  onSetComposerBucket: (bucket: TaskBucket | null) => void
  onCreate: (bucket: TaskBucket, draft: DraftTask) => void
  onOpenTask: (taskId: string) => void
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
  completingIds,
  composerBucket,
  onSetComposerBucket,
  onCreate,
  onOpenTask,
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
  }, [tasks, composerBucket, updateEdges])

  return (
    <div className="home-board">
      <div className="kanban" aria-label="Tasks by due date" ref={scrollerRef} onScroll={updateEdges}>
        {taskBuckets.map((meta) => (
          <KanbanColumn
            key={meta.bucket}
            meta={meta}
            tasks={tasks.filter((task) => task.bucket === meta.bucket)}
            completingIds={completingIds}
            composerOpen={composerBucket === meta.bucket}
            onOpenComposer={() => onSetComposerBucket(meta.bucket)}
            onCloseComposer={() => onSetComposerBucket(null)}
            onCreate={(draft) => onCreate(meta.bucket, draft)}
            onOpenTask={onOpenTask}
            onToggleComplete={onToggleComplete}
          />
        ))}
      </div>
      <span className={`home-board-fade home-board-fade--left${moreLeft ? ' is-on' : ''}`} aria-hidden="true" />
      <span className={`home-board-fade home-board-fade--right${moreRight ? ' is-on' : ''}`} aria-hidden="true" />
    </div>
  )
}
