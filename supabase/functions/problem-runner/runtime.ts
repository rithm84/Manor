import { adminClient, z, type Json } from '../_shared/integrationRuntime.ts'
import { BlaxelClient, type JudgeOutput } from '../_shared/blaxelClient.ts'
import { checkers, matches, type Checker } from './checkers.ts'
import { assembleProgram, parseDriverOutput } from '../_shared/problemDrivers.ts'
import { judgeBatches, judgeProgram, type JudgeItem } from '../_shared/problemJudge.ts'
import { chunk, gradeChunk } from './batch.ts'
import { harnessLanguages, validateInterface, type HarnessLanguage, type ProblemInterface } from '../_shared/problemInterface.ts'

export const languages = ['cpp', 'c', 'python', 'javascript', 'java', 'go'] as const
const verdict = z.enum(['accepted', 'wrong_answer', 'compile_error', 'runtime_error', 'time_limit', 'output_limit', 'execution_error'])
export const resultSchema = z.object({ id: z.string(), passed: z.boolean(), hidden: z.boolean(), input: z.string().nullable(), expectedOutput: z.string().nullable(), output: z.string().nullable(), stdout: z.string().nullable().optional(), stderr: z.string().nullable(), durationMs: z.number(), verdict })
export const submissionSchema = z.object({ id: z.uuid(), problemId: z.string(), contentVersion: z.number().int(), testsetVersion: z.number().int().nullable(), language: z.enum(languages), mode: z.enum(['run', 'submit']), status: z.enum(['queued', 'running', 'completed', 'failed']), verdict: verdict.nullable(), passedCases: z.number().int(), totalCases: z.number().int(), results: z.array(resultSchema), error: z.string().nullable(), sourceCode: z.string().nullable().optional(), createdAt: z.string(), finishedAt: z.string().nullable() })
const caseSchema = z.object({ id: z.string(), input: z.string(), expectedOutput: z.string().nullable(), hidden: z.boolean() })
const jobSchema = z.object({ submission: submissionSchema, owner: z.uuid(), leaseToken: z.uuid(), code: z.string(), checker: z.enum(checkers), cases: z.array(caseSchema).min(1).max(200), judge: z.string().nullable().optional(), interface: z.custom<ProblemInterface>(value => value === null || (typeof value === 'object' && value !== null && 'kind' in value)).nullable().optional() })
type RunnerCase = z.infer<typeof caseSchema>
type CaseResult = z.infer<typeof resultSchema>

export async function runnerStore(client: ReturnType<typeof adminClient>, action: string, owner: string | null, input: Record<string, Json>): Promise<Json> {
  const result = await client.rpc('manor_problem_runner', { p_action: action, p_owner: owner, p_input: input })
  if (result.error) throw new Error(`Problem execution ${action}: ${result.error.message}`)
  return z.json().parse(result.data)
}

function gradedCase(test: RunnerCase, process: NonNullable<JudgeOutput['compile']>, checker: Checker): CaseResult {
  const caseVerdict = process.timedOut ? 'time_limit' : process.outputLimit ? 'output_limit' : process.exitCode !== 0 ? 'runtime_error' : matches(process.stdout, test.expectedOutput, checker) ? 'accepted' : 'wrong_answer'
  return { id: test.id, passed: caseVerdict === 'accepted', hidden: test.hidden, input: test.hidden ? null : test.input, expectedOutput: test.hidden ? null : test.expectedOutput, output: test.hidden ? null : process.stdout, stderr: test.hidden ? null : process.stderr, durationMs: process.durationMs, verdict: caseVerdict }
}

async function judgeTyped(provider: BlaxelClient, sandbox: Awaited<ReturnType<BlaxelClient['createSandbox']>>, job: z.infer<typeof jobSchema>, spec: ProblemInterface): Promise<CaseResult[]> {
  const language = job.submission.language
  if (!(harnessLanguages as readonly string[]).includes(language)) throw new Error(`${language} is not available for this problem's solving interface`)
  validateInterface(spec)
  const groups = chunk(job.cases)
  const code = assembleProgram(language as HarnessLanguage, job.code, spec)
  const output = await provider.judge(sandbox, { language, code, cases: groups.map((group, index) => ({ id: `chunk-${index}`, input: group.map(test => test.input.endsWith('\n') ? test.input : test.input + '\n').join('') })) })
  if (output.compile !== null && output.compile.exitCode !== 0) return [{ id: job.cases[0].id, passed: false, hidden: false, input: null, expectedOutput: null, output: null, stderr: output.compile.stderr, durationMs: output.compile.durationMs, verdict: 'compile_error' }]
  if (output.cases.length !== groups.length || output.cases.some((item, index) => item.id !== `chunk-${index}`)) throw new Error('Judge returned chunks that do not match the leased batch')
  let accepts = (test: RunnerCase, answer: string): boolean => matches(answer, test.expectedOutput, job.checker)
  if (job.checker === 'special') {
    if (!job.judge) throw new Error('This testset uses a special judge but carries no judge source')
    const items: (JudgeItem & { id: string })[] = []
    groups.forEach((group, index) => parseDriverOutput(output.cases[index].process.stdout).forEach((finished, position) => {
      const test = group[position]
      if (test !== undefined && finished.output !== null && test.expectedOutput !== null) items.push({ id: test.id, input: test.input, output: finished.output, expected: test.expectedOutput })
    }))
    const verdicts = await specialJudge(provider, job.judge, items)
    accepts = test => verdicts.get(test.id) === true
  }
  return groups.flatMap((group, index) => gradeChunk(group, output.cases[index].process, accepts))
}

/** Runs trusted judge source in its own disposable sandbox: expected answers never share a sandbox with submitted code. */
async function specialJudge(provider: BlaxelClient, source: string, items: readonly (JudgeItem & { id: string })[]): Promise<Map<string, boolean>> {
  const verdicts = new Map<string, boolean>()
  if (items.length === 0) return verdicts
  const name = 'manor-judge-' + crypto.randomUUID().replaceAll('-', '')
  try {
    const sandbox = await provider.createSandbox(name, 'judge')
    const batches = judgeBatches(items.map(({ input, output, expected }) => ({ input, output, expected })), 1000000)
    const result = await provider.judge(sandbox, { language: 'python', code: judgeProgram(source), cases: batches.map((batch, index) => ({ id: `judge-${index}`, input: JSON.stringify(batch) })) })
    let offset = 0
    result.cases.forEach((item, index) => {
      if (item.process.exitCode !== 0) throw new Error(`Special judge failed: ${item.process.stderr.slice(0, 1000)}`)
      const decided = z.array(z.boolean()).length(batches[index].length).parse(JSON.parse(item.process.stdout))
      decided.forEach(value => { verdicts.set(items[offset].id, value); offset += 1 })
    })
  } finally { await provider.deleteSandbox(name) }
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

export async function runOneJob(client: ReturnType<typeof adminClient>): Promise<boolean> {
  await expireEditorSessions(client)
  const raw = await runnerStore(client, 'claim', null, {})
  if (raw === null) return false
  const job = jobSchema.parse(raw)
  const provider = BlaxelClient.configured()
  const name = 'manor-judge-' + job.leaseToken.replaceAll('-', '')
  let executionError: Error | null = null
  try {
    const sandbox = await provider.createSandbox(name, 'judge')
    let results: CaseResult[]
    const output = job.interface ? null : await provider.judge(sandbox, { language: job.submission.language, code: job.code, cases: job.cases.map(test => ({ id: test.id, input: test.input })) })
    if (job.interface) {
      results = await judgeTyped(provider, sandbox, job, job.interface)
    } else if (output === null) {
      throw new Error('Judge produced no output')
    } else if (output.compile !== null && output.compile.exitCode !== 0) {
      results = [{ id: job.cases[0].id, passed: false, hidden: false, input: null, expectedOutput: null, output: null, stderr: output.compile.stderr, durationMs: output.compile.durationMs, verdict: 'compile_error' }]
    } else {
      if (output.cases.length !== job.cases.length || output.cases.some((item, index) => item.id !== job.cases[index].id)) throw new Error('Judge returned cases that do not match the leased batch')
      results = output.cases.map((item, index) => gradedCase(job.cases[index], item.process, job.checker))
    }
    await runnerStore(client, 'complete', job.owner, { submissionId: job.submission.id, leaseToken: job.leaseToken, results })
  } catch (error) {
    executionError = error instanceof Error ? error : new Error(String(error))
    console.warn('Problem execution failed', { submissionId: job.submission.id, error: executionError.message })
    await runnerStore(client, 'fail', job.owner, { submissionId: job.submission.id, leaseToken: job.leaseToken, error: executionError.message })
  } finally {
    try { await provider.deleteSandbox(name) }
    catch (error) {
      console.error('Problem sandbox cleanup failed', { submissionId: job.submission.id, sandboxName: name, error: error instanceof Error ? error.message : String(error) })
      if (executionError === null) throw error
    }
  }
  return true
}
