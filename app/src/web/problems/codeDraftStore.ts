import { z } from 'zod'
import type { ProblemLanguage } from '../../shared/problemExecution'
import { problemLanguages } from '../../shared/problemExecution'
import { hasUnprotectedCodeDrafts, readUnprotectedCodeDraft } from './codeDraftProtection'

const draftSchema = z.object({ id: z.string(), requestId: z.string().uuid(), accountId: z.string(), problemId: z.string(), language: z.enum(['cpp', 'c', 'python', 'javascript', 'java', 'go']), contentVersion: z.number().int(), code: z.string(), cloudRevision: z.number().int().nonnegative(), pending: z.boolean(), updatedAt: z.string() })
export type ProblemCodeDraft = z.infer<typeof draftSchema>

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('manor-problem-code', 2)
    request.onupgradeneeded = (event): void => {
      if (event.oldVersion === 0) { request.result.createObjectStore('drafts', { keyPath: ['accountId', 'problemId', 'language'] }); return }
      const transaction = request.transaction
      if (transaction === null) { reject(new Error('The code draft upgrade transaction is unavailable.')); return }
      const cursor = transaction.objectStore('drafts').openCursor()
      cursor.onsuccess = (): void => {
        if (cursor.result === null) return
        const previous = draftSchema.omit({ requestId: true }).safeParse(cursor.result.value)
        if (!previous.success) { transaction.abort(); reject(new Error(`The protected code draft could not be upgraded: ${previous.error.message}`)); return }
        cursor.result.update({ ...previous.data, requestId: crypto.randomUUID() }); cursor.result.continue()
      }
    }
    request.onsuccess = (): void => resolve(request.result)
    request.onerror = (): void => reject(new Error(`Could not open protected code drafts: ${request.error?.message}`))
    request.onblocked = (): void => reject(new Error('Another Manor window is blocking the code draft database. Close it and retry.'))
  })
}

/** Account-scoped source stays on this device through reloads and expired sessions. */
export async function readCodeDraft(accountId: string, problemId: string, language: ProblemLanguage): Promise<ProblemCodeDraft | null> {
  const db = await database()
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('drafts', 'readonly').objectStore('drafts').get([accountId, problemId, language])
      request.onsuccess = (): void => {
        const parsed = draftSchema.safeParse(request.result)
        if (request.result === undefined) resolve(null)
        else if (parsed.success) resolve(parsed.data)
        else reject(new Error(`The saved code draft is invalid: ${parsed.error.message}`))
      }
      request.onerror = (): void => reject(new Error(`Could not read the protected code draft: ${request.error?.message}`))
    })
  } finally { db.close() }
}

export async function writeCodeDraft(draft: ProblemCodeDraft): Promise<void> {
  await navigator.locks.request(`manor-account:${draft.accountId}`, () => commitCodeDraft(draft))
}

async function commitCodeDraft(draft: ProblemCodeDraft): Promise<void> {
  const validDraft = draftSchema.parse(draft)
  const db = await database()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('drafts', 'readwrite', { durability: 'strict' })
      const store = transaction.objectStore('drafts')
      const request = store.get([draft.accountId, draft.problemId, draft.language])
      request.onsuccess = (): void => {
        const existing = request.result === undefined ? null : draftSchema.safeParse(request.result)
        if (existing !== null && !existing.success) { transaction.abort(); reject(new Error(`The protected code draft is invalid: ${existing.error.message}`)); return }
        store.put({ ...validDraft, cloudRevision: Math.max(existing?.data?.cloudRevision ?? 0, validDraft.cloudRevision) })
      }
      transaction.oncomplete = (): void => resolve()
      transaction.onerror = (): void => reject(new Error(`Could not protect your code on this device: ${transaction.error?.message}`))
      transaction.onabort = (): void => reject(new Error(`Code draft protection was interrupted: ${transaction.error?.message}`))
    })
  } finally { db.close() }
}

/** A cloud receipt advances the revision while preserving edits typed during the request. */
export async function acknowledgeCodeDraft(accountId: string, problemId: string, language: ProblemLanguage, source: string, revision: number): Promise<void> {
  await navigator.locks.request(`manor-account:${accountId}`, () => commitAcknowledgement(accountId, problemId, language, source, revision))
}

async function commitAcknowledgement(accountId: string, problemId: string, language: ProblemLanguage, source: string, revision: number): Promise<void> {
  const db = await database()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('drafts', 'readwrite', { durability: 'strict' })
      const store = transaction.objectStore('drafts')
      const request = store.get([accountId, problemId, language])
      request.onsuccess = (): void => {
        const parsed = draftSchema.safeParse(request.result)
        if (!parsed.success) { transaction.abort(); reject(new Error('The code draft is missing or invalid while applying its cloud receipt.')); return }
        store.put({ ...parsed.data, cloudRevision: revision, pending: parsed.data.code !== source })
      }
      transaction.oncomplete = (): void => resolve()
      transaction.onerror = (): void => reject(new Error(`Could not record the saved code revision: ${transaction.error?.message}`))
      transaction.onabort = (): void => reject(new Error(`Code draft receipt was interrupted: ${transaction.error?.message}`))
    })
  } finally { db.close() }
}

async function accountDrafts(accountId: string): Promise<ProblemCodeDraft[]> {
  const db = await database()
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('drafts', 'readonly').objectStore('drafts').getAll()
      request.onsuccess = (): void => {
        const parsed = z.array(draftSchema).safeParse(request.result)
        if (parsed.success) resolve(parsed.data.filter(draft => draft.accountId === accountId))
        else reject(new Error(`Could not validate protected code drafts: ${parsed.error.message}`))
      }
      request.onerror = (): void => reject(new Error(`Could not inspect code drafts before sign-out: ${request.error?.message}`))
    })
  } finally { db.close() }
}

export async function pendingProblemDrafts(accountId: string): Promise<boolean> {
  if (hasUnprotectedCodeDrafts(accountId)) return true
  const drafts = await accountDrafts(accountId)
  return hasUnprotectedCodeDrafts(accountId) || drafts.some(draft => draft.pending)
}

/** Retained sources keep their original draft identity, language, and content version. */
export async function recoverableProblemDrafts(accountId: string, problemIds: readonly string[]): Promise<ProblemCodeDraft[]> {
  const ids = new Set(problemIds)
  const stored = (await accountDrafts(accountId)).filter(draft => ids.has(draft.problemId) && draft.pending)
  const pending = problemIds.flatMap(problemId => problemLanguages.flatMap(language => {
    const draft = readUnprotectedCodeDraft(accountId, problemId, language)
    return draft === null ? [] : [draft]
  }))
  return [...new Map([...stored, ...pending].map(draft => [JSON.stringify([draft.problemId, draft.language]), draft])).values()]
}

/** Explicit sign-out removes only drafts whose cloud save is acknowledged. */
export async function clearSyncedProblemDrafts(accountId: string): Promise<void> {
  const drafts = await accountDrafts(accountId)
  if (drafts.some(draft => draft.pending)) throw new Error('Code drafts are still waiting to save. Sign-out was cancelled.')
  const db = await database()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('drafts', 'readwrite')
      for (const draft of drafts) transaction.objectStore('drafts').delete([accountId, draft.problemId, draft.language])
      transaction.oncomplete = (): void => resolve()
      transaction.onerror = (): void => reject(new Error(`Could not clear synced code drafts: ${transaction.error?.message}`))
    })
  } finally { db.close() }
}
