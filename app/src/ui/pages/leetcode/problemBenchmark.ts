import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import type { LanguageClientConfig } from 'monaco-languageclient/lcwrapper'
import { problemLanguages } from '../../../shared/problemExecution'
import type { ProblemLanguage } from '../../../shared/problemExecution'
import { logProblemBenchmarkFailure, logProblemTiming, sinceRouteStart } from '../../../web/shell/timing'
import { errorMessage } from './leetCodeModel'

/**
 * Problems timing for `desktop/benchmark.mjs`, written to the shell log as `problems timed` lines.
 *
 * The library always logs how long it took to settle after its navigation. A staging build that opens
 * `/leetcode?benchmark=problems&problem=<id>&query=<text>&run=<languages>&submit=<languages>` also drives one
 * solving session through test IDs: it searches, opens the problem, waits for the statement and an editable editor,
 * asks the language server for completions until it answers with items, then runs and submits the code in each
 * listed language and waits for each verdict. Run and Submit save real submissions, so other builds refuse to drive.
 */

const SEARCH_MARK = 'manor:problems-search'
const UI_TIMEOUT_MS = 30_000
const LANGUAGE_SERVER_TIMEOUT_MS = 120_000
const VERDICT_TIMEOUT_MS = 120_000
const COMPLETION_RETRY_MS = 250

type ClientMiddleware = NonNullable<LanguageClientConfig['clientOptions']['middleware']>
let completionWaiter: ((items: number) => void) | null = null

/** Language-client middleware that hands the size of each completion answer to a waiting benchmark drive. */
export const problemCompletionTiming: ClientMiddleware = {
  provideCompletionItem: async (document, position, context, token, next) => {
    const result = await next(document, position, context, token)
    completionWaiter?.(Array.isArray(result) ? result.length : result?.items.length ?? 0)
    return result
  }
}

/** Logs the library settling and the search painting, and runs a benchmark drive when the route asks for one. */
export function useProblemBenchmark(loaded: boolean, search: string): void {
  const location = useLocation()
  useEffect(() => {
    if (!loaded) return
    const frame = requestAnimationFrame(() => logProblemTiming('library', sinceRouteStart(), {}))
    return () => cancelAnimationFrame(frame)
  }, [loaded])
  useEffect(() => {
    const started = performance.getEntriesByName(SEARCH_MARK, 'mark').at(-1)
    if (started === undefined) return
    const frame = requestAnimationFrame(() => { performance.clearMarks(SEARCH_MARK); logProblemTiming('search', performance.now() - started.startTime, {}) })
    return () => cancelAnimationFrame(frame)
  }, [search])
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    if (params.get('benchmark') !== 'problems') return
    driveProblems(params).catch((failure: unknown) => {
      console.error('The Problems benchmark stopped', { error: errorMessage(failure) })
      logProblemBenchmarkFailure(errorMessage(failure))
    })
  }, [location.key])
}

const byTestId = (id: string): string => `[data-testid="${CSS.escape(id)}"]`

/** The element `selector` matches, checked to be of `type`, or null when nothing matches. */
function find<T extends Element>(selector: string, type: abstract new () => T): T | null {
  const found = document.querySelector(selector)
  if (found === null) return null
  if (!(found instanceof type)) throw new Error(`${selector} is not a ${type.name}`)
  return found
}

/** Resolves with the first non-null value `probe` returns, checked once per frame; a probe that throws fails fast. */
function waitFor<T>(probe: () => T | null, timeoutMs: number, what: string): Promise<T> {
  const deadline = performance.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const check = (): void => {
      try {
        const value = probe()
        if (value !== null) resolve(value)
        else if (performance.now() > deadline) reject(new Error(`Waited ${timeoutMs} ms for ${what}`))
        else requestAnimationFrame(check)
      } catch (failure) { reject(failure instanceof Error ? failure : new Error(String(failure))) }
    }
    requestAnimationFrame(check)
  })
}

/** Sets a React-controlled input or select the way typing or picking does. */
function setControlValue(control: HTMLInputElement | HTMLSelectElement, value: string, event: 'input' | 'change'): void {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(control), 'value')?.set
  if (setter === undefined) throw new Error(`${control.tagName} has no value setter`)
  setter.call(control, value)
  control.dispatchEvent(new Event(event, { bubbles: true }))
}

function requiredParam(params: URLSearchParams, name: string): string {
  const value = params.get(name)
  if (value === null || value === '') throw new Error(`The Problems benchmark link needs a ${name} parameter`)
  return value
}

function languageParam(params: URLSearchParams, name: string): ProblemLanguage[] {
  return requiredParam(params, name).split(',').map(value => {
    const language = problemLanguages.find(item => item === value)
    if (language === undefined) throw new Error(`The Problems benchmark does not know the language ${value}`)
    return language
  })
}

/** Waits for a newly mounted editor whose language server has connected, failing fast when the editor reports an error. */
function editableEditor(previous: Element | null): Promise<Element> {
  return waitFor(() => {
    const failure = document.querySelector('.problem-editor-error')
    if (failure !== null) throw new Error(`The code editor failed to start: ${failure.textContent ?? ''}`)
    const host = document.querySelector(byTestId('problem-code-editor'))
    const ready = host !== null && host !== previous && host.querySelector('.monaco-editor') !== null && document.querySelector('.problem-editor-loading') === null
    return ready ? host : null
  }, LANGUAGE_SERVER_TIMEOUT_MS, 'an editable code editor')
}

/** Asks for completions at the last line's first word, without editing the code, until the language server returns items. */
async function firstCompletion(host: Element): Promise<void> {
  const { editor } = await import('@codingame/monaco-vscode-editor-api')
  const instance = editor.getEditors().find(item => host.contains(item.getContainerDomNode()))
  const model = instance?.getModel() ?? null
  if (instance === undefined || model === null) throw new Error('The code editor has no Monaco model to ask for completions')
  const lines = model.getLinesContent()
  const fromEnd = [...lines].reverse().findIndex(text => text.trim() !== '')
  if (fromEnd < 0) throw new Error('The code is empty, so there is nowhere to ask for completions')
  const line = lines.length - 1 - fromEnd
  const position = { lineNumber: line + 1, column: lines[line].search(/\S/) + 1 }
  // The editor completes keywords locally before the language server connects; only its answers count.
  await waitFor(() => host.closest('[data-language-server="connected"]'), LANGUAGE_SERVER_TIMEOUT_MS, 'a connected language server')
  const deadline = performance.now() + LANGUAGE_SERVER_TIMEOUT_MS
  for (;;) {
    const remaining = deadline - performance.now()
    if (remaining <= 0) throw new Error(`The language server returned no completions within ${LANGUAGE_SERVER_TIMEOUT_MS} ms`)
    let timer: ReturnType<typeof setTimeout> | undefined
    const answer = new Promise<number>((resolve, reject) => {
      completionWaiter = resolve
      timer = setTimeout(() => reject(new Error(`The language server did not answer a completion request within ${LANGUAGE_SERVER_TIMEOUT_MS} ms`)), remaining)
    })
    instance.focus()
    instance.setPosition(position)
    instance.trigger('manor-benchmark', 'editor.action.triggerSuggest', {})
    try {
      if (await answer > 0) return
    } finally {
      clearTimeout(timer)
      completionWaiter = null
      instance.trigger('manor-benchmark', 'hideSuggestWidget', {})
    }
    await new Promise(resolve => setTimeout(resolve, COMPLETION_RETRY_MS))
  }
}

/** Switches the solution language when needed and returns the editor that is editable afterwards. */
async function switchLanguage(language: ProblemLanguage, host: Element): Promise<Element> {
  const select = await waitFor(() => { const found = find(byTestId('problem-language'), HTMLSelectElement); return found !== null && !found.disabled ? found : null }, UI_TIMEOUT_MS, 'the language picker')
  if (select.value === language) return host
  if (!Array.from(select.options).some(option => option.value === language)) throw new Error(`This problem has no ${language} starter code`)
  setControlValue(select, language, 'change')
  return editableEditor(host)
}

/** Clicks Run or Submit and logs the time until a new verdict is painted in the console. */
async function timedVerdict(mode: 'run' | 'submit', language: ProblemLanguage): Promise<void> {
  const verdictSelector = `${byTestId('problem-console')} ${byTestId('problem-verdict')}`
  const previous = document.querySelector(verdictSelector)
  const button = await waitFor(() => { const found = find(byTestId(`problem-${mode}`), HTMLButtonElement); return found !== null && !found.disabled ? found : null }, UI_TIMEOUT_MS, `an enabled ${mode} button`)
  const started = performance.now()
  button.click()
  const verdict = await waitFor(() => {
    if (document.querySelector(byTestId('problem-retry-execution')) !== null) throw new Error(`The ${language} ${mode} request failed before it was judged`)
    const shown = document.querySelector(verdictSelector)
    return shown !== null && shown !== previous ? shown : null
  }, VERDICT_TIMEOUT_MS, `the ${language} ${mode} verdict`)
  logProblemTiming(mode, performance.now() - started, { language, verdict: verdict.textContent ?? '' })
}

/** One scripted solving session; see the module documentation. */
async function driveProblems(params: URLSearchParams): Promise<void> {
  if (import.meta.env.MODE !== 'staging') throw new Error('Only staging builds run the Problems benchmark, because it saves submissions')
  const problemId = requiredParam(params, 'problem')
  const query = requiredParam(params, 'query')
  const runs = languageParam(params, 'run')
  const submits = languageParam(params, 'submit')
  const search = await waitFor(() => find(byTestId('problem-search'), HTMLInputElement), UI_TIMEOUT_MS, 'the library search')
  if (search.value !== '') throw new Error('The library search must start empty; open the library from another page first')
  performance.clearMarks(SEARCH_MARK)
  performance.mark(SEARCH_MARK)
  setControlValue(search, query, 'input')
  const open = await waitFor(() => find(byTestId(`problem-open-${problemId}`), HTMLButtonElement), UI_TIMEOUT_MS, `problem ${problemId} in the results for "${query}"`)
  await waitFor(() => performance.getEntriesByName(SEARCH_MARK, 'mark').length === 0 ? true : null, UI_TIMEOUT_MS, 'the search timing')
  const opened = performance.now()
  open.click()
  await waitFor(() => {
    if (document.querySelector(byTestId('problem-statement-empty')) !== null) throw new Error(`Problem ${problemId} has no statement`)
    return document.querySelector(`${byTestId('problem-reader')} .problem-markdown`)
  }, UI_TIMEOUT_MS, 'the problem statement')
  logProblemTiming('statement', performance.now() - opened, { problem: problemId })
  let host = await editableEditor(null)
  const editable = performance.now()
  const picker = find(byTestId('problem-language'), HTMLSelectElement)
  const original = problemLanguages.find(item => item === picker?.value)
  if (original === undefined) throw new Error('The editor opened without a known solution language')
  logProblemTiming('editor', editable - opened, { language: original })
  await firstCompletion(host)
  logProblemTiming('completion', performance.now() - editable, { language: original })
  for (const language of runs) { host = await switchLanguage(language, host); await timedVerdict('run', language) }
  for (const language of submits) { host = await switchLanguage(language, host); await timedVerdict('submit', language) }
  await switchLanguage(original, host)
  logProblemTiming('done', performance.now() - opened, {})
}
