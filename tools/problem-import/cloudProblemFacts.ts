/** Source adapters retain functional facts and exclude article solutions from curated captures. */
import { z } from 'zod'

type Json = z.infer<ReturnType<typeof z.json>>
const sourceDateSchema = z.object({ value: z.string().min(1), precision: z.enum(['day', 'month', 'year', 'instant']) })
type SourceDate = z.infer<typeof sourceDateSchema>
const sourceMetadataSchema = z.object({
  lastAsked: sourceDateSchema.optional(), reportedFrom: sourceDateSchema.optional(), reportedTo: sourceDateSchema.optional(),
  frequency: z.string().optional(), reportCount: z.number().int().nonnegative().optional(), isNew: z.boolean().optional(),
  durationMinutes: z.number().int().nonnegative().optional(), status: z.string().optional(),
})
export const factSchema = z.object({
  href: z.string(), id: z.string().min(1), slug: z.string().nullable().optional(), title: z.string(), description: z.string().nullable(),
  difficulty: z.json(), constraints: z.json(), sampleInput: z.string().nullable(), sampleOutput: z.string().nullable(),
  company: z.json(), employmentType: z.json(), testCases: z.json(), summary: z.json(), locked: z.boolean(),
  tags: z.array(z.string()), relatedLeetcode: z.json(),
  capture: z.object({ status: z.enum(['functional_sections', 'missing_statement']), parserVersion: z.literal(4).optional(), retainedHeadings: z.array(z.string()), excludedHeadings: z.array(z.string()) }).optional(),
  sourceMetadata: sourceMetadataSchema.optional(),
})
export type Fact = z.infer<typeof factSchema>
export type SourceKind = 'exercise' | 'curated'
export type FactAdapter = { sourceKind: SourceKind; parse: (href: string, target: URL, queryKey: Json, data: Json) => Fact }

export class SourceAccessRequired extends Error {}

const exerciseSchema = z.object({
  id: z.uuid(), slug: z.string().nullable().optional(), title: z.string(), description: z.string().nullable(),
  difficulty: z.json(), constraints: z.json(), sample_input: z.string().nullable(), sample_output: z.string().nullable(),
  company: z.json(), employment_type: z.json(), test_cases: z.json(), summary: z.json(),
  enrichment: z.object({ locked: z.boolean().optional(), tags_en: z.array(z.string()).nullable().optional(), leetcode: z.json().optional() }).nullable().optional(),
})
const exerciseIdentity = z.tuple([z.array(z.string()), z.object({ input: z.object({ uuid: z.string(), idType: z.string() }) })])
const curatedIdentity = z.tuple([z.array(z.string()), z.object({ input: z.object({ company: z.string(), slug: z.string() }) })])
const curatedSchema = z.object({
  bank: z.object({ company: z.string(), display_name: z.string() }),
  question: z.object({ id: z.string().min(1), slug: z.string(), title: z.string(), category: z.string(), overview: z.string().nullable(),
    roles: z.array(z.string()), stages: z.array(z.string()), tags: z.array(z.string()), body: z.string().nullable(), is_locked: z.boolean(),
    last_asked: z.string().nullable(), reported_from: z.string().nullable(), reported_to: z.string().nullable(),
    frequency: z.string().nullable(), source_count: z.number().int().nonnegative(), is_new: z.boolean(),
    duration_minutes: z.number().int().nonnegative().nullable(), status: z.string(),
  }),
})

function sourceDate(value: string | null): SourceDate | undefined {
  if (value === null || value.trim() === '') return undefined
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return { value: z.iso.date().parse(value), precision: 'day' }
  if (/^\d{4}-\d{2}$/.test(value) && Number(value.slice(5)) >= 1 && Number(value.slice(5)) <= 12) return { value, precision: 'month' }
  if (/^\d{4}$/.test(value)) return { value, precision: 'year' }
  const instant = z.iso.datetime({ offset: true }).safeParse(value)
  if (instant.success) return { value: instant.data, precision: 'instant' }
  throw new Error(`Source recency has an unsupported date format: ${value}`)
}

type FunctionalSections = { description: string | null; retainedHeadings: string[]; excludedHeadings: string[] }
type Section = { level: number; title: string; included: boolean; forbidden: boolean }
const functionalHeading = /\b(problems?|tasks?|questions?|prompt|challenge|what must be true|rules|requirements?|input|output|constraints?|limits?|examples?|follow[- ]?ups?|extensions?|variants?|variations?|versions?|bonus|parts?\s*\d+|scenario|goals?|objectives?|interface|expected behavior|clarifications?|specifications?)\b/i
const solutionHeading = /\b(solutions?|approaches?|algorithms?|implementation|how to solve|step.by.step explanation|strategy|hints?|answers?)\b|^(?:the\s+)?(?:\w+\s+)?code:?$/i
const articleHeading = /\b(solutions?|approaches?|algorithms?|implementation|how it works|how to solve|step.by.step explanation|strategy|logic|performance|complexity|special cases|takeaways?|evaluation|common errors|discussion topics|notes|hints?|answers?)\b|^(?:the\s+)?(?:\w+\s+)?code:?$/i

export function extractFunctionalSections(body: string | null): FunctionalSections {
  if (body === null || body.trim() === '') return { description: null, retainedHeadings: [], excludedHeadings: [] }
  const stack: Section[] = []
  const retainedHeadings: string[] = []
  const excludedHeadings: string[] = []
  const output: string[] = []
  let fence: string | null = null
  let sawArticle = false
  for (const line of body.split('\n')) {
    const boundary = /^\s{0,3}(`{3,}|~{3,})/.exec(line)
    if (boundary !== null) {
      const mark = boundary[1][0]
      if (fence === null) fence = mark
      else if (fence === mark) fence = null
    }
    const heading = fence === null ? /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line) : null
    if (heading !== null) {
      const level = heading[1].length
      const title = heading[2]
      while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop()
      const parent = stack.at(-1)
      const startsArticle = solutionHeading.test(title) || sawArticle && articleHeading.test(title)
      const forbidden = parent?.forbidden === true || startsArticle
      if (startsArticle) sawArticle = true
      const included = !forbidden && (parent?.included === true || functionalHeading.test(title) || !sawArticle)
      stack.push({ level, title, included, forbidden })
      if (included) { retainedHeadings.push(title); output.push(line) }
      else excludedHeadings.push(title)
    } else if (stack.at(-1)?.included === true || stack.length === 0 && !sawArticle) output.push(line)
  }
  const text = output.join('\n').trim()
  const content = text.replace(/^\s*#{1,6}\s+.+$/gm, '').trim()
  return { description: content === '' || retainedHeadings.length === 0 ? null : text, retainedHeadings, excludedHeadings }
}

function exerciseFact(href: string, target: URL, queryKey: Json, data: Json): Fact {
  const identity = exerciseIdentity.parse(queryKey)
  const problem = exerciseSchema.parse(data)
  const routeKey = target.pathname.split('/').at(-1)
  if (identity[1].input.uuid !== routeKey || (problem.id !== routeKey && problem.slug !== routeKey)) throw new Error(`Source identity differs from the catalog link ${href}`)
  if (problem.enrichment?.locked === true) throw new SourceAccessRequired(`The cloud profile cannot access the full problem at ${href}`)
  return {
    href, id: problem.id, slug: problem.slug, title: problem.title, description: problem.description,
    difficulty: problem.difficulty, constraints: problem.constraints, sampleInput: problem.sample_input, sampleOutput: problem.sample_output,
    company: problem.company, employmentType: problem.employment_type, testCases: problem.test_cases, summary: problem.summary,
    locked: false, tags: problem.enrichment?.tags_en ?? [], relatedLeetcode: problem.enrichment?.leetcode ?? [],
  }
}

function curatedFact(href: string, target: URL, queryKey: Json, data: Json): Fact {
  const identity = curatedIdentity.parse(queryKey)
  const { bank, question } = curatedSchema.parse(data)
  const segments = target.pathname.split('/').filter(Boolean)
  if (identity[1].input.slug !== segments.at(-1) || identity[1].input.company !== segments.at(-2)
    || question.slug !== segments.at(-1) || bank.company !== segments.at(-2)) throw new Error(`Curated source identity differs from the catalog link ${href}`)
  if (question.is_locked) throw new SourceAccessRequired(`The cloud profile cannot access the full problem at ${href}`)
  const sections = extractFunctionalSections(question.body)
  return {
    href, id: question.id, slug: question.slug, title: question.title, description: sections.description,
    difficulty: null, constraints: null, sampleInput: null, sampleOutput: null, company: bank.display_name,
    employmentType: null, testCases: null, summary: question.overview, locked: false,
    tags: [...question.tags, ...question.roles, ...question.stages, question.category], relatedLeetcode: [],
    capture: { status: sections.description === null ? 'missing_statement' : 'functional_sections', parserVersion: 4, retainedHeadings: sections.retainedHeadings, excludedHeadings: sections.excludedHeadings },
    sourceMetadata: {
      lastAsked: sourceDate(question.last_asked), reportedFrom: sourceDate(question.reported_from), reportedTo: sourceDate(question.reported_to),
      ...(question.frequency === null ? {} : { frequency: question.frequency }), reportCount: question.source_count, isNew: question.is_new,
      ...(question.duration_minutes === null ? {} : { durationMinutes: question.duration_minutes }), status: question.status,
    },
  }
}

const adapters: ReadonlyMap<string, FactAdapter> = new Map([
  ['interview.getOJProblem', { sourceKind: 'exercise', parse: exerciseFact }],
  ['interview.getQbankQuestion', { sourceKind: 'curated', parse: curatedFact }],
])

export function factAdapter(queryPath: string): FactAdapter {
  const adapter = adapters.get(queryPath)
  if (adapter === undefined) throw new Error(`Unsupported structured problem query: ${queryPath}`)
  return adapter
}
