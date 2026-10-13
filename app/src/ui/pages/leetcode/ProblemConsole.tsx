import { ChevronDown, ChevronUp, CloudUpload, LoaderCircle, Play, Plus, X } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ProblemExecutionMode, ProblemSubmission } from '../../../shared/problemExecution'
import { Button, Tooltip } from '../../components/ui'
import { PendingVerdict, ProblemTestResult } from './ProblemTestResult'
import { isPendingSubmission } from './problemSubmissionStats'
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
  submission: ProblemSubmission | null; running: ProblemExecutionMode | null; fields: readonly TestcaseField[] | null
}

/** The console under the editor: Testcase and Test Result tabs. Both stay mounted so a result keeps its selected case. */
export function ProblemConsole({ tab, onTab, editor, notice, submission, running, fields }: ConsoleProps): ReactNode {
  const pending = running ?? (submission !== null && isPendingSubmission(submission) ? submission.mode : null)
  return <section className="problem-console" aria-label="Console" data-testid="problem-console">
    <header className="problem-console-header">
      <nav className="problem-tabs" aria-label="Console">{([['testcase', 'Testcase'], ['result', 'Test Result']] as const).map(([value, label]) => <button type="button" key={value} className={tab === value ? 'is-active' : ''} aria-pressed={tab === value} data-testid={`problem-console-${value}`} onClick={() => onTab(value)}>{label}</button>)}</nav>
    </header>
    <div className="problem-console-body">
      {notice}
      <div hidden={tab !== 'testcase'}>{editor}</div>
      <div hidden={tab !== 'result'}>{pending !== null ? <PendingVerdict mode={pending} /> : submission === null ? <p className="problem-results-empty">Run your code to see results here.</p> : <ProblemTestResult key={submission.id} submission={submission} fields={fields} />}</div>
    </div>
  </section>
}

interface ActionBarProps {
  consoleOpen: boolean; onConsole: () => void
  running: ProblemExecutionMode | null; canRun: boolean; canSubmit: boolean; onRun: () => void; onSubmit: () => void
}

/** The bar under the console: the Console toggle on the left, Run and Submit on the right, each with its own inline spinner. */
export function ProblemActionBar({ consoleOpen, onConsole, running, canRun, canSubmit, onRun, onSubmit }: ActionBarProps): ReactNode {
  const spinner = <LoaderCircle className="problem-spinner" size={15} aria-hidden="true" />
  return <footer className="problem-action-bar">
    <button type="button" className="problem-console-toggle" aria-expanded={consoleOpen} data-testid="problem-console-toggle" onClick={onConsole}>Console{consoleOpen ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronUp size={14} aria-hidden="true" />}</button>
    <div className="problem-console-actions">
      <Tooltip label="Run (⌘ ')" side="top"><Button variant="ghost" icon={running === 'run' ? spinner : <Play size={15} />} testId="problem-run" onClick={onRun} disabled={running !== null || !canRun}>Run</Button></Tooltip>
      <Tooltip label="Submit (⌘ Enter)" side="top"><Button variant="primary" icon={running === 'submit' ? spinner : <CloudUpload size={15} />} testId="problem-submit" onClick={onSubmit} disabled={running !== null || !canSubmit}>Submit</Button></Tooltip>
    </div>
  </footer>
}
