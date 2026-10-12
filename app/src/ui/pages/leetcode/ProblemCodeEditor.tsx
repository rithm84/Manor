import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { ProblemExecutionApi, ProblemLanguage, ProblemEditorSession } from '../../../shared/problemExecution'
import { useNoteTheme } from '../notes/useNoteTheme'
import { Button } from '../../components/ui'
import { errorMessage } from './leetCodeModel'
import { startProblemEditor } from './problemCodeEditorRuntime'
import type { RunningProblemEditor } from './problemCodeEditorRuntime'
import { useManorAccount } from '../../../web/accountContext'
import { closeTrackedEditorSession, openTrackedEditorSession } from '../../../web/problems/editorSessions'

interface Props { api: ProblemExecutionApi; problemId: string; language: ProblemLanguage; initialCode: string; onChange: (value: string) => void }

export default function ProblemCodeEditor({ api, problemId, language, initialCode, onChange }: Props): ReactNode {
  const container = useRef<HTMLDivElement>(null)
  const running = useRef<RunningProblemEditor | null>(null)
  const change = useRef(onChange)
  change.current = onChange
  const theme = useNoteTheme()
  const account = useManorAccount()
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let cancelled = false
    let session: ProblemEditorSession | null = null
    let instance: RunningProblemEditor | null = null
    let expirationTimer: ReturnType<typeof setTimeout> | null = null
    setError(null); setReady(false)
    const start = async (): Promise<void> => {
      try {
        session = await openTrackedEditorSession(api, account.id, problemId, language)
        if (cancelled) { await closeTrackedEditorSession(api, account.id, session.id); return }
        if (container.current === null) throw new Error('The code editor container is unavailable.')
        instance = await startProblemEditor(container.current, session, language, initialCode, value => change.current(value), () => {
          if (!cancelled) { setReady(false); setError('IntelliSense disconnected. Your code remains protected. Reconnect the editor to continue with language assistance.') }
        })
        if (cancelled) { await instance.dispose(); await closeTrackedEditorSession(api, account.id, session.id); return }
        running.current = instance
        instance.theme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')
        expirationTimer = setTimeout(() => {
          setError('The editor session expired. Your code is protected on this device. Reconnect to restore IntelliSense.')
          setReady(false)
          if (session !== null) void closeTrackedEditorSession(api, account.id, session.id).catch(failure => console.error('Expired editor session cleanup failed', { problemId, language, error: errorMessage(failure) }))
        }, Math.max(0, Date.parse(session.expiresAt) - Date.now()))
        setReady(true)
      } catch (failure) { if (!cancelled) setError(errorMessage(failure)) }
    }
    void start()
    return () => {
      cancelled = true; running.current = null
      if (expirationTimer !== null) clearTimeout(expirationTimer)
      if (instance !== null) void instance.dispose().catch(failure => console.error('Problem editor cleanup failed', { problemId, language, error: errorMessage(failure) }))
      if (session !== null) void closeTrackedEditorSession(api, account.id, session.id).catch(failure => console.error('Problem editor session cleanup failed', { problemId, language, error: errorMessage(failure) }))
    }
  }, [api, account.id, problemId, language, retry])
  useEffect(() => { running.current?.theme(theme) }, [theme])
  return <div className="problem-code-editor">
    {!ready && error === null ? <p className="problem-editor-loading" role="status">Starting editor…</p> : null}
    {error === null ? null : <div className="problem-editor-error" role="alert"><p>{error}</p><Button variant="subtle" onClick={() => setRetry(value => value + 1)}>Reconnect editor</Button></div>}
    <div ref={container} className="problem-monaco" data-testid="problem-code-editor" />
  </div>
}
