/** Normalize a captured catalog and public stock metadata without copying source prose. */
import { z } from 'zod'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { bundleSchema, hash, stableUuid } from './bundle.mjs'
import { problemSourceMetadataSchema } from '../../app/src/shared/problemSourceMetadata.ts'

const catalogRecord = z.object({
  id: z.string().min(1).optional(), originalHref: z.string().optional(), href: z.string().min(1), title: z.string().min(1), kind: z.enum(['Coding', 'System Design', 'Behavioral', 'Other']),
  badges: z.array(z.string()), companies: z.array(z.string()), companyId: z.string(),
  sourceKind: z.enum(['curated', 'exercise']), summary: z.string().nullable(), difficulty: z.number().nullable().optional()
})
const catalogSchema = z.object({ version: z.literal(1), sourceBase: z.url(), companies: z.array(z.object({ id: z.string(), name: z.string() })), records: z.array(catalogRecord) })
const stockSchema = z.array(z.object({ questionFrontendId: z.string(), title: z.string(), titleSlug: z.string(), difficulty: z.enum(['Easy', 'Medium', 'Hard']), topicTags: z.array(z.object({ name: z.string(), slug: z.string() })) }))
const existingSchema = z.array(z.object({ id: z.string(), name: z.string(), kind: z.enum(['coding', 'system_design', 'behavioral', 'other']), revision: z.number().int().positive(), source_url: z.url().nullable(), source_type: z.enum(['stock', 'imported', 'custom']), external_key: z.string().nullable().optional(), difficulty: z.enum(['Easy', 'Medium', 'Hard']).nullable(), source_metadata: problemSourceMetadataSchema.optional(), content_available: z.boolean(), topics: z.array(z.string()), companies: z.array(z.string()), tags: z.array(z.string()), collections: z.array(z.string()) }))
const factsSchema = z.object({ version: z.literal(1), sourceBase: z.url(), records: z.array(z.object({ id: z.string().min(1), href: z.string(), title: z.string(), description: z.string().nullable(), sourceMetadata: problemSourceMetadataSchema.optional(), tags: z.array(z.string()).nullable() })) })
const seriesSchema = z.array(z.object({ link: z.string().min(1), code: z.string().regex(/^\d+-[a-z0-9-]+$/), neetcode150: z.boolean().optional(), blind75: z.boolean().optional() }))
const classificationSchema = z.object({ version: z.literal(1), records: z.array(z.object({
  sourceId: z.string().min(1), difficulty: z.enum(['Easy', 'Medium', 'Hard']), kind: z.enum(['coding', 'system_design', 'behavioral', 'other']),
  topics: z.array(z.string().trim().min(1).max(100)).min(1).max(100), tags: z.array(z.string().trim().min(1).max(100)).max(100), name: z.string().trim().min(1).max(500).optional()
})) })
const companyTagsSchema = z.object({ version: z.literal(1), source: problemSourceMetadataSchema.shape.snapshots.unwrap().element, records: z.array(z.object({ url: z.url(), companies: z.array(z.string().min(1).max(100)).max(1000), companyReports: problemSourceMetadataSchema.shape.companyReports.unwrap() })) })
const managedCollections = ['NeetCode 150', 'Blind 75']

const roles = new Map(Object.entries({ SWE: 'Software engineer', MLE: 'Machine learning engineer', 'Infra Eng': 'Infrastructure engineer', RS: 'Research scientist', RE: 'Research engineer', DS: 'Data scientist', EM: 'Engineering manager', 'Perf Eng': 'Performance engineer', PM: 'Product manager', Fellows: 'Fellowship' }))
const rounds = new Map(Object.entries({ oa: 'Online assessment', codesignal: 'CodeSignal assessment', screening: 'Screening', recruiter: 'Recruiter', 'take-home': 'Take-home', 'ai-screening': 'AI screening', 'new-round': 'Additional round', 'live-review': 'Live review', 'phone-screen': 'Phone screen', 'technical-screen': 'Technical screen', onsite: 'Onsite', 'virtual-onsite': 'Virtual onsite', 'behavioral-round': 'Behavioral round', 'system-design-round': 'System design round', 'coding-round': 'Coding round' }))
const employment = new Map(Object.entries({ 'full-time': 'Full-time', 'part-time': 'Part-time', intern: 'Internship', internship: 'Internship', contract: 'Contract', contractor: 'Contract', apprenticeship: 'Apprenticeship' }))
const technologies = new Map(Object.entries({ cpp: 'C++', c: 'C', go: 'Go', python: 'Python', java: 'Java', javascript: 'JavaScript', typescript: 'TypeScript', ruby: 'Ruby', sql: 'SQL', numpy: 'NumPy', pandas: 'pandas', pytorch: 'PyTorch', react: 'React', kafka: 'Kafka', redis: 'Redis', docker: 'Docker', colab: 'Colab', matplotlib: 'Matplotlib', pillow: 'Pillow', 'google-sheets': 'Google Sheets', 'scikit-learn': 'scikit-learn' }))
const canonicalTopics = new Map(Object.entries({
  array: 'Arrays', arrays: 'Arrays', string: 'Strings', strings: 'Strings', 'string-processing': 'Strings', hashmap: 'Hash tables', 'hash-table': 'Hash tables', 'hash-tables': 'Hash tables', hashhmap: 'Hash tables',
  bfs: 'Breadth-first search', 'breadth-first-search': 'Breadth-first search', dfs: 'Depth-first search', 'depth-first-search': 'Depth-first search', dp: 'Dynamic programming', 'dynamic-programming': 'Dynamic programming',
  grid: 'Grids', graph: 'Graphs', graphs: 'Graphs', tree: 'Trees', trees: 'Trees', heap: 'Heaps', 'heap-priority-queue': 'Heaps', sorting: 'Sorting', math: 'Mathematics', queue: 'Queues', stack: 'Stacks', set: 'Sets',
  'data-structure': 'Data structures', 'data-structures': 'Data structures', 'two-pointer': 'Two pointers', 'two-pointers': 'Two pointers', 'linked-list': 'Linked lists', 'binary-search-tree': 'Binary search trees', bst: 'Binary search trees',
  'object-design': 'Object-oriented design', 'oop-design': 'Object-oriented design', ood: 'Object-oriented design', oop: 'Object-oriented programming', 'prefix-sum': 'Prefix sums', 'union-find': 'Disjoint sets',
  'dedup': 'Deduplication', deduplication: 'Deduplication', 'mlsd': 'Machine learning system design', 'ml-knowledge': 'Machine learning', 'ml-infra': 'Machine learning infrastructure',
  bq: 'Behavioral interviews', behavioral: 'Behavioral interviews', 'culture-fit': 'Culture', culture: 'Culture', fit: 'Culture', 'why-company': 'Company motivation',
  io: 'Input/output', 'ab-testing': 'A/B testing', ttl: 'Expiration', mvcc: 'Multiversion concurrency control', pubsub: 'Publish/subscribe', sse: 'Server-sent events',
  llm: 'Large language models', rag: 'Retrieval-augmented generation', ann: 'Approximate nearest neighbors', cnn: 'Convolutional neural networks', dom: 'Document Object Model',
  'ci-cd': 'Continuous integration and delivery', etl: 'ETL', sre: 'Site reliability engineering', rpc: 'Remote procedure calls', gpu: 'GPU programming',
  'a100': 'GPU hardware', 'kv-cache': 'Key-value caching', 'matmul': 'Matrix multiplication', 'lora': 'Low-rank adaptation', 'rlhf': 'Reinforcement learning from human feedback',
  'vlm': 'Vision-language models', 'mmoe': 'Multi-gate mixture of experts', 'grpo': 'Group relative policy optimization', 'cs-fundamentals': 'Computer science fundamentals',
  'kwargs': 'Keyword arguments', 'http': 'HTTP', 'json': 'JSON', 'csv': 'CSV', 'ux': 'User experience', '3sum': 'Three sum'
}))
const kindNames = { Coding: 'coding', 'System Design': 'system_design', Behavioral: 'behavioral', Other: 'other' }

function options(argv) {
  const flags = new Map(); const factFiles = []
  const required = ['--catalog', '--stock', '--existing', '--source-tag', '--out', '--audit']
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    if ((!required.includes(key) && key !== '--facts' && key !== '--series' && key !== '--classifications' && key !== '--company-tags') || flags.has(key) || argv[index + 1] === undefined) throw new TypeError(`Invalid or repeated normalization argument: ${key}`)
    if (key === '--facts') factFiles.push(resolve(argv[index + 1]))
    else flags.set(key, argv[index + 1])
  }
  for (const key of required) if (!flags.has(key)) throw new TypeError(`Missing normalization argument: ${key}`)
  if (factFiles.length === 0) throw new TypeError('Supply at least one --facts evidence file')
  const sourceTag = z.string().trim().min(1).max(100).parse(flags.get('--source-tag'))
  return { catalog: resolve(flags.get('--catalog')), stock: resolve(flags.get('--stock')), existing: resolve(flags.get('--existing')), facts: factFiles, series: flags.has('--series') ? resolve(flags.get('--series')) : null, classifications: flags.has('--classifications') ? resolve(flags.get('--classifications')) : null, companyTags: flags.has('--company-tags') ? resolve(flags.get('--company-tags')) : null, sourceTag, out: resolve(flags.get('--out')), audit: resolve(flags.get('--audit')) }
}
function unique(values) { return [...new Set(values)].sort((a, b) => a.localeCompare(b)) }
function seriesMembership(records, stocks) {
  const stocksBySlug = new Map(stocks.map(stock => [stock.titleSlug, stock]))
  const membership = new Map(); const unmatchedInactiveIds = []
  for (const record of records) {
    const linkSlug = record.link.replace(/^\/+|\/+$/g, '')
    const stock = stocksBySlug.get(linkSlug)
    if (stock === undefined) throw new Error(`Series canonical slug is absent from stock metadata: ${linkSlug}`)
    if (membership.has(linkSlug)) throw new Error(`Series metadata repeats canonical slug: ${linkSlug}`)
    const collections = []
    if (record.neetcode150 === true) collections.push('NeetCode 150')
    if (record.blind75 === true) collections.push('Blind 75')
    const codeId = Number(record.code.split('-')[0])
    if (codeId !== Number(stock.questionFrontendId)) {
      if (collections.length > 0) throw new Error(`Series stock number disagrees with canonical slug: ${linkSlug}, code ID ${codeId}, stock ID ${stock.questionFrontendId}`)
      unmatchedInactiveIds.push({ slug: linkSlug, codeId, stockId: stock.questionFrontendId })
    }
    membership.set(linkSlug, collections)
  }
  return { membership, unmatchedInactiveIds }
}
function slug(value) { return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') }
function humanize(value) {
  const words = value.replace(/[-_]/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}
function topic(value) { return canonicalTopics.get(slug(value)) ?? humanize(slug(value)).replace(/\b(api|cpu|gpu|http|json|csv|etl|llm|ml|url|sql)\b/gi, match => match.toUpperCase()) }
function canonicalUrl(value, base) {
  const url = new URL(value, base)
  if (!['http:', 'https:'].includes(url.protocol)) throw new TypeError(`Unsupported catalog URL protocol: ${url.protocol}`)
  url.hash = ''; url.search = ''
  return url.href.replace(/\/$/, '')
}
function sourceIdentity(id, url) {
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
  const pathId = new URL(url).pathname.split('/').filter(Boolean).at(-1)
  const explicitId = id !== undefined && uuid.test(id) ? id.toLowerCase() : null
  const hrefId = pathId !== undefined && uuid.test(pathId) ? pathId.toLowerCase() : null
  if (explicitId !== null && hrefId !== null && explicitId !== hrefId) throw new Error(`Source ID disagrees with URL identity: ${url}`)
  const authoritativeId = explicitId ?? hrefId
  return authoritativeId === null ? `source:${hash(url)}` : `source:${hash(new URL(url).origin)}:${authoritativeId}`
}
function mappedLabel(labels, value) {
  const normalized = slug(value).replace(/-/g, '')
  for (const [key, label] of labels) if (slug(key).replace(/-/g, '') === normalized || slug(label).replace(/-/g, '') === normalized) return label
  return null
}
function badgeLabels(badges, sourceTag) {
  const topics = []; const tags = [sourceTag]; const discarded = []
  for (const raw of badges) {
    const value = raw.trim()
    if (!value || /^\+\d+$/.test(value) || /^(all|easy|medium|hard|coding|system design|other|behavioral)$/i.test(value)) { discarded.push(value); continue }
    const role = mappedLabel(roles, value)
    const round = mappedLabel(rounds, value)
    const employmentType = mappedLabel(employment, value)
    const technology = /^c\+\+$/i.test(value) ? 'C++' : /^c$/i.test(value) ? 'C' : mappedLabel(technologies, value)
    if (role !== null) tags.push(`Role: ${role}`)
    else if (round !== null) tags.push(`Round: ${round}`)
    else if (employmentType !== null) tags.push(`Employment: ${employmentType}`)
    else if (technology !== null) tags.push(`Technology: ${technology}`)
    else topics.push(topic(value))
  }
  return { topics: unique(topics), tags: unique(tags), discarded }
}
function evidenceKind(record, detail) {
  if (record.kind !== 'Coding') return kindNames[record.kind]
  const opening = detail?.description?.trim().slice(0, 500) ?? ''
  if ([record.title, opening].some(value => /^(tell (me|us) about|why (do you|this company)|describe (a time|your)|behavioral (interview|question))/i.test(value))) return 'behavioral'
  if ([record.title, opening].some(value => /^(system design[: -]|design (a |an )?(distributed |scalable )(system|service|platform)|architecture (of|for))/i.test(value))) return 'system_design'
  if (/\b(high.level architecture|capacity estimation|system design interview)\b/i.test(opening)) return 'system_design'
  return 'coding'
}
function inferredTopics(record, detail, kind) {
  const evidence = `${record.title}\n${record.summary ?? ''}\n${detail?.description ?? ''}`.toLowerCase()
  const rules = [
    [/\b(array|subarray|matrix|matrices)\b/, 'Arrays'], [/\bstring|anagram|palindrome|substring|characters?\b/, 'Strings'],
    [/\b(grid|island|maze|cardinal)\b/, 'Grids'], [/\b(binary tree|binary-tree|tree traversal|fibonacci tree)\b/, 'Trees'],
    [/\b(graph|vertices|vertex|edges|connected component)\b/, 'Graphs'], [/\binterval|overlap|calendar|scheduling\b/, 'Intervals'],
    [/\b(key.value|cache|dictionary|hash map|hash table|hashmap)\b/, 'Hash tables'], [/\b(linked list|linked-list)\b/, 'Linked lists'],
    [/\b(concurren|thread.safe|multithread|atomicity|race condition)/, 'Concurrency'], [/\b(sql|query|database|table schema)\b/, 'Databases'],
    [/\b(ipv4|cidr|firewall|network|tcp|udp|http)\b/, 'Networking'], [/\b(snapshot|iterator|versioning|data structure)\b/, 'Data structures'],
    [/\b(probability|random|sample|sampling|uniformly)\b/, 'Probability'], [/\b(regression|gradient|training|classifier|machine learning)\b/, 'Machine learning'],
    [/\b(sales|revenue|aggregate|aggregation)\b/, 'Aggregation'], [/\b(filesystem|file.system|directory|directories)\b/, 'File systems'],
    [/\b(token|authentication|authorization|password|encryption)\b/, 'Security'], [/\b(permutation|combination|combinatorial)\b/, 'Combinatorics']
  ]
  const selected = rules.filter(([pattern]) => pattern.test(evidence)).map(([, label]) => label)
  if (kind === 'system_design') selected.push('System design')
  if (kind === 'behavioral') selected.push('Behavioral interviews')
  return unique(selected)
}
function estimateDifficulty(record, detail, kind, topics) {
  const evidence = `${record.title}\n${record.summary ?? ''}\n${detail?.description ?? ''}`.toLowerCase()
  const hard = [
    /\b(concurren|thread.safe|multithread|lock.free|distributed|linearizab|serializab|mvcc)/,
    /\b(snapshot|persistent)\b[\s\S]{0,100}(iterator|o\(1\)|constant.time)/,
    /\b(fibonacci tree|implicit tree|exponential.size|segment tree|suffix automaton|suffix array|min.cost flow|advanced dynamic)/,
    /\b(200,?000|2\s*\*\s*10\^?5|2\s*[×x]\s*10\^?5)\b[\s\S]{0,120}(nested|ancestor|online|dynamic)/,
    /\b(rate.limiting|consistent hashing|sharding|consensus|multi.version|numerical.stability|reinforcement learning)\b/
  ].some(pattern => pattern.test(evidence))
  if (hard || kind === 'system_design' && topics.some(value => /Distributed|Scaling|Storage|Machine learning/i.test(value))) return 'Hard'
  const easy = [
    /\b(reverse a string|reverse string|fizzbuzz|sum of two|sum two|maximum revenue sum|maximum subarray|count encrypted files|circuit breaker)\b/,
    /\b(bottom.?k|total sales|monthly sales|aggregate.*revenue|frequency count|count.*characters|linear scan|simple prefix)\b/,
    /\b(lazy array|deferred evaluation)\b[\s\S]{0,100}(cache|cached|generator)/
  ].some(pattern => pattern.test(evidence))
  if (easy && !/\b(nested|concurren|snapshot|range.add|distributed)/.test(evidence)) return 'Easy'
  if (kind === 'behavioral' && !/\b(conflict|leadership|failure|ambiguity|strategy|trade.?off|management)/.test(evidence)) return 'Easy'
  return 'Medium'
}
function overview(record, kind, topics, companies) {
  if (kind === 'coding') return null
  const label = kind === 'system_design' ? 'System design' : kind === 'behavioral' ? 'Behavioral interview' : 'Interview discussion'
  const lines = [`# ${record.title}`, '', `${label} reference.`, '']
  if (companies.length > 0) lines.push(`Company context: ${companies.join(', ')}.`, '')
  if (topics.length > 0) lines.push(`Topics: ${topics.join(', ')}.`, '')
  lines.push('The source link contains the detailed prompt. This entry currently contains an indexed overview.')
  return { statement_markdown: lines.join('\n'), examples: [], hints: [], solution_markdown: null, starter_code: {} }
}
function increment(counts, values) { for (const value of values) counts[value] = (counts[value] ?? 0) + 1 }
function sortedCounts(counts) { return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) }

const configuration = options(process.argv.slice(2))
const [catalogBytes, stockBytes, existingBytes] = await Promise.all([configuration.catalog, configuration.stock, configuration.existing].map(path => readFile(path, 'utf8')))
const factBytes = await Promise.all(configuration.facts.map(path => readFile(path, 'utf8')))
const catalog = catalogSchema.parse(JSON.parse(catalogBytes))
const stocks = stockSchema.parse(JSON.parse(stockBytes))
const existing = existingSchema.parse(JSON.parse(existingBytes))
const seriesBytes = configuration.series === null ? null : await readFile(configuration.series, 'utf8')
const series = seriesBytes === null ? null : seriesMembership(seriesSchema.parse(JSON.parse(seriesBytes)), stocks)
const classificationBytes = configuration.classifications === null ? null : await readFile(configuration.classifications, 'utf8')
const classifications = classificationBytes === null ? [] : classificationSchema.parse(JSON.parse(classificationBytes)).records
const classificationsById = new Map(classifications.map(record => [record.sourceId, record]))
if (classificationsById.size !== classifications.length) throw new Error('Classification evidence repeats an authoritative source identifier')
const companyTagsBytes = configuration.companyTags === null ? null : await readFile(configuration.companyTags, 'utf8')
const companyTags = companyTagsBytes === null ? null : companyTagsSchema.parse(JSON.parse(companyTagsBytes))
const companyTagsByUrl = new Map((companyTags?.records ?? []).map(record => [canonicalUrl(record.url, catalog.sourceBase), record]))
if (companyTagsByUrl.size !== (companyTags?.records.length ?? 0)) throw new Error('Company data repeats a canonical stock URL')
const factBundles = factBytes.map(bytes => factsSchema.parse(JSON.parse(bytes)))
if (factBundles.some(bundle => new URL(catalog.sourceBase).origin !== new URL(bundle.sourceBase).origin)) throw new Error('Catalog and detail evidence refer to different source origins')
const companiesById = new Map(catalog.companies.map(company => [company.id, company.name]))
const existingByUrl = new Map(existing.filter(row => row.source_url !== null).map(row => [canonicalUrl(row.source_url, catalog.sourceBase), row]))
const existingByIdentity = new Map(existing.filter(row => row.source_type === 'imported' && row.source_url !== null).map(row => [row.external_key ?? sourceIdentity(undefined, canonicalUrl(row.source_url, catalog.sourceBase)), row]))
for (const record of catalog.records) {
  const url = canonicalUrl(record.href, catalog.sourceBase)
  const previous = existingByUrl.get(url) ?? (record.originalHref === undefined ? undefined : existingByUrl.get(canonicalUrl(record.originalHref, catalog.sourceBase)))
  if (previous === undefined) continue
  const identity = sourceIdentity(record.id, url)
  const matched = existingByIdentity.get(identity)
  if (matched !== undefined && matched.id !== previous.id) throw new Error(`Source identity has conflicting persisted problem IDs: ${url}`)
  existingByIdentity.set(identity, previous)
}
const factRecords = factBundles.flatMap(bundle => bundle.records)
const factsByIdentity = new Map(factRecords.map(record => [sourceIdentity(record.id, canonicalUrl(record.href, catalog.sourceBase)), record]))
const factsByUrl = new Map(factRecords.map(record => [canonicalUrl(record.href, catalog.sourceBase), record]))
if (factsByIdentity.size !== factRecords.length) throw new Error('Detail evidence repeats an authoritative source identity')
const problems = []; const identities = new Set(); const discardedBadges = {}; const kindCorrections = []
let reusedStockIds = 0; let enrichedRecords = 0; let classifiedRecords = 0
for (const record of catalog.records) {
  const url = canonicalUrl(record.href, catalog.sourceBase)
  const urlDetail = factsByUrl.get(url)
  const identity = sourceIdentity(record.id ?? urlDetail?.id, url)
  if (identities.has(identity)) throw new Error(`Catalog repeats an authoritative source identity: ${url}`)
  identities.add(identity)
  const detail = factsByIdentity.get(identity)
  const classified = classificationsById.get(record.id ?? detail?.id)
  if (classified !== undefined) classifiedRecords += 1
  const previous = existingByIdentity.get(identity) ?? existingByUrl.get(url)
  const labels = badgeLabels([...record.badges, ...(detail?.tags ?? [])], configuration.sourceTag)
  if (detail?.description === null) labels.tags.push('Source statement unavailable')
  increment(discardedBadges, labels.discarded)
  const companyName = companiesById.get(record.companyId)
  if (!companyName) throw new Error(`Catalog references unknown company ID: ${record.companyId}`)
  const companies = unique([companyName, ...record.companies])
  const kind = previous?.tags.includes('Reviewed classification') ? previous.kind : classified?.kind ?? evidenceKind(record, detail)
  const name = previous?.tags.includes('Reviewed classification') ? previous.name : classified?.name ?? record.title
  if (kind !== kindNames[record.kind]) kindCorrections.push({ sourceUrl: url, title: record.title, from: kindNames[record.kind], to: kind })
  if (detail) enrichedRecords += 1
  const difficultyBadge = record.badges.find(value => /^(easy|medium|hard)$/i.test(value))
  const inferred = inferredTopics(record, detail, kind)
  const previousTopics = (previous?.topics ?? []).filter(value => { const technology = /^c\+\+$/i.test(value) ? 'C++' : /^c$/i.test(value) ? 'C' : mappedLabel(technologies, value); if (technology !== null) labels.tags.push(`Technology: ${technology}`); return technology === null })
  const topics = previous?.tags.includes('Reviewed topics') ? previous.topics : unique([...labels.topics, ...inferred, ...previousTopics.map(topic), ...(classified?.topics ?? []).map(topic)])
  if (classified !== undefined) labels.tags.push('Automated classification', ...classified.tags.filter(value => !/^Reviewed (difficulty|classification)$/.test(value)))
  if (inferred.some(value => !labels.topics.includes(value))) labels.tags.push('Inferred topics')
  const needsTopicReview = topics.length === 0 || topics.length === 1 && topics[0] === 'Algorithms'
  if (topics.length === 0) topics.push(kind === 'coding' ? 'Algorithms' : kind === 'system_design' ? 'System design' : kind === 'behavioral' ? 'Behavioral interviews' : 'Interview discussion')
  if (needsTopicReview) labels.tags.push('Topic review needed')
  const difficulty = difficultyBadge ? difficultyBadge.charAt(0).toUpperCase() + difficultyBadge.slice(1).toLowerCase() : previous?.tags.includes('Reviewed difficulty') ? previous.difficulty : classified?.difficulty ?? estimateDifficulty(record, detail, kind, topics)
  if (!difficultyBadge) labels.tags.push('Estimated difficulty')
  problems.push({ id: previous?.id ?? stableUuid(identity), expected_revision: previous?.revision ?? 0, name, difficulty, kind, topics, companies, tags: unique([...labels.tags, ...(previous?.tags ?? []).filter(value => value !== 'Topic review needed' || needsTopicReview)]),
    collections: unique([record.sourceKind === 'curated' ? 'Interview question bank' : 'Interview exercises', ...(previous?.collections ?? [])]), source_type: 'imported', source_url: url, external_key: identity,
    source_metadata: { ...(previous?.source_metadata ?? {}), ...(detail?.sourceMetadata ?? {}) }, content: previous?.content_available ? null : overview(record, kind, topics, companies) })
}
for (const stock of stocks) {
  const url = canonicalUrl(`https://leetcode.com/problems/${stock.titleSlug}/`, catalog.sourceBase)
  if (identities.has(url)) throw new Error(`Stock metadata repeats canonical URL: ${url}`)
  identities.add(url)
  const previous = existingByUrl.get(url)
  if (previous && previous.source_type !== 'stock') throw new Error(`Canonical stock URL already belongs to a different source type: ${url}`)
  if (previous) reusedStockIds += 1
  const stockTopics = unique([...stock.topicTags.map(tag => topic(tag.name)), ...(previous?.topics ?? []).map(topic)])
  const stockTags = [...(previous?.tags ?? [])]
  const companyEvidence = companyTagsByUrl.get(url)
  const sourceMetadata = { ...(previous?.source_metadata ?? {}) }
  if (companyEvidence !== undefined && companyTags !== null) {
    sourceMetadata.snapshots = [...new Map([...(sourceMetadata.snapshots ?? []), companyTags.source].map(item => [JSON.stringify(item), item])).values()]
    sourceMetadata.companyReports = [...new Map([...(sourceMetadata.companyReports ?? []), ...companyEvidence.companyReports].map(item => [JSON.stringify(item), item])).values()]
    stockTags.push('Reported company association')
  }
  if (stockTopics.length === 0) {
    stockTopics.push(...inferredTopics({ title: stock.title, summary: null }, undefined, 'coding'))
    stockTags.push('Inferred topics')
    if (stockTopics.length === 0) { stockTopics.push('Algorithms'); stockTags.push('Topic review needed') }
  }
  problems.push({ id: previous?.id ?? stableUuid(`stock:${url}`), expected_revision: previous?.revision ?? 0, name: stock.title, difficulty: stock.difficulty, kind: 'coding',
    topics: stockTopics, companies: unique([...(previous?.companies ?? []), ...(companyEvidence?.companies ?? [])]), tags: unique(stockTags), collections: series === null ? previous?.collections ?? [] : unique([...(previous?.collections ?? []).filter(value => !managedCollections.includes(value)), ...(series.membership.get(stock.titleSlug) ?? [])]),
    source_metadata: sourceMetadata, source_type: 'stock', source_url: `${url}/`, external_key: `leetcode:${stock.questionFrontendId}`, content: null })
}
if ([...companyTagsByUrl.keys()].some(url => !stocks.some(stock => canonicalUrl(`https://leetcode.com/problems/${stock.titleSlug}/`, catalog.sourceBase) === url))) throw new Error('Company evidence contains URLs absent from the official stock catalog')
if (reusedStockIds !== existing.filter(row => row.source_type === 'stock').length) throw new Error('Not every existing stock problem matched public canonical metadata; refusing to duplicate history')
if (classifiedRecords !== classifications.length) throw new Error('Classification evidence contains source identifiers absent from the captured catalog')
const bundle = bundleSchema.parse({ version: 1, problems })
const kinds = {}; const sourceTypes = {}; const topics = {}; const companyCounts = {}; const tags = {}; const collections = {}; const titles = {}
for (const problem of bundle.problems) {
  increment(kinds, [problem.kind]); increment(sourceTypes, [problem.source_type]); increment(topics, problem.topics); increment(companyCounts, problem.companies); increment(tags, problem.tags); increment(collections, problem.collections); increment(titles, [problem.name.toLowerCase()])
}
const difficulties = {}; for (const problem of problems) increment(difficulties, [problem.difficulty ?? 'Unknown'])
const audit = { version: 1, inputHashes: { catalog: hash(catalogBytes), stock: hash(stockBytes), existing: hash(existingBytes), facts: factBytes.map(hash), series: seriesBytes === null ? null : hash(seriesBytes), classifications: classificationBytes === null ? null : hash(classificationBytes), companyTags: companyTagsBytes === null ? null : hash(companyTagsBytes) },
  total: problems.length, sourceRecords: catalog.records.length, stockRecords: stocks.length, reusedStockIds, enrichedRecords, classifiedRecords, companyTaggedStock: companyTags?.records.length ?? 0, kinds: sortedCounts(kinds), sourceTypes: sortedCounts(sourceTypes),
  contentOverviews: problems.filter(problem => problem.content !== null).length, runnable: 0, unknownDifficulty: problems.filter(problem => problem.difficulty === null).length, difficulties: sortedCounts(difficulties),
  emptyTopics: problems.filter(problem => problem.topics.length === 0).length, distinctCompanies: Object.keys(companyCounts).length, distinctTopics: Object.keys(topics).length,
  repeatedTitlesKeptDistinct: Object.values(titles).filter(count => count > 1).length, discardedBadges: sortedCounts(discardedBadges), kindCorrections,
  series: series === null ? null : { records: series.membership.size, memberships: Object.fromEntries(managedCollections.map(name => [name, bundle.problems.filter(problem => problem.source_type === 'stock' && problem.collections.includes(name)).length])), inactiveNumberMismatches: series.unmatchedInactiveIds },
  topics: sortedCounts(topics), companies: sortedCounts(companyCounts), tags: sortedCounts(tags), collections: sortedCounts(collections),
  notes: ['Verified source UUIDs and their source origin define identity; canonical URLs identify records without authoritative UUIDs. Similar titles and related stock references do not merge exercises.', 'Official text difficulty values are preserved. Missing difficulty uses a documented complexity rubric and an Estimated difficulty provenance tag; unknown numeric source scales are not treated as official labels.', 'Topic inference uses statements, summaries, and titles as evidence, with broad review labels for underspecified records.', 'Noncoding entries contain original indexed overviews; detailed source prompts are not represented as complete transcriptions.', 'Source examples and test cases remain in the private evidence artifact pending contract and oracle verification.'] }
await writeFile(configuration.out, JSON.stringify(bundle, null, 2), { mode: 0o600 })
await writeFile(configuration.audit, JSON.stringify(audit, null, 2), { mode: 0o600 })
console.log(JSON.stringify({ event: 'problem_catalog_normalized', total: audit.total, reusedStockIds, enrichedRecords, kinds: audit.kinds, contentOverviews: audit.contentOverviews, distinctCompanies: audit.distinctCompanies, distinctTopics: audit.distinctTopics, series: audit.series }))
