/** Runtime validation and deterministic identities for source-independent problem bundles. */
import { z } from 'zod'
import { createHash } from 'node:crypto'
import { problemSourceMetadataSchema } from '../../app/src/shared/problemSourceMetadata.ts'

const identifier = z.string().min(1).max(200)
const label = z.string().trim().min(1).max(100)
const labels = z.array(label).max(100).refine(value => new Set(value).size === value.length, 'Labels must be unique')
const language = z.enum(['cpp', 'c', 'python', 'javascript', 'java', 'go'])
const content = z.object({
  statement_markdown: z.string().min(1).max(1000000),
  examples: z.array(z.object({ input: z.string().max(100000), output: z.string().max(100000), explanation: z.string().max(100000).nullable() })).max(100),
  hints: z.array(z.string().min(1).max(100000)).max(100), solution_markdown: z.string().max(1000000).nullable(),
  starter_code: z.partialRecord(language, z.string().max(100000)),
  interface: z.looseObject({ kind: z.enum(['function', 'class', 'codec']) }).nullable().optional()
})
const testset = z.object({
  checker: z.enum(['exact', 'trimmed', 'json', 'numeric', 'json_unordered', 'json_unordered_deep', 'json_tolerant', 'special']), judge: z.string().max(65536).optional(), provenance: z.enum(['generated', 'source', 'user']),
  cases: z.array(z.object({ id: z.string().min(1).max(100), input: z.string().max(1048576).refine(value => Buffer.byteLength(value, 'utf8') <= 1048576, 'Case input exceeds 1 MiB of UTF-8'), expectedOutput: z.string().max(65536).refine(value => Buffer.byteLength(value, 'utf8') <= 65536, 'Expected output exceeds 64 KiB of UTF-8'), hidden: z.boolean() })).min(1).max(200)
}).superRefine((value, context) => {
  const ids = new Set()
  for (const [index, item] of value.cases.entries()) {
    if (ids.has(item.id)) context.addIssue({ code: 'custom', path: ['cases', index, 'id'], message: 'Case IDs must be unique within a testset' })
    ids.add(item.id)
    if (value.checker === 'numeric') {
      const tokens = item.expectedOutput.trim().split(/\s+/)
      if (tokens.length === 0 || tokens.some(token => !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(token) || !Number.isFinite(Number(token)))) context.addIssue({ code: 'custom', path: ['cases', index, 'expectedOutput'], message: 'Numeric answers require at least one finite decimal or scientific-notation token' })
    }
    if (['json', 'json_unordered', 'json_unordered_deep', 'json_tolerant'].includes(value.checker)) {
      let decoded
      try { decoded = JSON.parse(item.expectedOutput) }
      catch (error) {
        if (!(error instanceof SyntaxError)) throw error
        context.addIssue({ code: 'custom', path: ['cases', index, 'expectedOutput'], message: 'JSON answers must contain valid JSON' }); continue
      }
      if ((value.checker === 'json_unordered' || value.checker === 'json_unordered_deep') && !Array.isArray(decoded)) context.addIssue({ code: 'custom', path: ['cases', index, 'expectedOutput'], message: 'Unordered JSON answers must be top-level arrays' })
    }
  }
})
export const problemSchema = z.object({
  id: identifier.optional(), expected_revision: z.number().int().nonnegative().optional(),
  name: z.string().trim().min(1).max(500), difficulty: z.enum(['Easy', 'Medium', 'Hard']).nullable(),
  kind: z.enum(['coding', 'system_design', 'behavioral', 'other']), topics: labels, companies: z.array(label).max(1000).refine(value => new Set(value).size === value.length, 'Company labels must be unique'), tags: labels, collections: labels,
  source_type: z.enum(['stock', 'imported', 'custom']), source_url: z.url().max(2000).refine(value => /^https?:\/\//.test(value)).nullable(),
  source_metadata: problemSourceMetadataSchema.optional(), external_key: identifier, content: content.nullable(), testset: testset.optional()
})
export const bundleSchema = z.object({ version: z.literal(1), problems: z.array(problemSchema).min(1).max(100000) })
export function hash(value) { return createHash('sha256').update(value).digest('hex') }
export function stableUuid(value) {
  const digits = hash(value).slice(0, 32).split('')
  digits[12] = '5'; digits[16] = (8 + parseInt(digits[16], 16) % 4).toString(16)
  const hex = digits.join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
