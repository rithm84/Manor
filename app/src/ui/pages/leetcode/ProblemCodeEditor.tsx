import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type { ProblemExecutionApi, ProblemLanguage } from '../../../shared/problemExecution'
import { useNoteTheme } from '../notes/useNoteTheme'
import { Button } from '../../components/ui'
import { errorMessage } from './leetCodeModel'
import { startProblemEditor } from './problemCodeEditorRuntime'
import type { ProblemEditorOptions, RunningProblemEditor } from './problemCodeEditorRuntime'
import { connectLanguageServer, languageServerState, noteLanguageServerUse, onLanguageServerState } from './problemLanguageServer'
import { useManorAccount } from '../../../web/accountContext'
import { editorSessions } from '../../../web/problems/editorSessions'

interface Props { api: ProblemExecutionApi; problemId: string; language: ProblemLanguage; initialCode: string; options: ProblemEditorOptions; onChange: (value: string) => void }
const assistLabels = { connecting: 'Starting IntelliSense', offline: 'IntelliSense is offline. It reconnects when you type.' } as const

/** Editable at once; language-server features arrive in place when the shared connection is ready. */
export default function ProblemCodeEditor({ api, problemId, language, initialCode, options, onChange }: Props): ReactNode {
  const container = useRef<HTMLDivElement>(null)
  const running = useRef<RunningProblemEditor | null>(null)
  const change = useRef(onChange)
  change.current = onChange
  const latestOptions = useRef(options)
  latestOptions.current = options
  const theme = useNoteTheme()
  const account = useManorAccount()
  const assist = useSyncExternalStore(onLanguageServerState, () => languageServerState(language))
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let cancelled = false
    let instance: RunningProblemEditor | null = null
    setError(null); setReady(false)
    const sessions = editorSessions(api, account.id)
    const bound = () => sessions.session(language, problemId)
    const report = (failure: unknown): void => console.warn('IntelliSense is unavailable', { problemId, language, error: errorMessage(failure) })
    const use = (): void => noteLanguageServerUse(language, bound, report)
    // Connecting reuses any recent session, such as a prewarmed one. Binding the open problem to the lease follows
    // it, so a slow renewal never delays the editor or its language server.
    connectLanguageServer(language, () => sessions.session(language, null)).catch(report).finally(() => { if (!cancelled) bound().catch(report) })
    const onVisible = (): void => { if (document.visibilityState === 'visible') use() }
    document.addEventListener('visibilitychange', onVisible)
    const start = async (): Promise<void> => {
      try {
        if (container.current === null) throw new Error('The code editor container is unavailable.')
        instance = await startProblemEditor(container.current, language, initialCode, latestOptions.current, value => change.current(value), use)
        if (cancelled) { await instance.dispose(); return }
        running.current = instance
        instance.theme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')
        setReady(true)
      } catch (failure) { if (!cancelled) setError(errorMessage(failure)) }
    }
    void start()
    return () => {
      cancelled = true; running.current = null
      document.removeEventListener('visibilitychange', onVisible)
      if (instance !== null) void instance.dispose().catch(failure => console.error('Problem editor cleanup failed', { problemId, language, error: errorMessage(failure) }))
    }
  }, [api, account.id, problemId, language, retry])
  useEffect(() => { running.current?.theme(theme) }, [theme])
  useEffect(() => { running.current?.configure({ fontSize: options.fontSize, tabSize: options.tabSize }) }, [options.fontSize, options.tabSize])
  return <div className="problem-code-editor" data-language-server={assist}>
    {!ready && error === null ? <p className="problem-editor-loading" role="status">Starting editor…</p> : null}
    {error === null ? null : <div className="problem-editor-error" role="alert"><p>{error}</p><Button variant="subtle" onClick={() => setRetry(value => value + 1)}>Reload editor</Button></div>}
    {ready && assist !== 'connected' ? <span className="problem-editor-assist" data-state={assist} role="img" aria-label={assistLabels[assist]} title={assistLabels[assist]} /> : null}
    <div ref={container} className="problem-monaco" data-testid="problem-code-editor" />
  </div>
}
