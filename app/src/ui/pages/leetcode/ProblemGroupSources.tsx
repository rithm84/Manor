import { ChevronRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { ProblemContent, ProblemDetail, ProblemLibraryApi, ProblemRecord } from '../../../shared/problemLibrary'
import { problemLanguageLabels } from '../../../shared/problemExecution'
import { useManorAccount } from '../../../web/accountContext'
import { recoverableProblemDrafts } from '../../../web/problems/codeDraftStore'
import type { ProblemCodeDraft } from '../../../web/problems/codeDraftStore'
import { Button } from '../../components/ui'
import { errorMessage } from './leetCodeModel'
import { ProblemMarkdown } from './ProblemMarkdown'
import { ProblemSourceDetails } from './ProblemSourceDetails'
import { problemTitle } from './problemTestcases'

/** Source statements and unsynced code remain attached to their original identity and version. */
export function ProblemGroupSources({ detail, library }: { detail: ProblemDetail; library: ProblemLibraryApi }): ReactNode {
  const account = useManorAccount()
  const [drafts, setDrafts] = useState<readonly ProblemCodeDraft[]>([])
  const [contents, setContents] = useState<ReadonlyMap<string, ProblemContent | null>>(() => new Map([[detail.requestedId, detail.requestedContent]]))
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let cancelled = false
    const ids = detail.sourceRecords.filter(source => source.id !== detail.problem.id || !detail.canExecute).map(source => source.id)
    void recoverableProblemDrafts(account.id, ids).then(saved => { if (!cancelled) { setDrafts(saved); setError(null) } }).catch(failure => { if (!cancelled) setError(errorMessage(failure)) })
    return () => { cancelled = true }
  }, [account.id, detail, retry])
  const readSource = async (source: ProblemRecord): Promise<void> => {
    setLoading(source.id); setError(null)
    try {
      const saved = await library.loadProblem(source.id)
      setContents(previous => new Map([...previous, [source.id, saved.requestedContent]]))
    } catch (failure) { setError(errorMessage(failure)) } finally { setLoading(null) }
  }
  if (detail.sourceRecords.length < 2 && drafts.length === 0 && error === null) return null
  return <section className="problem-group-sources" data-testid="problem-group-sources" aria-label="Retained problem sources">
    {detail.requestedId === detail.problem.id ? null : <p>This source is grouped with {problemTitle(detail.problem)}. The workspace uses that problem’s statement and tests.</p>}
    {drafts.length === 0 ? null : <div className="problem-draft-recovery" data-testid="problem-alias-draft-recovery"><h2>Code from a retained source</h2><p>Your code stays with its original source and has not been copied into this problem. Copy what you need into the editor to keep working on it.</p>{drafts.map(draft => <details key={`${draft.problemId}-${draft.language}`}><summary><ChevronRight className="problem-disclosure-icon" size={14} aria-hidden="true" />{detail.sourceRecords.find(source => source.id === draft.problemId)?.sourceName ?? detail.sourceRecords.find(source => source.id === draft.problemId)?.name ?? draft.problemId} · {problemLanguageLabels[draft.language]} · Version {draft.contentVersion}</summary><pre data-testid={`problem-recovered-code-${draft.problemId}-${draft.language}`}>{draft.code}</pre></details>)}</div>}
    {error === null ? null : <div className="lc-error" role="alert"><p>{error}</p><Button variant="ghost" onClick={() => setRetry(value => value + 1)}>Check protected code again</Button></div>}
    <details data-testid="problem-retained-sources"><summary><ChevronRight className="problem-disclosure-icon" size={14} aria-hidden="true" />Sources <span className="tnum">({detail.sourceRecords.length})</span></summary><ul>{detail.sourceRecords.map(source => {
      const content = contents.get(source.id)
      return <li key={source.id}><details data-testid={`problem-source-${source.id}`}><summary><ChevronRight className="problem-disclosure-icon" size={14} aria-hidden="true" />{source.sourceName ?? problemTitle(source)} <span className="tnum">· Version {source.contentVersion}</span>{source.id === detail.problem.id ? ' · Main problem' : ''}</summary>
        {source.duplicateReason == null ? null : <p>{source.duplicateReason}</p>}
        <ProblemSourceDetails metadata={source.sourceMetadata} />
        {source.sourceUrl === null ? null : <a href={source.sourceUrl} target="_blank" rel="noreferrer">Open original source</a>}
        {content === undefined ? <Button variant="ghost" testId={`problem-read-source-${source.id}`} disabled={loading !== null} onClick={() => void readSource(source)}>{loading === source.id ? 'Loading source…' : 'Read source statement'}</Button> : content === null ? <p>No statement is stored for this source.</p> : <div className="problem-retained-statement" data-testid={`problem-source-statement-${source.id}`}><ProblemMarkdown text={content.statementMarkdown} />{content.examples.map((example, index) => <div key={index}><h3>Example {index + 1}</h3><label>Input<pre>{example.input}</pre></label><label>Output<pre>{example.output}</pre></label>{example.explanation === null ? null : <ProblemMarkdown text={example.explanation} />}</div>)}</div>}
      </details></li>
    })}</ul></details>
  </section>
}
