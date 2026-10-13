import { Building2, ChevronRight, CircleCheck, ExternalLink, Lightbulb, Tag } from 'lucide-react'
import { Fragment, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { ProblemDetail, ProblemLibraryApi } from '../../../shared/problemLibrary'
import { kindLabel } from './leetCodeModel'
import { ProblemDifficulty } from './ProblemDifficulty'
import { ProblemGroupSources } from './ProblemGroupSources'
import { ProblemMarkdown } from './ProblemMarkdown'
import { ProblemSourceDetails } from './ProblemSourceDetails'
import { ProblemTagList } from './ProblemTag'
import { SubmissionsPanel, listedSubmissions } from './ProblemSubmissions'
import type { SubmissionsPanelProps } from './ProblemSubmissions'
import { exampleAssignments, problemTitle, splitStatement, tagFacets } from './problemTestcases'

export type ReaderTab = 'description' | 'submissions' | 'solution'
type Disclosure = 'topics' | 'companies' | 'collections'

interface Props {
  detail: ProblemDetail; library: ProblemLibraryApi; coding: boolean; solved: boolean
  tab: ReaderTab; onTab: (tab: ReaderTab) => void; submissions: SubmissionsPanelProps
}

function Examples({ detail }: { detail: ProblemDetail }): ReactNode {
  const examples = detail.content?.examples ?? []
  if (examples.length === 0) return null
  return <section className="problem-examples" aria-label="Examples">{examples.map((example, index) => <div className="problem-example" key={index} data-testid={`problem-example-${index}`}>
    <h3>Example {index + 1}</h3>
    <dl className="problem-example-body">
      <div><dt>Input</dt><dd><code className="problem-example-input">{exampleAssignments(example.input).map((pair, position) => <Fragment key={position}>{position === 0 ? null : ' '}<span className="problem-example-pair">{pair}</span></Fragment>)}</code></dd></div>
      <div><dt>Output</dt><dd><code>{example.output}</code></dd></div>
      {example.explanation === null ? null : <div><dt>Explanation</dt><dd><ProblemMarkdown text={example.explanation} /></dd></div>}
    </dl>
  </div>)}</section>
}

/** The problem reader: Description, Submissions, and Solution tabs over one scroll area, each starting at the same place. */
export function ProblemReader({ detail, library, coding, solved, tab, onTab, submissions }: Props): ReactNode {
  const { problem, content } = detail
  const [open, setOpen] = useState<Disclosure | null>(null)
  const hints = useRef<HTMLElement>(null)
  const facets = useMemo(() => tagFacets(problem.tags), [problem.tags])
  const statement = useMemo(() => content === null ? null : splitStatement(content.statementMarkdown), [content])
  const tabs = ([['description', 'Description'], ['submissions', 'Submissions'], ['solution', 'Solution']] as const).filter(([value]) => value !== 'submissions' || coding)
  const submitted = listedSubmissions(submissions.history).length
  const disclosures = ([['topics', 'Topics', <Tag key="icon" size={13} aria-hidden="true" />], ['companies', 'Companies', <Building2 key="icon" size={13} aria-hidden="true" />], ['collections', 'Collections', null]] as const).filter(([value]) => problem[value].length > 0)
  return <article className="problem-reader" data-testid="problem-reader">
    <nav className="problem-tabs problem-reader-tabs" aria-label="Problem content">{tabs.map(([value, label]) => <button type="button" key={value} className={tab === value ? 'is-active' : ''} aria-pressed={tab === value} data-testid={`problem-${value}-tab`} onClick={() => onTab(value)}>{label}{value === 'submissions' && submitted > 0 ? <span className="tnum problem-tab-count">{submitted}</span> : null}</button>)}</nav>
    <div className="problem-reader-scroll">
      {tab === 'submissions' ? <SubmissionsPanel {...submissions} /> : tab === 'solution' ? content?.solutionMarkdown === null || content?.solutionMarkdown === undefined ? <p className="problem-results-empty" data-testid="problem-solution-empty">No solution yet.</p> : <ProblemMarkdown text={content.solutionMarkdown} /> : <>
        <h1 className="problem-reader-title" data-testid="problem-title">{problemTitle(problem)}</h1>
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
          {content.hints.length === 0 ? null : <section className="problem-hints" ref={hints} aria-label="Hints">{content.hints.map((hint, index) => <details className="problem-hint" key={index}><summary><ChevronRight className="problem-disclosure-icon" size={14} aria-hidden="true" />Hint {index + 1}</summary><ProblemMarkdown text={hint} /></details>)}</section>}
        </>}
        {!coding && problem.kind === 'coding' && problem.sourceType !== 'stock' && content !== null ? <p className="problem-availability" data-testid="problem-availability">Ask Codex to clarify this problem and add tests before solving it here.</p> : null}
        <footer className="problem-reader-footer">
          <ProblemSourceDetails metadata={problem.sourceMetadata} />
          <ProblemGroupSources detail={detail} library={library} />
          {problem.sourceUrl === null ? null : <a className="problem-source-link" href={problem.sourceUrl} target="_blank" rel="noreferrer"><ExternalLink size={13} aria-hidden="true" />Open original source</a>}
        </footer>
      </>}
    </div>
  </article>
}
