import type { ProblemLanguage } from '../../shared/problemExecution'
import type { ProblemCodeDraft } from './codeDraftStore'

interface DraftIdentity { readonly accountId: string; readonly problemId: string; readonly language: ProblemLanguage }
interface PendingProtection<Draft extends DraftIdentity> { readonly draft: Draft; readonly receipt: symbol }

/** A restart must wait for the latest in-memory source to reach durable local storage. */
export class CodeDraftProtectionBoundary<Draft extends DraftIdentity> {
  private readonly pending = new Map<string, PendingProtection<Draft>>()
  private readonly target: EventTarget
  private listening = false
  constructor(target: EventTarget) { this.target = target }
  begin(draft: Draft): () => void {
    if (!this.listening) {
      this.target.addEventListener('manor:before-update', this.onBeforeUpdate)
      this.listening = true
    }
    const key = JSON.stringify([draft.accountId, draft.problemId, draft.language])
    const receipt = Symbol('code draft protection')
    this.pending.set(key, { draft, receipt })
    return (): void => { if (this.pending.get(key)?.receipt === receipt) this.pending.delete(key) }
  }
  hasUnprotected(accountId: string): boolean { return [...this.pending.values()].some(entry => entry.draft.accountId === accountId) }
  readUnprotected(draft: DraftIdentity): Draft | null { return this.pending.get(JSON.stringify([draft.accountId, draft.problemId, draft.language]))?.draft ?? null }
  private readonly onBeforeUpdate = (event: Event): void => { if (this.pending.size > 0) event.preventDefault() }
}

let boundary: CodeDraftProtectionBoundary<ProblemCodeDraft> | null = null

/** Registration is lazy so importing draft helpers does not access the browser environment. */
export function beginCodeDraftProtection(draft: ProblemCodeDraft): () => void {
  boundary ??= new CodeDraftProtectionBoundary<ProblemCodeDraft>(window)
  return boundary.begin(draft)
}

export function hasUnprotectedCodeDrafts(accountId: string): boolean { return boundary?.hasUnprotected(accountId) ?? false }

/** Retains source through navigation when local storage failed, until a later write protects it. */
export function readUnprotectedCodeDraft(accountId: string, problemId: string, language: ProblemLanguage): ProblemCodeDraft | null {
  return boundary?.readUnprotected({ accountId, problemId, language }) ?? null
}
