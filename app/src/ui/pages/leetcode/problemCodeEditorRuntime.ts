import { editor } from '@codingame/monaco-vscode-editor-api'
import '@codingame/monaco-vscode-standalone-languages/languages/definitions/cpp/register'
import '@codingame/monaco-vscode-standalone-languages/languages/definitions/python/register'
import '@codingame/monaco-vscode-standalone-languages/languages/definitions/javascript/register'
import '@codingame/monaco-vscode-standalone-languages/languages/definitions/java/register'
import '@codingame/monaco-vscode-standalone-languages/languages/definitions/go/register'
import EditorWorker from '@codingame/monaco-vscode-editor-api/esm/vs/editor/editor.worker.js?worker'
import { MonacoVscodeApiWrapper, getEnhancedMonacoEnvironment } from 'monaco-languageclient/vscodeApiWrapper'
import { EditorApp } from 'monaco-languageclient/editorApp'
import { LanguageClientWrapper, LcWebSocket } from 'monaco-languageclient/lcwrapper'
import { Uri } from 'vscode'
import type { ProblemEditorSession, ProblemLanguage } from '../../../shared/problemExecution'

let initialized: Promise<void> | null = null
function initializeEditor(): Promise<void> {
  if (initialized === null) {
    const wrapper = new MonacoVscodeApiWrapper({ $type: 'classic', viewsConfig: { $type: 'EditorService' }, advanced: { loadThemes: false, enableExtHostWorker: false },
      userConfiguration: { json: JSON.stringify({ 'editor.wordBasedSuggestions': 'off', 'editor.fontSize': 14, 'editor.minimap.enabled': false }) },
      monacoWorkerFactory: () => { getEnhancedMonacoEnvironment().getWorker = () => new EditorWorker() }
    })
    initialized = wrapper.start()
  }
  return initialized
}

export interface RunningProblemEditor { dispose(): Promise<void>; focus(): void; theme(value: 'light' | 'dark'): void }

/** The standard VS Code client owns diagnostics, completion, hover, and document sync. */
export async function startProblemEditor(container: HTMLElement, session: ProblemEditorSession, language: ProblemLanguage, code: string, onChange: (value: string) => void, onDisconnect: () => void): Promise<RunningProblemEditor> {
  await initializeEditor()
  const languageId = language
  let disposed = false
  const client = new LanguageClientWrapper({ languageId,
    connection: { options: { $family: 'WebSocket', realization: () => new LcWebSocket(), webSocketUrl: session.webSocketUrl, disposeResources: true, stopOptions: { onCall: () => { if (!disposed) onDisconnect() } } }, retryConfig: { retries: 0, timeout: 15000, disposeOnRestart: true } },
    clientOptions: { documentSelector: [languageId], workspaceFolder: { index: 0, name: 'Problem', uri: Uri.parse(session.workspaceUri) } }
  })
  const app = new EditorApp({ id: session.id, codeResources: { modified: { text: code, uri: session.documentUri, enforceLanguageId: languageId } },
    editorOptions: { ariaLabel: 'Problem solution code', fontFamily: 'JetBrains Mono, SF Mono, monospace', fontSize: 14, minimap: { enabled: false }, scrollBeyondLastLine: false, padding: { top: 16 }, automaticLayout: true, wordWrap: 'off', tabSize: 4, insertSpaces: true }
  })
  app.registerOnTextChangedCallback(change => { if (change.modified !== undefined) onChange(change.modified) })
  try { await client.start(); await app.start(container) }
  catch (failure) { await app.dispose(); await client.dispose(); throw failure }
  return {
    dispose: async () => { disposed = true; await app.dispose(); await client.dispose() },
    focus: () => app.getEditor()?.focus(),
    theme: value => editor.setTheme(value === 'dark' ? 'vs-dark' : 'vs')
  }
}
