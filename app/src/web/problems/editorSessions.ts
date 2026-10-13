import type { ProblemEditorSession, ProblemExecutionApi, ProblemLanguage } from '../../shared/problemExecution'

/** A session this recent is reused; an older one is renewed, which also extends the account sandbox's idle lease. */
const renewAfterMs = 5 * 60000

interface Request { readonly problemId: string | null }
interface Held extends Request { readonly session: ProblemEditorSession; readonly fetchedAt: number }

/**
 * The account's editor capability on this device. Prewarming, opening, and use renewals share one request at a
 * time and reuse a recent answer, so the server sees at most one renewal every few minutes while the editor is in
 * use. The server, not this cache, enforces one editor sandbox per account and removes stale ones.
 */
export class EditorSessions {
  private readonly api: ProblemExecutionApi
  private held: Held | null = null
  private pending: (Request & { readonly promise: Promise<ProblemEditorSession> }) | null = null
  constructor(api: ProblemExecutionApi) { this.api = api }

  /**
   * The account's editor session; with a problem, the lease also protects that problem as the open one. A session
   * addresses every language, so a recent one serves a language switch without asking the server; the language only
   * tells a server that has to start its language servers which one to start first.
   */
  session(language: ProblemLanguage, problemId: string | null): Promise<ProblemEditorSession> {
    const covers = (value: Request): boolean => problemId === null || value.problemId === problemId
    if (this.pending !== null && covers(this.pending)) return this.pending.promise
    if (this.held !== null && covers(this.held) && Date.now() - this.held.fetchedAt < renewAfterMs) return Promise.resolve(this.held.session)
    const promise = this.api.editorSession(problemId, language).then(session => {
      // The server keeps the bound problem when a renewal names none.
      this.held = { problemId: problemId ?? this.held?.problemId ?? null, session, fetchedAt: Date.now() }
      return session
    }).finally(() => { if (this.pending?.promise === promise) this.pending = null })
    this.pending = { problemId, promise }
    return promise
  }
}

const accounts = new Map<string, { readonly api: ProblemExecutionApi; readonly sessions: EditorSessions }>()

export function editorSessions(api: ProblemExecutionApi, accountId: string): EditorSessions {
  const current = accounts.get(accountId)
  if (current !== undefined && current.api === api) return current.sessions
  const sessions = new EditorSessions(api)
  accounts.set(accountId, { api, sessions })
  return sessions
}
