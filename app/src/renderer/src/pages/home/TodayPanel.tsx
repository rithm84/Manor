import { useDroppable } from '@dnd-kit/core'
import type { ReactNode } from 'react'

import { calendars, events } from '../../data/mock'
import type { CalendarEvent, ScratchBlock, Task } from '../../data/mock'
import { formatClock, timeToMinutes } from './taskModel'

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
}

export const AXIS_START_MIN = 6 * 60
export const AXIS_END_MIN = 24 * 60
export const HOUR_PX = 44

interface TimelineBlock {
  id: string
  title: string
  start: string
  end: string
  scratch: boolean
  taskId: string | null
  color: string
}

function calendarColor(calendarId: string): string {
  const source = calendars.find((calendar) => calendar.id === calendarId)
  if (source === undefined) throw new Error(`Calendar event references missing calendar ${calendarId}`)
  return source.color
}

function blockFromEvent(event: CalendarEvent): TimelineBlock {
  return { id: event.id, title: event.title, start: event.start, end: event.end, scratch: false, taskId: null, color: calendarColor(event.calendarId) }
}

function blockFromScratch(block: ScratchBlock, tasks: readonly Task[]): TimelineBlock {
  const task = tasks.find((candidate) => candidate.id === block.taskId)
  if (task === undefined) throw new Error(`Scratch block ${block.id} references missing task ${block.taskId}`)
  return { id: block.id, title: task.title, start: block.start, end: block.end, scratch: true, taskId: task.id, color: '#48708e' }
}

export function timelineTop(minutes: number): number {
  return ((minutes - AXIS_START_MIN) / 60) * HOUR_PX
}

function formatHour(hour: number): string {
  if (hour === 24) return '12 AM'
  const meridiem = hour >= 12 ? 'PM' : 'AM'
  const display = hour % 12 === 0 ? 12 : hour % 12
  return `${display} ${meridiem}`
}

export function TodayPanel({ tasks, scratchBlocks, date, dateLabel, day, nowTime, dropPreview, onDayChange, onOpenTask, onOpenScratchBlock }: TodayPanelProps): ReactNode {
  const { setNodeRef, isOver } = useDroppable({ id: `timeline:${date}`, data: { type: 'timeline', date } })
  const dayScratchBlocks = scratchBlocks.filter((block) => block.date === date)
  const blocks: readonly TimelineBlock[] = [
    ...events.filter((event) => event.date === date && !event.scratch).map(blockFromEvent),
    ...dayScratchBlocks.map((block) => blockFromScratch(block, tasks))
  ]
  const hours = Array.from({ length: AXIS_END_MIN / 60 - AXIS_START_MIN / 60 + 1 }, (_, index) => AXIS_START_MIN / 60 + index)
  const nowMinutes = timeToMinutes(nowTime)
  const axisHeight = timelineTop(AXIS_END_MIN)

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
        <div ref={setNodeRef} className={`today-timeline${isOver ? ' is-drag-over' : ''}`} style={{ height: axisHeight }}>
          {hours.map((hour) => (
            <div key={hour} className="today-hour" style={{ top: timelineTop(hour * 60) }}>
              <span className="today-hour-label">{formatHour(hour)}</span><span className="today-hour-line" />
            </div>
          ))}

          {blocks.map((block) => {
            const height = timelineTop(timeToMinutes(block.end)) - timelineTop(timeToMinutes(block.start))
            return (
              <button key={block.id} type="button" className={`today-block${block.scratch ? ' is-scratch is-linked' : ''}${height < 34 ? ' is-slim' : ''}`}
                style={{ top: timelineTop(timeToMinutes(block.start)), height, ['--entry-color' as string]: block.color }}
                title={`${block.title}, ${formatClock(block.start)} to ${formatClock(block.end)}`}
                onClick={() => { if (block.scratch) onOpenScratchBlock(block.id); else if (block.taskId !== null) onOpenTask(block.taskId) }}>
                <span className="today-block-title">{block.title}</span>
                <span className="today-block-time tnum">{formatClock(block.start)} to {formatClock(block.end)}</span>
              </button>
            )
          })}

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
