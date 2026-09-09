import { ArrowRight, MoreHorizontal, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { DragEvent, ReactNode } from 'react'

import type { JobStage } from '../../../shared/jobs'
import { Pill, useDismissLayer } from '../../components/ui'
import type { BoardCard, DragPayload, JobColumn } from './jobsModel'
import { appliedLabel, jobColumns, jobStageOptions, postedColorway, postedLabel, termColorway } from './jobsModel'

export interface PipelineBoardProps {
  cards: readonly BoardCard[]
  /** Local today, for the posted-freshness chip. */
  today: string
  /** Cards that just arrived from "Mark applied" get a brief highlight. */
  arrivedIds: ReadonlySet<string>
  /** The active drag, owned by the page so to-apply rows can join in. */
  dragging: DragPayload | null
  onDragStartCard: (cardId: string) => void
  onDragEnd: () => void
  onDropOnColumn: (column: JobColumn) => void
  onOpenCard: (cardId: string) => void
  onMoveCard: (cardId: string, stage: JobStage) => void
  onRemoveCard: (cardId: string) => void
}

interface CardMenuProps {
  card: BoardCard
  onMove: (stage: JobStage) => void
  onRemove: () => void
}

function CardMenu({ card, onMove, onRemove }: CardMenuProps): ReactNode {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  const dismiss = (): void => {
    setOpen(false)
    triggerRef.current?.focus()
  }
  useDismissLayer(open, dismiss)

  useEffect(() => {
    if (!open) {
      return
    }
    const onPointerDown = (event: PointerEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    window.addEventListener('pointerdown', onPointerDown)
    return (): void => {
      window.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open])

  return (
    <div
      className="pipeline-card-menu"
      ref={rootRef}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        ref={triggerRef}
        className="pipeline-card-menu-btn"
        aria-label={`Options for ${card.role.company}`}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <MoreHorizontal size={14} />
      </button>
      {open ? (
        <div className="pipeline-menu" role="menu" aria-label={`Move ${card.role.company}`}>
          <div className="pipeline-menu-label">Move to</div>
          {jobStageOptions
            .filter((option) => option.value !== 'to_apply' && option.value !== card.role.stage)
            .map((option) => (
              <button
                key={option.value}
                type="button"
                role="menuitem"
                className="pipeline-menu-item"
                onClick={() => {
                  setOpen(false)
                  onMove(option.value)
                }}
              >
                <ArrowRight size={14} />
                {option.label}
              </button>
            ))}
          <button
            type="button"
            role="menuitem"
            className="pipeline-menu-item pipeline-menu-item--danger"
            onClick={() => {
              setOpen(false)
              onRemove()
            }}
          >
            <Trash2 size={14} />
            Remove
          </button>
        </div>
      ) : null}
    </div>
  )
}

/** Whether the active drag may land on this column. */
function accepts(
  dragging: DragPayload | null,
  cards: readonly BoardCard[],
  column: JobColumn
): boolean {
  if (dragging === null) {
    return false
  }
  if (dragging.kind === 'to_apply') {
    return column === 'applied'
  }
  const card = cards.find((candidate) => candidate.role.id === dragging.id)
  return card !== undefined && card.column !== column
}

/** Stage columns with compact company cards, Notion-board bones, real drag. */
export function PipelineBoard({
  cards,
  today,
  arrivedIds,
  dragging,
  onDragStartCard,
  onDragEnd,
  onDropOnColumn,
  onOpenCard,
  onMoveCard,
  onRemoveCard
}: PipelineBoardProps): ReactNode {
  const [overColumn, setOverColumn] = useState<JobColumn | null>(null)

  useEffect(() => {
    if (dragging === null) {
      setOverColumn(null)
    }
  }, [dragging])

  const columnDragProps = (
    column: JobColumn
  ): {
    onDragOver: (event: DragEvent<HTMLDivElement>) => void
    onDragLeave: (event: DragEvent<HTMLDivElement>) => void
    onDrop: (event: DragEvent<HTMLDivElement>) => void
  } => ({
    onDragOver: (event) => {
      if (!accepts(dragging, cards, column)) {
        return
      }
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      setOverColumn(column)
    },
    onDragLeave: (event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node)) {
        setOverColumn((current) => (current === column ? null : current))
      }
    },
    onDrop: (event) => {
      if (!accepts(dragging, cards, column)) {
        return
      }
      event.preventDefault()
      setOverColumn(null)
      onDropOnColumn(column)
    }
  })

  return (
    <div className="pipeline">
      {jobColumns.map((meta) => {
        const columnCards = cards.filter((card) => card.column === meta.column)
        const droppable = accepts(dragging, cards, meta.column)
        const over = overColumn === meta.column && droppable
        return (
          <div
            key={meta.column}
            className={`pipeline-col pipeline-col--${meta.column}${over ? ' is-dropover' : ''}`}
            {...columnDragProps(meta.column)}
          >
            <div className="pipeline-col-head">
              <Pill
                variant="group"
                colorway={meta.pillColorway}
                label={meta.label}
                count={columnCards.length}
              />
            </div>
            <div className="pipeline-cards">
              {columnCards.length === 0 && !over ? (
                <div className="pipeline-col-empty">Nothing here yet</div>
              ) : (
                columnCards.map((card) => (
                  <div
                    key={card.role.id}
                    className={`pipeline-card${arrivedIds.has(card.role.id) ? ' is-arrived' : ''}${
                      dragging !== null && dragging.kind === 'pipeline' && dragging.id === card.role.id
                        ? ' is-dragging'
                        : ''
                    }`}
                    role="button"
                    tabIndex={0}
                    aria-label={`${card.role.company}, ${card.role.role}, open details`}
                    draggable
                    onClick={() => onOpenCard(card.role.id)}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget) return
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        onOpenCard(card.role.id)
                      }
                    }}
                    onDragStart={(event) => {
                      event.dataTransfer.setData('text/plain', card.role.id)
                      event.dataTransfer.effectAllowed = 'move'
                      onDragStartCard(card.role.id)
                    }}
                    onDragEnd={onDragEnd}
                  >
                    <div className="pipeline-card-company">{card.role.company}</div>
                    <div className="pipeline-card-role">{card.role.role}</div>
                    <div className="pipeline-card-chips">
                      {card.role.term === null || card.role.term === undefined ? null : (
                        <Pill
                          variant="tag"
                          colorway={termColorway(card.role.term)}
                          label={card.role.term}
                        />
                      )}
                      {card.column === 'to_apply' && card.role.datePosted !== null ? (
                        <Pill
                          variant="tag"
                          colorway={postedColorway(card.role.datePosted, today)}
                          label={postedLabel(card.role.datePosted, today)}
                        />
                      ) : null}
                      {card.column !== 'to_apply' && card.role.appliedDate !== null ? (
                        <Pill
                          variant="tag"
                          colorway="neutral"
                          label={appliedLabel(card.role.appliedDate)}
                        />
                      ) : null}
                      {card.detailTone === null ? null : (
                        <Pill variant="tag" colorway={card.detailTone} label={card.detail} />
                      )}
                    </div>
                    <CardMenu
                      card={card}
                      onMove={(stage) => onMoveCard(card.role.id, stage)}
                      onRemove={() => onRemoveCard(card.role.id)}
                    />
                  </div>
                ))
              )}
              {over ? <div className="pipeline-drop-slot" aria-hidden="true" /> : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}
