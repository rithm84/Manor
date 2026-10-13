import { ArrowLeft, History } from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { ProblemDetail, ProblemLibraryApi } from '../../../shared/problemLibrary'
import type { ExecuteProblemInput, ProblemExecutionApi, ProblemExecutionMode, ProblemLanguage, ProblemSubmission } from '../../../shared/problemExecution'
import { problemLanguages, problemLanguageLabels } from '../../../shared/problemExecution'
import { useManorAccount } from '../../../web/accountContext'
import { Button, Modal, hasOpenDismissLayer } from '../../components/ui'
import { useDeviceFlag, useDevicePreference } from '../../preferences/devicePreference'
import { ProblemDraftSession } from '../../../web/problems/ProblemDraftSession'
import type { CodeDraftStatus } from '../../../web/problems/ProblemDraftSession'
import { errorMessage } from './leetCodeModel'
import { PaneDivider, usePaneSize } from './PaneDivider'
import { ProblemActionBar, ProblemConsole, TestcaseEditor } from './ProblemConsole'
import type { ConsoleTab } from './ProblemConsole'
import { ProblemEditorToolbar, useEditorSettings } from './ProblemEditorToolbar'
import { ProblemReader } from './ProblemReader'
import { defaultProblemLanguage, loadProblemCodeEditor, problemLanguagePreference } from './problemEditorWarmup'
import type { ReaderTab } from './ProblemReader'
import { isPendingSubmission } from './problemSubmissionStats'
import { exampleTestcases, firstInvalidTestcase, sameTestcases, testcaseFields, testcaseInput } from './problemTestcases'
import type { InvalidTestcase, Testcase } from './problemTestcases'

const CodeEditor = lazy(loadProblemCodeEditor)
/** A submission still running when its request returns is polled soon, then less often, settling at once a second. */
function pollDelay(attempt: number): number { return Math.min(1000, Math.round(300 * 1.5 ** attempt)) }
interface Props { detail: ProblemDetail; execution: ProblemExecutionApi; library: ProblemLibraryApi; onBack: () => void; onReview: () => void; onSubmitted: () => void }

/** A primary solving page keeps the source draft durable before language or page changes. */
export function ProblemWorkspace({ detail, execution, library, onBack, onReview, onSubmitted }: Props): ReactNode {
  const { problem, content } = detail
  const account = useManorAccount()
  const coding = detail.canExecute
  const spec = content?.interface ?? null
  const fields = useMemo(() => spec === null ? null : testcaseFields(spec), [spec])
  const exampleCases = useMemo(() => spec === null ? [] : exampleTestcases(spec, content?.examples ?? []), [spec, content])
  const languages = useMemo(() => spec === null ? problemLanguages : problemLanguages.filter(value => content?.starterCode[value] !== undefined), [spec, content])
  const [preferredLanguage, setPreferredLanguage] = useDevicePreference<ProblemLanguage>(problemLanguagePreference, problemLanguages, defaultProblemLanguage)
  const language: ProblemLanguage | undefined = languages.includes(preferredLanguage) ? preferredLanguage : languages[0]
  const [code, setCode] = useState<string | null>(null)
  const [codeLanguage, setCodeLanguage] = useState<ProblemLanguage | null>(null)
  const codeRef = useRef('')
  const draftSession = useRef<ProblemDraftSession | null>(null)
  const [draftStatus, setDraftStatus] = useState<CodeDraftStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const [cases, setCases] = useState<readonly Testcase[]>(exampleCases)
  const [selectedCase, setSelectedCase] = useState(0)
  const [invalidCase, setInvalidCase] = useState<InvalidTestcase | null>(null)
  const [stdinInput, setStdinInput] = useState('')
  const [consoleTab, setConsoleTab] = useState<ConsoleTab>('testcase')
  /** The mode of the execution in flight; Run and Submit, language changes, and edits to cases wait for it. */
  const [running, setRunning] = useState<ProblemExecutionMode | null>(null)
  const busy = running !== null
  const [submission, setSubmission] = useState<ProblemSubmission | null>(null)
  const [history, setHistory] = useState<readonly ProblemSubmission[]>([])
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [historyRetry, setHistoryRetry] = useState(0)
  const [showConflict, setShowConflict] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [editorRevision, setEditorRevision] = useState(0)
  const [resolvingConflict, setResolvingConflict] = useState(false)
  const [openingSubmission, setOpeningSubmission] = useState<string | null>(null)
  const [readerTab, setReaderTab] = useState<ReaderTab>('description')
  const [openedSubmission, setOpenedSubmission] = useState<ProblemSubmission | null>(null)
  const [replacement, setReplacement] = useState<ProblemSubmission | null>(null)
  /** Code chosen from a submission in another language, adopted once that language's draft session opens. */
  const adoptedSource = useRef<{ language: ProblemLanguage; code: string } | null>(null)
  const [consoleOpen, setConsoleOpen] = useDeviceFlag('problems.console-open', true)
  const [fullscreen, setFullscreen] = useState(false)
  const [editorSettings, setEditorSettings] = useEditorSettings()
  const [pendingExecution, setPendingExecution] = useState<ExecuteProblemInput | null>(null)
  const [resultError, setResultError] = useState<string | null>(null)
  const [resultRetry, setResultRetry] = useState(0)
  const body = useRef<HTMLDivElement>(null)
  const panes = useRef<HTMLDivElement>(null)
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
    // The editor mounts with this device's draft at once; the cloud draft replaces it only while it is unedited.
    void session.open(content?.starterCode[language] ?? '').then(async initial => {
      if (cancelled) return
      const adopted = adoptedSource.current?.language === language ? adoptedSource.current.code : null
      adoptedSource.current = null
      if (adopted !== null) {
        // Adopted code is an edit, so it starts from the cloud revision rather than conflicting with it.
        await session.reconciled()
        if (cancelled) return
        codeRef.current = adopted; setCode(adopted); setCodeLanguage(language); session.protect(adopted)
        return
      }
      codeRef.current = initial; setCode(initial); setCodeLanguage(language)
      const replacement = await session.reconciled()
      if (!cancelled && replacement !== null) replaceCode(replacement)
    }).catch(failure => { if (!cancelled) { setError(errorMessage(failure)); setDraftStatus('failed') } })
    return () => { cancelled = true; session.stop() }
  }, [account.id, problem.id, problem.contentVersion, language, coding, library])

  useEffect(() => {
    if (!coding) return
    let cancelled = false
    void execution.submissions(problem.id).then(next => { if (!cancelled) { setHistory(next); setHistoryError(null) } }).catch(failure => { if (!cancelled) setHistoryError(errorMessage(failure)) })
    return () => { cancelled = true }
  }, [execution, problem.id, coding, historyRetry])

  /** A finished submission refreshes history and attempts; a judged Submit opens in the reader, as LeetCode does. */
  const finish = (next: ProblemSubmission): void => {
    setRunning(null); setHistoryRetry(value => value + 1); onSubmitted()
    if (next.mode !== 'submit') return
    setReaderTab('submissions'); setOpenedSubmission(next)
    if (next.sourceCode === undefined) void openSubmission(next.id)
  }
  const finishRef = useRef(finish)
  finishRef.current = finish
  const polls = useRef({ id: '', count: 0 })
  useEffect(() => {
    if (submission === null || !isPendingSubmission(submission)) return
    let cancelled = false
    const attempt = polls.current.id === submission.id ? polls.current.count : 0
    polls.current = { id: submission.id, count: attempt + 1 }
    const timer = setTimeout(() => {
      void execution.submission(submission.id).then(next => {
        if (cancelled) return
        setSubmission(next); setResultError(null)
        if (!isPendingSubmission(next)) finishRef.current(next)
      }).catch(failure => { if (!cancelled) setResultError(errorMessage(failure)) })
    }, pollDelay(attempt))
    return () => { cancelled = true; clearTimeout(timer) }
  }, [submission, execution, resultRetry])

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
    setRunning(request.mode); setError(null); setResultError(null); setConsoleTab('result'); setConsoleOpen(true); setPendingExecution(request)
    try {
      const next = await execution.execute(request)
      setSubmission(next); setPendingExecution(null)
      if (!isPendingSubmission(next)) finish(next)
    } catch (failure) { setError(errorMessage(failure)); setRunning(null) }
  }
  const execute = async (mode: ProblemExecutionMode, customInput: string | null): Promise<void> => {
    if (language === undefined) throw new Error('This problem has no starter code to run.')
    setRunning(mode); setError(null); setInvalidCase(null)
    try {
      await draftSession.current?.protected()
      await deliverExecution({ problemId: problem.id, language, code: codeRef.current, mode, requestId: crypto.randomUUID(), ...(customInput === null ? {} : { customInput }) })
    } catch (failure) { setError(errorMessage(failure)); setRunning(null) }
  }
  /** Unchanged examples run as the testset's public cases so results carry expected answers; edited cases run as custom input. */
  const runInput = (): string | null | Error => {
    if (fields === null) {
      if (stdinInput.trim() !== '') return stdinInput
      return detail.gradingAvailable ? null : new Error('Add input to run your code.')
    }
    const invalid = firstInvalidTestcase(fields, cases)
    if (invalid !== null) { setInvalidCase(invalid); setSelectedCase(invalid.caseIndex); setConsoleTab('testcase'); setConsoleOpen(true); return new Error(invalid.message) }
    return detail.gradingAvailable && sameTestcases(cases, exampleCases) ? null : testcaseInput(cases)
  }
  const run = (): void => {
    if (busy || code === null) return
    const input = runInput()
    if (input instanceof Error) { setError(input.message); setConsoleOpen(true); return }
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
  /** Opens a saved submission in the reader with its code; one still being judged also takes over the console so it keeps polling. */
  async function openSubmission(id: string): Promise<void> {
    setOpeningSubmission(id); setHistoryError(null)
    try {
      const saved = await execution.submission(id)
      setOpenedSubmission(saved)
      if (isPendingSubmission(saved) && !busy) { setSubmission(saved); setResultError(null); setConsoleTab('result'); setRunning(saved.mode) }
    } catch (failure) { setHistoryError(errorMessage(failure)) } finally { setOpeningSubmission(null) }
  }
  /** Loads submitted code through the draft session, so it is protected exactly like typing. */
  const useSubmissionCode = (saved: ProblemSubmission): void => {
    const source = saved.sourceCode
    if (source === undefined || source === null) throw new Error('This submission has no saved code to load.')
    setReplacement(null)
    if (saved.language === language) { protect(source); setEditorRevision(value => value + 1); return }
    adoptedSource.current = { language: saved.language, code: source }
    void afterProtected(() => setPreferredLanguage(saved.language))
  }
  const requestSubmissionCode = (saved: ProblemSubmission): void => {
    if (saved.language === language && saved.sourceCode === codeRef.current) return
    setReplacement(saved)
  }
  const retryDraft = async (): Promise<void> => {
    setError(null)
    try {
      const source = await draftSession.current?.retry()
      if (source === undefined) throw new Error('The code draft session is unavailable.')
      if (source !== codeRef.current) replaceCode(source)
    } catch (failure) { setError(errorMessage(failure)) }
  }

  useEffect(() => {
    if (!fullscreen) return
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape' && !event.defaultPrevented && !hasOpenDismissLayer()) setFullscreen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullscreen])

  // A judged submission shown in the reader follows the console's polling while it is still in flight.
  const shownSubmission = openedSubmission !== null && submission?.id === openedSubmission.id ? submission : openedSubmission
  const reader = <ProblemReader detail={detail} library={library} coding={coding} solved={solved} tab={readerTab} onTab={setReaderTab} submissions={{
    history, historyError, opening: openingSubmission, opened: shownSubmission, fields, tabSize: editorSettings.tabSize,
    canUseCode: value => !busy && code !== null && languages.includes(value),
    onRetry: () => setHistoryRetry(value => value + 1), onOpen: id => void openSubmission(id), onClose: () => setOpenedSubmission(null), onUseCode: requestSubmissionCode
  }} />
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
      <div className="problem-workspace-actions"><Button variant="ghost" icon={<History size={15} />} onClick={onReview}>Attempts</Button></div>
    </header>
    {!coding ? <div className="problem-workspace-body">{reader}</div> : <div className={`problem-workspace-body${fullscreen ? ' is-fullscreen' : ''}`} ref={body} style={{ gridTemplateColumns: fullscreen ? 'minmax(0, 1fr)' : `minmax(280px, min(${readerSize.percent}%, 880px)) auto minmax(360px, 1fr)` }}>
      {reader}
      <PaneDivider orientation="vertical" label="Resize problem and editor" container={body} size={readerSize} min={25} max={70} reversed={false} testId="problem-reader-divider" />
      <div className="problem-solving">
        <ProblemEditorToolbar language={language} languages={languages} onLanguage={next => void afterProtected(() => setPreferredLanguage(next))} draftStatus={draftStatus} draftConflict={(draftSession.current?.conflict() ?? null) !== null} onResolveDraft={() => { if ((draftSession.current?.conflict() ?? null) !== null) setShowConflict(true); else void retryDraft() }} busy={busy} canReset={code !== null} onReset={() => setConfirmReset(true)} settings={editorSettings} onSettings={setEditorSettings} fullscreen={fullscreen} onFullscreen={() => setFullscreen(value => !value)} />
        <div className={`problem-solving-panes${consoleOpen ? '' : ' is-console-closed'}`} ref={panes}>
          <div className="problem-editor-pane">
            {language === undefined ? <div className="problem-editor-placeholder"><p role="alert">This problem has no starter code yet. Ask Codex to add its solving interface.</p></div> : code === null || codeLanguage !== language ? <div className="problem-editor-placeholder"><p role="status">{draftStatus === 'failed' ? 'Code draft could not load.' : 'Loading your code…'}</p>{draftStatus === 'failed' ? <Button variant="subtle" onClick={() => window.location.reload()}>Reload</Button> : null}</div> : <Suspense fallback={<div className="problem-editor-placeholder" role="status">Loading editor…</div>}><CodeEditor key={`${problem.id}-${language}-${editorRevision}`} api={execution} problemId={problem.id} language={language} initialCode={code} options={editorSettings} onChange={value => { if (value !== codeRef.current) protect(value) }} /></Suspense>}
          </div>
          {consoleOpen ? <>
            <PaneDivider orientation="horizontal" label="Resize editor and console" container={panes} size={consoleSize} min={15} max={75} reversed testId="problem-console-divider" />
            <div className="problem-console-pane" style={{ flexBasis: `${consoleSize.percent}%` }}>
              <ProblemConsole tab={consoleTab} onTab={setConsoleTab} editor={testcases} notice={notice} submission={submission} running={running} fields={fields} />
            </div>
          </> : null}
        </div>
        <ProblemActionBar consoleOpen={consoleOpen} onConsole={() => setConsoleOpen(!consoleOpen)} running={running} canRun={code !== null && (detail.gradingAvailable || fields !== null || stdinInput.trim() !== '')} canSubmit={code !== null && detail.gradingAvailable} onRun={run} onSubmit={submit} />
      </div>
    </div>}
    <Modal open={showConflict} onClose={() => setShowConflict(false)} width={860} ariaLabel="Compare code drafts"><div className="problem-draft-conflict"><h2>Choose the code to keep</h2><p>Your code has changed on another device. Choosing a draft replaces the other version.</p><div><section><h3>This device</h3><pre>{code}</pre></section><section><h3>Cloud</h3><pre>{draftSession.current?.conflict()?.source}</pre></section></div><footer><Button variant="ghost" onClick={() => setShowConflict(false)} disabled={resolvingConflict}>Cancel</Button><Button variant="subtle" onClick={() => void useCloud()} disabled={resolvingConflict}>Use cloud draft</Button><Button variant="primary" onClick={() => void keepLocal()} disabled={resolvingConflict}>Keep this device’s code</Button></footer></div></Modal>
    <Modal open={confirmReset} onClose={() => setConfirmReset(false)} width={400} ariaLabel="Reset code"><div className="ui-confirm"><h2>Reset your code?</h2><p>Your {language === undefined ? '' : `${problemLanguageLabels[language]} `}code is replaced with the starter code. Earlier submissions keep their code.</p><div className="ui-confirm-actions"><Button variant="ghost" onClick={() => setConfirmReset(false)}>Cancel</Button><Button variant="primary" testId="problem-reset-confirm" onClick={resetCode}>Reset code</Button></div></div></Modal>
    <Modal open={replacement !== null} onClose={() => setReplacement(null)} width={400} ariaLabel="Use submitted code"><div className="ui-confirm"><h2>Replace your code?</h2><p>Your {replacement === null ? '' : `${problemLanguageLabels[replacement.language]} `}code is replaced with this submission’s code. Earlier submissions keep their code.</p><div className="ui-confirm-actions"><Button variant="ghost" onClick={() => setReplacement(null)}>Cancel</Button><Button variant="primary" testId="problem-use-code-confirm" onClick={() => { if (replacement !== null) useSubmissionCode(replacement) }}>Replace code</Button></div></div></Modal>
  </section>
}
