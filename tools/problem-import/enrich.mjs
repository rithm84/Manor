/** Merge reviewed functional contracts into metadata using committed revision receipts. */
import { z } from 'zod'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { bundleSchema, problemSchema } from './bundle.mjs'

const contractSchema = z.object({
  sourceId: z.string().min(1), content: problemSchema.shape.content.unwrap(),
  testset: problemSchema.shape.testset, tags: problemSchema.shape.tags, difficulty: problemSchema.shape.difficulty.optional(),
  topics: problemSchema.shape.topics.optional(), kind: problemSchema.shape.kind.optional(), name: problemSchema.shape.name.optional()
})
const contractsSchema = z.object({ version: z.literal(1), records: z.array(contractSchema).min(1) })
const revisionsSchema = z.object({ outcomes: z.array(z.object({ id: z.string(), revision: z.number().int().positive() })) })
const catalogSchema = z.object({ sourceBase: z.url(), records: z.array(z.object({ id: z.string().optional(), href: z.string(), originalHref: z.string().optional() })) })
const factsSchema = z.object({ sourceBase: z.url(), records: z.array(z.object({ id: z.string(), href: z.string(), sourceMetadata: problemSchema.shape.source_metadata })) })

function options(argv) {
  const flags = new Map(); const contracts = []
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]; const value = argv[index + 1]
    if (value === undefined || !['--metadata', '--revisions', '--catalog', '--facts', '--contracts', '--out'].includes(key)) throw new TypeError(`Invalid enrichment argument: ${key}`)
    if (key === '--contracts') contracts.push(resolve(value))
    else if (flags.has(key)) throw new TypeError(`Repeated enrichment argument: ${key}`)
    else flags.set(key, resolve(value))
  }
  for (const key of ['--metadata', '--revisions', '--catalog', '--facts', '--out']) if (!flags.has(key)) throw new TypeError(`Missing enrichment argument: ${key}`)
  if (contracts.length === 0) throw new TypeError('Supply at least one --contracts file')
  return { metadata: flags.get('--metadata'), revisions: flags.get('--revisions'), catalog: flags.get('--catalog'), facts: flags.get('--facts'), contracts, out: flags.get('--out') }
}
const configuration = options(process.argv.slice(2))
const metadata = bundleSchema.parse(JSON.parse(await readFile(configuration.metadata, 'utf8')))
const revisions = revisionsSchema.parse(JSON.parse(await readFile(configuration.revisions, 'utf8')))
const catalog = catalogSchema.parse(JSON.parse(await readFile(configuration.catalog, 'utf8')))
const facts = factsSchema.parse(JSON.parse(await readFile(configuration.facts, 'utf8')))
if (new URL(facts.sourceBase).origin !== new URL(catalog.sourceBase).origin) throw new Error('Catalog and detail evidence have different source origins')
const sourceMetadataById = new Map(facts.records.filter(record => record.sourceMetadata !== undefined).map(record => [record.id, record.sourceMetadata]))
const currentRevisions = new Map(revisions.outcomes.map(outcome => [outcome.id, outcome.revision]))
const contracts = (await Promise.all(configuration.contracts.map(async path => contractsSchema.parse(JSON.parse(await readFile(path, 'utf8'))).records))).flat()
const bySourceId = new Map()
const sourceUrlsById = new Map(catalog.records.filter(record => record.id !== undefined).map(record => [record.id, new URL(record.href, catalog.sourceBase).href.replace(/\/$/, '')]))
const sourceIdsByUrl = new Map(catalog.records.map(record => [new URL(record.href, catalog.sourceBase).href.replace(/\/$/, ''), record.id]))
for (const record of catalog.records) if (record.originalHref !== undefined && record.id !== undefined) sourceIdsByUrl.set(new URL(record.originalHref, catalog.sourceBase).href.replace(/\/$/, ''), record.id)
for (const fact of facts.records) {
  const url = new URL(fact.href, facts.sourceBase).href.replace(/\/$/, '')
  const catalogId = sourceIdsByUrl.get(url)
  if (catalogId !== undefined && catalogId !== fact.id) throw new Error(`Catalog and reviewed evidence disagree on source identity: ${url}`)
  sourceIdsByUrl.set(url, fact.id)
  sourceUrlsById.set(fact.id, url)
}
for (const problem of metadata.problems) {
  if (problem.source_type !== 'imported' || problem.source_url === null) continue
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
  const identityId = problem.external_key?.startsWith('source:') ? problem.external_key.split(':').at(-1) : undefined
  const pathId = new URL(problem.source_url).pathname.split('/').filter(Boolean).at(-1)
  const sourceId = identityId !== undefined && uuid.test(identityId) ? identityId : sourceIdsByUrl.get(problem.source_url.replace(/\/$/, '')) ?? (pathId !== undefined && uuid.test(pathId) ? pathId : undefined)
  if (sourceId === undefined) continue
  bySourceId.set(sourceId, [...(bySourceId.get(sourceId) ?? []), problem])
}
const appliedIds = new Set()
const problems = contracts.map(contract => {
  const matches = bySourceId.get(contract.sourceId)
  if (!matches) throw new Error(`Reviewed contract has no metadata identity: ${contract.sourceId}`)
  if (matches.length !== 1) throw new Error(`Reviewed source identifier is ambiguous across canonical URLs: ${contract.sourceId}`)
  const problem = matches[0]
  if (appliedIds.has(problem.id)) throw new Error(`Reviewed contracts repeat problem identity: ${problem.id}`)
  appliedIds.add(problem.id)
  const revision = currentRevisions.get(problem.id)
  if (revision === undefined) throw new Error(`No committed revision receipt for reviewed problem: ${problem.id}`)
  const reviewTags = [...(contract.topics === undefined ? [] : ['Reviewed topics']), ...(contract.difficulty === undefined ? [] : ['Reviewed difficulty']), ...(contract.kind === undefined && contract.name === undefined ? [] : ['Reviewed classification'])]
  const sourceMetadata = sourceMetadataById.get(contract.sourceId)
  return { ...problem, expected_revision: revision, source_url: sourceUrlsById.get(contract.sourceId) ?? problem.source_url, ...(sourceMetadata === undefined ? {} : { source_metadata: { ...problem.source_metadata, ...sourceMetadata } }), difficulty: contract.difficulty ?? problem.difficulty, topics: contract.topics ?? problem.topics, kind: contract.kind ?? problem.kind, name: contract.name ?? problem.name, content: contract.content, tags: [...new Set([...problem.tags, ...contract.tags, ...reviewTags])].sort(), ...(contract.testset === undefined ? {} : { testset: contract.testset }) }
})
const bundle = bundleSchema.parse({ version: 1, problems })
await writeFile(configuration.out, JSON.stringify(bundle, null, 2), { mode: 0o600 })
console.log(JSON.stringify({ event: 'problem_contracts_enriched', problems: bundle.problems.length, withTestsets: bundle.problems.filter(problem => problem.testset !== undefined).length, cases: bundle.problems.reduce((count, problem) => count + (problem.testset?.cases.length ?? 0), 0) }))
