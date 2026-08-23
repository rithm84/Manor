import { Briefcase, Plus } from 'lucide-react'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import type { JobRoleFields, JobsState, JobStage } from '../../../shared/jobs'
import { Button, EmptyState } from '../components/ui'
import { AddRoleModal } from './jobs/AddRoleModal'
import { JobDetailModal } from './jobs/JobDetailModal'
import { PipelineBoard } from './jobs/PipelineBoard'
import { ToApplyTable } from './jobs/ToApplyTable'
import { createJobsSeed } from './jobs/jobsSeed'
import type { DragPayload, JobColumn } from './jobs/jobsModel'
import {
  fieldsForStageChange,
  stageForColumn,
  toBoardCard
} from './jobs/jobsModel'
import './jobs/jobs.css'

type JobsView = 'board' | 'flow'

const JOBS_SEED = createJobsSeed()
const JobsFlow = lazy(async () => {
  const module = await import('./jobs/JobsFlow')
  return { default: module.JobsFlow }
})
const ROW_LEAVE_MS = 220
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
  const [state, setState] = useState<JobsState | null>(null)
  const [loading, setLoading] = useState(true)
  const [persistError, setPersistError] = useState<string | null>(null)
  const [leavingIds, setLeavingIds] = useState<ReadonlySet<string>>(new Set())
  const [arrivedIds, setArrivedIds] = useState<ReadonlySet<string>>(new Set())
  const [addOpen, setAddOpen] = useState(false)
  const [dragging, setDragging] = useState<DragPayload | null>(null)
  const [detailRoleId, setDetailRoleId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [view, setView] = useState<JobsView>('board')
  const timers = useRef<Set<number>>(new Set())
  const suppressClick = useRef(false)

  useEffect(() => {
    let cancelled = false
    void window.manor.jobs.load(JOBS_SEED).then((loaded) => {
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

  const toApplyRoles = state.roles.filter((role) => role.stage === 'to_apply')
  const cards = state.roles
    .filter((role) => role.stage !== 'to_apply')
    .map((role) => toBoardCard(role, state.today))
  const detailRole = detailRoleId === null
    ? null
    : state.roles.find((role) => role.id === detailRoleId) ?? null
  const empty = state.roles.length === 0
  const note = freshRolesNote(state)

  const updateStage = (roleId: string, stage: JobStage): void => {
    const role = state.roles.find((candidate) => candidate.id === roleId)
    if (role === undefined || role.stage === stage) return
    void persist('Could not change stage', () => window.manor.jobs.updateRole({
      id: roleId,
      fields: fieldsForStageChange(role, stage, state.today)
    }))
    if (stage !== 'to_apply') flashArrival(roleId)
  }

  const markApplied = (roleId: string): void => {
    if (leavingIds.has(roleId)) return
    setLeavingIds((current) => new Set(current).add(roleId))
    later(() => {
      setLeavingIds((current) => {
        const next = new Set(current)
        next.delete(roleId)
        return next
      })
      updateStage(roleId, 'applied')
    }, ROW_LEAVE_MS)
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

  return (
    <div className="jobs">
      <header className="jobs-header">
        <div>
          <h1 className="jobs-title display">Jobs</h1>
          <span className="jobs-meta tnum">
            {toApplyRoles.length} to apply · {cards.length} in the pipeline
          </span>
        </div>
        <Button variant="primary" icon={<Plus size={16} />} onClick={() => setAddOpen(true)}>
          Add role
        </Button>
      </header>

      {persistError !== null ? <div className="jobs-error" role="alert">{persistError}</div> : null}

      {empty ? (
        <EmptyState
          icon={<Briefcase size={20} />}
          title="No roles yet"
          message="Add a role to start your pipeline."
          action={
            <Button variant="primary" icon={<Plus size={16} />} onClick={() => setAddOpen(true)}>
              Add role
            </Button>
          }
        />
      ) : (
        <>
          <section className="jobs-section jobs-toapply-section">
            <div className="jobs-section-head">
              <span className="jobs-section-title">
                To apply
                <span className="jobs-section-count">{toApplyRoles.length}</span>
              </span>
              {note !== null ? <span className="jobs-section-note">{note}</span> : null}
            </div>
            <ToApplyTable
              roles={toApplyRoles}
              today={state.today}
              leavingIds={leavingIds}
              onMarkApplied={markApplied}
              onOpenRole={openDetail}
              onDragStartRole={(roleId) => setDragging({ kind: 'to_apply', id: roleId })}
              onDragEnd={endDrag}
            />
          </section>

          <section className="jobs-section jobs-pipeline-section">
            <div className="jobs-section-head jobs-pipeline-head">
              <span className="jobs-section-title">
                Pipeline
                <span className="jobs-section-count">{cards.length}</span>
              </span>
              <div className="jobs-viewtabs" role="tablist" aria-label="Pipeline view">
                <button type="button" role="tab" aria-selected={view === 'board'} className={view === 'board' ? 'is-selected' : ''} onClick={() => setView('board')}>Board</button>
                <button type="button" role="tab" aria-selected={view === 'flow'} className={view === 'flow' ? 'is-selected' : ''} onClick={() => setView('flow')}>Flow</button>
              </div>
            </div>
            {view === 'board' ? (
              <PipelineBoard
                cards={cards}
                arrivedIds={arrivedIds}
                dragging={dragging}
                onDragStartCard={(roleId) => setDragging({ kind: 'pipeline', id: roleId })}
                onDragEnd={endDrag}
                onDropOnColumn={dropOnColumn}
                onOpenCard={openDetail}
                onMoveCard={updateStage}
                onRemoveCard={(roleId) => {
                  if (detailRoleId === roleId) setDetailOpen(false)
                  void persist('Could not remove role', () => window.manor.jobs.deleteRole(roleId))
                }}
              />
            ) : (
              <Suspense fallback={<div className="jobs-loading">Loading flow…</div>}>
                <JobsFlow transitions={state.transitions} />
              </Suspense>
            )}
          </section>
        </>
      )}

      <JobDetailModal
        role={detailRole}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        onSave={(roleId, fields) => {
          setDetailOpen(false)
          void persist('Could not save role', () => window.manor.jobs.updateRole({ id: roleId, fields }))
        }}
      />

      <AddRoleModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAdd={(fields: JobRoleFields) => {
          setAddOpen(false)
          void persist('Could not add role', () => window.manor.jobs.createRole(fields))
        }}
      />
    </div>
  )
}
