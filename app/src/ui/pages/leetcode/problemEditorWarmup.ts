import { problemLanguages } from '../../../shared/problemExecution'
import type { ProblemExecutionApi, ProblemLanguage } from '../../../shared/problemExecution'
import { readDevicePreference } from '../../preferences/devicePreference'
import { editorSessions } from '../../../web/problems/editorSessions'
import { errorMessage } from './leetCodeModel'
import { singleFlight } from '../../singleFlight'

export const problemLanguagePreference = 'problems.language'
export const defaultProblemLanguage: ProblemLanguage = 'python'

function preferredLanguage(): ProblemLanguage { return readDevicePreference(problemLanguagePreference, problemLanguages, defaultProblemLanguage) }
function report(failure: unknown): void { console.warn('Editor warmup failed', { error: errorMessage(failure) }) }

/** Resumes or creates the account's editor sandbox, with its language server, in one idempotent request. */
export function warmEditorSandbox(api: ProblemExecutionApi, accountId: string): void {
  editorSessions(api, accountId).session(preferredLanguage(), null).catch(report)
}

/**
 * The editor chunk, loaded once for the workspace and every warmup. Its modules import the language server and Monaco
 * runtime statically, so a later `import()` of either resolves from the evaluated graph instead of overlapping it.
 */
export const loadProblemCodeEditor = singleFlight(() => import('./ProblemCodeEditor'))

/**
 * Loads the editor's code and starts Monaco's services once the library has painted, so opening a problem only
 * creates the editor view. It costs no network request, and Monaco starts once per window.
 */
export function warmEditorRuntime(): void {
  loadProblemCodeEditor().then(() => import('./problemCodeEditorRuntime')).then(runtime => runtime.initializeEditor()).catch(report)
}

/** Pointing at a problem also loads the editor and connects the language server, so an opened problem finds it ready. */
export function warmLanguageServer(api: ProblemExecutionApi, accountId: string): void {
  const language = preferredLanguage()
  const sessions = editorSessions(api, accountId)
  loadProblemCodeEditor().then(() => import('./problemLanguageServer')).then(server => server.connectLanguageServer(language, () => sessions.session(language, null))).catch(report)
}
