/**
 * Applies reviewed duplicate groups to the shared problem catalog through `manor_private.catalog_command`.
 * The groups file is source-independent JSON:
 *   {"version":1,"groups":[{"canonical":"<problem id>","name":"<reviewed title>","reason":"<equivalence evidence>","aliases":["<problem id>", ...]}]}
 * A canonical can be a stock or imported catalog problem; aliases are imported catalog problems of the same kind.
 * Current revisions are read from the project, so the file carries only reviewed decisions. A group whose aliases
 * already sit under its canonical with the reviewed title is skipped, so a rerun after an interruption applies only
 * the rest; a retried command reuses its command ID and replays the original receipt. Usage:
 *   node catalog-merge.mjs --file <groups.json> --project-ref <ref> [--dry-run]
 * --dry-run reads the project and prints each group's plan without writing.
 */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'
import { stableUuid } from './bundle.mjs'
import { runSqlTextWithRetries } from './sql.mjs'

const identifier = z.string().min(1).max(200)
const groupSchema = z.object({
  canonical: identifier, name: z.string().trim().min(1).max(500), reason: z.string().trim().min(1).max(2000),
  aliases: z.array(identifier).min(1).max(99)
})
const fileSchema = z.object({ version: z.literal(1), groups: z.array(groupSchema).min(1) })
const problemSchema = z.object({
  id: identifier, revision: z.number().int().positive(), catalog: z.boolean(), source_type: z.enum(['stock', 'imported', 'custom']),
  kind: z.string(), name: z.string(), canonical_problem_id: identifier.nullable()
})
const receiptSchema = z.object({ command_id: z.uuid(), operation: z.literal('merge_problem_duplicates'), replayed: z.boolean() })
const PERMANENT = /PT409|P0002|Record changed|different input|status 400|status 413|Choose|must be|exceed|not owned|Unmerge/
const sqlOptions = event => ({ attempts: 5, permanent: PERMANENT, event, timeout: 180000, maxBuffer: 16000000 })

function options(argv) {
  const flags = new Map()
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    if (key === '--dry-run') { flags.set(key, 'true'); continue }
    if (!['--file', '--project-ref'].includes(key) || flags.has(key) || argv[index + 1] === undefined) throw new TypeError(`Invalid or repeated merge argument: ${key}. Usage: node catalog-merge.mjs --file <groups.json> --project-ref <ref> [--dry-run]`)
    flags.set(key, argv[++index])
  }
  return { file: resolve(z.string().min(1).parse(flags.get('--file'))), projectRef: z.string().regex(/^[a-z]{20}$/).parse(flags.get('--project-ref')), dryRun: flags.has('--dry-run') }
}

/** Rejects a file whose groups overlap or name their canonical as an alias. */
function checkGroups(groups) {
  const seen = new Map()
  for (const [index, group] of groups.entries()) {
    for (const id of [group.canonical, ...group.aliases]) {
      if (seen.has(id)) throw new Error(`Problem ${id} appears in groups ${seen.get(id) + 1} and ${index + 1}; each problem belongs to at most one group`)
      seen.set(id, index)
    }
  }
}

async function readProblems(projectRef, ids) {
  const encoded = Buffer.from(JSON.stringify(ids)).toString('base64')
  const sql = `select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'revision',p.revision,'catalog',p.user_id is null,'source_type',p.source_type,'kind',p.kind,'name',p.name,'canonical_problem_id',p.canonical_problem_id)),'[]'::jsonb) as problems
from public.leetcode_problems p where p.id in (select jsonb_array_elements_text(convert_from(decode('${encoded}','base64'),'UTF8')::jsonb));`
  const rows = z.array(z.object({ problems: z.array(problemSchema) })).length(1).parse(await runSqlTextWithRetries(projectRef, sql, sqlOptions('catalog_merge_read_retry')))
  return new Map(rows[0].problems.map(problem => [problem.id, problem]))
}

/** The command input for one group at the current revisions, or null when the group is already applied. */
function plan(group, problems) {
  const members = [group.canonical, ...group.aliases].map(id => {
    const problem = problems.get(id)
    if (!problem) throw new Error(`Problem ${id} does not exist in the project`)
    if (!problem.catalog) throw new Error(`Problem ${id} belongs to an account, not the catalog; catalog groups hold only catalog problems`)
    return problem
  })
  const [canonical, ...aliases] = members
  if (canonical.canonical_problem_id !== null) throw new Error(`Canonical ${canonical.id} is itself grouped under ${canonical.canonical_problem_id}`)
  for (const alias of aliases) {
    if (alias.source_type !== 'imported') throw new Error(`Alias ${alias.id} is ${alias.source_type}; only imported problems join a group`)
    if (alias.kind !== canonical.kind) throw new Error(`Alias ${alias.id} is ${alias.kind} and canonical ${canonical.id} is ${canonical.kind}; a group has one kind`)
    if (alias.canonical_problem_id !== null && alias.canonical_problem_id !== canonical.id) throw new Error(`Alias ${alias.id} is grouped under ${alias.canonical_problem_id}; unmerge it before regrouping`)
  }
  const pending = aliases.filter(alias => alias.canonical_problem_id === null)
  if (pending.length === 0 && canonical.name === group.name) return null
  if (pending.length === 0) throw new Error(`Group ${canonical.id} is applied under the title "${canonical.name}", not "${group.name}"; retitle it through save_problem`)
  return { id: canonical.id, expected_revision: canonical.revision, name: group.name, reason: group.reason, aliases: pending.map(alias => ({ id: alias.id, expected_revision: alias.revision })) }
}

const configuration = options(process.argv.slice(2))
const { groups } = fileSchema.parse(JSON.parse(await readFile(configuration.file, 'utf8')))
checkGroups(groups)
const problems = await readProblems(configuration.projectRef, [...new Set(groups.flatMap(group => [group.canonical, ...group.aliases]))])
const inputs = groups.map(group => plan(group, problems))
const summary = { groups: groups.length, merged: 0, replayed: 0, unchanged: inputs.filter(input => input === null).length, pending: inputs.filter(input => input !== null).length }
for (const [index, input] of inputs.entries()) {
  if (input === null) continue
  if (configuration.dryRun) { console.log(JSON.stringify({ event: 'catalog_merge_planned', group: index + 1, canonical: input.id, aliases: input.aliases.map(alias => alias.id) })); continue }
  const body = JSON.stringify(input)
  const commandId = stableUuid(`${configuration.projectRef}:catalog:merge_problem_duplicates:${body}`)
  const sql = `select manor_private.catalog_command('${commandId}'::uuid,'merge_problem_duplicates',convert_from(decode('${Buffer.from(body).toString('base64')}','base64'),'UTF8')::jsonb) as receipt;`
  const receipt = z.array(z.object({ receipt: receiptSchema })).length(1).parse(await runSqlTextWithRetries(configuration.projectRef, sql, sqlOptions('catalog_merge_retry')))[0].receipt
  if (receipt.command_id !== commandId) throw new Error(`Merge receipt for group ${index + 1} names command ${receipt.command_id}, expected ${commandId}`)
  summary[receipt.replayed ? 'replayed' : 'merged'] += 1
  console.log(JSON.stringify({ event: 'catalog_merge_committed', group: index + 1, canonical: input.id, aliases: input.aliases.length, replayed: receipt.replayed }))
}
console.log(JSON.stringify({ event: configuration.dryRun ? 'catalog_merge_planned_all' : 'catalog_merge_completed', ...summary }))
