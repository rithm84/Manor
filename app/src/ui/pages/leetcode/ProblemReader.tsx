import { Building2, CircleCheck, ExternalLink, Lightbulb, Tag } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { ProblemDetail, ProblemLibraryApi } from '../../../shared/problemLibrary'
import type { ProblemSubmission } from '../../../shared/problemExecution'
import { problemLanguageLabels } from '../../../shared/problemExecution'
import { Button } from '../../components/ui'
import { kindLabel } from './ProblemEditorDialog'
import { ProblemDifficulty } from './ProblemDifficulty'
import { ProblemGroupSources } from './ProblemGroupSources'
import { ProblemMarkdown } from './ProblemMarkdown'
import { ProblemSourceDetails } from './ProblemSourceDetails'
import { ProblemTagList } from './ProblemTag'
import { submissionLabel } from './ProblemTestResult'
import { leetCodeNumber, splitStatement, tagFacets } from './problemTestcases'

type ReaderTab = 'description' | 'editorial' | 'submissions'
type Disclosure = 'topics' | 'companies' | 'collections'

interface Props {
  detail: ProblemDetail; library: ProblemLibraryApi; coding: boolean; solved: boolean
  history: readonly ProblemSubmission[]; historyError: string | null; openingSubmission: string | null; busy: boolean
  onRetryHistory: () => void; onOpenSubmission: (id: string) => void; onDetail: (next: ProblemDetail) => void
}

function Examples({ detail }: { detail: ProblemDetail }): ReactNode {
  const examples = detail.content?.examples ?? []
  if (examples.length === 0) return null
  return <section className="problem-examples" aria-label="Examples">{examples.map((example, index) => <div className="problem-example" key={index} data-testid={`problem-example-${index}`}>
    <h3>Example {index + 1}</h3>
    <dl className="problem-example-body">
      <div><dt>Input</dt><dd><code>{example.input}</code></dd></div>
      <div><dt>Output</dt><dd><code>{example.output}</code></dd></div>
      {example.explanation === null ? null : <div><dt>Explanation</dt><dd><ProblemMarkdown text={example.explanation} /></dd></div>}
    </dl>
  </div>)}</section>
}

function SubmissionList({ history, historyError, openingSubmission, busy, onRetry, onOpen }: { history: readonly ProblemSubmission[]; historyError: string | null; openingSubmission: string | null; busy: boolean; onRetry: () => void; onOpen: (id: string) => void }): ReactNode {
  return <>
    {historyError === null ? null : <div className="lc-error" role="alert"><p>{historyError}</p><Button variant="ghost" onClick={onRetry}>Try again</Button></div>}
    {history.length === 0 ? <p className="problem-results-empty">No submissions yet. Your runs and submissions appear here.</p> : <ol className="problem-submissions" data-testid="problem-submissions">{history.map(item => <li key={item.id}><button type="button" data-testid={`problem-submission-${item.id}`} disabled={busy || openingSubmission !== null} onClick={() => onOpen(item.id)}>
      <strong className={item.verdict === 'accepted' && (item.mode === 'submit' || item.testsetVersion !== null) ? 'is-accepted' : item.verdict === null || item.verdict === 'accepted' ? '' : 'is-failed'}>{submissionLabel(item)}</strong>
      <span>{item.mode === 'run' ? 'Run' : 'Submission'}</span>
      <span>{problemLanguageLabels[item.language]}</span>
      <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</time>
    </button></li>)}</ol>}
  </>
}

/** The problem reader: LeetCode's Description, Editorial, and Submissions tabs over one scroll area. */
export function ProblemReader({ detail, library, coding, solved, history, historyError, openingSubmission, busy, onRetryHistory, onOpenSubmission, onDetail }: Props): ReactNode {
  const { problem, content } = detail
  const [tab, setTab] = useState<ReaderTab>('description')
  const [open, setOpen] = useState<Disclosure | null>(null)
  const [editorialShown, setEditorialShown] = useState(false)
  const hints = useRef<HTMLElement>(null)
  const number = leetCodeNumber(problem)
  const facets = useMemo(() => tagFacets(problem.tags), [problem.tags])
  const statement = useMemo(() => content === null ? null : splitStatement(content.statementMarkdown), [content])
  const tabs = ([['description', 'Description'], ['editorial', 'Editorial'], ['submissions', 'Submissions']] as const).filter(([value]) => value !== 'submissions' || coding)
  const disclosures = ([['topics', 'Topics', <Tag key="icon" size={13} aria-hidden="true" />], ['companies', 'Companies', <Building2 key="icon" size={13} aria-hidden="true" />], ['collections', 'Collections', null]] as const).filter(([value]) => problem[value].length > 0)
  return <article className="problem-reader" data-testid="problem-reader">
    <nav className="problem-tabs problem-reader-tabs" aria-label="Problem content">{tabs.map(([value, label]) => <button type="button" key={value} className={tab === value ? 'is-active' : ''} aria-pressed={tab === value} data-testid={`problem-${value}-tab`} onClick={() => setTab(value)}>{label}{value === 'submissions' && history.length > 0 ? <span className="tnum problem-tab-count">{history.length}</span> : null}</button>)}</nav>
    <div className="problem-reader-scroll">
      {tab === 'submissions' ? <SubmissionList history={history} historyError={historyError} openingSubmission={openingSubmission} busy={busy} onRetry={onRetryHistory} onOpen={onOpenSubmission} /> : tab === 'editorial' ? content?.solutionMarkdown === null || content?.solutionMarkdown === undefined ? <p className="problem-results-empty">No editorial yet.</p> : editorialShown ? <ProblemMarkdown text={content.solutionMarkdown} /> : <div className="problem-editorial-locked"><p>The editorial walks through a full solution.</p><Button variant="subtle" testId="problem-reveal-editorial" onClick={() => setEditorialShown(true)}>Reveal editorial</Button></div> : <>
        <h1 className="problem-reader-title" data-testid="problem-title">{number === null ? null : <span className="tnum">{number}. </span>}{problem.name}</h1>
        <div className="problem-reader-meta">
          <ProblemDifficulty problem={problem} />
          {problem.kind === 'coding' ? null : <span className="problem-meta-text">{kindLabel[problem.kind]}</span>}
          {solved ? <span className="problem-solved" data-testid="problem-solved"><CircleCheck size={14} aria-hidden="true" />Solved</span> : problem.status === 'attempted' ? <span className="problem-meta-text">Attempted</span> : null}
          {disclosures.map(([value, label, icon]) => <button type="button" key={value} className={`problem-meta-chip${open === value ? ' is-open' : ''}`} aria-expanded={open === value} data-testid={`problem-disclosure-${value}`} onClick={() => setOpen(open === value ? null : value)}>{icon}{label}</button>)}
          {content === null || content.hints.length === 0 ? null : <button type="button" className="problem-meta-chip" onClick={() => hints.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })}><Lightbulb size={13} aria-hidden="true" />Hint</button>}
        </div>
        {open === null ? null : <div className="problem-disclosure" data-testid="problem-disclosure"><ProblemTagList category={open} labels={problem[open]} limit={1000} /></div>}
        {facets.length === 0 ? null : <dl className="problem-facets" aria-label="Interview evidence">{facets.map(group => <div key={group.facet}><dt>{group.facet === 'Other' ? 'Tags' : group.facet}</dt><dd>{group.values.map(value => value.label).join(', ')}</dd></div>)}</dl>}
        {content === null || statement === null ? <div className="problem-statement-empty" data-testid="problem-statement-empty"><p>This problem has no statement yet.</p></div> : <>
          <ProblemMarkdown text={statement.description} />
          {statement.hasInlineExamples ? null : <Examples detail={detail} />}
          {statement.rest === '' ? null : <ProblemMarkdown text={statement.rest} />}
          {content.hints.length === 0 ? null : <section className="problem-hints" ref={hints} aria-label="Hints">{content.hints.map((hint, index) => <details className="problem-hint" key={index}><summary>Hint {index + 1}</summary><ProblemMarkdown text={hint} /></details>)}</section>}
        </>}
        {!coding && problem.kind === 'coding' && problem.sourceType !== 'stock' && content !== null ? <p className="problem-availability" data-testid="problem-availability">Ask Codex to clarify this problem and add tests before solving it here.</p> : null}
        <ProblemSourceDetails metadata={problem.sourceMetadata} />
        <ProblemGroupSources detail={detail} library={library} onDetail={onDetail} />
        {problem.sourceUrl === null ? null : <a className="problem-source-link" href={problem.sourceUrl} target="_blank" rel="noreferrer"><ExternalLink size={13} aria-hidden="true" />Open original source</a>}
      </>}
    </div>
  </article>
}
