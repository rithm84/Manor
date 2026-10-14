import { adminClient, z, type Json } from '../_shared/integrationRuntime.ts'
import { BlaxelClient, SandboxUnavailableError, type JudgeInput, type JudgeOutput, type WarmPurpose } from '../_shared/blaxelClient.ts'
import { checkers, matches, type Checker } from './checkers.ts'
import { assembleProgram, parseDriverOutput } from '../_shared/problemDrivers.ts'
import { judgeBatches, judgeProgram, type JudgeItem } from '../_shared/problemJudge.ts'
import { chunk, gradeChunk } from './batch.ts'
import { offeredLanguages, validateInterface, type HarnessLanguage, type ProblemInterface } from '../_shared/problemInterface.ts'
import { formatDriverStdout, prepareInput } from '../_shared/problemShapes.ts'

export const languages = ['cpp', 'c', 'python', 'javascript', 'java', 'go'] as const
const verdict = z.enum(['accepted', 'wrong_answer', 'compile_error', 'runtime_error', 'time_limit', 'output_limit', 'execution_error'])
export const resultSchema = z.object({ id: z.string(), passed: z.boolean(), hidden: z.boolean(), input: z.string().nullable(), expectedOutput: z.string().nullable(), output: z.string().nullable(), stdout: z.string().nullable().optional(), stderr: z.string().nullable(), durationMs: z.number(), memoryKb: z.number().int().nonnegative().nullable().optional(), verdict })
export const submissionSchema = z.object({ id: z.uuid(), problemId: z.string(), contentVersion: z.number().int(), testsetVersion: z.number().int().nullable(), language: z.enum(languages), mode: z.enum(['run', 'submit']), status: z.enum(['queued', 'running', 'completed', 'failed']), verdict: verdict.nullable(), passedCases: z.number().int(), totalCases: z.number().int(), results: z.array(resultSchema), error: z.string().nullable(), sourceCode: z.string().nullable().optional(), createdAt: z.string(), finishedAt: z.string().nullable() })
const caseSchema = z.object({ id: z.string(), input: z.string(), expectedOutput: z.string().nullable(), hidden: z.boolean() })
const jobSchema = z.object({ submission: submissionSchema, owner: z.uuid(), leaseToken: z.uuid(), code: z.string(), checker: z.enum(checkers), cases: z.array(caseSchema).min(1).max(200), judge: z.string().nullable().optional(), interface: z.custom<ProblemInterface>(value => value === null || (typeof value === 'object' && value !== null && 'kind' in value)).nullable().optional() })
type RunnerCase = z.infer<typeof caseSchema>
type CaseResult = z.infer<typeof resultSchema>

/** The session a locally verified JWT names was signed out, expired, or belongs to a banned or deleted account. */
export class SessionExpiredError extends Error {}

export async function runnerStore(client: ReturnType<typeof adminClient>, action: string, owner: string | null, input: Record<string, Json>): Promise<Json> {
  const result = await client.rpc('manor_problem_runner', { p_action: action, p_owner: owner, p_input: input })
  if (result.error) throw new Error(`Problem execution ${action}: ${result.error.message}`)
  return z.json().parse(result.data)
}

function gradedCase(test: RunnerCase, process: NonNullable<JudgeOutput['compile']>, checker: Checker): CaseResult {
  const caseVerdict = process.timedOut ? 'time_limit' : process.outputLimit ? 'output_limit' : process.exitCode !== 0 ? 'runtime_error' : matches(process.stdout, test.expectedOutput, checker) ? 'accepted' : 'wrong_answer'
  return { id: test.id, passed: caseVerdict === 'accepted', hidden: test.hidden, input: test.hidden ? null : test.input, expectedOutput: test.hidden ? null : test.expectedOutput, output: test.hidden ? null : process.stdout, stderr: test.hidden ? null : process.stderr, durationMs: process.durationMs, verdict: caseVerdict }
}

async function discardSandbox(provider: BlaxelClient, name: string, failure: unknown): Promise<never> {
  try { await provider.deleteSandbox(name) }
  catch (cleanupError) { throw new AggregateError([failure, cleanupError], `${failure instanceof Error ? failure.message : String(failure)}; deleting sandbox ${name} also failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`) }
  throw failure
}

/**
 * Runs one batch in the account's standing sandbox for the purpose. A sandbox that cannot accept the batch is replaced
 * once; a sandbox whose batch failed, overran, or left anything behind is deleted so the next job starts clean.
 */
async function inStandingSandbox(provider: BlaxelClient, purpose: WarmPurpose, owner: string, input: JudgeInput): Promise<JudgeOutput> {
  let sandbox = await provider.warmSandbox(purpose, owner)
  let output: JudgeOutput
  try { output = await provider.judge(sandbox, input) }
  catch (error) {
    if (!(error instanceof SandboxUnavailableError)) return discardSandbox(provider, sandbox.metadata.name, error)
    console.warn('Replacing an unavailable problem sandbox', { sandboxName: sandbox.metadata.name, purpose, error: error.message })
    await provider.deleteSandbox(sandbox.metadata.name)
    sandbox = await provider.warmSandbox(purpose, owner)
    try { output = await provider.judge(sandbox, input) }
    catch (retryError) { return discardSandbox(provider, sandbox.metadata.name, retryError) }
  }
  if (output.tainted.length > 0) {
    console.warn('Deleting a problem sandbox a job left tainted', { sandboxName: sandbox.metadata.name, purpose, reasons: output.tainted })
    await provider.deleteSandbox(sandbox.metadata.name)
  }
  return output
}

/** Interactive and concurrent problems spend wall time on pipes and threads, so their batches are smaller. */
function casesPerProcess(spec: ProblemInterface): number { return spec.kind === 'class' && spec.concurrency ? 8 : spec.kind !== 'codec' && (spec.apis ?? []).length > 0 ? 10 : 40 }

async function judgeTyped(provider: BlaxelClient, job: z.infer<typeof jobSchema>, spec: ProblemInterface): Promise<CaseResult[]> {
  const language = job.submission.language
  if (!(offeredLanguages(spec) as readonly string[]).includes(language)) throw new Error(`${language} is not available for this problem's solving interface`)
  validateInterface(spec)
  // A case whose friendly input cannot be shaped into nodes fails on its own, before any code runs.
  const prepared = new Map<string, string>()
  const unprepared: CaseResult[] = []
  for (const test of job.cases) {
    try { prepared.set(test.id, prepareInput(spec, test.input.endsWith('\n') ? test.input : test.input + '\n')) }
    catch (error) { unprepared.push({ id: test.id, passed: false, hidden: test.hidden, input: test.hidden ? null : test.input, expectedOutput: test.hidden ? null : test.expectedOutput, output: null, stderr: test.hidden ? null : `This input cannot be read: ${error instanceof Error ? error.message : String(error)}`, durationMs: 0, verdict: 'runtime_error' }) }
  }
  const runnable = job.cases.filter(test => prepared.has(test.id))
  if (runnable.length === 0) return unprepared
  const groups = chunk(runnable, casesPerProcess(spec))
  const code = assembleProgram(language as HarnessLanguage, job.code, spec)
  const output = await inStandingSandbox(provider, 'judge', job.owner, { language, code, cases: groups.map((group, index) => ({ id: `chunk-${index}`, input: group.map(test => prepared.get(test.id)!).join('') })) })
  if (output.compile !== null && output.compile.exitCode !== 0) return [{ id: job.cases[0].id, passed: false, hidden: false, input: null, expectedOutput: null, output: null, stderr: output.compile.stderr, durationMs: output.compile.durationMs, verdict: 'compile_error' }]
  if (output.cases.length !== groups.length || output.cases.some((item, index) => item.id !== `chunk-${index}`)) throw new Error('Judge returned chunks that do not match the leased batch')
  const processes = output.cases.map((item, index) => ({ ...item.process, stdout: formatDriverStdout(spec, groups[index].map(test => test.input.endsWith('\n') ? test.input : test.input + '\n'), item.process.stdout) }))
  let accepts = (test: RunnerCase, answer: string): boolean => matches(answer, test.expectedOutput, job.checker)
  if (job.checker === 'special') {
    if (!job.judge) throw new Error('This testset uses a special judge but carries no judge source')
    const items: (JudgeItem & { id: string })[] = []
    groups.forEach((group, index) => parseDriverOutput(processes[index].stdout).forEach((finished, position) => {
      const test = group[position]
      if (test !== undefined && finished.output !== null && test.expectedOutput !== null) items.push({ id: test.id, input: test.input, output: finished.output, expected: test.expectedOutput })
    }))
    const verdicts = await specialJudge(provider, job.owner, job.judge, items)
    accepts = test => verdicts.get(test.id) === true
  }
  const graded = new Map(groups.flatMap((group, index) => gradeChunk(group, processes[index], accepts)).map(result => [result.id, result]))
  for (const result of unprepared) graded.set(result.id, result)
  return job.cases.map(test => graded.get(test.id)!)
}

/** Runs trusted judge source in the account's checker sandbox: expected answers never share a sandbox with submitted code. */
async function specialJudge(provider: BlaxelClient, owner: string, source: string, items: readonly (JudgeItem & { id: string })[]): Promise<Map<string, boolean>> {
  const verdicts = new Map<string, boolean>()
  if (items.length === 0) return verdicts
  const batches = judgeBatches(items.map(({ input, output, expected }) => ({ input, output, expected })), 1000000)
  const result = await inStandingSandbox(provider, 'checker', owner, { language: 'python', code: judgeProgram(source), cases: batches.map((batch, index) => ({ id: `judge-${index}`, input: JSON.stringify(batch) })) })
  let offset = 0
  result.cases.forEach((item, index) => {
    if (item.process.exitCode !== 0) throw new Error(`Special judge failed: ${item.process.stderr.slice(0, 1000)}`)
    const decided = z.array(z.boolean()).length(batches[index].length).parse(JSON.parse(item.process.stdout))
    decided.forEach(value => { verdicts.set(items[offset].id, value); offset += 1 })
  })
  return verdicts
}

async function expireEditorSessions(client: ReturnType<typeof adminClient>): Promise<void> {
  const expired = z.array(z.object({ id: z.uuid(), owner: z.uuid(), sandboxName: z.string() })).parse(await runnerStore(client, 'editor_expired', null, {}))
  if (expired.length === 0) return
  const provider = BlaxelClient.configured()
  for (const session of expired) {
    await provider.deleteSandbox(session.sandboxName)
    await runnerStore(client, 'editor_delete', session.owner, { id: session.id })
  }
}

/** Worker entry: cleans up expired editor sessions, then leases and runs the oldest runnable batch of any account. */
export async function runOneJob(client: ReturnType<typeof adminClient>): Promise<boolean> {
  await expireEditorSessions(client)
  const raw = await runnerStore(client, 'claim', null, {})
  if (raw === null) return false
  const job = jobSchema.parse(raw)
  await runnerStore(client, ...settlement(job, await judgeJob(job)))
  return true
}

type Job = z.infer<typeof jobSchema>
const stepSchema = z.object({ submission: submissionSchema, job: z.json().nullable() })
/** A submission as its owner reads it, and the lease on its next batch when this request should run it. */
export interface ExecutionStep { readonly submission: z.infer<typeof submissionSchema>; readonly job: Job | null }

async function step(client: ReturnType<typeof adminClient>, fn: 'manor_problem_execute' | 'manor_problem_settle', args: Record<string, Json>): Promise<ExecutionStep> {
  const result = await client.rpc(fn, args)
  if (result.error?.code === 'PT401') throw new SessionExpiredError(result.error.message)
  if (result.error) throw new Error(`Problem execution ${fn}: ${result.error.message}`)
  const parsed = stepSchema.parse(result.data)
  return { submission: parsed.submission, job: parsed.job === null ? null : jobSchema.parse(parsed.job) }
}

/**
 * Checks that the caller's session is live, enqueues the request, and leases it when it is still queued, in one
 * transaction. A replayed request ID returns its submission, leased only while it is still queued.
 */
export function enqueueExecution(client: ReturnType<typeof adminClient>, owner: string, sessionId: string | null, input: Record<string, Json>): Promise<ExecutionStep> {
  return step(client, 'manor_problem_execute', { p_owner: owner, p_session: sessionId, p_input: input })
}

/** Runs a leased job and each batch leased after it, recording each outcome with the next lease in one transaction. */
export async function runLeased(client: ReturnType<typeof adminClient>, leased: Job): Promise<z.infer<typeof submissionSchema>> {
  let job = leased
  for (;;) {
    const [action, owner, input] = settlement(job, await judgeJob(job))
    const next = await step(client, 'manor_problem_settle', { p_action: action, p_owner: owner, p_input: input })
    if (next.job === null) return next.submission
    job = next.job
  }
}

/**
 * Leases and runs one submission's batches until it finishes or another worker holds its lease. The lease, attempt,
 * and replay rules are the worker's, so a poll of a queued submission can run it.
 */
export async function runSubmission(client: ReturnType<typeof adminClient>, owner: string, submissionId: string): Promise<void> {
  const raw = await runnerStore(client, 'claim_submission', owner, { submissionId })
  if (raw !== null) await runLeased(client, jobSchema.parse(raw))
}

type Outcome = { readonly action: 'complete'; readonly results: CaseResult[] } | { readonly action: 'fail'; readonly error: string }

/** The runner action, owner, and input that record a job's outcome under its lease. */
function settlement(job: Job, outcome: Outcome): ['complete' | 'fail', string, Record<string, Json>] {
  const lease = { submissionId: job.submission.id, leaseToken: job.leaseToken }
  return outcome.action === 'complete' ? ['complete', job.owner, { ...lease, results: outcome.results }] : ['fail', job.owner, { ...lease, error: outcome.error }]
}

/** Judges one leased batch; a failure becomes the job's recorded error. */
async function judgeJob(job: Job): Promise<Outcome> {
  const provider = BlaxelClient.configured()
  try {
    if (job.interface) return { action: 'complete', results: await judgeTyped(provider, job, job.interface) }
    const output = await inStandingSandbox(provider, 'judge', job.owner, { language: job.submission.language, code: job.code, cases: job.cases.map(test => ({ id: test.id, input: test.input })) })
    if (output.compile !== null && output.compile.exitCode !== 0) {
      return { action: 'complete', results: [{ id: job.cases[0].id, passed: false, hidden: false, input: null, expectedOutput: null, output: null, stderr: output.compile.stderr, durationMs: output.compile.durationMs, verdict: 'compile_error' }] }
    }
    if (output.cases.length !== job.cases.length || output.cases.some((item, index) => item.id !== job.cases[index].id)) throw new Error('Judge returned cases that do not match the leased batch')
    return { action: 'complete', results: output.cases.map((item, index) => gradedCase(job.cases[index], item.process, job.checker)) }
  } catch (error) {
    const executionError = error instanceof Error ? error : new Error(String(error))
    console.warn('Problem execution failed', { submissionId: job.submission.id, error: executionError.message })
    return { action: 'fail', error: executionError.message }
  }
}
