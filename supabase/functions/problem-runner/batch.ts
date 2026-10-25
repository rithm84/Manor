/** Batched judging for typed interfaces: case grouping and mapping one process's marked output back to per-case verdicts. */
import type { JudgeOutput } from '../_shared/blaxelClient.ts'
import { driverPeakKb, parseDriverOutput, trailingDriverOutput } from '../_shared/problemDrivers.ts'

export interface RunnerCase { readonly id: string; readonly input: string; readonly expectedOutput: string | null; readonly hidden: boolean }
export type Verdict = 'accepted' | 'wrong_answer' | 'compile_error' | 'runtime_error' | 'time_limit' | 'output_limit' | 'execution_error'
export type CaseResult = { id: string; passed: boolean; hidden: boolean; input: string | null; expectedOutput: string | null; output: string | null; stdout?: string | null; stderr: string | null; durationMs: number; memoryKb?: number | null; verdict: Verdict }
type Process = NonNullable<JudgeOutput['compile']>
const chunkCases = 40, chunkInputBytes = 262144, heavyCaseBytes = 65536, chunkAnswerBytes = 49152

/** Typed drivers run many cases per process; heavy inputs run alone so one slow case cannot starve its neighbors of the per-process time limit. */
export function chunk(cases: readonly RunnerCase[], maxCases = chunkCases): RunnerCase[][] {
  const groups: RunnerCase[][] = []; let current: RunnerCase[] = []; let inputBytes = 0; let answerBytes = 0
  for (const test of cases) {
    const size = new TextEncoder().encode(test.input).length; const answer = test.expectedOutput?.length ?? 4096
    if (current.length > 0 && (size >= heavyCaseBytes || current.length >= maxCases || inputBytes + size > chunkInputBytes || answerBytes + answer > chunkAnswerBytes)) { groups.push(current); current = []; inputBytes = 0; answerBytes = 0 }
    current.push(test); inputBytes += size; answerBytes += answer
    if (size >= heavyCaseBytes) { groups.push(current); current = []; inputBytes = 0; answerBytes = 0 }
  }
  if (current.length > 0) groups.push(current)
  return groups
}

function caseResult(test: RunnerCase, verdict: Verdict, output: string | null, stdout: string | null, stderr: string | null, durationMs: number): CaseResult {
  return { id: test.id, passed: verdict === 'accepted', hidden: test.hidden, input: test.hidden ? null : test.input, expectedOutput: test.hidden ? null : test.expectedOutput, output, stdout, stderr, durationMs, verdict }
}

/** Only the first failure in the submission may disclose hidden diagnostics; SQL attaches its saved input and answer. */
export function submissionResults(previous: readonly CaseResult[], results: readonly CaseResult[]): CaseResult[] {
  const first = previous.some(result => !result.passed) ? -1 : results.findIndex(result => !result.passed)
  return results.map((result, index) => !result.hidden || index === first ? result : {
    ...result, input: null, expectedOutput: null, output: null, stdout: null, stderr: null
  })
}

/** Maps one batched process back to its cases: finished cases are graded, the case running when the process stopped takes the stop reason, and later cases are reported as not run. */
export function gradeChunk(tests: readonly RunnerCase[], process: Process, accepts: (test: RunnerCase, output: string) => boolean): CaseResult[] {
  const finished = parseDriverOutput(process.stdout)
  const memoryKb = driverPeakKb(process.stdout)
  const stopped = process.timedOut ? 'time_limit' : process.outputLimit ? 'output_limit' : 'runtime_error'
  return tests.map((test, index) => ({ ...gradeOne(test, index), memoryKb }))
  function gradeOne(test: RunnerCase, index: number): CaseResult {
    const item = finished[index]
    if (item !== undefined) {
      const verdict = item.output === null ? 'runtime_error' : accepts(test, item.output) ? 'accepted' : 'wrong_answer'
      return caseResult(test, verdict, item.output, item.stdout || null, item.output === null ? process.stderr : null, item.durationMs)
    }
    if (index === finished.length) return caseResult(test, stopped, null, trailingDriverOutput(process.stdout) || null, process.stderr, process.durationMs)
    return caseResult(test, stopped, null, null, 'Not run because the program stopped on an earlier case.', 0)
  }
}

