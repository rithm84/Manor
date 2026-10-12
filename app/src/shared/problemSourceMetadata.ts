import { z } from 'zod'

export const problemSourceDateSchema = z.object({
  value: z.string().max(40), precision: z.enum(['day', 'month', 'year', 'instant'])
}).superRefine((value, context) => {
  const patterns = { day: /^\d{4}-\d{2}-\d{2}$/, month: /^\d{4}-\d{2}$/, year: /^\d{4}$/, instant: /^\d{4}-\d{2}-\d{2}T/ }
  const date = value.precision === 'year' ? `${value.value}-01-01` : value.precision === 'month' ? `${value.value}-01` : value.value
  const parsed = Date.parse(date)
  if (!/^[1-9]\d{3}/.test(value.value) || !patterns[value.precision].test(value.value) || !Number.isFinite(parsed) || (value.precision !== 'instant' && new Date(parsed).toISOString().slice(0, date.length) !== date)) context.addIssue({ code: 'custom', message: 'Source date must be a valid date at its stated precision' })
  if (value.precision === 'instant' && !z.iso.datetime({ offset: true }).safeParse(value.value).success) context.addIssue({ code: 'custom', message: 'Source instants require an explicit UTC offset' })
})
const sourceUrl = z.url().max(2000).refine(value => /^https?:\/\//.test(value), 'Source provenance requires HTTP or HTTPS')
const day = z.iso.date()
export const problemSourceMetadataSchema = z.object({
  lastAsked: problemSourceDateSchema.optional(), reportedFrom: problemSourceDateSchema.optional(), reportedTo: problemSourceDateSchema.optional(),
  frequency: z.string().trim().min(1).max(100).optional(), reportCount: z.number().int().nonnegative().max(2147483647).optional(),
  difficultySource: z.enum(['official', 'estimated']).optional(),
  isNew: z.boolean().optional(), durationMinutes: z.number().int().nonnegative().max(1000000).optional(), status: z.string().trim().min(1).max(100).optional(),
  snapshots: z.array(z.object({ sourceUrl, snapshotDate: day, revision: z.string().min(1).max(200).optional() })).max(100).optional(),
  companyReports: z.array(z.object({
    company: z.string().trim().min(1).max(100), window: z.enum(['30d', '3m', '6m', '1y', 'all', 'older_than_6m']),
    frequency: z.number().min(0).max(100).nullable(), acceptance: z.number().min(0).max(100).nullable(),
    snapshotDate: day, sourceUrl, sourceRevision: z.string().min(1).max(200)
  })).max(5000).optional()
})
export type ProblemSourceDate = z.infer<typeof problemSourceDateSchema>
export type ProblemSourceMetadata = z.infer<typeof problemSourceMetadataSchema>

/** Coarse source dates are intervals; filters retain their actual stated precision. */
export function problemSourceDateBounds(value: ProblemSourceDate): readonly [string, string] {
  if (value.precision === 'instant') { const dayValue = new Date(value.value).toISOString().slice(0, 10); return [dayValue, dayValue] }
  if (value.precision === 'day') return [value.value, value.value]
  if (value.precision === 'year') return [`${value.value}-01-01`, `${value.value}-12-31`]
  const [year, month] = value.value.split('-').map(Number)
  const last = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)
  return [`${value.value}-01`, last]
}
