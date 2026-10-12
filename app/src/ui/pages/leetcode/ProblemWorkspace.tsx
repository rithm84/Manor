import { ArrowLeft, Code2, History, Pencil, RotateCcw } from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { ProblemDetail, ProblemLibraryApi } from '../../../shared/problemLibrary'
import type { ExecuteProblemInput, ProblemExecutionApi, ProblemExecutionMode, ProblemLanguage, ProblemSubmission } from '../../../shared/problemExecution'
import { problemLanguages, problemLanguageLabels } from '../../../shared/problemExecution'
import { useManorAccount } from '../../../web/accountContext'
import { Button, Modal, Tooltip } from '../../components/ui'
import { useDevicePreference } from '../../preferences/devicePreference'
import { ProblemDraftSession } from '../../../web/problems/ProblemDraftSession'
import type { CodeDraftStatus } from '../../../web/problems/ProblemDraftSession'
import { errorMessage } from './leetCodeModel'
import { PaneDivider, usePaneSize } from './PaneDivider'
import { ProblemConsole, TestcaseEditor } from './ProblemConsole'
import type { ConsoleTab } from './ProblemConsole'
import { ProblemReader } from './ProblemReader'
import { exampleTestcases, firstInvalidTestcase, sameTestcases, testcaseFields, testcaseInput } from './problemTestcases'
import type { InvalidTestcase, Testcase } from './problemTestcases'

const CodeEditor = lazy(() => import('./ProblemCodeEditor'))
interface Props { detail: ProblemDetail; execution: ProblemExecutionApi; library: ProblemLibraryApi; onBack: () => void; onEdit: () => void; onReview: () => void; onSubmitted: () => void; onDetail: (next: ProblemDetail) => void }

const draftLabels: Readonly<Record<CodeDraftStatus, string>> = { loading: 'Loading code…', protecting: 'Protecting code…', saving: 'Saving…', saved: 'Saved', protected: 'Protected on this device', failed: 'Protected on this device' }

/** A primary solving page keeps the source draft durable before language or page changes. */
export function ProblemWorkspace({ detail, execution, library, onBack, onEdit, onReview, onSubmitted, onDetail }: Props): ReactNode {
  const { problem, content } = detail
  const account = useManorAccount()
  const coding = detail.canExecute
  const spec = content?.interface ?? null
  const fields = useMemo(() => spec === null ? null : testcaseFields(spec), [spec])
  const exampleCases = useMemo(() => spec === null ? [] : exampleTestcases(spec, content?.examples ?? []), [spec, content])
  const languages = useMemo(() => spec === null ? problemLanguages : problemLanguages.filter(value => content?.starterCode[value] !== undefined), [spec, content])
  const [preferredLanguage, setPreferredLanguage] = useDevicePreference<ProblemLanguage>('problems.language', problemLanguages, 'python')
  const language: ProblemLanguage | undefined = languages.includes(preferredLanguage) ? preferredLanguage : languages[0]
  const [code, setCode] = useState<string | null>(null)
  const codeRef = useRef('')
  const draftSession = useRef<ProblemDraftSession | null>(null)
  const [draftStatus, setDraftStatus] = useState<CodeDraftStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const [cases, setCases] = useState<readonly Testcase[]>(exampleCases)
  const [selectedCase, setSelectedCase] = useState(0)
  const [invalidCase, setInvalidCase] = useState<InvalidTestcase | null>(null)
  const [stdinInput, setStdinInput] = useState('')
  const [consoleTab, setConsoleTab] = useState<ConsoleTab>('testcase')
  const [busy, setBusy] = useState(false)
  const [submission, setSubmission] = useState<ProblemSubmission | null>(null)
  const [history, setHistory] = useState<readonly ProblemSubmission[]>([])
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [historyRetry, setHistoryRetry] = useState(0)
  const [showConflict, setShowConflict] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [editorRevision, setEditorRevision] = useState(0)
  const [resolvingConflict, setResolvingConflict] = useState(false)
  const [openingSubmission, setOpeningSubmission] = useState<string | null>(null)
  const [pendingExecution, setPendingExecution] = useState<ExecuteProblemInput | null>(null)
  const [resultError, setResultError] = useState<string | null>(null)
  const [resultRetry, setResultRetry] = useState(0)
  const body = useRef<HTMLDivElement>(null)
  const solving = useRef<HTMLDivElement>(null)
  const readerSize = usePaneSize('problems.reader-width', 44, 25, 70)
  const consoleSize = usePaneSize('problems.console-height', 34, 15, 75)
  const solved = problem.status === 'solved' || history.some(item => item.mode === 'submit' && item.verdict === 'accepted')

  useEffect(() => {
    if (!coding || language === undefined) return
    let cancelled = false
    setCode(null); setDraftStatus('loading'); setError(null)
    const session = new ProblemDraftSession(library, account.id, problem.id, language, problem.contentVersion, (status, failure) => {
      if (!cancelled) { setDraftStatus(status); if (failure !== null) setError(failure.message) }
    })
    draftSession.current = session
    void session.open(content?.starterCode[language] ?? '').then(initial => {
      if (cancelled) return
      codeRef.current = initial; setCode(initial)
    }).catch(failure => { if (!cancelled) { setError(errorMessage(failure)); setDraftStatus('failed') } })
    return () => { cancelled = true; session.stop() }
  }, [account.id, problem.id, problem.contentVersion, language, coding, library])

  useEffect(() => {
    if (!coding) return
    let cancelled = false
    void execution.submissions(problem.id).then(next => { if (!cancelled) { setHistory(next); setHistoryError(null) } }).catch(failure => { if (!cancelled) setHistoryError(errorMessage(failure)) })
    return () => { cancelled = true }
  }, [execution, problem.id, coding, historyRetry])

  useEffect(() => {
    if (submission === null || (submission.status !== 'queued' && submission.status !== 'running')) return
    let cancelled = false
    const timer = setTimeout(() => {
      void execution.submission(submission.id).then(next => {
        if (cancelled) return
        setSubmission(next); setResultError(null)
        if (next.status === 'completed' || next.status === 'failed') { setBusy(false); setHistoryRetry(value => value + 1); onSubmitted() }
      }).catch(failure => { if (!cancelled) setResultError(errorMessage(failure)) })
    }, 1000)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [submission, execution, onSubmitted, resultRetry])

  const protect = (value: string): void => {
    codeRef.current = value; setCode(value)
    if (draftSession.current === null) throw new Error('The protected code draft has not loaded.')
    draftSession.current.protect(value)
  }

  const afterProtected = async (action: () => void): Promise<void> => {
    try { await draftSession.current?.protected(); action() }
    catch (failure) { setError(errorMessage(failure)) }
  }

  const deliverExecution = async (request: ExecuteProblemInput): Promise<void> => {
    setBusy(true); setError(null); setResultError(null); setConsoleTab('result'); setPendingExecution(request)
    try {
      const next = await execution.execute(request)
      setSubmission(next); setPendingExecution(null)
      if (next.status === 'completed' || next.status === 'failed') { setBusy(false); setHistoryRetry(value => value + 1); onSubmitted() }
    } catch (failure) { setError(errorMessage(failure)); setBusy(false) }
  }
  const execute = async (mode: ProblemExecutionMode, customInput: string | null): Promise<void> => {
    if (language === undefined) throw new Error('This problem has no starter code to run.')
    setBusy(true); setError(null); setInvalidCase(null)
    try {
      await draftSession.current?.protected()
      await deliverExecution({ problemId: problem.id, language, code: codeRef.current, mode, requestId: crypto.randomUUID(), ...(customInput === null ? {} : { customInput }) })
    } catch (failure) { setError(errorMessage(failure)); setBusy(false) }
  }
  /** Unchanged examples run as the testset's public cases so results carry expected answers; edited cases run as custom input. */
  const runInput = (): string | null | Error => {
    if (fields === null) {
      if (stdinInput.trim() !== '') return stdinInput
      return detail.gradingAvailable ? null : new Error('Add input to run your code.')
    }
    const invalid = firstInvalidTestcase(fields, cases)
    if (invalid !== null) { setInvalidCase(invalid); setSelectedCase(invalid.caseIndex); setConsoleTab('testcase'); return new Error(invalid.message) }
    return detail.gradingAvailable && sameTestcases(cases, exampleCases) ? null : testcaseInput(cases)
  }
  const run = (): void => {
    if (busy || code === null) return
    const input = runInput()
    if (input instanceof Error) { setError(input.message); return }
    void execute('run', input)
  }
  const submit = (): void => {
    if (busy || code === null || !detail.gradingAvailable) return
    void execute('submit', null)
  }
  const actions = useRef({ run, submit })
  actions.current = { run, submit }
  useEffect(() => {
    if (!coding) return
    const onKey = (event: KeyboardEvent): void => {
      if (!event.metaKey || event.altKey || event.ctrlKey || (event.key !== 'Enter' && event.key !== "'")) return
      if (event.target instanceof Element && event.target.closest('[role="dialog"]') !== null) return
      event.preventDefault(); event.stopPropagation()
      if (event.key === 'Enter') actions.current.submit(); else actions.current.run()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [coding])

  const keepLocal = async (): Promise<void> => {
    setResolvingConflict(true)
    try { await draftSession.current?.keepLocal(); setShowConflict(false); setError(null) } catch (failure) { setError(errorMessage(failure)) } finally { setResolvingConflict(false) }
  }
  const replaceCode = (source: string): void => { setCode(source); codeRef.current = source; setEditorRevision(value => value + 1) }
  const useCloud = async (): Promise<void> => {
    setResolvingConflict(true)
    try {
      const source = await draftSession.current?.useCloud()
      if (source === undefined) throw new Error('The code draft session is unavailable.')
      replaceCode(source); setShowConflict(false); setError(null)
    } catch (failure) { setError(errorMessage(failure)) } finally { setResolvingConflict(false) }
  }
  const resetCode = (): void => {
    if (language === undefined) throw new Error('This problem has no starter code to reset to.')
    const starter = content?.starterCode[language] ?? ''
    protect(starter); setEditorRevision(value => value + 1); setConfirmReset(false)
  }
  const openSubmission = async (id: string): Promise<void> => {
    setOpeningSubmission(id); setHistoryError(null)
    try {
      const saved = await execution.submission(id)
      setSubmission(saved); setResultError(null); setConsoleTab('result'); setBusy(saved.status === 'queued' || saved.status === 'running')
    } catch (failure) { setHistoryError(errorMessage(failure)) } finally { setOpeningSubmission(null) }
  }
  const retryDraft = async (): Promise<void> => {
    setError(null)
    try {
      const source = await draftSession.current?.retry()
      if (source === undefined) throw new Error('The code draft session is unavailable.')
      if (source !== codeRef.current) replaceCode(source)
    } catch (failure) { setError(errorMessage(failure)) }
  }

  const reader = <ProblemReader detail={detail} library={library} coding={coding} solved={solved} history={history} historyError={historyError} openingSubmission={openingSubmission} busy={busy} onRetryHistory={() => setHistoryRetry(value => value + 1)} onOpenSubmission={id => void openSubmission(id)} onDetail={next => void afterProtected(() => onDetail(next))} />
  const notice = <>
    {error === null ? null : <div className="lc-error" role="alert"><p>{error}</p>{pendingExecution === null ? null : <Button variant="subtle" testId="problem-retry-execution" disabled={busy} onClick={() => void deliverExecution(pendingExecution)}>Retry previous {pendingExecution.mode === 'run' ? 'run' : 'submission'}</Button>}{draftSession.current?.conflict() !== null && draftSession.current?.conflict() !== undefined ? <Button variant="subtle" onClick={() => setShowConflict(true)}>Compare drafts</Button> : draftStatus === 'failed' && code !== null ? <Button variant="subtle" onClick={() => void retryDraft()}>Retry saving code</Button> : null}</div>}
    {resultError === null ? null : <div className="lc-error" role="alert"><p>{resultError}</p><Button variant="subtle" testId="problem-retry-results" onClick={() => { setResultError(null); setResultRetry(value => value + 1) }}>Retry loading results</Button></div>}
  </>
  const testcases = <>
    {detail.gradingAvailable ? null : <p className="problem-availability" data-testid="problem-availability">This problem has no tests yet. Run your code with your own input, or ask Codex to add tests.</p>}
    {fields === null ? <label className="problem-stdin"><span>Input</span><textarea data-testid="problem-custom-input" aria-label="Custom test input" rows={4} value={stdinInput} spellCheck={false} onChange={event => setStdinInput(event.target.value)} placeholder={detail.gradingAvailable ? 'Leave empty to run the examples' : 'Input sent to stdin'} /></label>
      : <TestcaseEditor fields={fields} cases={cases} selected={Math.min(selectedCase, cases.length - 1)} invalid={invalidCase} disabled={busy} onSelect={setSelectedCase} onCases={(next, selected) => { setCases(next); setSelectedCase(selected); setInvalidCase(null) }} />}
  </>

  return <section className={`problem-workspace${coding ? ' is-coding' : ''}`} data-testid="problem-workspace">
    <header className="problem-workspace-header">
      <Button variant="ghost" icon={<ArrowLeft size={16} />} onClick={() => void afterProtected(onBack)} testId="problem-workspace-back">Library</Button>
      <div className="problem-workspace-actions"><Button variant="ghost" icon={<History size={15} />} onClick={onReview}>Attempts</Button><Button variant="ghost" icon={<Pencil size={15} />} onClick={onEdit}>Edit</Button></div>
    </header>
    {!coding ? <div className="problem-workspace-body">{reader}</div> : <div className="problem-workspace-body" ref={body} style={{ gridTemplateColumns: `minmax(280px, ${readerSize.percent}%) auto minmax(360px, 1fr)` }}>
      {reader}
      <PaneDivider orientation="vertical" label="Resize problem and editor" container={body} size={readerSize} min={25} max={70} reversed={false} testId="problem-reader-divider" />
      <div className="problem-solving" ref={solving}>
        <header className="problem-editor-toolbar">
          <label><Code2 size={16} aria-hidden="true" /><select data-testid="problem-language" aria-label="Solution language" value={language ?? ''} disabled={busy || language === undefined} onChange={event => { const next = event.target.value as ProblemLanguage; void afterProtected(() => setPreferredLanguage(next)) }}>{languages.map(value => <option key={value} value={value}>{problemLanguageLabels[value]}</option>)}</select></label>
          <span className={draftStatus === 'failed' ? 'is-failed' : ''} role="status">{draftLabels[draftStatus]}</span>
          <Tooltip label="Reset to starter code" side="bottom"><button type="button" className="problem-icon-button" aria-label="Reset to starter code" data-testid="problem-reset-code" disabled={busy || code === null} onClick={() => setConfirmReset(true)}><RotateCcw size={15} aria-hidden="true" /></button></Tooltip>
        </header>
        <div className="problem-editor-pane">
          {language === undefined ? <div className="problem-editor-placeholder"><p role="alert">This problem has no starter code yet. Ask Codex to add its solving interface.</p></div> : code === null ? <div className="problem-editor-placeholder"><p role="status">{draftStatus === 'failed' ? 'Code draft could not load.' : 'Loading your code…'}</p>{draftStatus === 'failed' ? <Button variant="subtle" onClick={() => window.location.reload()}>Reload</Button> : null}</div> : <Suspense fallback={<div className="problem-editor-placeholder" role="status">Loading editor…</div>}><CodeEditor key={`${problem.id}-${language}-${editorRevision}`} api={execution} problemId={problem.id} language={language} initialCode={code} onChange={protect} /></Suspense>}
        </div>
        <PaneDivider orientation="horizontal" label="Resize editor and console" container={solving} size={consoleSize} min={15} max={75} reversed testId="problem-console-divider" />
        <div className="problem-console-pane" style={{ flexBasis: `${consoleSize.percent}%` }}>
          <ProblemConsole tab={consoleTab} onTab={setConsoleTab} editor={testcases} notice={notice} submission={submission} fields={fields} busy={busy} canRun={code !== null && (detail.gradingAvailable || fields !== null || stdinInput.trim() !== '')} canSubmit={code !== null && detail.gradingAvailable} onRun={run} onSubmit={submit} />
        </div>
      </div>
    </div>}
    <Modal open={showConflict} onClose={() => setShowConflict(false)} width={860} ariaLabel="Compare code drafts"><div className="problem-draft-conflict"><h2>Choose the code to keep</h2><p>Your code has changed on another device. Choosing a draft replaces the other version.</p><div><section><h3>This device</h3><pre>{code}</pre></section><section><h3>Cloud</h3><pre>{draftSession.current?.conflict()?.source}</pre></section></div><footer><Button variant="ghost" onClick={() => setShowConflict(false)} disabled={resolvingConflict}>Cancel</Button><Button variant="subtle" onClick={() => void useCloud()} disabled={resolvingConflict}>Use cloud draft</Button><Button variant="primary" onClick={() => void keepLocal()} disabled={resolvingConflict}>Keep this device’s code</Button></footer></div></Modal>
    <Modal open={confirmReset} onClose={() => setConfirmReset(false)} width={400} ariaLabel="Reset code"><div className="ui-confirm"><h2>Reset your code?</h2><p>Your {language === undefined ? '' : `${problemLanguageLabels[language]} `}code is replaced with the starter code. Earlier submissions keep their code.</p><div className="ui-confirm-actions"><Button variant="ghost" onClick={() => setConfirmReset(false)}>Cancel</Button><Button variant="primary" testId="problem-reset-confirm" onClick={resetCode}>Reset code</Button></div></div></Modal>
  </section>
}
