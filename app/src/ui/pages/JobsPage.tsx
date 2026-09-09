import { useManorService } from '../services/ManorServices'
import { Briefcase, Plus } from 'lucide-react'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import type { JobRoleFields, JobsState, JobStage } from '../../shared/jobs'
import { Button, EmptyState, Modal } from '../components/ui'
import { AddRoleModal } from './jobs/AddRoleModal'
import { JobDetailModal } from './jobs/JobDetailModal'
import { JobsBrowse } from './jobs/JobsBrowse'
import { PipelineBoard } from './jobs/PipelineBoard'
import type { DragPayload, JobColumn } from './jobs/jobsModel'
import {
  fieldsForStageChange,
  stageForColumn,
  toBoardCard
} from './jobs/jobsModel'
import { useJobsView } from './jobs/jobsViewState'
import type { JobsView } from './jobs/jobsViewState'
import './jobs/jobs.css'

const JobsFlow = lazy(async () => {
  const module = await import('./jobs/JobsFlow')
  return { default: module.JobsFlow }
})
const VIEW_TABS: readonly { value: JobsView; label: string }[] = [
  { value: 'pipeline', label: 'Pipeline' },
  { value: 'browse', label: 'Listings' }
]
const ARRIVE_FLASH_MS = 1200
const CLICK_SUPPRESS_MS = 150

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'An unknown Jobs persistence error occurred'
}

function freshRolesNote(state: JobsState): string | null {
  const fresh = state.roles.filter(
    (role) => role.stage === 'to_apply' && role.datePosted === state.today
  ).length
  return fresh === 0 ? null : `${fresh} new today`
}

export function JobsPage(): ReactNode {
  const jobsApi = useManorService('jobs')
  const [state, setState] = useState<JobsState | null>(null)
  const [loading, setLoading] = useState(true)
  const [persistError, setPersistError] = useState<string | null>(null)
  const [arrivedIds, setArrivedIds] = useState<ReadonlySet<string>>(new Set())
  const [addOpen, setAddOpen] = useState(false)
  const [dragging, setDragging] = useState<DragPayload | null>(null)
  const [detailRoleId, setDetailRoleId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [removeCandidateId, setRemoveCandidateId] = useState<string | null>(null)
  const [view, setView] = useJobsView()
  const timers = useRef<Set<number>>(new Set())
  const suppressClick = useRef(false)

  useEffect(() => {
    let cancelled = false
    void jobsApi.load().then((loaded) => {
      if (!cancelled) {
        setState(loaded)
        setLoading(false)
      }
    }).catch((error: unknown) => {
      console.error('Jobs persistence load failed', { error })
      if (!cancelled) {
        setPersistError(errorMessage(error))
        setLoading(false)
      }
    })
    return (): void => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const pending = timers.current
    return (): void => {
      pending.forEach((timer) => window.clearTimeout(timer))
      pending.clear()
    }
  }, [])

  const persist = async (
    operation: string,
    mutation: () => Promise<JobsState>
  ): Promise<void> => {
    try {
      const next = await mutation()
      setState(next)
      setPersistError(null)
    } catch (error) {
      console.error('Jobs persistence operation failed', { operation, error })
      setPersistError(`${operation}: ${errorMessage(error)}`)
    }
  }

  const later = (operation: () => void, milliseconds: number): void => {
    const timer = window.setTimeout(() => {
      timers.current.delete(timer)
      operation()
    }, milliseconds)
    timers.current.add(timer)
  }

  const endDrag = (): void => {
    setDragging(null)
    suppressClick.current = true
    later(() => {
      suppressClick.current = false
    }, CLICK_SUPPRESS_MS)
  }

  const flashArrival = (roleId: string): void => {
    setArrivedIds((current) => new Set(current).add(roleId))
    later(() => {
      setArrivedIds((current) => {
        const next = new Set(current)
        next.delete(roleId)
        return next
      })
    }, ARRIVE_FLASH_MS)
  }

  if (loading) {
    return <div className="jobs-loading">Loading roles…</div>
  }

  if (state === null) {
    return <div className="jobs-error" role="alert">{persistError ?? 'Jobs data could not be loaded.'}</div>
  }

  // Rows mid leave-animation stay in the table (and out of the pipeline)
  // even though their stage change is already persisted.
  const toApplyCount = state.roles.filter((role) => role.stage === 'to_apply').length
  const cards = state.roles.map((role) => toBoardCard(role, state.today))
  const detailRole = detailRoleId === null
    ? null
    : state.roles.find((role) => role.id === detailRoleId) ?? null
  const empty = state.roles.length === 0
  const note = freshRolesNote(state)

  const updateStage = (roleId: string, stage: JobStage): void => {
    const role = state.roles.find((candidate) => candidate.id === roleId)
    if (role === undefined || role.stage === stage) return
    void persist('Could not change stage', () => jobsApi.updateRole({
      id: roleId,
      fields: fieldsForStageChange(role, stage, state.today)
    }))
    if (stage !== 'to_apply') flashArrival(roleId)
  }

  const dropOnColumn = (column: JobColumn): void => {
    if (dragging === null) return
    const role = state.roles.find((candidate) => candidate.id === dragging.id)
    if (role !== undefined) {
      updateStage(role.id, stageForColumn(column, role.stage))
    }
    setDragging(null)
  }

  const openDetail = (roleId: string): void => {
    if (suppressClick.current) return
    setDetailRoleId(roleId)
    setDetailOpen(true)
  }

  const removeCandidate = removeCandidateId === null
    ? null
    : state.roles.find((role) => role.id === removeCandidateId) ?? null

  const removeRole = (roleId: string): void => {
    if (detailRoleId === roleId) setDetailOpen(false)
    setRemoveCandidateId(null)
    void persist('Could not remove role', () => jobsApi.deleteRole(roleId))
  }

  return (
    <div className="jobs">
      <header className="jobs-header">
        <div>
          <h1 className="jobs-title display">Jobs</h1>
          <span className="jobs-meta tnum">
            {cards.length} {cards.length === 1 ? 'role' : 'roles'} · {toApplyCount} to apply
          </span>
        </div>
        <div className="jobs-header-actions">
          <div className="jobs-viewtabs" role="tablist" aria-label="Jobs view">
            {VIEW_TABS.map((tab) => (
              <button
                key={tab.value}
                type="button"
                role="tab"
                aria-selected={view === tab.value}
                className={view === tab.value ? 'is-selected' : ''}
                onClick={() => setView(tab.value)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => setAddOpen(true)}>
            Add role
          </Button>
        </div>
      </header>

      {persistError !== null ? <div className="jobs-error" role="alert">{persistError}</div> : null}

      {view === 'browse' ? (
        <JobsBrowse
          today={state.today}
          onAdded={(next) => {
            setState(next)
            setPersistError(null)
          }}
        />
      ) : empty ? (
        <EmptyState
          icon={<Briefcase size={20} />}
          title="No roles yet"
          message="Add a role, or open Listings to pull one from the feed."
          action={
            <Button variant="primary" icon={<Plus size={16} />} onClick={() => setAddOpen(true)}>
              Add role
            </Button>
          }
        />
      ) : (
        <div className="jobs-pipeline-stack">
          <section className="jobs-section jobs-board-section">
            <div className="jobs-section-head">
              <span className="jobs-section-title">
                Pipeline
                <span className="jobs-section-count">{cards.length}</span>
              </span>
              {note !== null ? <span className="jobs-section-note">{note}</span> : null}
            </div>
            <PipelineBoard
              cards={cards}
              today={state.today}
              arrivedIds={arrivedIds}
              dragging={dragging}
              onDragStartCard={(roleId) => setDragging({ kind: 'pipeline', id: roleId })}
              onDragEnd={endDrag}
              onDropOnColumn={dropOnColumn}
              onOpenCard={openDetail}
              onMoveCard={updateStage}
              onRemoveCard={(roleId) => setRemoveCandidateId(roleId)}
            />
          </section>

          <section className="jobs-section jobs-flow-section">
            <div className="jobs-section-head">
              <span className="jobs-section-title">Flow</span>
            </div>
            <Suspense fallback={<div className="jobs-loading">Loading flow…</div>}>
              <JobsFlow transitions={state.transitions} />
            </Suspense>
          </section>
        </div>
      )}

      <JobDetailModal
        role={detailRole}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        onSave={async (roleId, fields) => {
          // Close only once the persist lands; a failure keeps the modal
          // (and its field state) open, with the error shown inside it.
          const next = await jobsApi.updateRole({ id: roleId, fields })
          setState(next)
          setPersistError(null)
          setDetailOpen(false)
        }}
      />

      <AddRoleModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAdd={async (fields: JobRoleFields) => {
          const next = await jobsApi.createRole(fields)
          setState(next)
          setPersistError(null)
          setAddOpen(false)
        }}
      />

      <Modal
        open={removeCandidate !== null}
        onClose={() => setRemoveCandidateId(null)}
        width={420}
        ariaLabel="Delete role"
      >
        <div className="ui-confirm">
          <h2>Delete this role?</h2>
          <p>{removeCandidate?.company ?? 'This role'} comes off the board. Its stage history goes with it.</p>
          <div className="ui-confirm-actions">
            <Button variant="ghost" onClick={() => setRemoveCandidateId(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (removeCandidate !== null) removeRole(removeCandidate.id)
              }}
            >
              Delete
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
