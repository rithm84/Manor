import { Play, Plus, Send, X } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ProblemSubmission } from '../../../shared/problemExecution'
import { Button, Tooltip } from '../../components/ui'
import { ProblemTestResult } from './ProblemTestResult'
import type { InvalidTestcase, Testcase, TestcaseField } from './problemTestcases'

export type ConsoleTab = 'testcase' | 'result'

interface TestcaseEditorProps { fields: readonly TestcaseField[]; cases: readonly Testcase[]; selected: number; invalid: InvalidTestcase | null; disabled: boolean; onSelect: (index: number) => void; onCases: (cases: Testcase[], selected: number) => void }

/** One labeled field per parameter, in cases the user can add, edit, and remove before a Run. */
export function TestcaseEditor({ fields, cases, selected, invalid, disabled, onSelect, onCases }: TestcaseEditorProps): ReactNode {
  const current = cases[selected]
  const edit = (field: number, value: string): void => onCases(cases.map((testcase, index) => index === selected ? { ...testcase, values: testcase.values.map((item, position) => position === field ? value : item) } : testcase), selected)
  const add = (): void => onCases([...cases, { id: crypto.randomUUID(), values: current === undefined ? fields.map(() => '') : [...current.values] }], cases.length)
  const remove = (target: number): void => onCases(cases.filter((_, index) => index !== target), Math.max(0, target <= selected ? selected - 1 : selected))
  return <div className="problem-testcases" data-testid="problem-testcases">
    <div className="problem-case-chips" role="tablist" aria-label="Test cases">
      {cases.map((testcase, index) => <span key={testcase.id} className={`problem-case-chip${selected === index ? ' is-selected' : ''}${invalid?.caseIndex === index ? ' is-invalid' : ''}`}>
        <button type="button" role="tab" aria-selected={selected === index} data-testid={`problem-case-${index}`} onClick={() => onSelect(index)}>Case {index + 1}</button>
        {cases.length === 1 ? null : <button type="button" className="problem-case-remove" aria-label={`Remove case ${index + 1}`} data-testid={`problem-case-remove-${index}`} disabled={disabled} onClick={() => remove(index)}><X size={12} aria-hidden="true" /></button>}
      </span>)}
      <Tooltip label="Add a case" side="top"><button type="button" className="problem-case-add" aria-label="Add a case" data-testid="problem-case-add" disabled={disabled} onClick={add}><Plus size={14} aria-hidden="true" /></button></Tooltip>
    </div>
    {current === undefined ? null : <div className="problem-case-fields" role="tabpanel" aria-label={`Case ${selected + 1}`}>
      {fields.map((field, index) => {
        const wrong = invalid !== null && invalid.caseIndex === selected && invalid.fieldIndex === index
        return <label key={field.name} className="problem-case-field"><span>{field.label}</span><textarea data-testid={`problem-case-field-${field.name}`} rows={1} spellCheck={false} autoCapitalize="off" autoCorrect="off" value={current.values[index] ?? ''} aria-invalid={wrong} disabled={disabled} onChange={event => edit(index, event.target.value)} /></label>
      })}
    </div>}
  </div>
}

interface ConsoleProps {
  tab: ConsoleTab; onTab: (tab: ConsoleTab) => void
  editor: ReactNode; notice: ReactNode
  submission: ProblemSubmission | null; fields: readonly TestcaseField[] | null
  busy: boolean; canRun: boolean; canSubmit: boolean; onRun: () => void; onSubmit: () => void
}

/** The console under the editor: Testcase and Test Result tabs, with Run and Submit beside them. */
export function ProblemConsole({ tab, onTab, editor, notice, submission, fields, busy, canRun, canSubmit, onRun, onSubmit }: ConsoleProps): ReactNode {
  return <section className="problem-console" aria-label="Console" data-testid="problem-console">
    <header className="problem-console-header">
      <nav className="problem-tabs" aria-label="Console">{([['testcase', 'Testcase'], ['result', 'Test Result']] as const).map(([value, label]) => <button type="button" key={value} className={tab === value ? 'is-active' : ''} aria-pressed={tab === value} data-testid={`problem-console-${value}`} onClick={() => onTab(value)}>{label}</button>)}</nav>
      <div className="problem-console-actions">
        <Tooltip label="Run (⌘')" side="top"><Button variant="subtle" icon={<Play size={15} />} testId="problem-run" onClick={onRun} disabled={busy || !canRun}>{busy ? 'Running…' : 'Run'}</Button></Tooltip>
        <Tooltip label="Submit (⌘ Enter)" side="top"><Button variant="primary" icon={<Send size={15} />} testId="problem-submit" onClick={onSubmit} disabled={busy || !canSubmit}>Submit</Button></Tooltip>
      </div>
    </header>
    <div className="problem-console-body">
      {notice}
      {tab === 'testcase' ? editor : submission === null ? <p className="problem-results-empty">{busy ? 'Sending your code…' : 'Run your code to see results here.'}</p> : <ProblemTestResult key={`${submission.id}-${submission.status}`} submission={submission} fields={fields} />}
    </div>
  </section>
}
