import { Briefcase, Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { Button, EmptyState } from '../components/ui'
import { jobsFunnel, pipeline, toApply } from '../data/mock'
import { AddRoleModal } from './jobs/AddRoleModal'
import type { RoleDraft } from './jobs/AddRoleModal'
import { Funnel } from './jobs/Funnel'
import { JobPeek } from './jobs/JobPeek'
import type { PeekData, StageValue } from './jobs/JobPeek'
import { PipelineBoard } from './jobs/PipelineBoard'
import { ToApplyTable } from './jobs/ToApplyTable'
import type { BoardCard, DragPayload, JobColumn, LocalPosting } from './jobs/jobsModel'
import { detailForMove, toBoardCard, toLocalPosting } from './jobs/jobsModel'
import './jobs/jobs.css'

const ROW_LEAVE_MS = 220
const ARRIVE_FLASH_MS = 1200
const CLICK_SUPPRESS_MS = 150

type PeekSubject = { kind: 'card'; id: string } | { kind: 'posting'; id: string }

function freshRolesNote(postings: readonly LocalPosting[]): string | null {
  const fresh = postings.filter((posting) => posting.ageDays === 0).length
  if (fresh === 0) {
    return null
  }
  const words = ['One', 'Two', 'Three', 'Four', 'Five', 'Six']
  const word = fresh <= words.length ? words[fresh - 1] : `${fresh}`
  return fresh === 1 ? 'One arrived this morning.' : `${word} arrived this morning.`
}

/** Jobs: the to-apply queue on top, the live pipeline underneath. */
export function JobsPage(): ReactNode {
  const [postings, setPostings] = useState<readonly LocalPosting[]>(toApply.map(toLocalPosting))
  const [cards, setCards] = useState<readonly BoardCard[]>(pipeline.map(toBoardCard))
  const [leavingIds, setLeavingIds] = useState<ReadonlySet<string>>(new Set())
  const [arrivedIds, setArrivedIds] = useState<ReadonlySet<string>>(new Set())
  const [addOpen, setAddOpen] = useState(false)
  const [dragging, setDragging] = useState<DragPayload | null>(null)
  const [peekSubject, setPeekSubject] = useState<PeekSubject | null>(null)
  const [peekOpen, setPeekOpen] = useState(false)
  const timers = useRef<Set<number>>(new Set())
  const suppressClick = useRef(false)

  useEffect(() => {
    const pending = timers.current
    return (): void => {
      pending.forEach((timer) => window.clearTimeout(timer))
      pending.clear()
    }
  }, [])

  const later = (fn: () => void, ms: number): void => {
    const timer = window.setTimeout(() => {
      timers.current.delete(timer)
      fn()
    }, ms)
    timers.current.add(timer)
  }

  /** A finished drag swallows the click the browser may still deliver. */
  const endDrag = (): void => {
    setDragging(null)
    suppressClick.current = true
    later(() => {
      suppressClick.current = false
    }, CLICK_SUPPRESS_MS)
  }

  const flashArrival = (cardId: string): void => {
    setArrivedIds((current) => new Set(current).add(cardId))
    later(() => {
      setArrivedIds((current) => {
        const next = new Set(current)
        next.delete(cardId)
        return next
      })
    }, ARRIVE_FLASH_MS)
  }

  const cardFromPosting = (posting: LocalPosting, column: JobColumn): BoardCard => ({
    id: `card-${posting.id}`,
    company: posting.company,
    role: posting.role,
    column,
    detail: detailForMove(column),
    dueSoon: false,
    oaDueDate: null,
    outcome: null,
    link: posting.link,
    notes: posting.notes
  })

  /** Shared conversion: posting leaves the queue, a card lands and flashes. */
  const convertPosting = (postingId: string, column: JobColumn): BoardCard | null => {
    const posting = postings.find((candidate) => candidate.id === postingId)
    if (posting === undefined) {
      return null
    }
    setPostings((current) => current.filter((candidate) => candidate.id !== postingId))
    const card = cardFromPosting(posting, column)
    setCards((current) => [card, ...current])
    flashArrival(card.id)
    return card
  }

  const markApplied = (postingId: string): void => {
    if (leavingIds.has(postingId)) {
      return
    }
    setLeavingIds((current) => new Set(current).add(postingId))
    later(() => {
      setLeavingIds((current) => {
        const next = new Set(current)
        next.delete(postingId)
        return next
      })
      convertPosting(postingId, 'applied')
    }, ROW_LEAVE_MS)
  }

  const dropOnColumn = (column: JobColumn): void => {
    if (dragging === null) {
      return
    }
    if (dragging.kind === 'card') {
      moveCard(dragging.id, column)
    } else if (column === 'applied') {
      convertPosting(dragging.id, 'applied')
    }
    setDragging(null)
  }

  const moveCard = (cardId: string, column: JobColumn): void => {
    setCards((current) =>
      current.map((card) =>
        card.id === cardId
          ? {
              ...card,
              column,
              detail: detailForMove(column),
              dueSoon: false,
              oaDueDate: null,
              outcome: column === 'decided' ? card.outcome : null
            }
          : card
      )
    )
  }

  const removeCard = (cardId: string): void => {
    if (peekSubject !== null && peekSubject.kind === 'card' && peekSubject.id === cardId) {
      setPeekOpen(false)
    }
    setCards((current) => current.filter((card) => card.id !== cardId))
  }

  const addRole = (draft: RoleDraft): void => {
    setAddOpen(false)
    if (draft.destination === 'toapply') {
      const posting: LocalPosting = {
        id: `job-local-${Date.now()}`,
        company: draft.company,
        role: draft.role,
        location: '',
        ageDays: 0,
        link: draft.link,
        notes: ''
      }
      setPostings((current) => [posting, ...current])
      return
    }
    const card: BoardCard = {
      id: `card-local-${Date.now()}`,
      company: draft.company,
      role: draft.role,
      column: draft.destination,
      detail: detailForMove(draft.destination),
      dueSoon: false,
      oaDueDate: null,
      outcome: null,
      link: draft.link,
      notes: ''
    }
    setCards((current) => [card, ...current])
    flashArrival(card.id)
  }

  // --- Side peek -----------------------------------------------------------

  const openPeek = (subject: PeekSubject): void => {
    if (suppressClick.current) {
      return
    }
    setPeekSubject(subject)
    setPeekOpen(true)
  }

  const peekData: PeekData | null = (() => {
    if (peekSubject === null) {
      return null
    }
    if (peekSubject.kind === 'card') {
      const card = cards.find((candidate) => candidate.id === peekSubject.id)
      return card !== undefined ? { kind: 'card', card } : null
    }
    const posting = postings.find((candidate) => candidate.id === peekSubject.id)
    return posting !== undefined ? { kind: 'posting', posting } : null
  })()

  const peekChangeStage = (stage: StageValue): void => {
    if (peekSubject === null || stage === 'toapply') {
      return
    }
    if (peekSubject.kind === 'card') {
      moveCard(peekSubject.id, stage)
      return
    }
    const card = convertPosting(peekSubject.id, stage)
    if (card !== null) {
      setPeekSubject({ kind: 'card', id: card.id })
    }
  }

  const peekEditLink = (link: string): void => {
    if (peekSubject === null) {
      return
    }
    if (peekSubject.kind === 'card') {
      setCards((current) =>
        current.map((card) => (card.id === peekSubject.id ? { ...card, link } : card))
      )
      return
    }
    setPostings((current) =>
      current.map((posting) => (posting.id === peekSubject.id ? { ...posting, link } : posting))
    )
  }

  const peekEditNotes = (notes: string): void => {
    if (peekSubject === null) {
      return
    }
    if (peekSubject.kind === 'card') {
      setCards((current) =>
        current.map((card) => (card.id === peekSubject.id ? { ...card, notes } : card))
      )
      return
    }
    setPostings((current) =>
      current.map((posting) => (posting.id === peekSubject.id ? { ...posting, notes } : posting))
    )
  }

  const empty = postings.length === 0 && cards.length === 0
  const note = freshRolesNote(postings)

  return (
    <div className="jobs">
      <header className="jobs-header">
        <div>
          <h1 className="jobs-title display">Jobs</h1>
          <span className="jobs-meta tnum">
            {postings.length} to apply · {cards.length} in the pipeline
          </span>
        </div>
        <Button variant="primary" icon={<Plus size={16} />} onClick={() => setAddOpen(true)}>
          Add role
        </Button>
      </header>

      {empty ? (
        <EmptyState
          icon={<Briefcase size={20} />}
          title="The season starts here"
          message="Add the first role you want and the pipeline builds itself around it."
          action={
            <Button variant="primary" icon={<Plus size={16} />} onClick={() => setAddOpen(true)}>
              Add role
            </Button>
          }
        />
      ) : (
        <>
          <section className="jobs-section">
            <div className="jobs-section-head">
              <span className="jobs-section-title">
                To apply
                <span className="jobs-section-count">{postings.length}</span>
              </span>
              {note !== null ? <span className="jobs-section-note">{note}</span> : null}
            </div>
            <ToApplyTable
              postings={postings}
              leavingIds={leavingIds}
              onMarkApplied={markApplied}
              onOpenPosting={(postingId) => openPeek({ kind: 'posting', id: postingId })}
              onDragStartPosting={(postingId) => setDragging({ kind: 'posting', id: postingId })}
              onDragEnd={endDrag}
            />
          </section>

          <section className="jobs-section">
            <div className="jobs-section-head">
              <span className="jobs-section-title">
                Pipeline
                <span className="jobs-section-count">{cards.length}</span>
              </span>
              <Funnel funnel={jobsFunnel} />
            </div>
            <PipelineBoard
              cards={cards}
              arrivedIds={arrivedIds}
              dragging={dragging}
              onDragStartCard={(cardId) => setDragging({ kind: 'card', id: cardId })}
              onDragEnd={endDrag}
              onDropOnColumn={dropOnColumn}
              onOpenCard={(cardId) => openPeek({ kind: 'card', id: cardId })}
              onMoveCard={moveCard}
              onRemoveCard={removeCard}
            />
          </section>
        </>
      )}

      <JobPeek
        data={peekData}
        open={peekOpen}
        onClose={() => setPeekOpen(false)}
        onChangeStage={peekChangeStage}
        onEditLink={peekEditLink}
        onEditNotes={peekEditNotes}
      />

      <AddRoleModal open={addOpen} onClose={() => setAddOpen(false)} onAdd={addRole} />
    </div>
  )
}
