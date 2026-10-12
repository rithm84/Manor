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
export interface ProblemEditorSession {
  id: string
  webSocketUrl: string
  token: string
  expiresAt: string
  workspaceUri: string
  documentUri: string
}
export interface ProblemExecutionApi {
  execute(input: ExecuteProblemInput): Promise<ProblemSubmission>
  submission(submissionId: string): Promise<ProblemSubmission>
  submissions(problemId: string): Promise<readonly ProblemSubmission[]>
  editorSession(problemId: string, language: ProblemLanguage): Promise<ProblemEditorSession>
  closeEditorSession(sessionId: string): Promise<void>
}
export const problemLanguageLabels: Readonly<Record<ProblemLanguage, string>> = {
  cpp: 'C++', c: 'C', python: 'Python', javascript: 'JavaScript', java: 'Java', go: 'Go',
}
export const problemLanguageFiles: Readonly<Record<ProblemLanguage, string>> = {
  cpp: 'main.cpp', c: 'main.c', python: 'main.py', javascript: 'main.js', java: 'Main.java', go: 'main.go',
}
