import { Check, LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { ProblemCaseResult, ProblemExecutionMode, ProblemSubmission, ProblemVerdict } from '../../../shared/problemExecution'
import { labeledInput } from './problemTestcases'
import type { TestcaseField } from './problemTestcases'
import { firstFailingVisibleCase, formatMemory, formatRuntime, submissionMemoryKb, submissionRuntimeMs } from './problemSubmissionStats'

export const verdictLabels: Readonly<Record<ProblemVerdict, string>> = { accepted: 'Accepted', wrong_answer: 'Wrong Answer', compile_error: 'Compile Error', runtime_error: 'Runtime Error', time_limit: 'Time Limit Exceeded', output_limit: 'Output Limit Exceeded', execution_error: 'Execution Failed' }

/** An ungraded run (custom input, no testset) has no expected answer, so finishing is not an Accepted verdict. */
export function submissionLabel(submission: ProblemSubmission): string {
  if (submission.mode === 'run' && submission.testsetVersion === null && submission.verdict === 'accepted') return 'Finished'
  return submission.verdict === null ? submission.status === 'queued' ? 'Queued' : submission.status === 'running' ? 'Running' : submission.status === 'failed' ? 'Failed' : 'Completed' : verdictLabels[submission.verdict]
}

export function isGraded(submission: ProblemSubmission): boolean {
  return submission.mode === 'submit' || submission.testsetVersion !== null
}

/** Accepted reads green only when it was graded against expected answers; every other verdict reads as a failure. */
export function submissionTone(submission: ProblemSubmission): string {
  if (submission.verdict === null) return submission.status === 'failed' ? 'is-failed' : ''
  return submission.verdict === 'accepted' ? isGraded(submission) ? 'is-accepted' : '' : 'is-failed'
}

/** The calm in-flight state shared by the console and the submission view: one small spinner and a word. */
export function PendingVerdict({ mode }: { mode: ProblemExecutionMode }): ReactNode {
  return <div className="problem-result-pending" role="status" data-testid="problem-result-pending"><LoaderCircle className="problem-spinner" size={16} aria-hidden="true" />{mode === 'submit' ? 'Judging' : 'Running'}</div>
}

function Value({ label, text, tone }: { label: string; text: string; tone: 'plain' | 'error' }): ReactNode {
  return <div className="problem-result-value"><span>{label}</span><pre className={tone === 'error' ? 'is-error' : undefined}>{text}</pre></div>
}

export function CaseDetail({ result, fields }: { result: ProblemCaseResult; fields: readonly TestcaseField[] | null }): ReactNode {
  if (result.hidden && result.input === null) return <p className="problem-result-note">This test case is hidden.</p>
  const labeled = fields === null || result.input === null ? null : labeledInput(fields, result.input)
  return <div className="problem-case-detail" data-testid="problem-case-detail">
    {result.input === null ? null : labeled === null ? <Value label="Input" text={result.input} tone="plain" /> : <div className="problem-result-value"><span>Input</span>{labeled.map(item => <div className="problem-result-param" key={item.field.name}><span>{item.field.label}</span><pre>{item.value}</pre></div>)}</div>}
    {result.output === null ? null : <Value label="Output" text={result.output} tone="plain" />}
    {result.expectedOutput === null ? null : <Value label="Expected" text={result.expectedOutput} tone="plain" />}
    {result.verdict === 'wrong_answer' && result.output === null ? <p className="problem-result-note">Output was not saved for this submission. Submit again to see it.</p> : null}
    {result.stdout === undefined || result.stdout === null || result.stdout === '' ? null : <Value label="Stdout" text={result.stdout} tone="plain" />}
    {result.stderr === null || result.stderr === '' ? null : <Value label={result.verdict === 'accepted' ? 'Errors' : verdictLabels[result.verdict]} text={result.stderr} tone="error" />}
  </div>
}

/** A failed submission shows its first failing case the account may see, and says when an earlier hidden case failed first. */
export function SubmissionFailure({ submission, fields }: { submission: ProblemSubmission; fields: readonly TestcaseField[] | null }): ReactNode {
  const first = submission.results.findIndex(result => !result.passed)
  if (first < 0 || submission.verdict === 'compile_error') return null
  const visible = firstFailingVisibleCase(submission.results)
  return <section className="problem-submission-failure" data-testid="problem-submission-failure">
    {visible?.index === first ? <p className="problem-result-note">Failed on test case {first + 1}.</p> : <p className="problem-result-note">Failed on hidden test case {first + 1}.{visible === null ? null : ` Test case ${visible.index + 1} also failed.`}</p>}
    {visible === null ? null : <CaseDetail result={visible.result} fields={fields} />}
  </section>
}

export function CompileOutput({ submission }: { submission: ProblemSubmission }): ReactNode {
  const compile = submission.verdict === 'compile_error' ? submission.results.find(result => result.verdict === 'compile_error') : undefined
  return compile === undefined ? null : <pre className="problem-compile-output" data-testid="problem-compile-output">{compile.stderr ?? 'The compiler reported no output.'}</pre>
}

/** LeetCode's result anatomy: one prominent verdict and its counts, then the cases. Submissions show only a failing case. */
export function ProblemTestResult({ submission, fields }: { submission: ProblemSubmission; fields: readonly TestcaseField[] | null }): ReactNode {
  const firstFailure = submission.results.findIndex(result => !result.passed)
  const [selected, setSelected] = useState(firstFailure < 0 ? 0 : firstFailure)
  const compiled = submission.verdict !== 'compile_error'
  const runtime = submissionRuntimeMs(submission)
  const memory = submissionMemoryKb(submission)
  const result = submission.results[selected]
  return <div className="problem-result" data-testid="problem-result">
    <div className="problem-verdict-row">
      <strong className={`problem-verdict ${submissionTone(submission)}`} data-testid="problem-verdict">{submission.verdict === 'accepted' && isGraded(submission) ? <Check size={18} aria-hidden="true" /> : null}{submissionLabel(submission)}</strong>
      {!compiled || submission.results.length === 0 ? null : <span className="tnum" data-testid="problem-passed-count">{submission.testsetVersion === null ? `${submission.results.length} ${submission.results.length === 1 ? 'case' : 'cases'}` : `Passed test cases: ${submission.passedCases} / ${submission.totalCases}`}</span>}
      {runtime === null ? null : <span className="tnum">Runtime: {formatRuntime(runtime)}</span>}
      {memory === null ? null : <span className="tnum">Memory: {formatMemory(memory)}</span>}
    </div>
    {submission.error === null ? null : <p className="lc-error" role="alert">{submission.error}</p>}
    <CompileOutput submission={submission} />
    {!compiled ? null : submission.mode === 'submit' ? <SubmissionFailure submission={submission} fields={fields} /> : <>
      <div className="problem-case-chips" role="tablist" aria-label="Test results">{submission.results.map((item, index) => <button key={item.id} type="button" role="tab" aria-selected={selected === index} className={item.passed ? 'is-passed' : 'is-failed'} data-testid={`problem-result-case-${index}`} onClick={() => setSelected(index)}>{item.hidden ? 'Hidden' : 'Case'} {index + 1}</button>)}</div>
      {result === undefined ? null : <CaseDetail result={result} fields={fields} />}
    </>}
  </div>
}
