export const JOB_STAGES = [
  'to_apply',
  'applied',
  'oa',
  'interview_1',
  'interview_2',
  'interview_3',
  'offer',
  'rejected'
] as const

export type JobStage = (typeof JOB_STAGES)[number]

export interface JobRoleFields {
  company: string
  role: string
  location: string
  postingLink: string
  datePosted: string | null
  stage: JobStage
  appliedDate: string | null
  oaDueDate: string | null
  interview1Date: string | null
  interview2Date: string | null
  interview3Date: string | null
  decisionDate: string | null
  /** ResumeVersion id the application was sent with. Optional on input so
      pre-resume rows and seeds stay valid; parsing always emits null. */
  resumeId?: string | null
}

export interface JobRole extends JobRoleFields {
  id: string
  createdAt: string
  updatedAt: string
}

export interface JobStageTransition {
  id: string
  roleId: string
  fromStage: JobStage | null
  toStage: JobStage
  changedAt: string
}

export interface JobsSeed {
  today: string
  roles: readonly JobRole[]
  transitions: readonly JobStageTransition[]
}

export interface JobsState {
  today: string
  roles: readonly JobRole[]
  transitions: readonly JobStageTransition[]
}

export interface JobRoleUpdate {
  id: string
  fields: JobRoleFields
}

export interface JobStageMutation {
  id: string
  stage: JobStage
}

export interface JobsApi {
  load: (seed: JobsSeed) => Promise<JobsState>
  createRole: (fields: JobRoleFields) => Promise<JobsState>
  updateRole: (mutation: JobRoleUpdate) => Promise<JobsState>
  setStage: (mutation: JobStageMutation) => Promise<JobsState>
  deleteRole: (roleId: string) => Promise<JobsState>
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const MAX_NAME_LENGTH = 160
const MAX_LOCATION_LENGTH = 160

function recordValue(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${label} must be a non-empty string`)
  }
  return value.trim()
}

function limitedString(value: unknown, label: string, maxLength: number): string {
  const text = stringValue(value, label)
  if (text.length > maxLength) {
    throw new RangeError(`${label} must be ${maxLength} characters or fewer`)
  }
  return text
}

function optionalString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string') {
    throw new TypeError(`${label} must be a string`)
  }
  const text = value.trim()
  if (text.length > maxLength) {
    throw new RangeError(`${label} must be ${maxLength} characters or fewer`)
  }
  return text
}

function timestampValue(value: unknown, label: string): string {
  const timestamp = stringValue(value, label)
  if (Number.isNaN(Date.parse(timestamp))) {
    throw new TypeError(`${label} must be an ISO timestamp`)
  }
  return timestamp
}

export function parseJobDate(value: unknown, label: string): string {
  const date = stringValue(value, label)
  if (!ISO_DATE_PATTERN.test(date)) {
    throw new TypeError(`${label} must use YYYY-MM-DD format`)
  }
  const parsed = new Date(`${date}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new TypeError(`${label} must be a real calendar date`)
  }
  return date
}

export function jobLocalDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return parseJobDate(`${year}-${month}-${day}`, 'current local job date')
}

function nullableDate(value: unknown, label: string): string | null {
  return value === null ? null : parseJobDate(value, label)
}

export function parseJobStage(value: unknown, label: string): JobStage {
  if (typeof value !== 'string' || !JOB_STAGES.includes(value as JobStage)) {
    throw new TypeError(`${label} must be one of ${JOB_STAGES.join(', ')}`)
  }
  return value as JobStage
}

function nullableStage(value: unknown, label: string): JobStage | null {
  return value === null ? null : parseJobStage(value, label)
}

function nullableResumeId(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null
  }
  return stringValue(value, 'job.resumeId')
}

function postingLink(value: unknown): string {
  const link = optionalString(value, 'job.postingLink', 2000)
  if (link === '') {
    return link
  }
  let parsed: URL
  try {
    parsed = new URL(link)
  } catch {
    throw new TypeError('job.postingLink must be a valid URL')
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new TypeError('job.postingLink must use http or https')
  }
  return link
}

export function parseJobRoleFields(value: unknown): JobRoleFields {
  const fields = recordValue(value, 'job role fields')
  return {
    company: limitedString(fields.company, 'job.company', MAX_NAME_LENGTH),
    role: limitedString(fields.role, 'job.role', MAX_NAME_LENGTH),
    location: optionalString(fields.location, 'job.location', MAX_LOCATION_LENGTH),
    postingLink: postingLink(fields.postingLink),
    datePosted: nullableDate(fields.datePosted, 'job.datePosted'),
    stage: parseJobStage(fields.stage, 'job.stage'),
    appliedDate: nullableDate(fields.appliedDate, 'job.appliedDate'),
    oaDueDate: nullableDate(fields.oaDueDate, 'job.oaDueDate'),
    interview1Date: nullableDate(fields.interview1Date, 'job.interview1Date'),
    interview2Date: nullableDate(fields.interview2Date, 'job.interview2Date'),
    interview3Date: nullableDate(fields.interview3Date, 'job.interview3Date'),
    decisionDate: nullableDate(fields.decisionDate, 'job.decisionDate'),
    resumeId: nullableResumeId(fields.resumeId)
  }
}

export function parseJobRole(value: unknown): JobRole {
  const role = recordValue(value, 'job role')
  return {
    id: stringValue(role.id, 'job.id'),
    ...parseJobRoleFields(role),
    createdAt: timestampValue(role.createdAt, 'job.createdAt'),
    updatedAt: timestampValue(role.updatedAt, 'job.updatedAt')
  }
}

export function parseJobTransition(value: unknown): JobStageTransition {
  const transition = recordValue(value, 'job stage transition')
  return {
    id: stringValue(transition.id, 'transition.id'),
    roleId: stringValue(transition.roleId, 'transition.roleId'),
    fromStage: nullableStage(transition.fromStage, 'transition.fromStage'),
    toStage: parseJobStage(transition.toStage, 'transition.toStage'),
    changedAt: timestampValue(transition.changedAt, 'transition.changedAt')
  }
}

export function parseJobsSeed(value: unknown): JobsSeed {
  const seed = recordValue(value, 'jobs seed')
  if (!Array.isArray(seed.roles) || !Array.isArray(seed.transitions)) {
    throw new TypeError('jobs seed roles and transitions must be arrays')
  }
  const roles = seed.roles.map(parseJobRole)
  const transitions = seed.transitions.map(parseJobTransition)
  const roleIds = new Set(roles.map((role) => role.id))
  if (roleIds.size !== roles.length) {
    throw new TypeError('jobs seed roles must have unique ids')
  }
  const transitionIds = new Set(transitions.map((transition) => transition.id))
  if (transitionIds.size !== transitions.length) {
    throw new TypeError('jobs seed transitions must have unique ids')
  }
  transitions.forEach((transition) => {
    if (!roleIds.has(transition.roleId)) {
      throw new TypeError(`job transition ${transition.id} references missing role ${transition.roleId}`)
    }
  })
  return { today: parseJobDate(seed.today, 'jobs.today'), roles, transitions }
}

export function parseJobRoleUpdate(value: unknown): JobRoleUpdate {
  const mutation = recordValue(value, 'job role update')
  return {
    id: stringValue(mutation.id, 'job update id'),
    fields: parseJobRoleFields(mutation.fields)
  }
}

export function parseJobStageMutation(value: unknown): JobStageMutation {
  const mutation = recordValue(value, 'job stage mutation')
  return {
    id: stringValue(mutation.id, 'job stage mutation id'),
    stage: parseJobStage(mutation.stage, 'job stage mutation stage')
  }
}

export function parseJobRoleId(value: unknown): string {
  return stringValue(value, 'job role id')
}
