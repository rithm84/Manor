/** Checkpointed metadata classification with the official TypeSafe SDK; never writes to Manor. */
import { TypeSafeClient, APIError, type Logger } from '@typesafe-ai/sdk'
import { readFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseEnv } from 'node:util'
import { z } from 'zod'
import { contextFor, decide, digest, factsSchema, reviewsSchema, selectionSchema, validateResponse, topics, type CheckpointEntry, type Context, type Review } from './classification.ts'
import { classificationVersion, questions } from './classificationQuestions.ts'
import { ClassificationCheckpoint, loadCheckpoint } from './classificationCheckpoint.ts'

const optionsSchema = z.object({ facts: z.string(), reviews: z.array(z.string()), selection: z.string(), checkpoint: z.string(), out: z.string(), audit: z.string(), concurrency: z.number().int().min(1).max(32), confidence: z.number().min(0).max(1), probability: z.number().min(0).max(1), topicThreshold: z.number().min(0).max(1) })
type Options = z.infer<typeof optionsSchema>
function options(argv: string[]): Options {
  const flags = new Map<string, string>(); const reviews: string[] = []
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]; const value = argv[i + 1]
    if (value === undefined) throw new TypeError(`Missing classification argument value: ${key}`)
    if (key === '--reviews') { reviews.push(resolve(value)); continue }
    if (!['--facts', '--selection', '--checkpoint', '--out', '--audit', '--concurrency', '--confidence', '--probability', '--topic-threshold'].includes(key) || flags.has(key)) throw new TypeError(`Invalid or repeated classification argument: ${key}`)
    flags.set(key, value)
  }
  for (const key of ['--facts', '--selection', '--checkpoint', '--out', '--audit', '--concurrency', '--confidence', '--probability', '--topic-threshold']) if (!flags.has(key)) throw new TypeError(`Required classification argument: ${key}`)
  if (reviews.length === 0) throw new TypeError('Supply at least one --reviews file to protect existing reviewed decisions')
  return optionsSchema.parse({ facts: resolve(flags.get('--facts')!), reviews, selection: resolve(flags.get('--selection')!), checkpoint: resolve(flags.get('--checkpoint')!), out: resolve(flags.get('--out')!), audit: resolve(flags.get('--audit')!), concurrency: Number(flags.get('--concurrency')), confidence: Number(flags.get('--confidence')), probability: Number(flags.get('--probability')), topicThreshold: Number(flags.get('--topic-threshold')) })
}
function structuredLog(event: string, fields: Record<string, string | number | boolean>): void { console.error(JSON.stringify({ event, ...fields })) }

/** Vendor SDK owns transport retries; only safe request metadata appears in logs. */
class ProblemClassifier {
  readonly client: TypeSafeClient
  constructor(apiKey: string) {
    const logger: Logger = {
      debug: message => structuredLog('classification_sdk_debug', { message }),
      info: message => { if (/retrying/.test(message)) structuredLog('classification_retry_warning', { message }) },
      warn: message => structuredLog('classification_sdk_warning', { message }),
      error: message => structuredLog('classification_sdk_error', { message })
    }
    this.client = new TypeSafeClient({ apiKey, defaultModel: 'jev-latest', timeout: 45000, logLevel: 'info', logger, retry: { maxRetries: 3, backoffInitialMs: 1000, backoffMaxMs: 8000, backoffJitter: 0.25, maxRetryAfterMs: 30000, respectRetryAfter: true, httpStatuses: new Set([408, 429, 500, 502, 503, 504, 529]), apiConnectionError: true, apiTimeoutError: true } })
  }
  async classify(sourceId: string, context: Context, configurationHash: string): Promise<CheckpointEntry> {
    const start = performance.now(); const contextHash = digest(context)
    try {
      const response = validateResponse(await this.client.systemOne({ state: context, questions, model: 'jev-latest' }))
      return { sourceId, contextHash, configurationHash, latencyMs: Math.round(performance.now() - start), response }
    } catch (error) {
      if (error instanceof APIError) throw new Error(JSON.stringify({ event: 'classification_api_failed', sourceId, contextHash, status: error.status, body: error.body }), { cause: error })
      if (error instanceof Error) throw new Error(JSON.stringify({ event: 'classification_failed', sourceId, contextHash, reason: error.message }), { cause: error })
      throw new TypeError(`Classification failed with a non-Error response for ${sourceId}`)
    }
  }
}

const config = options(process.argv.slice(2))
const envPath = resolve(import.meta.dirname, '../../.env.local')
const environment = parseEnv(readFileSync(envPath, 'utf8'))
const apiKey = environment.TYPESAFE_AI_API_KEY
if (!apiKey?.trim()) throw new Error(`TYPESAFE_AI_API_KEY is missing from ${envPath}`)
const facts = factsSchema.parse(JSON.parse(await readFile(config.facts, 'utf8')))
const selection = selectionSchema.parse(JSON.parse(await readFile(config.selection, 'utf8')))
if (new Set(selection.sourceIds).size !== selection.sourceIds.length) throw new Error('Classification selection repeats source IDs')
const reviewFiles = await Promise.all(config.reviews.map(async path => reviewsSchema.parse(JSON.parse(await readFile(path, 'utf8')))))
const reviews = new Map<string, Review>()
for (const file of reviewFiles) for (const review of file.records) {
  const previous = reviews.get(review.sourceId)
  if (previous !== undefined && JSON.stringify(previous) !== JSON.stringify(review)) throw new Error(`Conflicting reviewed metadata for ${review.sourceId}`)
  reviews.set(review.sourceId, review)
}
const byId = new Map(facts.records.map(fact => [fact.id, fact]))
if (byId.size !== facts.records.length) throw new Error('Captured facts repeat source IDs')
const work = selection.sourceIds.map(sourceId => {
  const fact = byId.get(sourceId)
  if (fact === undefined) throw new Error(`Classification selection has no captured facts: ${sourceId}`)
  const review = reviews.get(sourceId) ?? null
  return { fact, review, context: contextFor(fact, review) }
})
const prior = await loadCheckpoint(config.checkpoint)
const checkpoint = new ClassificationCheckpoint(config.checkpoint, prior)
const configurationHash = digest({ version: classificationVersion, questions, model: 'jev-latest' })
for (const item of work) {
  const old = checkpoint.entries.get(item.fact.id)
  if (old !== undefined && (old.configurationHash !== configurationHash || old.contextHash !== digest(item.context))) throw new Error(`Classification checkpoint context/configuration changed for ${item.fact.id}; use a new checkpoint file to re-evaluate it`)
  if (old !== undefined) validateResponse(old.response)
}
const pending = work.filter(item => !checkpoint.entries.has(item.fact.id)); const classifier = new ProblemClassifier(apiKey)
let cursor = 0; let failed = false; const started = performance.now()
structuredLog('classification_started', { selected: work.length, pending: pending.length, concurrency: config.concurrency, topics: Object.keys(questions).length - 3 })
async function worker(): Promise<void> {
  while (!failed && cursor < pending.length) {
    const item = pending[cursor++];
    try {
      const entry = await classifier.classify(item.fact.id, item.context, configurationHash)
      await checkpoint.save(entry)
      structuredLog('classification_saved', { sourceId: item.fact.id, latencyMs: entry.latencyMs, inputTokens: entry.response.usage.input_tokens, outputTokens: entry.response.usage.output_tokens })
    } catch (error) { failed = true; throw error }
  }
}
const workers = await Promise.allSettled(Array.from({ length: Math.min(config.concurrency, pending.length) }, () => worker()))
const failures = workers.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
if (failures.length > 0) throw new AggregateError(failures.map(result => result.reason), 'Classification stopped after a failed request; committed responses are preserved in the checkpoint')
await checkpoint.compact()
const accepted = []; const queue = []; const evaluations = []
for (const item of work) {
  const entry = checkpoint.entries.get(item.fact.id)
  if (entry === undefined) throw new Error(`Classification checkpoint is incomplete for ${item.fact.id}`)
  const result = decide(entry, item.context, item.review, config.confidence, config.probability, config.topicThreshold)
  if (result.decision !== null) accepted.push(result.decision)
  if (result.review !== null) queue.push(result.review)
  const difficulty = entry.response.answers.difficulty
  const kind = entry.response.answers.kind
  if (difficulty.type !== 'choice' || kind.type !== 'choice') throw new TypeError(`Expected choice answers for ${item.fact.id}`)
  const predictedTopics = Object.keys(topics).filter((_, index) => { const answer = entry.response.answers[`topic_${index}`]; return answer.type === 'noul' && answer.noul >= config.topicThreshold })
  const reviewedTopics = item.review?.topics ?? null
  evaluations.push({ sourceId: item.fact.id, title: item.context.title, predictedDifficulty: difficulty.choice, reviewedDifficulty: item.review?.difficulty ?? null, difficultyMatchesReview: item.review?.difficulty === undefined ? null : difficulty.choice === item.review.difficulty, predictedKind: kind.choice, reviewedKind: item.review?.kind ?? null, kindMatchesReview: item.review?.kind === undefined ? null : kind.choice === item.review.kind, sufficientContext: entry.response.answers.sufficient_context, predictedTopics, reviewedTopics, requiredTopicsRecovered: reviewedTopics === null ? null : reviewedTopics.filter(topic => predictedTopics.includes(topic)).length, latencyMs: entry.latencyMs, usage: entry.response.usage, accepted: result.decision !== null, contextAvailable: item.context.sourceStatementAvailable, removedSolutionSections: item.context.removedSolutionSections })
}
const difficultyEvaluated = evaluations.filter(item => item.difficultyMatchesReview !== null); const kindEvaluated = evaluations.filter(item => item.kindMatchesReview !== null)
const latencies = evaluations.map(item => item.latencyMs).sort((a, b) => a - b)
const audit = { version: 1, classificationVersion, configurationHash, selected: work.length, accepted: accepted.length, reviewQueue: queue, contextPartial: evaluations.filter(item => !item.contextAvailable).map(item => item.sourceId), metrics: { elapsedMs: Math.round(performance.now() - started), newlyRequested: pending.length, inputTokens: evaluations.reduce((sum, item) => sum + item.usage.input_tokens, 0), outputTokens: evaluations.reduce((sum, item) => sum + item.usage.output_tokens, 0), medianLatencyMs: latencies[Math.floor(latencies.length / 2)], p95LatencyMs: latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * .95))], difficultyAgreement: { correct: difficultyEvaluated.filter(item => item.difficultyMatchesReview).length, evaluated: difficultyEvaluated.length }, kindAgreement: { correct: kindEvaluated.filter(item => item.kindMatchesReview).length, evaluated: kindEvaluated.length } }, evaluations }
await Promise.all([writeFile(config.out, JSON.stringify({ version: 1, records: accepted }, null, 2), { mode: 0o600 }), writeFile(config.audit, JSON.stringify(audit, null, 2), { mode: 0o600 })])
console.log(JSON.stringify({ event: 'classification_complete', selected: work.length, accepted: accepted.length, manualReview: queue.length, ...audit.metrics }))
