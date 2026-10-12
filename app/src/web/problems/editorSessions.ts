import { z } from 'zod'
import type { ProblemEditorSession, ProblemExecutionApi, ProblemLanguage } from '../../shared/problemExecution'

const sessionIds = z.array(z.string().uuid())
function storageKey(accountId: string): string { return `manor:problem-editor-sessions:${accountId}` }
function readIds(accountId: string): string[] {
  const value = localStorage.getItem(storageKey(accountId))
  return value === null ? [] : sessionIds.parse(JSON.parse(value))
}
function writeIds(accountId: string, ids: readonly string[]): void {
  if (ids.length === 0) localStorage.removeItem(storageKey(accountId))
  else localStorage.setItem(storageKey(accountId), JSON.stringify(ids))
}

/** One desktop solving workspace owns the account's tracked editor leases, including leases left by Quit. */
export async function openTrackedEditorSession(api: ProblemExecutionApi, accountId: string, problemId: string, language: ProblemLanguage): Promise<ProblemEditorSession> {
  return navigator.locks.request(`manor-problem-editor:${accountId}`, async () => {
    for (const id of readIds(accountId)) {
      await api.closeEditorSession(id)
      writeIds(accountId, readIds(accountId).filter(previous => previous !== id))
    }
    const session = await api.editorSession(problemId, language)
    try { writeIds(accountId, [session.id]) }
    catch (failure) {
      await api.closeEditorSession(session.id)
      throw new Error(`The editor session could not be tracked on this device: ${failure instanceof Error ? failure.message : String(failure)}`)
    }
    return session
  })
}

export async function closeTrackedEditorSession(api: ProblemExecutionApi, accountId: string, id: string): Promise<void> {
  await navigator.locks.request(`manor-problem-editor:${accountId}`, async () => {
    const ids = readIds(accountId)
    if (!ids.includes(id)) return
    await api.closeEditorSession(id)
    writeIds(accountId, ids.filter(previous => previous !== id))
  })
}
