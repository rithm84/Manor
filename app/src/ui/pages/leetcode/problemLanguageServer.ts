import { LanguageClientWrapper, LcWebSocket } from 'monaco-languageclient/lcwrapper'
import { Uri } from 'vscode'
import type { ProblemEditorSession, ProblemLanguage } from '../../../shared/problemExecution'
import { initializeEditor } from './problemCodeEditorRuntime'
import { problemCompletionTiming } from './problemBenchmark'

/**
 * The app's language-server connections, one per language, shared by every problem editor. The account's editor
 * sandbox keeps a server running for every language, so a connection outlives editors: moving between problems
 * reuses it, and switching languages attaches to that language's open connection or opens one to its warm server.
 */
export type LanguageServerState = 'connecting' | 'connected' | 'offline'
export type EditorSessionSource = () => Promise<ProblemEditorSession>

/** Blaxel closes a preview WebSocket after about a minute without traffic, so a used connection sends a small notification this often. */
const keepAliveMs = 25000
/** A connection stays open this long after its language was last used; afterwards it closes and the sandbox can stand by. */
const retainMs = 10 * 60000
/** Use reports are coalesced to this interval. */
const useIntervalMs = 2000
/** An offline server is retried on use at most this often. */
const retryMs = 5000

interface Connection { readonly language: ProblemLanguage; state: LanguageServerState; wrapper: LanguageClientWrapper | null; ready: Promise<void>; lastUse: number; lastAttempt: number }
const connections = new Map<ProblemLanguage, Connection>()
let keepAlive: ReturnType<typeof setInterval> | null = null
const listeners = new Set<() => void>()

function setState(target: Connection, state: LanguageServerState): void {
  target.state = state
  listeners.forEach(listener => listener())
}

function keepUsedConnectionsOpen(): void {
  if (keepAlive !== null) return
  keepAlive = setInterval(() => {
    if (document.visibilityState !== 'visible') return
    for (const connection of connections.values()) {
      const client = connection.state === 'connected' ? connection.wrapper?.getLanguageClient() : undefined
      if (client === undefined || Date.now() - connection.lastUse > retainMs) continue
      void client.sendNotification('$/setTrace', { value: 'off' }).catch((failure: unknown) => console.warn('Language server keep-alive failed', { language: connection.language, error: failure instanceof Error ? failure.message : String(failure) }))
    }
  }, keepAliveMs)
}

export function languageServerState(language: ProblemLanguage): LanguageServerState {
  return connections.get(language)?.state ?? 'offline'
}

export function onLanguageServerState(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

async function discard(previous: Connection | undefined): Promise<void> {
  if (previous === undefined || previous.wrapper === null) return
  try { await previous.wrapper.dispose() }
  catch (failure) { console.warn('Closing the previous language server connection failed', { language: previous.language, error: failure instanceof Error ? failure.message : String(failure) }) }
}

/** Connects the language, or returns the connection already open or opening for it. */
export function connectLanguageServer(language: ProblemLanguage, session: EditorSessionSource): Promise<void> {
  const previous = connections.get(language)
  const now = Date.now()
  if (previous !== undefined) previous.lastUse = now
  if (previous !== undefined && previous.state !== 'offline') return previous.ready
  const next: Connection = { language, state: 'connecting', wrapper: null, ready: Promise.resolve(), lastUse: now, lastAttempt: now }
  connections.set(language, next)
  setState(next, 'connecting')
  next.ready = (async () => {
    await discard(previous)
    await initializeEditor()
    const value = await session()
    if (connections.get(language) !== next) return
    const wrapper = new LanguageClientWrapper({ languageId: language,
      connection: { options: { $family: 'WebSocket', realization: () => new LcWebSocket(), webSocketUrl: value.webSocketUrls[language], disposeResources: true, stopOptions: { onCall: () => { if (connections.get(language) === next) setState(next, 'offline') } } }, retryConfig: { retries: 0, timeout: 15000, disposeOnRestart: true } },
      clientOptions: { documentSelector: [language], workspaceFolder: { index: 0, name: 'Problem', uri: Uri.parse(value.workspaceUri) }, middleware: problemCompletionTiming }
    })
    next.wrapper = wrapper
    await wrapper.start()
    if (connections.get(language) !== next) { await discard(next); return }
    setState(next, 'connected')
    keepUsedConnectionsOpen()
  })()
  next.ready.catch(() => { if (connections.get(language) === next) { setState(next, 'offline'); void discard(next) } })
  return next.ready
}

/**
 * Editor use keeps the language's connection open, renews the account sandbox's lease through the session source
 * (which asks the server only when its session is a few minutes old), and reconnects an offline server.
 */
export function noteLanguageServerUse(language: ProblemLanguage, session: EditorSessionSource, onFailure: (failure: unknown) => void): void {
  const now = Date.now()
  const connection = connections.get(language)
  if (connection !== undefined && now - connection.lastUse < useIntervalMs) return
  if (connection !== undefined) connection.lastUse = now
  if (languageServerState(language) === 'offline') {
    if (connection === undefined || now - connection.lastAttempt >= retryMs) connectLanguageServer(language, session).catch(onFailure)
    return
  }
  session().catch(onFailure)
}
