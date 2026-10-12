import { Check } from 'lucide-react'
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { ProblemCaseResult, ProblemSubmission, ProblemVerdict } from '../../../shared/problemExecution'
import { labeledInput } from './problemTestcases'
import type { TestcaseField } from './problemTestcases'

export const verdictLabels: Readonly<Record<ProblemVerdict, string>> = { accepted: 'Accepted', wrong_answer: 'Wrong Answer', compile_error: 'Compile Error', runtime_error: 'Runtime Error', time_limit: 'Time Limit Exceeded', output_limit: 'Output Limit Exceeded', execution_error: 'Execution Failed' }

/** An ungraded run (custom input, no testset) has no expected answer, so finishing is not an Accepted verdict. */
export function submissionLabel(submission: ProblemSubmission): string {
  if (submission.mode === 'run' && submission.testsetVersion === null && submission.verdict === 'accepted') return 'Finished'
  return submission.verdict === null ? submission.status === 'queued' ? 'Queued' : submission.status === 'running' ? 'Running' : submission.status === 'failed' ? 'Failed' : 'Completed' : verdictLabels[submission.verdict]
}

function Value({ label, text, tone }: { label: string; text: string; tone: 'plain' | 'error' }): ReactNode {
  return <div className="problem-result-value"><span>{label}</span><pre className={tone === 'error' ? 'is-error' : undefined}>{text}</pre></div>
}

function CaseDetail({ result, fields }: { result: ProblemCaseResult; fields: readonly TestcaseField[] | null }): ReactNode {
  if (result.hidden) return <p className="problem-result-note">This test case is hidden.</p>
  const labeled = fields === null || result.input === null ? null : labeledInput(fields, result.input)
  return <div className="problem-case-detail" data-testid="problem-case-detail">
    {result.input === null ? null : labeled === null ? <Value label="Input" text={result.input} tone="plain" /> : <div className="problem-result-value"><span>Input</span>{labeled.map(item => <div className="problem-result-param" key={item.field.name}><span>{item.field.label}</span><pre>{item.value}</pre></div>)}</div>}
    {result.stdout === undefined || result.stdout === null || result.stdout === '' ? null : <Value label="Stdout" text={result.stdout} tone="plain" />}
    {result.output === null ? null : <Value label="Output" text={result.output} tone="plain" />}
    {result.expectedOutput === null ? null : <Value label="Expected" text={result.expectedOutput} tone="plain" />}
    {result.stderr === null || result.stderr === '' ? null : <Value label={result.verdict === 'accepted' ? 'Errors' : verdictLabels[result.verdict]} text={result.stderr} tone="error" />}
  </div>
}

/** LeetCode's result anatomy: one prominent verdict, then the cases. Submissions show only the first failing case. */
export function ProblemTestResult({ submission, fields }: { submission: ProblemSubmission; fields: readonly TestcaseField[] | null }): ReactNode {
  const firstFailure = submission.results.findIndex(result => !result.passed)
  const [selected, setSelected] = useState(firstFailure < 0 ? 0 : firstFailure)
  const pending = submission.status === 'queued' || submission.status === 'running'
  const compile = submission.verdict === 'compile_error' ? submission.results.find(result => result.verdict === 'compile_error') : undefined
  const runtime = submission.results.reduce((total, result) => total + result.durationMs, 0)
  const graded = submission.mode === 'submit' || submission.testsetVersion !== null
  const tone = pending ? 'is-pending' : submission.verdict === 'accepted' ? graded ? 'is-accepted' : '' : 'is-failed'
  const result = submission.mode === 'submit' ? submission.results[firstFailure] : submission.results[selected]
  return <div className="problem-result" data-testid="problem-result">
    <div className="problem-verdict-row">
      <strong className={`problem-verdict ${tone}`} data-testid="problem-verdict">{submission.verdict === 'accepted' && graded && !pending ? <Check size={18} aria-hidden="true" /> : null}{pending ? (submission.status === 'queued' ? 'Pending' : 'Judging') : submissionLabel(submission)}</strong>
      {pending || compile !== undefined ? null : <span className="tnum">{submission.testsetVersion === null ? `${submission.results.length} ${submission.results.length === 1 ? 'case' : 'cases'}` : `${submission.passedCases} / ${submission.totalCases} testcases passed`}</span>}
      {pending || compile !== undefined || submission.results.length === 0 ? null : <span className="tnum">Runtime {Math.round(runtime)} ms</span>}
    </div>
    {submission.error === null ? null : <p className="lc-error" role="alert">{submission.error}</p>}
    {compile === undefined ? null : <pre className="problem-compile-output" data-testid="problem-compile-output">{compile.stderr ?? 'The compiler reported no output.'}</pre>}
    {pending || compile !== undefined ? null : submission.mode === 'submit' ? result === undefined ? null : <><p className="problem-result-note">{result.hidden ? `Failed on hidden test case ${firstFailure + 1}.` : `Failed on test case ${firstFailure + 1}.`}</p><CaseDetail result={result} fields={fields} /></> : <>
      <div className="problem-case-chips" role="tablist" aria-label="Test results">{submission.results.map((item, index) => <button key={item.id} type="button" role="tab" aria-selected={selected === index} className={item.passed ? 'is-passed' : 'is-failed'} onClick={() => setSelected(index)}>{item.hidden ? 'Hidden' : 'Case'} {index + 1}</button>)}</div>
      {result === undefined ? null : <CaseDetail result={result} fields={fields} />}
    </>}
    {submission.sourceCode === undefined || submission.sourceCode === null ? null : <details className="problem-submission-source"><summary>Submitted code</summary><pre data-testid="problem-submission-source">{submission.sourceCode}</pre></details>}
  </div>
}
