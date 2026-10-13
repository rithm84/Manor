/** Validated, source-independent metadata decisions and full-context preparation. */
import { z } from 'zod'
import { createHash } from 'node:crypto'
import { PROBLEM_TOPIC_CATEGORIES, PROBLEM_TOPICS } from '../../app/src/shared/problemTopics.ts'

export const difficultySchema = z.enum(['Easy', 'Medium', 'Hard'])
export const kindSchema = z.enum(['coding', 'system_design', 'behavioral', 'other'])
/** The closed library taxonomy, label to rubric; the app owns it so classification and the UI never diverge. */
export const topics: Readonly<Record<string, string>> = Object.fromEntries(PROBLEM_TOPIC_CATEGORIES.flatMap(category => category.topics.map(topic => [topic.label, topic.rubric])))
export type Topic = string
export const topicSchema = z.enum(PROBLEM_TOPICS as [string, ...string[]])

const parameterSchema = z.object({ inputName: z.string(), inputType: z.string(), inputValue: z.string() })
const exampleSchema = z.object({ input_data: z.union([z.string(), z.array(parameterSchema)]), output_data: z.string() })
export const factsSchema = z.object({ version: z.literal(1), records: z.array(z.object({
  id: z.string().min(1), title: z.string(), description: z.string().nullable(), constraints: z.string().nullable(),
  sampleInput: z.string().nullable(), sampleOutput: z.string().nullable(), tags: z.array(z.string()).nullable(),
  testCases: z.array(exampleSchema).nullable(), summary: z.string().optional()
})) })
export type Fact = z.infer<typeof factsSchema>['records'][number]
export const reviewsSchema = z.object({ version: z.literal(1), records: z.array(z.object({
  sourceId: z.string(), difficulty: difficultySchema.optional(), kind: kindSchema.optional(), name: z.string().optional(), topics: z.array(topicSchema).optional(),
  content: z.object({ statement_markdown: z.string(), examples: z.array(z.object({ input: z.string(), output: z.string(), explanation: z.string().nullable() })) }).optional()
})) })
export type Review = z.infer<typeof reviewsSchema>['records'][number]
export const selectionSchema = z.object({ version: z.literal(1), sourceIds: z.array(z.string()).min(1) })
const probabilitySchema = z.number().finite().min(0).max(1)
export const choiceAnswerSchema = z.object({ type: z.literal('choice'), choice: z.string(), confidence: probabilitySchema, probabilities: z.record(z.string(), probabilitySchema) })
export const noulAnswerSchema = z.object({ type: z.literal('noul'), noul: probabilitySchema })
export const responseSchema = z.object({ model: z.string().min(1), answers: z.record(z.string(), z.union([choiceAnswerSchema, noulAnswerSchema])), usage: z.object({ input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative() }) })
export type ClassificationResponse = z.infer<typeof responseSchema>

/** Reject incomplete or internally invalid answers before persisting a billable response. */
export function validateResponse(value: object): ClassificationResponse {
  const response = responseSchema.parse(value)
  const choiceOptions = { difficulty: difficultySchema.options, kind: kindSchema.options }
  for (const [key, options] of Object.entries(choiceOptions)) {
    const answer = choiceAnswerSchema.parse(response.answers[key])
    if (!options.some(option => option === answer.choice)) throw new TypeError(`Invalid ${key} choice: ${answer.choice}`)
    for (const option of options) if (answer.probabilities[option] === undefined) throw new TypeError(`Missing ${key} probability: ${option}`)
    const total = options.reduce((sum, option) => sum + answer.probabilities[option], 0)
    if (Math.abs(total - 1) > .02) throw new TypeError(`Invalid ${key} probability total: ${total}`)
  }
  noulAnswerSchema.parse(response.answers.sufficient_context)
  Object.keys(topics).forEach((_, index) => noulAnswerSchema.parse(response.answers[`topic_${index}`]))
  return response
}
export const checkpointEntrySchema = z.object({ sourceId: z.string(), contextHash: z.string(), configurationHash: z.string(), latencyMs: z.number().nonnegative(), response: responseSchema })
export const checkpointSchema = z.object({ version: z.literal(1), records: z.array(checkpointEntrySchema) })
export type CheckpointEntry = z.infer<typeof checkpointEntrySchema>
export type Context = { title: string; statement: string; constraints: string | null; examples: { input: string; output: string }[]; sourceSupportedTags: string[]; sourceStatementAvailable: boolean; sourceContextStatus: 'statement' | 'summary_only' | 'missing'; removedSolutionSections: number }

/** Remove explicit solution sections and external-link addresses, keeping functional facts. */
function functionalStatement(value: string): { statement: string; removed: number } {
  const lines = value.split('\n'); const retained: string[] = []; let removed = 0; let excludedDepth: number | null = null
  for (const line of lines) {
    if (/^Review needed\s*$/.test(line)) break
    const heading = /^(#{1,6})\s+(.+)$/.exec(line)
    if (heading !== null && /^(?:solution|approach|editorial|reference implementation|answer|code solution)\b/i.test(heading[2])) { excludedDepth = heading[1].length; removed += 1; continue }
    if (excludedDepth !== null && heading !== null && heading[1].length <= excludedDepth) excludedDepth = null
    if (excludedDepth === null) retained.push(line)
  }
  return { statement: retained.join('\n').replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, '$1').replace(/https?:\/\/\S+/g, '[external link]').replace(/\bKind (?:coding|system_design|behavioral|other)\./g, '').trim(), removed }
}

/** Supply all captured functional context; reviewed labels remain outside the model request. */
export function contextFor(fact: Fact, review: Review | null): Context {
  const source = functionalStatement(fact.description ?? '')
  const summary = functionalStatement(fact.summary ?? '')
  const sourceContextStatus = source.statement.length > 0 ? 'statement' : summary.statement.length > 0 ? 'summary_only' : 'missing'
  const reviewed = review === null ? null : functionalStatement(review.content?.statement_markdown ?? '')
  const statement = [source.statement || summary.statement, reviewed?.statement ? `Reviewed functional interface and clarifications:\n${reviewed.statement}` : ''].filter(Boolean).join('\n\n')
  const examples = [
    ...(fact.sampleInput === null || fact.sampleOutput === null ? [] : [{ input: fact.sampleInput, output: fact.sampleOutput }]),
    ...(fact.testCases ?? []).map(example => ({ input: typeof example.input_data === 'string' ? example.input_data : JSON.stringify(example.input_data), output: example.output_data })),
    ...(review?.content?.examples ?? []).map(example => ({ input: example.input, output: example.output }))
  ]
  const uniqueExamples = [...new Map(examples.map(example => [JSON.stringify(example), example])).values()]
  return { title: review?.name ?? fact.title, statement, constraints: fact.constraints, examples: uniqueExamples, sourceSupportedTags: fact.tags ?? [], sourceStatementAvailable: sourceContextStatus === 'statement', sourceContextStatus, removedSolutionSections: source.removed + summary.removed + (reviewed?.removed ?? 0) }
}
export function digest(value: object): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex') }

export type Decision = { sourceId: string; difficulty: z.infer<typeof difficultySchema>; kind: z.infer<typeof kindSchema>; topics: Topic[]; tags: string[]; audit: { model: string; contextHash: string; confidence: { difficulty: number; kind: number }; probabilities: { difficulty: Record<string, number>; kind: Record<string, number> }; topicProbabilities: Record<string, number>; sourceContextStatus: Context['sourceContextStatus']; reviewedFieldsPreserved: string[] } }
export type ReviewItem = { sourceId: string; reasons: string[]; proposedDifficulty: string; proposedKind: string; difficultyConfidence: number; kindConfidence: number }

/** Keep uncertain decisions out of the import file and preserve explicit reviewed decisions. */
export function decide(entry: CheckpointEntry, context: Context, review: Review | null, minimumConfidence: number, minimumProbability: number, topicThreshold: number): { decision: Decision | null; review: ReviewItem | null } {
  const difficulty = choiceAnswerSchema.parse(entry.response.answers.difficulty)
  const kind = choiceAnswerSchema.parse(entry.response.answers.kind)
  const adequate = noulAnswerSchema.parse(entry.response.answers.sufficient_context)
  const proposedDifficulty = difficultySchema.parse(difficulty.choice); const proposedKind = kindSchema.parse(kind.choice)
  const reasons: string[] = []
  if (!context.sourceStatementAvailable) reasons.push(`Source context is ${context.sourceContextStatus}`)
  if (adequate.noul < minimumProbability) reasons.push('Functional context is insufficient')
  if (difficulty.confidence < minimumConfidence || difficulty.probabilities[proposedDifficulty] < minimumProbability) reasons.push('Difficulty confidence is below the acceptance threshold')
  if (kind.confidence < minimumConfidence || kind.probabilities[proposedKind] < minimumProbability) reasons.push('Kind confidence is below the acceptance threshold')
  if (review?.difficulty !== undefined && review.difficulty !== proposedDifficulty) reasons.push('Difficulty disagrees with a reviewed decision')
  if (review?.kind !== undefined && review.kind !== proposedKind) reasons.push('Kind disagrees with a reviewed decision')
  const topicProbabilities = Object.fromEntries((Object.keys(topics) as Topic[]).map((label, index) => [label, noulAnswerSchema.parse(entry.response.answers[`topic_${index}`]).noul]))
  const selectedTopics = (Object.keys(topics) as Topic[]).filter(label => topicProbabilities[label] >= topicThreshold)
  if (selectedTopics.length === 0) reasons.push('No topic meets the evidence threshold')
  const reviewItem = reasons.length === 0 ? null : { sourceId: entry.sourceId, reasons, proposedDifficulty, proposedKind, difficultyConfidence: difficulty.confidence, kindConfidence: kind.confidence }
  if (reviewItem !== null) return { decision: null, review: reviewItem }
  const preserved = [...(review?.difficulty === undefined ? [] : ['difficulty']), ...(review?.kind === undefined ? [] : ['kind'])]
  return { decision: { sourceId: entry.sourceId, difficulty: review?.difficulty ?? proposedDifficulty, kind: review?.kind ?? proposedKind, topics: selectedTopics, tags: [], audit: { model: entry.response.model, contextHash: entry.contextHash, confidence: { difficulty: difficulty.confidence, kind: kind.confidence }, probabilities: { difficulty: difficulty.probabilities, kind: kind.probabilities }, topicProbabilities, sourceContextStatus: context.sourceContextStatus, reviewedFieldsPreserved: preserved } }, review: null }
}
