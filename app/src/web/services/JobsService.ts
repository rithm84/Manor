import { z } from 'zod'
import { parseJobRole, parseJobRoleFields, parseJobTransition } from '../../shared/jobs'
import type { JobsApi, JobsState, JobRole, JobRoleFields, JobRoleUpdate, JobStageMutation } from '../../shared/jobs'
import type { JobFeedPage } from '../../shared/jobFeed'
import type { ManorGateway, JsonObject } from '../ManorGateway'
import { accountToday, camelRow, rowRevision } from './rows'

function roleFromRow(row: JsonObject): JobRole {
  return { ...parseJobRole({ ...camelRow(row), postingLink: row.link, datePosted: row.posted, appliedDate: row.applied,
    oaDueDate: row.oa_due, interview1Date: row.interview1, interview2Date: row.interview2, interview3Date: row.interview3, decisionDate: row.decision }), revision: rowRevision(row) }
}
function roleFields(fields: JobRoleFields): JsonObject {
  const role = parseJobRoleFields(fields)
  return { company: role.company, role: role.role, location: role.location, link: role.postingLink, posted: role.datePosted,
    stage: role.stage, applied: role.appliedDate, oa_due: role.oaDueDate, interview1: role.interview1Date,
    interview2: role.interview2Date, interview3: role.interview3Date, decision: role.decisionDate, resume_id: role.resumeId ?? null, term: role.term ?? null }
}
const listingSchema = z.object({ id: z.string(), company: z.string(), role: z.string(), locations: z.string(), url: z.url(), posted: z.iso.date(), term: z.string(), category: z.string(), active: z.boolean() })

export class JobsService implements JobsApi {
  private readonly gateway: ManorGateway
  constructor(gateway: ManorGateway) { this.gateway = gateway }
  async load(): Promise<JobsState> {
    const [rows, transitions, { today }] = await Promise.all([this.gateway.rows('job_roles'), this.gateway.rows('job_stage_transitions'), accountToday(this.gateway)])
    const roles = rows.filter((row) => row.deleted_at === null).map(roleFromRow)
    const ids = new Set(roles.map((role) => role.id))
    return { today, roles, transitions: transitions.filter((row) => ids.has(z.string().parse(row.role_id))).map((row) => parseJobTransition({ ...camelRow(row), changedAt: row.at })) }
  }
  async createRole(fields: JobRoleFields): Promise<JobsState> {
    await this.gateway.command('create_application', { id: crypto.randomUUID(), expected_revision: 0, ...roleFields(fields) }, crypto.randomUUID())
    return this.load()
  }
  async updateRole(mutation: JobRoleUpdate): Promise<JobsState> {
    await this.gateway.command('update_application', { id: mutation.id, expected_revision: z.number().int().positive().parse(mutation.expectedRevision), ...roleFields(mutation.fields) }, crypto.randomUUID())
    return this.load()
  }
  async setStage(mutation: JobStageMutation): Promise<JobsState> {
    await this.gateway.command('change_application_stage', { id: mutation.id, stage: mutation.stage, expected_revision: this.gateway.revision('job_roles', mutation.id) }, crypto.randomUUID())
    return this.load()
  }
  async deleteRole(roleId: string): Promise<JobsState> {
    await this.gateway.command('trash_application', { id: roleId, expected_revision: this.gateway.revision('job_roles', roleId) }, crypto.randomUUID())
    return this.load()
  }
  async feedList(): Promise<JobFeedPage> {
    const [rows, roles] = await Promise.all([this.gateway.rowsWhere('job_listings', [{ column: 'active', value: true }]), this.gateway.rows('job_roles')])
    const addedUrls = new Set(roles.filter((row) => row.deleted_at === null).map((row) => z.string().parse(row.link)))
    const listings = rows.map((row) => listingSchema.parse(row)).filter((row) => row.active).sort((a,b) => b.posted.localeCompare(a.posted)).map((row) => ({ ...row, added: addedUrls.has(row.url), openings: 1 }))
    return { listings, terms: [...new Set(listings.map((listing) => listing.term).filter(Boolean))].sort().reverse(), categories: [...new Set(listings.map((listing) => listing.category).filter(Boolean))].sort(), truncated: false }
  }
  async feedAdd(listingId: string): Promise<JobsState> {
    await this.gateway.command('add_job_listing', { listing_id: listingId }, crypto.randomUUID())
    return this.load()
  }
}
