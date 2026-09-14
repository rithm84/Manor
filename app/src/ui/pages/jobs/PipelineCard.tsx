import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import type { KeyboardEvent, ReactNode } from 'react'

import type { JobStage } from '../../../shared/jobs'
import { Pill } from '../../components/ui'
import { PipelineCardMenu } from './PipelineCardMenu'
import type { BoardCard } from './jobsModel'
import { appliedLabel, postedColorway, postedLabel, termColorway } from './jobsModel'

export interface PipelineCardProps {
  card: BoardCard
  today: string
  arrived: boolean
  onOpen: () => void
  onMove: (stage: JobStage) => void
  onRemove: () => void
}

function PipelineCardChips({ card, today }: { card: BoardCard; today: string }): ReactNode {
  return (
    <div className="pipeline-card-chips">
      {card.role.term === null || card.role.term === undefined ? null : (
        <Pill variant="tag" colorway={termColorway(card.role.term)} label={card.role.term} />
      )}
      {card.column === 'to_apply' && card.role.datePosted !== null ? (
        <Pill
          variant="tag"
          colorway={postedColorway(card.role.datePosted, today)}
          label={postedLabel(card.role.datePosted, today)}
        />
      ) : null}
      {card.column !== 'to_apply' && card.role.appliedDate !== null ? (
        <Pill variant="tag" colorway="neutral" label={appliedLabel(card.role.appliedDate)} />
      ) : null}
      {card.detailTone === null ? null : (
        <Pill variant="tag" colorway={card.detailTone} label={card.detail} />
      )}
    </div>
  )
}

/** Ghost that follows the pointer. WKWebView never paints an HTML5 drag image. */
export function PipelineCardPreview({ card, today }: { card: BoardCard; today: string }): ReactNode {
  return (
    <div className="pipeline-card pipeline-drag-card" aria-hidden="true">
      <div className="pipeline-card-company">{card.role.company}</div>
      <div className="pipeline-card-role">{card.role.role}</div>
      <PipelineCardChips card={card} today={today} />
    </div>
  )
}

/** Pointer-tracked pipeline card; HTML5 drag does not run in the desktop webview. */
export function PipelineCard({
  card,
  today,
  arrived,
  onOpen,
  onMove,
  onRemove
}: PipelineCardProps): ReactNode {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `pipeline-card:${card.role.id}`,
    data: { type: 'pipeline-card', roleId: card.role.id, sourceColumn: card.column }
  })

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget) return
    if (event.key === 'Enter') {
      event.preventDefault()
      onOpen()
      return
    }
    listeners?.onKeyDown?.(event)
  }

  return (
    <div
      ref={setNodeRef}
      style={{ transform: isDragging ? undefined : CSS.Translate.toString(transform) }}
      data-testid={`pipeline-card-${card.role.id}`}
      className={`pipeline-card${arrived ? ' is-arrived' : ''}${isDragging ? ' is-dragging' : ''}`}
      {...listeners}
      {...attributes}
      aria-label={`${card.role.company}, ${card.role.role}, open details`}
      onClick={() => {
        if (!isDragging) onOpen()
      }}
      onKeyDown={onKeyDown}
    >
      <div className="pipeline-card-company">{card.role.company}</div>
      <div className="pipeline-card-role">{card.role.role}</div>
      <PipelineCardChips card={card} today={today} />
      <PipelineCardMenu card={card} onMove={onMove} onRemove={onRemove} />
    </div>
  )
}
