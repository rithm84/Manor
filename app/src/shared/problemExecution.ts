/** A submitted program reads stdin and writes its answer to stdout. */
export const problemLanguages = ['cpp', 'c', 'python', 'javascript', 'java', 'go'] as const
export type ProblemLanguage = typeof problemLanguages[number]
export type ProblemExecutionMode = 'run' | 'submit'
export type ProblemSubmissionStatus = 'queued' | 'running' | 'completed' | 'failed'
export type ProblemVerdict = 'accepted' | 'wrong_answer' | 'compile_error' | 'runtime_error' | 'time_limit' | 'output_limit' | 'execution_error'
export interface ProblemCaseResult {
  id: string
  passed: boolean
  hidden: boolean
  input: string | null
  expectedOutput: string | null
  output: string | null
  /** What the solution printed while running this case; typed problems report it apart from the returned answer. */
  stdout?: string | null
  stderr: string | null
  durationMs: number
  /** Peak memory of the batch process that ran this case, in KiB; absent for programs without a typed driver. */
  memoryKb?: number | null
  verdict: ProblemVerdict
}
export interface ProblemSubmission {
  id: string
  problemId: string
  contentVersion: number
  testsetVersion: number | null
  language: ProblemLanguage
  mode: ProblemExecutionMode
  status: ProblemSubmissionStatus
  verdict: ProblemVerdict | null
  passedCases: number
  totalCases: number
  results: readonly ProblemCaseResult[]
  error: string | null
  sourceCode?: string | null
  createdAt: string
  finishedAt: string | null
}
export interface ExecuteProblemInput {
  problemId: string
  language: ProblemLanguage
  code: string
  mode: ProblemExecutionMode
  customInput?: string
  requestId: string
}
/** The account's editor capability: one short-lived token, with the address of every language's server under it. */
export interface ProblemEditorSession {
  id: string
  webSocketUrls: Readonly<Record<ProblemLanguage, string>>
  token: string
  expiresAt: string
  workspaceUri: string
}
export interface ProblemExecutionApi {
  execute(input: ExecuteProblemInput): Promise<ProblemSubmission>
  submission(submissionId: string): Promise<ProblemSubmission>
  submissions(problemId: string): Promise<readonly ProblemSubmission[]>
  /** Renews the account's editor sandbox for the language, binding the open problem when there is one, and returns a short-lived connection. */
  editorSession(problemId: string | null, language: ProblemLanguage): Promise<ProblemEditorSession>
}
export const problemLanguageLabels: Readonly<Record<ProblemLanguage, string>> = {
  cpp: 'C++', c: 'C', python: 'Python', javascript: 'JavaScript', java: 'Java', go: 'Go',
}
export const problemLanguageFiles: Readonly<Record<ProblemLanguage, string>> = {
  cpp: 'main.cpp', c: 'main.c', python: 'main.py', javascript: 'main.js', java: 'Main.java', go: 'main.go',
}
