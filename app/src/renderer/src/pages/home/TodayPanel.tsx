import { useDroppable } from '@dnd-kit/core'
import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'

import type { CalendarDayEvent } from '../../../../shared/calendar'
import { calendars, events } from '../../data/mock'
import type { CalendarEvent, ScratchBlock, Task } from '../../data/mock'
import { calendarApi } from '../settings/useGoogleConnect'
import { formatClock, minutesToTime, timeToMinutes } from './taskModel'

export type ScheduleDay = 'today' | 'tomorrow'

export type TimelineDropPreview =
  | { start: string; end: string; title: string; error: null }
  | { start: null; end: null; title: string; error: string }

export interface TodayPanelProps {
  tasks: readonly Task[]
  scratchBlocks: readonly ScratchBlock[]
  date: string
  dateLabel: string
  day: ScheduleDay
  nowTime: string
  dropPreview: TimelineDropPreview | null
  onDayChange: (day: ScheduleDay) => void
  onOpenTask: (taskId: string) => void
  onOpenScratchBlock: (blockId: string) => void
  onMoveScratchBlock: (blockId: string, start: string, end: string) => void
  onCreateScratch: (start: string, end: string) => void
}

export const AXIS_START_MIN = 6 * 60
export const AXIS_END_MIN = 24 * 60
export const HOUR_PX = 44
const SNAP_MIN = 15

interface TimelineBlock {
  id: string
  title: string
  start: string
  end: string
  scratch: boolean
  taskId: string | null
  color: string
}

type TimelineDrag =
  | { kind: 'move'; blockId: string; grabOffsetMin: number; durationMin: number; startMin: number; moved: boolean }
  | { kind: 'create'; anchorMin: number; currentMin: number }

function calendarColor(calendarId: string): string {
  const source = calendars.find((calendar) => calendar.id === calendarId)
  if (source === undefined) throw new Error(`Calendar event references missing calendar ${calendarId}`)
  return source.color
}

function blockFromEvent(event: CalendarEvent): TimelineBlock {
  return { id: event.id, title: event.title, start: event.start, end: event.end, scratch: false, taskId: null, color: calendarColor(event.calendarId) }
}

const LIVE_EVENT_FALLBACK_COLOR = '#48708e'

/** A connected-calendar event, clamped to the visible axis; null when the
    whole event falls outside it. All-day events carry no timeline slot. */
function blockFromDayEvent(event: CalendarDayEvent): TimelineBlock | null {
  const startMin = Math.max(timeToMinutes(event.start), AXIS_START_MIN)
  const endMin = Math.min(timeToMinutes(event.end), AXIS_END_MIN)
  if (endMin <= startMin) return null
  return {
    id: event.id,
    title: event.title,
    start: minutesToTime(startMin),
    end: minutesToTime(endMin),
    scratch: false,
    taskId: null,
    color: event.color ?? LIVE_EVENT_FALLBACK_COLOR
  }
}

function blockFromScratch(block: ScratchBlock, tasks: readonly Task[]): TimelineBlock {
  if (block.taskId === null) {
    const title = block.portion.trim() === '' ? 'Sticky note' : block.portion
    return { id: block.id, title, start: block.start, end: block.end, scratch: true, taskId: null, color: '#48708e' }
  }
  const task = tasks.find((candidate) => candidate.id === block.taskId)
  if (task === undefined) throw new Error(`Scratch block ${block.id} references missing task ${block.taskId}`)
  return { id: block.id, title: task.title, start: block.start, end: block.end, scratch: true, taskId: task.id, color: '#48708e' }
}

export function timelineTop(minutes: number): number {
  return ((minutes - AXIS_START_MIN) / 60) * HOUR_PX
}

function snapMinutes(minutes: number): number {
  return Math.round(minutes / SNAP_MIN) * SNAP_MIN
}

function clampMinutes(minutes: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, minutes))
}

function formatHour(hour: number): string {
  if (hour === 24) return '12 AM'
  const meridiem = hour >= 12 ? 'PM' : 'AM'
  const display = hour % 12 === 0 ? 12 : hour % 12
  return `${display} ${meridiem}`
}

export function TodayPanel({ tasks, scratchBlocks, date, dateLabel, day, nowTime, dropPreview, onDayChange, onOpenTask, onOpenScratchBlock, onMoveScratchBlock, onCreateScratch }: TodayPanelProps): ReactNode {
  const { setNodeRef, isOver } = useDroppable({ id: `timeline:${date}`, data: { type: 'timeline', date } })
  const timelineRef = useRef<HTMLDivElement | null>(null)
  const suppressClickRef = useRef(false)
  const [drag, setDrag] = useState<TimelineDrag | null>(null)

  // Connected-calendar feed: while at least one Google account is connected,
  // real events replace the mock story. Polled every 60s; the main-process
  // service handles caching and incremental sync.
  const [liveEvents, setLiveEvents] = useState<readonly CalendarDayEvent[] | null>(null)
  useEffect(() => {
    let cancelled = false
    const load = (): void => {
      Promise.resolve()
        .then(() => {
          const api = calendarApi()
          return api
            .accounts()
            .then((accounts) => (accounts.length === 0 ? null : api.eventsFor([date])))
        })
        .then((eventsForDay) => {
          if (!cancelled) setLiveEvents(eventsForDay)
        })
        .catch((error: unknown) => {
          // No connection or no bridge: the mock story stays on screen.
          console.warn('Connected calendar events unavailable', { error })
          if (!cancelled) setLiveEvents(null)
        })
    }
    load()
    const timer = window.setInterval(load, 60_000)
    return (): void => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [date])

  const dayScratchBlocks = scratchBlocks.filter((block) => block.date === date)
  const dayEventBlocks: readonly TimelineBlock[] =
    liveEvents !== null
      ? liveEvents
          .filter((event) => event.date === date && !event.allDay)
          .flatMap((event) => {
            const block = blockFromDayEvent(event)
            return block === null ? [] : [block]
          })
      : events.filter((event) => event.date === date && !event.scratch).map(blockFromEvent)
  const blocks: readonly TimelineBlock[] = [
    ...dayEventBlocks,
    ...dayScratchBlocks.map((block) => blockFromScratch(block, tasks))
  ]

  // Escape cancels an in-progress pointer drag; the block snaps back. A plain
  // listener is fine here because no dismiss layer can open mid-drag.
  const dragActive = drag !== null
  useEffect(() => {
    if (!dragActive) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setDrag(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return (): void => window.removeEventListener('keydown', onKeyDown)
  }, [dragActive])

  const overlapsOtherBlock = (blockId: string, startMin: number, endMin: number): boolean =>
    blocks.some(
      (block) =>
        block.id !== blockId &&
        startMin < timeToMinutes(block.end) &&
        endMin > timeToMinutes(block.start)
    )
  const hours = Array.from({ length: AXIS_END_MIN / 60 - AXIS_START_MIN / 60 + 1 }, (_, index) => AXIS_START_MIN / 60 + index)
  const nowMinutes = timeToMinutes(nowTime)
  const axisHeight = timelineTop(AXIS_END_MIN)

  const minuteFromPointer = (event: ReactPointerEvent): number => {
    const timeline = timelineRef.current
    if (timeline === null) throw new Error('Timeline pointer event fired before the timeline mounted')
    const rect = timeline.getBoundingClientRect()
    const raw = AXIS_START_MIN + ((event.clientY - rect.top) / HOUR_PX) * 60
    return clampMinutes(snapMinutes(raw), AXIS_START_MIN, AXIS_END_MIN)
  }

  const beginTimelinePointer = (event: ReactPointerEvent): void => {
    if (event.button !== 0) return
    const target = event.target instanceof HTMLElement ? event.target : null
    const blockElement = target?.closest('.today-block') ?? null
    if (blockElement !== null) {
      const blockId = blockElement.getAttribute('data-block-id')
      const scratch = dayScratchBlocks.find((candidate) => candidate.id === blockId)
      if (scratch === undefined) return
      const startMin = timeToMinutes(scratch.start)
      const durationMin = timeToMinutes(scratch.end) - startMin
      setDrag({ kind: 'move', blockId: scratch.id, grabOffsetMin: minuteFromPointer(event) - startMin, durationMin, startMin, moved: false })
    } else {
      const anchorMin = minuteFromPointer(event)
      if (anchorMin >= AXIS_END_MIN) return
      setDrag({ kind: 'create', anchorMin, currentMin: anchorMin })
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const moveTimelinePointer = (event: ReactPointerEvent): void => {
    if (drag === null) return
    if (drag.kind === 'move') {
      const nextStart = clampMinutes(
        snapMinutes(minuteFromPointer(event) - drag.grabOffsetMin),
        AXIS_START_MIN,
        AXIS_END_MIN - drag.durationMin
      )
      if (nextStart !== drag.startMin || drag.moved) {
        setDrag({ ...drag, startMin: nextStart, moved: true })
      }
    } else {
      setDrag({ ...drag, currentMin: minuteFromPointer(event) })
    }
  }

  const endTimelinePointer = (): void => {
    if (drag === null) return
    if (drag.kind === 'move') {
      suppressClickRef.current = true
      if (drag.moved) {
        const endMin = drag.startMin + drag.durationMin
        // A span landing on another block snaps back instead of overlapping;
        // the block reads as invalid while it hovers there.
        if (!overlapsOtherBlock(drag.blockId, drag.startMin, endMin)) {
          onMoveScratchBlock(drag.blockId, minutesToTime(drag.startMin), minutesToTime(endMin))
        }
      } else {
        onOpenScratchBlock(drag.blockId)
      }
    } else {
      const start = Math.min(drag.anchorMin, drag.currentMin)
      const end = Math.max(drag.anchorMin, drag.currentMin)
      if (end - start >= SNAP_MIN) {
        suppressClickRef.current = true
        onCreateScratch(minutesToTime(start), minutesToTime(end))
      }
    }
    setDrag(null)
    /* Native click (if any) fires right after pointerup; clear the guard
       on the next tick so it can never swallow an unrelated click. */
    window.setTimeout(() => { suppressClickRef.current = false }, 0)
  }

  const openBlock = (block: TimelineBlock): void => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    if (block.scratch) onOpenScratchBlock(block.id)
    else if (block.taskId !== null) onOpenTask(block.taskId)
  }

  const createGhost = drag?.kind === 'create' && Math.abs(drag.currentMin - drag.anchorMin) >= SNAP_MIN
    ? { start: Math.min(drag.anchorMin, drag.currentMin), end: Math.max(drag.anchorMin, drag.currentMin) }
    : null

  return (
    <aside className="today-panel" aria-label={`${day === 'today' ? 'Today' : 'Tomorrow'} schedule`}>
      <header className="today-head">
        <div className="today-day-toggle" role="group" aria-label="Schedule day">
          <button type="button" className={day === 'today' ? 'is-active' : ''} aria-pressed={day === 'today'} onClick={() => onDayChange('today')}>Today</button>
          <button type="button" className={day === 'tomorrow' ? 'is-active' : ''} aria-pressed={day === 'tomorrow'} onClick={() => onDayChange('tomorrow')}>Tomorrow</button>
        </div>
        <span className="today-date">{dateLabel}</span>
      </header>

      <div className="today-timeline-scroll">
        <div
          ref={(node) => { setNodeRef(node); timelineRef.current = node }}
          className={`today-timeline${isOver ? ' is-drag-over' : ''}${drag !== null ? ' is-pointer-drag' : ''}`}
          style={{ height: axisHeight }}
          onPointerDown={beginTimelinePointer}
          onPointerMove={moveTimelinePointer}
          onPointerUp={endTimelinePointer}
          onPointerCancel={() => setDrag(null)}
        >
          {hours.map((hour) => (
            <div key={hour} className="today-hour" style={{ top: timelineTop(hour * 60) }}>
              <span className="today-hour-label">{formatHour(hour)}</span><span className="today-hour-line" />
            </div>
          ))}

          {blocks.map((block) => {
            const dragging = drag?.kind === 'move' && drag.blockId === block.id
            const startMin = dragging ? drag.startMin : timeToMinutes(block.start)
            const endMin = dragging ? drag.startMin + drag.durationMin : timeToMinutes(block.end)
            const height = timelineTop(endMin) - timelineTop(startMin)
            const startLabel = dragging ? minutesToTime(startMin) : block.start
            const endLabel = dragging ? minutesToTime(endMin) : block.end
            const invalid = dragging && drag.moved && overlapsOtherBlock(block.id, startMin, endMin)
            // Title wraps to the lines the block's height affords (16.5px per
            // line after padding and the time row); slim blocks keep one line.
            const titleLines = Math.max(1, Math.floor((height - 20) / 16.5))
            return (
              <button key={block.id} type="button" data-block-id={block.id}
                className={`today-block${block.scratch ? ' is-scratch is-linked' : ''}${height < 34 ? ' is-slim' : ''}${dragging && drag.moved ? ' is-dragging' : ''}${invalid ? ' is-drag-invalid' : ''}`}
                style={{ top: timelineTop(startMin), height, ['--entry-color' as string]: block.color, ['--title-lines' as string]: titleLines }}
                title={`${block.title}, ${formatClock(startLabel)} to ${formatClock(endLabel)}`}
                onClick={() => openBlock(block)}>
                <span className="today-block-title">{block.title}</span>
                <span className="today-block-time tnum">{formatClock(startLabel)} to {formatClock(endLabel)}</span>
              </button>
            )
          })}

          {createGhost !== null ? (
            <div className="today-block is-scratch today-create-ghost" style={{ top: timelineTop(createGhost.start), height: timelineTop(createGhost.end) - timelineTop(createGhost.start) }}>
              <span className="today-block-title">Sticky note</span>
              <span className="today-block-time tnum">{formatClock(minutesToTime(createGhost.start))} to {formatClock(minutesToTime(createGhost.end))}</span>
            </div>
          ) : null}

          {isOver && dropPreview?.error === null ? (
            <div className="today-drop-preview" style={{ top: timelineTop(timeToMinutes(dropPreview.start)), height: timelineTop(timeToMinutes(dropPreview.end)) - timelineTop(timeToMinutes(dropPreview.start)) }}>
              <span>{dropPreview.title}</span><span className="tnum">{formatClock(dropPreview.start)} to {formatClock(dropPreview.end)}</span>
            </div>
          ) : null}
          {isOver && dropPreview?.error !== null && dropPreview !== null ? <div className="today-drop-error" role="status">{dropPreview.error}</div> : null}

          {day === 'today' && nowMinutes >= AXIS_START_MIN && nowMinutes <= AXIS_END_MIN ? (
            <div className="today-now" style={{ top: timelineTop(nowMinutes) }} aria-label={`Now, ${formatClock(nowTime)}`}><span className="today-now-dot" /><span className="today-now-line" /></div>
          ) : null}
        </div>
      </div>
    </aside>
  )
}
