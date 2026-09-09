import type { PillColorway } from '../../components/ui'
import type { JobRole, JobRoleFields, JobStage, JobStageTransition } from '../../../shared/jobs'

export type JobColumn = 'to_apply' | 'applied' | 'oa' | 'interview' | 'decided'

export type DragPayload =
  | { kind: 'pipeline'; id: string }
  | { kind: 'to_apply'; id: string }

export interface BoardCard {
  role: JobRole
  column: JobColumn
  detail: string
  detailTone: 'today' | 'plum' | 'success' | 'overdue' | null
}

export interface ColumnMeta {
  column: JobColumn
  label: string
  pillColorway: 'week' | 'forest' | 'today' | 'plum' | 'neutral'
}

export interface StageOption {
  value: JobStage
  label: string
  tone: 'neutral' | 'forest' | 'today' | 'plum' | 'success' | 'overdue'
}

export interface JobFlowNode {
  name: string
  stage: JobStage
}

export interface JobFlowLink {
  source: number
  target: number
  value: number
  sourceStage: JobStage
  targetStage: JobStage
}

export interface JobFlowData {
  nodes: readonly JobFlowNode[]
  links: readonly JobFlowLink[]
}

export const jobColumns: readonly ColumnMeta[] = [
  { column: 'to_apply', label: 'To apply', pillColorway: 'week' },
  { column: 'applied', label: 'Applied', pillColorway: 'forest' },
  { column: 'oa', label: 'OA', pillColorway: 'today' },
  { column: 'interview', label: 'Interviews', pillColorway: 'plum' },
  { column: 'decided', label: 'Decided', pillColorway: 'neutral' }
]

export const jobStageOptions: readonly StageOption[] = [
  { value: 'to_apply', label: 'To apply', tone: 'neutral' },
  { value: 'applied', label: 'Applied', tone: 'forest' },
  { value: 'oa', label: 'OA', tone: 'today' },
  { value: 'interview_1', label: 'Interview 1', tone: 'plum' },
  { value: 'interview_2', label: 'Interview 2', tone: 'plum' },
  { value: 'interview_3', label: 'Interview 3', tone: 'plum' },
  { value: 'offer', label: 'Offer', tone: 'success' },
  { value: 'rejected', label: 'Rejected', tone: 'overdue' }
]

const STAGE_ORDER: Readonly<Record<JobStage, number>> = {
  to_apply: 0,
  applied: 1,
  oa: 2,
  interview_1: 3,
  interview_2: 4,
  interview_3: 5,
  offer: 6,
  rejected: 6
}

function dateFromIso(date: string): Date {
  return new Date(`${date}T12:00:00.000Z`)
}

function dayDifference(date: string, today: string): number {
  return Math.round((dateFromIso(date).getTime() - dateFromIso(today).getTime()) / 86_400_000)
}

function shortDate(date: string): string {
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC'
  }).format(dateFromIso(date))
}

function weekday(date: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'long'
  }).format(dateFromIso(date))
}

function upcomingDate(date: string, today: string): string {
  const difference = dayDifference(date, today)
  if (difference === 0) return 'today'
  if (difference === 1) return 'tomorrow'
  if (difference > 1 && difference <= 6) return weekday(date)
  return shortDate(date)
}

export function stageLabel(stage: JobStage): string {
  const option = jobStageOptions.find((candidate) => candidate.value === stage)
  if (option === undefined) {
    throw new Error(`Jobs stage ${stage} has no display label`)
  }
  return option.label
}

export function columnForStage(stage: JobStage): JobColumn {
  switch (stage) {
    case 'to_apply':
      return 'to_apply'
    case 'applied':
      return 'applied'
    case 'oa':
      return 'oa'
    case 'interview_1':
    case 'interview_2':
    case 'interview_3':
      return 'interview'
    case 'offer':
    case 'rejected':
      return 'decided'
  }
}

export function stageForColumn(column: JobColumn, currentStage: JobStage): JobStage {
  switch (column) {
    case 'to_apply':
      return 'to_apply'
    case 'applied':
      return 'applied'
    case 'oa':
      return 'oa'
    case 'interview':
      return currentStage === 'interview_2' || currentStage === 'interview_3'
        ? currentStage
        : 'interview_1'
    case 'decided':
      return currentStage === 'offer' ? 'offer' : 'rejected'
  }
}

export function currentUpdateLabel(role: JobRole, today: string): string {
  switch (role.stage) {
    case 'to_apply':
      return role.datePosted === null ? 'Posted date not set' : `Posted ${shortDate(role.datePosted)}`
    case 'applied':
      return role.appliedDate === null ? 'Applied date not set' : `Applied ${shortDate(role.appliedDate)}`
    case 'oa': {
      if (role.oaDueDate === null) return 'OA due date not set'
      const difference = dayDifference(role.oaDueDate, today)
      return difference < 0
        ? `OA overdue ${shortDate(role.oaDueDate)}`
        : `OA due ${upcomingDate(role.oaDueDate, today)}`
    }
    case 'interview_1':
      return role.interview1Date === null
        ? 'Round 1 date not set'
        : `Round 1 ${upcomingDate(role.interview1Date, today)}`
    case 'interview_2':
      return role.interview2Date === null
        ? 'Round 2 date not set'
        : `Round 2 ${upcomingDate(role.interview2Date, today)}`
    case 'interview_3':
      return role.interview3Date === null
        ? 'Round 3 date not set'
        : `Round 3 ${upcomingDate(role.interview3Date, today)}`
    case 'offer':
      return role.decisionDate === null ? 'Offer' : `Offer ${shortDate(role.decisionDate)}`
    case 'rejected':
      return role.decisionDate === null ? 'Rejected' : `Rejected ${shortDate(role.decisionDate)}`
  }
}

export function toBoardCard(role: JobRole, today: string): BoardCard {
  const column = columnForStage(role.stage)
  const detailTone: BoardCard['detailTone'] = (() => {
    switch (role.stage) {
      case 'oa':
        return 'today'
      case 'interview_1':
      case 'interview_2':
      case 'interview_3':
        return 'plum'
      case 'offer':
        return 'success'
      case 'rejected':
        return 'overdue'
      case 'applied':
      case 'to_apply':
        return null
    }
  })()
  return {
    role,
    column,
    detail: currentUpdateLabel(role, today),
    detailTone
  }
}

/** Board-card pill once a role is past To apply: the day it was applied. */
export function appliedLabel(appliedDate: string): string {
  return `Applied ${shortDate(appliedDate)}`
}

export function postedLabel(datePosted: string | null, today: string): string {
  if (datePosted === null) return 'Not set'
  const difference = dayDifference(datePosted, today)
  if (difference === 0) return 'Today'
  if (difference === -1) return 'Yesterday'
  if (difference < -1 && difference >= -6) return `${Math.abs(difference)}d ago`
  return shortDate(datePosted)
}

/** Freshness of a feed posting: newest reads warmest, stale settles to neutral. */
export function postedColorway(posted: string, today: string): PillColorway {
  const age = -dayDifference(posted, today)
  if (age <= 0) return 'today'
  if (age <= 3) return 'tomorrow'
  if (age <= 14) return 'week'
  return 'neutral'
}

/** One colorway per hiring season, so a cycle always reads the same. */
export function termColorway(term: string): PillColorway {
  if (/summer/i.test(term)) return 'gold'
  if (/fall|autumn/i.test(term)) return 'plum'
  if (/spring/i.test(term)) return 'success'
  if (/winter/i.test(term)) return 'info'
  return 'neutral'
}

export function emptyJobRoleFields(stage: JobStage): JobRoleFields {
  return {
    company: '',
    role: '',
    location: '',
    postingLink: '',
    datePosted: null,
    stage,
    appliedDate: null,
    oaDueDate: null,
    interview1Date: null,
    interview2Date: null,
    interview3Date: null,
    decisionDate: null,
    resumeId: null
  }
}

/** Field-level equality for the dirty-close guard on the role modals. */
export function sameRoleFields(left: JobRoleFields, right: JobRoleFields): boolean {
  return (Object.keys(left) as readonly (keyof JobRoleFields)[]).every(
    (key) => left[key] === right[key]
  )
}

export function roleFields(role: JobRole): JobRoleFields {
  return {
    company: role.company,
    role: role.role,
    location: role.location,
    postingLink: role.postingLink,
    datePosted: role.datePosted,
    stage: role.stage,
    appliedDate: role.appliedDate,
    oaDueDate: role.oaDueDate,
    interview1Date: role.interview1Date,
    interview2Date: role.interview2Date,
    interview3Date: role.interview3Date,
    decisionDate: role.decisionDate,
    resumeId: role.resumeId ?? null,
    term: role.term ?? null
  }
}

export function fieldsForStageChange(
  role: JobRole,
  stage: JobStage,
  today: string
): JobRoleFields {
  const fields = roleFields(role)
  return {
    ...fields,
    stage,
    appliedDate: stage === 'applied' && fields.appliedDate === null ? today : fields.appliedDate,
    decisionDate:
      (stage === 'offer' || stage === 'rejected') && fields.decisionDate === null
        ? today
        : fields.decisionDate
  }
}

export function jobFlowData(transitions: readonly JobStageTransition[]): JobFlowData {
  /* The flow mirrors where each role actually stands, not every drag it
     survived. Events replay in order per role: a forward move extends the
     role's path, and a backward move is a correction that pops the hops it
     undoes, so a card dragged back reads as never having been there. */
  const paths = new Map<string, { from: JobStage; to: JobStage }[]>()
  const ordered = [...transitions].sort((left, right) =>
    left.changedAt.localeCompare(right.changedAt)
  )
  ordered.forEach((transition) => {
    if (transition.fromStage === null) return
    const path = paths.get(transition.roleId) ?? []
    const fromRank = STAGE_ORDER[transition.fromStage]
    const toRank = STAGE_ORDER[transition.toStage]
    if (toRank > fromRank) {
      // The queue is not part of the flow; edges begin at Applied.
      if (transition.fromStage !== 'to_apply') {
        path.push({ from: transition.fromStage, to: transition.toStage })
      }
    } else if (toRank < fromRank) {
      while (path.length > 0 && STAGE_ORDER[path[path.length - 1].to] > toRank) {
        path.pop()
      }
    }
    paths.set(transition.roleId, path)
  })

  const counts = new Map<string, { source: JobStage; target: JobStage; value: number }>()
  paths.forEach((path) => {
    path.forEach((edge) => {
      const key = `${edge.from}:${edge.to}`
      const current = counts.get(key)
      counts.set(key, {
        source: edge.from,
        target: edge.to,
        value: (current?.value ?? 0) + 1
      })
    })
  })

  const stageSet = new Set<JobStage>()
  counts.forEach((link) => {
    stageSet.add(link.source)
    stageSet.add(link.target)
  })
  const stages = [...stageSet].sort((first, second) => {
    const rankDifference = STAGE_ORDER[first] - STAGE_ORDER[second]
    return rankDifference === 0 ? first.localeCompare(second) : rankDifference
  })
  const indexByStage = new Map(stages.map((stage, index) => [stage, index]))
  const links = [...counts.values()].map((link): JobFlowLink => {
    const source = indexByStage.get(link.source)
    const target = indexByStage.get(link.target)
    if (source === undefined || target === undefined) {
      throw new Error(`Could not index jobs flow link ${link.source} to ${link.target}`)
    }
    return {
      source,
      target,
      value: link.value,
      sourceStage: link.source,
      targetStage: link.target
    }
  })
  return {
    nodes: stages.map((stage) => ({ name: stageLabel(stage), stage })),
    links
  }
}
