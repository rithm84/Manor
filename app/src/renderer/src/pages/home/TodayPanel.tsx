import { useState } from 'react'
import type { DragEvent, ReactNode } from 'react'

import { NOW_TIME, TODAY_ISO, TODAY_LABEL, calendars, events } from '../../data/mock'
import type { CalendarEvent } from '../../data/mock'
import { TASK_DRAG_TYPE, findFreeStart, formatClock, timeToMinutes } from './taskModel'
import type { DroppedBlock } from './taskModel'

export interface TodayPanelProps {
  droppedBlocks: readonly DroppedBlock[]
  onDropTask: (taskId: string) => void
  onOpenTask: (taskId: string) => void
}

/** Axis window: 8:00 to 22:00 keeps the canon day dense, no dead hours. */
const AXIS_START_MIN = 8 * 60
const AXIS_END_MIN = 22 * 60
const HOUR_PX = 44
const HINT_MINUTES = 60

interface TimelineBlock {
  id: string
  title: string
  start: string
  end: string
  scratch: boolean
  faded: boolean
  taskId: string | null
  color: string
}

function calendarColor(calendarId: string): string {
  const source = calendars.find((calendar) => calendar.id === calendarId)
  return source !== undefined ? source.color : '#6c6a64'
}

function blockFromEvent(event: CalendarEvent): TimelineBlock {
  return {
    id: event.id,
    title: event.title,
    start: event.start,
    end: event.end,
    scratch: event.scratch,
    faded: event.faded,
    taskId: event.taskId,
    color: calendarColor(event.calendarId)
  }
}

function blockFromDrop(dropped: DroppedBlock): TimelineBlock {
  return {
    id: dropped.id,
    title: dropped.title,
    start: dropped.start,
    end: dropped.end,
    scratch: true,
    faded: false,
    taskId: dropped.taskId,
    color: '#cc785c'
  }
}

function topFor(minutes: number): number {
  return ((minutes - AXIS_START_MIN) / 60) * HOUR_PX
}

function formatHour(hour: number): string {
  const meridiem = hour >= 12 ? 'PM' : 'AM'
  const display = hour % 12 === 0 ? 12 : hour % 12
  return `${display} ${meridiem}`
}

/**
 * The day as an hour-axis timeline: mono hour gutter, faint hourlines,
 * events and scratch blocks positioned and sized by their times, a coral
 * now line, and a free-slot hint that accepts dragged board cards.
 */
export function TodayPanel({ droppedBlocks, onDropTask, onOpenTask }: TodayPanelProps): ReactNode {
  const [dragOver, setDragOver] = useState(false)

  const blocks: readonly TimelineBlock[] = [
    ...events.filter((event) => event.date === TODAY_ISO).map(blockFromEvent),
    ...droppedBlocks.map(blockFromDrop)
  ]

  const hours: number[] = []
  for (let hour = AXIS_START_MIN / 60; hour <= AXIS_END_MIN / 60; hour += 1) {
    hours.push(hour)
  }

  const nowTop = topFor(timeToMinutes(NOW_TIME))
  const hintStart = findFreeStart(HINT_MINUTES, droppedBlocks)
  const hintTop = topFor(timeToMinutes(hintStart))
  const axisHeight = topFor(AXIS_END_MIN)

  const onDragOver = (event: DragEvent<HTMLDivElement>): void => {
    if (event.dataTransfer.types.includes(TASK_DRAG_TYPE)) {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
      setDragOver(true)
    }
  }

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault()
    setDragOver(false)
    const taskId = event.dataTransfer.getData(TASK_DRAG_TYPE)
    if (taskId !== '') {
      onDropTask(taskId)
    }
  }

  return (
    <aside className="today-panel" aria-label="Today">
      <header className="today-head">
        <span className="today-title">Today</span>
        <span className="today-date">{TODAY_LABEL}</span>
      </header>

      <div
        className="today-timeline"
        style={{ height: axisHeight }}
        onDragOver={onDragOver}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        {hours.map((hour) => (
          <div key={hour} className="today-hour" style={{ top: topFor(hour * 60) }}>
            <span className="today-hour-label">{formatHour(hour)}</span>
            <span className="today-hour-line" />
          </div>
        ))}

        {blocks.map((block) => {
          const startMin = timeToMinutes(block.start)
          const endMin = timeToMinutes(block.end)
          const height = topFor(endMin) - topFor(startMin)
          return (
            <div
              key={block.id}
              className={`today-block${block.scratch ? ' is-scratch' : ''}${
                block.faded ? ' is-faded' : ''
              }${block.taskId !== null ? ' is-linked' : ''}${height < 34 ? ' is-slim' : ''}`}
              style={{ top: topFor(startMin), height, ['--entry-color' as string]: block.color }}
              title={`${block.title}, ${formatClock(block.start)} to ${formatClock(block.end)}`}
              role={block.taskId !== null ? 'button' : undefined}
              tabIndex={block.taskId !== null ? 0 : undefined}
              onClick={() => {
                if (block.taskId !== null) {
                  onOpenTask(block.taskId)
                }
              }}
            >
              <span className="today-block-title">{block.title}</span>
              <span className="today-block-time tnum">
                {formatClock(block.start)} to {formatClock(block.end)}
              </span>
            </div>
          )
        })}

        <div
          className={`today-hint${dragOver ? ' is-over' : ''}`}
          style={{ top: hintTop, height: (HINT_MINUTES / 60) * HOUR_PX }}
        >
          Drag a task here to block time
        </div>

        <div className="today-now" style={{ top: nowTop }} aria-label={`Now, ${formatClock(NOW_TIME)}`}>
          <span className="today-now-dot" />
          <span className="today-now-line" />
        </div>
      </div>
    </aside>
  )
}
