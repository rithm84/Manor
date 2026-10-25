import type { ProblemCaseResult, ProblemSubmission } from '../../../shared/problemExecution'

/** A submission still waiting for, or inside, the judge. */
export function isPendingSubmission(submission: ProblemSubmission): boolean {
  return submission.status === 'queued' || submission.status === 'running'
}

/** Total time across the cases that ran; a pending, empty, or uncompiled submission has no runtime. */
export function submissionRuntimeMs(submission: ProblemSubmission): number | null {
  if (isPendingSubmission(submission) || submission.verdict === 'compile_error' || submission.results.length === 0) return null
  return submission.results.reduce((total, result) => total + result.durationMs, 0)
}

/** The peak memory across the case batches, or null when no case reported memory (stdin programs and older submissions). */
export function submissionMemoryKb(submission: ProblemSubmission): number | null {
  if (isPendingSubmission(submission) || submission.verdict === 'compile_error') return null
  return submission.results.reduce<number | null>((peak, result) => result.memoryKb === undefined || result.memoryKb === null ? peak : peak === null ? result.memoryKb : Math.max(peak, result.memoryKb), null)
}

export function formatRuntime(milliseconds: number): string {
  return `${Math.round(milliseconds).toLocaleString('en-US')} ms`
}

/** Memory reads in MB with one decimal, as LeetCode shows it. */
export function formatMemory(kilobytes: number): string {
  return `${(kilobytes / 1024).toFixed(1)} MB`
}

export interface FailingCase { readonly index: number; readonly result: ProblemCaseResult }

/** The first failing case with available diagnostics, including a revealed judge counterexample. */
export function firstFailingVisibleCase(results: readonly ProblemCaseResult[]): FailingCase | null {
  const index = results.findIndex(result => !result.passed && (!result.hidden || result.input !== null))
  return index < 0 ? null : { index, result: results[index] }
}

const relative = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' })
const steps: readonly { readonly unit: Intl.RelativeTimeFormatUnit; readonly seconds: number }[] = [{ unit: 'day', seconds: 86_400 }, { unit: 'hour', seconds: 3_600 }, { unit: 'minute', seconds: 60 }]

/** Recent submissions read as relative time; anything older than a week shows its date. */
export function relativeSubmissionTime(iso: string, now: Date): string {
  const then = new Date(iso)
  const elapsed = (now.getTime() - then.getTime()) / 1000
  if (Number.isNaN(elapsed)) throw new Error(`Submission time is not a valid date: ${iso}`)
  if (elapsed < 60) return 'Just now'
  if (elapsed >= 7 * 86_400) return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(then.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }) })
  const step = steps.find(item => elapsed >= item.seconds) ?? steps[steps.length - 1]
  const text = relative.format(-Math.floor(elapsed / step.seconds), step.unit)
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export function submittedAt(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}
