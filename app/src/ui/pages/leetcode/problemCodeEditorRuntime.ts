import { editor, languages } from '@codingame/monaco-vscode-editor-api'
import '@codingame/monaco-vscode-standalone-languages/languages/definitions/cpp/register'
import '@codingame/monaco-vscode-standalone-languages/languages/definitions/python/register'
import '@codingame/monaco-vscode-standalone-languages/languages/definitions/javascript/register'
import '@codingame/monaco-vscode-standalone-languages/languages/definitions/java/register'
import '@codingame/monaco-vscode-standalone-languages/languages/definitions/go/register'
import EditorWorker from '@codingame/monaco-vscode-editor-api/esm/vs/editor/editor.worker.js?worker'
import { MonacoVscodeApiWrapper, getEnhancedMonacoEnvironment } from 'monaco-languageclient/vscodeApiWrapper'
import { EditorApp } from 'monaco-languageclient/editorApp'
import { problemLanguageFiles, problemLanguages } from '../../../shared/problemExecution'
import type { ProblemLanguage } from '../../../shared/problemExecution'

/** The Monarch grammars that color each language also list its keywords. */
const grammars: Readonly<Record<ProblemLanguage, () => Promise<{ language: { readonly keywords?: readonly string[] } }>>> = {
  cpp: () => import('@codingame/monaco-vscode-standalone-languages/languages/definitions/cpp/cpp.js'),
  c: () => import('@codingame/monaco-vscode-standalone-languages/languages/definitions/cpp/cpp.js'),
  python: () => import('@codingame/monaco-vscode-standalone-languages/languages/definitions/python/python.js'),
  javascript: () => import('@codingame/monaco-vscode-standalone-languages/languages/definitions/javascript/javascript.js'),
  java: () => import('@codingame/monaco-vscode-standalone-languages/languages/definitions/java/java.js'),
  go: () => import('@codingame/monaco-vscode-standalone-languages/languages/definitions/go/go.js'),
}

/**
 * Keywords complete before the language server connects. The provider shares the lowest-ranked group with Monaco's
 * words-in-document suggestions, which the editor consults only when the language server offers nothing, so a
 * connected server's answers are never mixed with them.
 */
function registerKeywordCompletions(): void {
  languages.registerCompletionItemProvider('*', {
    provideCompletionItems: async (model, position) => {
      const language = problemLanguages.find(value => value === model.getLanguageId())
      if (language === undefined) return undefined
      const keywords = (await grammars[language]()).language.keywords ?? []
      const word = model.getWordUntilPosition(position)
      const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn }
      return { suggestions: keywords.map(label => ({ label, kind: languages.CompletionItemKind.Keyword, insertText: label, range })) }
    }
  })
}

let initialized: Promise<void> | null = null
export function initializeEditor(): Promise<void> {
  if (initialized === null) {
    const wrapper = new MonacoVscodeApiWrapper({ $type: 'classic', viewsConfig: { $type: 'EditorService' }, advanced: { loadThemes: false, enableExtHostWorker: false },
      userConfiguration: { json: JSON.stringify({ 'editor.wordBasedSuggestions': 'currentDocument', 'editor.fontSize': 14, 'editor.minimap.enabled': false }) },
      monacoWorkerFactory: () => { getEnhancedMonacoEnvironment().getWorker = () => new EditorWorker() }
    })
    initialized = wrapper.start().then(registerKeywordCompletions)
  }
  return initialized
}

export interface ProblemEditorOptions { readonly fontSize: number; readonly tabSize: number }
export interface RunningProblemEditor { dispose(): Promise<void>; focus(): void; theme(value: 'light' | 'dark'): void; configure(options: ProblemEditorOptions): void }

/** Each language has one workspace document; the language server sees a problem switch as an edit to it. */
export function problemDocumentUri(language: ProblemLanguage): string { return 'file:///workspace/' + problemLanguageFiles[language] }

/**
 * Hover, signature help, completion, and diagnostics widgets render in a fixed host on the document body, so the
 * editor pane never clips them and Monaco can flip them below a line near the window's top edge. The host carries
 * the `monaco-editor` class so Monaco's widget styles apply, and `problem-monaco-overflow` for Manor's theme.
 */
function overflowHost(): HTMLElement {
  const host = document.createElement('div')
  host.className = 'monaco-editor problem-monaco-overflow'
  document.body.append(host)
  return host
}

/** Read-only highlighting with the same Monarch grammars and theme as the editor, for submitted code. */
export async function colorizeProblemCode(code: string, language: ProblemLanguage, theme: 'light' | 'dark', tabSize: number): Promise<string> {
  await initializeEditor()
  editor.setTheme(theme === 'dark' ? 'vs-dark' : 'vs')
  return editor.colorize(code, language, { tabSize })
}

/**
 * The editor is usable as soon as Monaco starts: highlighting, keywords, and words in the document need no server.
 * The language client attaches to the same document when it connects (see `problemLanguageServer.ts`), so the
 * upgrade keeps the cursor, undo stack, and scroll position. `onUse` reports typing, caret movement, and focus.
 */
export async function startProblemEditor(container: HTMLElement, language: ProblemLanguage, code: string, options: ProblemEditorOptions, onChange: (value: string) => void, onUse: () => void): Promise<RunningProblemEditor> {
  await initializeEditor()
  const overflow = overflowHost()
  const app = new EditorApp({ codeResources: { modified: { text: code, uri: problemDocumentUri(language), enforceLanguageId: language } },
    editorOptions: { ariaLabel: 'Problem solution code', fontFamily: 'JetBrains Mono, SF Mono, monospace', minimap: { enabled: false }, scrollBeyondLastLine: false, padding: { top: 16 }, automaticLayout: true, wordWrap: 'off', fontSize: options.fontSize, tabSize: options.tabSize, detectIndentation: false, insertSpaces: true, fixedOverflowWidgets: true, overflowWidgetsDomNode: overflow, overviewRulerBorder: false, hideCursorInOverviewRuler: true }
  })
  app.registerOnTextChangedCallback(change => { if (change.modified !== undefined) onChange(change.modified) })
  try { await app.start(container) }
  catch (failure) { await app.dispose(); overflow.remove(); throw failure }
  const running = app.getEditor()
  if (running === undefined) { await app.dispose(); overflow.remove(); throw new Error('The problem editor started without an editor view.') }
  const uses = [running.onDidChangeModelContent(onUse), running.onDidChangeCursorPosition(onUse), running.onDidFocusEditorText(onUse)]
  return {
    dispose: async () => { uses.forEach(use => use.dispose()); try { await app.dispose() } finally { overflow.remove() } },
    focus: () => running.focus(),
    theme: value => editor.setTheme(value === 'dark' ? 'vs-dark' : 'vs'),
    configure: value => {
      running.updateOptions({ fontSize: value.fontSize })
      running.getModel()?.updateOptions({ tabSize: value.tabSize, indentSize: value.tabSize, insertSpaces: true })
    }
  }
}
