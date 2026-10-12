import { Plus, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { PROBLEM_KINDS, PROBLEM_LANGUAGES } from '../../../shared/problemLibrary'
import type { ProblemDetail, ProblemKind, ProblemContentInput, SaveProblemInput } from '../../../shared/problemLibrary'
import { problemLanguageLabels } from '../../../shared/problemExecution'
import { Button, Modal } from '../../components/ui'
import { errorMessage } from './leetCodeModel'
import { ProblemTagList } from './ProblemTag'

interface Props { detail: ProblemDetail | null; onClose: () => void; onSave: (input: SaveProblemInput) => Promise<void> }
export const kindLabel: Readonly<Record<ProblemKind, string>> = { coding: 'Coding', system_design: 'System design', behavioral: 'Behavioral', other: 'Other' }
function labels(value: string): string[] { return [...new Set(value.split(',').map(label => label.trim()).filter(label => label !== ''))] }

/** Metadata and complete content share one revision-checked save. */
export function ProblemEditorDialog({ detail, onClose, onSave }: Props): ReactNode {
  const problem = detail?.problem
  const [id] = useState(() => problem?.id ?? crypto.randomUUID())
  const [name, setName] = useState(problem?.name ?? '')
  const [kind, setKind] = useState<ProblemKind>(problem?.kind ?? 'coding')
  const [difficulty, setDifficulty] = useState(problem?.difficulty ?? '')
  const [topics, setTopics] = useState(problem?.topics.join(', ') ?? '')
  const [companies, setCompanies] = useState(problem?.companies.join(', ') ?? '')
  const [tags, setTags] = useState(problem?.tags.join(', ') ?? '')
  const [collections, setCollections] = useState(problem?.collections.join(', ') ?? '')
  const [sourceUrl, setSourceUrl] = useState(problem?.sourceUrl ?? '')
  const [statement, setStatement] = useState(detail?.content?.statementMarkdown ?? '')
  const [hints, setHints] = useState(detail?.content?.hints.join('\n\n') ?? '')
  const [solution, setSolution] = useState(detail?.content?.solutionMarkdown ?? '')
  const [examples, setExamples] = useState<ProblemContentInput['examples']>(detail?.content?.examples ?? [])
  const [starter, setStarter] = useState<ProblemContentInput['starterCode']>(detail?.content?.starterCode ?? {})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const requestClose = (): void => { if (dirty) setConfirmDiscard(true); else onClose() }
  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault(); setBusy(true); setError(null)
    try {
      const { problemContentInputSchema } = await import('../../../shared/problemLibrary')
      const content = statement.trim() === '' ? null : problemContentInputSchema.parse({ statementMarkdown: statement, examples, hints: hints.split(/\n\s*\n/).map(text => text.trim()).filter(Boolean), solutionMarkdown: solution.trim() === '' ? null : solution, starterCode: starter, interface: detail?.content?.interface ?? null })
      if (detail?.content !== null && detail?.content !== undefined && content === null) throw new Error('The statement cannot be empty for a problem with saved content.')
      await onSave({ id, expectedRevision: problem?.revision ?? 0, name, kind, difficulty: difficulty === '' ? null : difficulty as 'Easy' | 'Medium' | 'Hard', topics: labels(topics), companies: labels(companies), tags: labels(tags), collections: labels(collections), sourceUrl: sourceUrl.trim() === '' ? null : sourceUrl.trim(), sourceType: problem?.sourceType ?? 'custom', externalKey: problem?.externalKey ?? null, content })
      onClose()
    } catch (failure) { setError(errorMessage(failure)) } finally { setBusy(false) }
  }
  return <><Modal open onClose={requestClose} width={800} ariaLabel={problem ? 'Edit problem' : 'New problem'}>
    <form className="problem-edit" data-testid="problem-edit-dialog" onChange={() => setDirty(true)} onSubmit={event => void save(event)}>
      <header><h2>{problem ? 'Edit problem' : 'New problem'}</h2><Button variant="ghost" icon={<X size={18} />} ariaLabel="Close problem editor" onClick={requestClose}>{null}</Button></header>
      <div className="problem-edit-body">
        <label className="problem-property"><span>Name</span><input data-testid="problem-name" value={name} required maxLength={500} autoFocus onChange={event => setName(event.target.value)} /></label>
        <label className="problem-property"><span>Kind</span><select data-testid="problem-kind" value={kind} onChange={event => setKind(event.target.value as ProblemKind)}>{PROBLEM_KINDS.map(value => <option key={value} value={value}>{kindLabel[value]}</option>)}</select></label>
        <label className="problem-property"><span>Difficulty</span><select value={difficulty} onChange={event => setDifficulty(event.target.value)}><option value="">Not specified</option>{['Easy', 'Medium', 'Hard'].map(value => <option key={value}>{value}</option>)}</select></label>
        {([['Topics', 'topics', topics, setTopics], ['Companies', 'companies', companies, setCompanies], ['Tags', 'tags', tags, setTags], ['Collections', 'collections', collections, setCollections]] as const).map(([label, category, value, change]) => <label className="problem-property" key={label}><span>{label}</span><span className="problem-label-field"><input value={value} placeholder="Separate with commas" onChange={event => change(event.target.value)} />{value.trim() === '' ? null : <ProblemTagList category={category} labels={labels(value)} limit={5} />}</span></label>)}
        <label className="problem-property"><span>Source</span><input type="url" value={sourceUrl} placeholder="https://" onChange={event => setSourceUrl(event.target.value)} /></label>
        <label className="problem-long-field"><span>Problem</span><textarea data-testid="problem-statement" rows={10} value={statement} placeholder="Write the statement in Markdown" onChange={event => setStatement(event.target.value)} /></label>
        <details className="problem-content-fields"><summary>Examples, hints, and solution</summary>
          {examples.map((example, index) => <section key={index} className="problem-example-editor"><header><h3>Example {index + 1}</h3><Button variant="ghost" icon={<Trash2 size={15} />} ariaLabel={`Remove example ${index + 1}`} onClick={() => { setDirty(true); setExamples(previous => previous.filter((_, item) => item !== index)) }}>{null}</Button></header>{(['input', 'output', 'explanation'] as const).map(property => <label key={property} className="problem-long-field"><span>{property === 'input' ? 'Input' : property === 'output' ? 'Output' : 'Explanation'}</span><textarea rows={3} spellCheck={property === 'explanation'} value={example[property] ?? ''} onChange={event => setExamples(previous => previous.map((item, position) => position === index ? { ...item, [property]: event.target.value } : item))} /></label>)}</section>)}
          <Button variant="subtle" icon={<Plus size={15} />} onClick={() => { setDirty(true); setExamples(previous => [...previous, { input: '', output: '', explanation: null }]) }}>Add example</Button>
          <label className="problem-long-field"><span>Hints</span><textarea rows={4} value={hints} placeholder="Separate hints with a blank line" onChange={event => setHints(event.target.value)} /></label>
          <label className="problem-long-field"><span>Solution</span><textarea rows={6} value={solution} onChange={event => setSolution(event.target.value)} /></label>
        </details>
        {kind === 'coding' ? <details className="problem-content-fields"><summary>Starter code</summary>{PROBLEM_LANGUAGES.map(language => <label className="problem-long-field" key={language}><span>{problemLanguageLabels[language]}</span><textarea rows={5} spellCheck={false} value={starter[language] ?? ''} onChange={event => setStarter(previous => ({ ...previous, [language]: event.target.value }))} /></label>)}</details> : null}
        {error === null ? null : <p className="lc-error" role="alert">{error}</p>}
      </div>
      <footer><Button variant="ghost" onClick={requestClose} disabled={busy}>Cancel</Button><button data-testid="problem-save" type="submit" className="ui-button ui-button--primary" disabled={busy || name.trim() === ''}>{busy ? 'Saving…' : 'Save problem'}</button></footer>
    </form>
  </Modal><Modal open={confirmDiscard} onClose={() => setConfirmDiscard(false)} width={380} ariaLabel="Discard problem changes"><div className="ui-confirm"><h2>Discard these changes?</h2><p>They have not been saved.</p><div className="ui-confirm-actions"><Button variant="ghost" onClick={() => setConfirmDiscard(false)}>Keep editing</Button><Button variant="primary" onClick={onClose}>Discard</Button></div></div></Modal></>
}
