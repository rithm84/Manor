import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors
} from '@dnd-kit/core'
import type { CollisionDetection, DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { useState } from 'react'
import type { ReactNode } from 'react'

import type { JobStage } from '../../../shared/jobs'
import { Pill } from '../../components/ui'
import { PipelineCard, PipelineCardPreview } from './PipelineCard'
import './pipeline.css'
import type { BoardCard, ColumnMeta, JobColumn } from './jobsModel'
import {
  PIPELINE_VISIBLE_CARDS,
  jobColumns,
  pipelineColumnDroppableId,
  pipelineDropColumn
} from './jobsModel'

export interface PipelineBoardProps {
  cards: readonly BoardCard[]
  /** Local today, for the posted-freshness chip. */
  today: string
  /** Recently moved cards receive a brief arrival highlight. */
  arrivedIds: ReadonlySet<string>
  onDropOnColumn: (roleId: string, column: JobColumn) => void
  onOpenCard: (cardId: string) => void
  onMoveCard: (cardId: string, stage: JobStage) => void
  onRemoveCard: (cardId: string) => void
}

const pipelineCollision: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args)
  return pointerCollisions.length > 0 ? pointerCollisions : closestCenter(args)
}

function PipelineColumn({
  meta,
  cards,
  today,
  arrivedIds,
  sourceColumn,
  onOpenCard,
  onMoveCard,
  onRemoveCard
}: {
  meta: ColumnMeta
  cards: readonly BoardCard[]
  today: string
  arrivedIds: ReadonlySet<string>
  sourceColumn: JobColumn | null
  onOpenCard: (cardId: string) => void
  onMoveCard: (cardId: string, stage: JobStage) => void
  onRemoveCard: (cardId: string) => void
}): ReactNode {
  const { setNodeRef, isOver } = useDroppable({
    id: pipelineColumnDroppableId(meta.column),
    data: { type: 'pipeline-column', column: meta.column }
  })
  const droppable = sourceColumn !== null && sourceColumn !== meta.column
  const over = isOver && droppable
  return (
    <div
      ref={setNodeRef}
      data-testid={`pipeline-column-${meta.column}`}
      className={`pipeline-col pipeline-col--${meta.column}${over ? ' is-dropover' : ''}`}
    >
      <div className="pipeline-col-head">
        <Pill
          variant="group"
          colorway={meta.pillColorway}
          label={meta.label}
          count={cards.length}
        />
      </div>
      <div className="pipeline-cards">
        {cards.length === 0 && !over ? (
          <div className="pipeline-col-empty">Nothing here yet</div>
        ) : (
          cards.map((card) => (
            <PipelineCard
              key={card.role.id}
              card={card}
              today={today}
              arrived={arrivedIds.has(card.role.id)}
              onOpen={() => onOpenCard(card.role.id)}
              onMove={(stage) => onMoveCard(card.role.id, stage)}
              onRemove={() => onRemoveCard(card.role.id)}
            />
          ))
        )}
        {over ? <div className="pipeline-drop-slot" aria-hidden="true" /> : null}
      </div>
    </div>
  )
}

/** Stage columns with compact company cards. Pointer drag, not HTML5. */
export function PipelineBoard({
  cards,
  today,
  arrivedIds,
  onDropOnColumn,
  onOpenCard,
  onMoveCard,
  onRemoveCard
}: PipelineBoardProps): ReactNode {
  const [activeId, setActiveId] = useState<string | null>(null)
  const [dropLanded, setDropLanded] = useState(false)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )
  const capColumns = jobColumns.some(
    (meta) => cards.filter((card) => card.column === meta.column).length >= PIPELINE_VISIBLE_CARDS
  )
  const activeCard = activeId === null ? null : cards.find((card) => card.role.id === activeId) ?? null
  const sourceColumn = activeCard?.column ?? null

  const onDragStart = (event: DragStartEvent): void => {
    const roleId = event.active.data.current?.roleId
    setActiveId(typeof roleId === 'string' ? roleId : null)
    setDropLanded(false)
  }

  const onDragEnd = (event: DragEndEvent): void => {
    const roleId = event.active.data.current?.roleId
    const fromColumn = event.active.data.current?.sourceColumn
    setActiveId(null)
    if (typeof roleId !== 'string' || typeof fromColumn !== 'string') {
      return
    }
    const column = pipelineDropColumn(event.over?.id, fromColumn as JobColumn)
    if (column === null) {
      return
    }
    setDropLanded(true)
    onDropOnColumn(roleId, column)
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pipelineCollision}
      onDragStart={onDragStart}
      onDragCancel={() => setActiveId(null)}
      onDragEnd={onDragEnd}
    >
      <div
        className={`pipeline${capColumns ? ' is-capped' : ''}`}
        data-testid="pipeline-board"
      >
        {jobColumns.map((meta) => (
          <PipelineColumn
            key={meta.column}
            meta={meta}
            cards={cards.filter((card) => card.column === meta.column)}
            today={today}
            arrivedIds={arrivedIds}
            sourceColumn={sourceColumn}
            onOpenCard={onOpenCard}
            onMoveCard={onMoveCard}
            onRemoveCard={onRemoveCard}
          />
        ))}
      </div>
      <DragOverlay zIndex={1000} dropAnimation={dropLanded ? null : undefined}>
        {activeCard === null ? null : <PipelineCardPreview card={activeCard} today={today} />}
      </DragOverlay>
    </DndContext>
  )
}
