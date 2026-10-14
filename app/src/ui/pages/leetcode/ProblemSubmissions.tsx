import { ArrowLeft, Check, Clock, Copy, MemoryStick, SquarePen } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { ProblemLanguage, ProblemSubmission } from '../../../shared/problemExecution'
import { problemLanguageLabels } from '../../../shared/problemExecution'
import { Button, Tooltip } from '../../components/ui'
import { errorMessage } from './leetCodeModel'
import { ProblemHighlightedCode } from './ProblemHighlightedCode'
import { CompileOutput, PendingVerdict, SubmissionFailure, submissionLabel, submissionTone } from './ProblemTestResult'
import { formatMemory, formatRuntime, isPendingSubmission, relativeSubmissionTime, submissionMemoryKb, submissionRuntimeMs, submittedAt } from './problemSubmissionStats'
import type { TestcaseField } from './problemTestcases'

export interface SubmissionsPanelProps {
  history: readonly ProblemSubmission[]; historyError: string | null; opening: string | null
  opened: ProblemSubmission | null; fields: readonly TestcaseField[] | null; tabSize: number
  /** Whether "Use this code" can load a submission's language into the editor right now. */
  canUseCode: (language: ProblemLanguage) => boolean
  onRetry: () => void; onOpen: (id: string) => void; onClose: () => void; onUseCode: (submission: ProblemSubmission) => void
}

/** As on LeetCode, the history lists judged submissions; runs stay stored but are not listed. */
export function listedSubmissions(history: readonly ProblemSubmission[]): readonly ProblemSubmission[] {
  return history.filter(item => item.mode === 'submit')
}

function SubmissionList({ history: all, historyError, opening, onRetry, onOpen }: SubmissionsPanelProps): ReactNode {
  const now = new Date()
  const history = listedSubmissions(all)
  return <>
    {historyError === null ? null : <div className="lc-error" role="alert"><p>{historyError}</p><Button variant="ghost" onClick={onRetry}>Try again</Button></div>}
    {history.length === 0 ? <p className="problem-results-empty">No submissions yet. Submit your code to see it here.</p> : <div className="problem-submissions">
      <div className="problem-submissions-head" aria-hidden="true"><span>Status</span><span>Language</span><span>Runtime</span><span>Memory</span></div>
      <ol data-testid="problem-submissions">{history.map(item => {
        const runtime = submissionRuntimeMs(item)
        const memory = submissionMemoryKb(item)
        return <li key={item.id}><button type="button" data-testid={`problem-submission-${item.id}`} aria-busy={opening === item.id} disabled={opening !== null} onClick={() => onOpen(item.id)}>
          <span className="problem-submission-status"><strong className={submissionTone(item)}>{submissionLabel(item)}</strong><time dateTime={item.createdAt} title={submittedAt(item.createdAt)}>{relativeSubmissionTime(item.createdAt, now)}</time></span>
          <span>{problemLanguageLabels[item.language]}</span>
          <span className="tnum">{runtime === null ? null : formatRuntime(runtime)}</span>
          <span className="tnum">{memory === null ? null : formatMemory(memory)}</span>
        </button></li>
      })}</ol>
    </div>}
  </>
}

function Stat({ icon, label, value }: { icon: ReactNode; label: string; value: string }): ReactNode {
  return <div className="problem-stat"><span>{icon}{label}</span><strong className="tnum">{value}</strong></div>
}

function SubmissionDetail({ submission, fields, tabSize, canUseCode, onClose, onUseCode }: SubmissionsPanelProps & { submission: ProblemSubmission }): ReactNode {
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(timer)
  }, [copied])
  const pending = isPendingSubmission(submission)
  const runtime = submissionRuntimeMs(submission)
  const memory = submissionMemoryKb(submission)
  const source = submission.sourceCode ?? null
  const copy = (): void => {
    if (source === null) throw new Error('This submission has no saved code to copy.')
    setCopyError(null)
    void navigator.clipboard.writeText(source).then(() => setCopied(true)).catch(failure => setCopyError(`The code could not be copied: ${errorMessage(failure)}`))
  }
  return <section className="problem-submission-detail" data-testid="problem-submission-detail" aria-label="Submission">
    <button type="button" className="problem-back-link" data-testid="problem-submission-back" onClick={onClose}><ArrowLeft size={14} aria-hidden="true" />All submissions</button>
    {pending ? <PendingVerdict mode={submission.mode} /> : <header className="problem-submission-heading">
      <div><strong className={`problem-verdict ${submissionTone(submission)}`} data-testid="problem-submission-verdict">{submissionLabel(submission)}</strong>{submission.verdict === 'compile_error' || submission.results.length === 0 ? null : <span className="tnum">{submission.testsetVersion === null ? `${submission.results.length} ${submission.results.length === 1 ? 'case' : 'cases'}` : `${submission.passedCases} / ${submission.totalCases} test cases passed`}</span>}</div>
      <p>{problemLanguageLabels[submission.language]}<span aria-hidden="true"> · </span>{submission.mode === 'run' ? 'Run' : 'Submitted'} <time dateTime={submission.createdAt}>{submittedAt(submission.createdAt)}</time></p>
    </header>}
    {submission.error === null ? null : <p className="lc-error" role="alert">{submission.error}</p>}
    {runtime === null ? null : <div className="problem-stats" data-testid="problem-submission-stats">
      <Stat icon={<Clock size={14} aria-hidden="true" />} label="Runtime" value={formatRuntime(runtime)} />
      {memory === null ? null : <Stat icon={<MemoryStick size={14} aria-hidden="true" />} label="Memory" value={formatMemory(memory)} />}
    </div>}
    {pending ? null : <><CompileOutput submission={submission} /><SubmissionFailure submission={submission} fields={fields} /></>}
    {source === null ? null : <section className="problem-submission-code-section" aria-label="Submitted code">
      <header>
        <h3>Code<span>{problemLanguageLabels[submission.language]}</span></h3>
        <Tooltip label={copied ? 'Copied' : 'Copy code'} side="top"><button type="button" className="problem-icon-button" aria-label={copied ? 'Copied' : 'Copy code'} data-testid="problem-submission-copy" onClick={copy}>{copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}</button></Tooltip>
        <Button variant="ghost" icon={<SquarePen size={15} />} testId="problem-submission-use" disabled={!canUseCode(submission.language)} onClick={() => onUseCode(submission)}>Use this code</Button>
      </header>
      {copyError === null ? null : <p className="lc-error" role="alert">{copyError}</p>}
      <ProblemHighlightedCode code={source} language={submission.language} tabSize={tabSize} className="problem-submission-code" testId="problem-submission-source" />
    </section>}
  </section>
}

/** LeetCode's Submissions tab: a compact history whose rows open a full submission view in place. */
export function SubmissionsPanel(props: SubmissionsPanelProps): ReactNode {
  return props.opened === null ? <SubmissionList {...props} /> : <SubmissionDetail key={props.opened.id} {...props} submission={props.opened} />
}
