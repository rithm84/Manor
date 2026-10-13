import { describe, expect, it } from 'vitest'
import type { ProblemCaseResult, ProblemSubmission } from '../../../shared/problemExecution'
import { firstFailingVisibleCase, formatMemory, formatRuntime, relativeSubmissionTime, submissionMemoryKb, submissionRuntimeMs } from './problemSubmissionStats'

function result(id: string, overrides: Partial<ProblemCaseResult>): ProblemCaseResult {
  return { id, passed: true, hidden: false, input: '1', expectedOutput: '1', output: '1', stderr: null, durationMs: 1, verdict: 'accepted', ...overrides }
}
const base: ProblemSubmission = { id: '00000000-0000-4000-8000-000000000002', problemId: 'p', contentVersion: 1, testsetVersion: 1, language: 'python', mode: 'submit', status: 'completed', verdict: 'accepted', passedCases: 3, totalCases: 3, results: [], error: null, createdAt: '2026-10-12T12:00:00Z', finishedAt: '2026-10-12T12:00:02Z' }

describe('submission runtime and memory', () => {
  it('sums case durations and takes the peak batch memory', () => {
    const submission = { ...base, results: [result('a', { durationMs: 2.4, memoryKb: 16_000 }), result('b', { durationMs: 3.3, memoryKb: 18_022 }), result('c', { durationMs: 0.8, memoryKb: null })] }
    expect(submissionRuntimeMs(submission)).toBeCloseTo(6.5)
    expect(submissionMemoryKb(submission)).toBe(18_022)
    expect(formatRuntime(6.5)).toBe('7 ms')
    expect(formatRuntime(12_345)).toBe('12,345 ms')
    expect(formatMemory(18_022)).toBe('17.6 MB')
  })

  it('reports no memory for submissions that predate it and no numbers while pending or uncompiled', () => {
    expect(submissionMemoryKb({ ...base, results: [result('a', {}), result('b', { memoryKb: null })] })).toBeNull()
    expect(submissionRuntimeMs({ ...base, status: 'running', verdict: null, results: [result('a', {})] })).toBeNull()
    expect(submissionRuntimeMs({ ...base, verdict: 'compile_error', results: [result('a', { passed: false, durationMs: 0, verdict: 'compile_error' })] })).toBeNull()
    expect(submissionRuntimeMs({ ...base, results: [] })).toBeNull()
  })
})

describe('failing case selection', () => {
  it('skips hidden failures and passing cases to the first failing case with visible data', () => {
    const results = [result('a', {}), result('b', { passed: false, hidden: true, input: null, verdict: 'wrong_answer' }), result('c', { passed: false, verdict: 'runtime_error' }), result('d', { passed: false, verdict: 'wrong_answer' })]
    expect(firstFailingVisibleCase(results)).toEqual({ index: 2, result: results[2] })
    expect(firstFailingVisibleCase([result('a', {}), result('b', { passed: false, hidden: true, verdict: 'time_limit' })])).toBeNull()
    expect(firstFailingVisibleCase([result('a', {})])).toBeNull()
  })
})

describe('relative submission time', () => {
  const now = new Date('2026-10-13T12:00:00Z')
  it('reads recent times relatively and older ones as dates', () => {
    expect(relativeSubmissionTime('2026-10-13T11:59:30Z', now)).toBe('Just now')
    expect(relativeSubmissionTime('2026-10-13T11:55:00Z', now)).toBe('5 minutes ago')
    expect(relativeSubmissionTime('2026-10-13T09:00:00Z', now)).toBe('3 hours ago')
    expect(relativeSubmissionTime('2026-10-12T10:00:00Z', now)).toBe('Yesterday')
    expect(relativeSubmissionTime('2026-10-01T12:00:00Z', now)).toBe(new Date('2026-10-01T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))
    expect(() => relativeSubmissionTime('not a date', now)).toThrow('not a valid date')
  })
})
