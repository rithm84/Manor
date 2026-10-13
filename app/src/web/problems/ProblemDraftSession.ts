import type { ProblemLibraryApi, ProblemCodeDraft as CloudCodeDraft } from '../../shared/problemLibrary'
import type { ProblemLanguage } from '../../shared/problemExecution'
import { acknowledgeCodeDraft, readCodeDraft, writeCodeDraft } from './codeDraftStore'
import type { ProblemCodeDraft } from './codeDraftStore'
import { beginCodeDraftProtection, readUnprotectedCodeDraft } from './codeDraftProtection'

export type CodeDraftStatus = 'loading' | 'protecting' | 'protected' | 'saving' | 'saved' | 'failed'

/** Serializes local protection and cloud writes for one account, problem, and language. */
export class ProblemDraftSession {
  private readonly library: ProblemLibraryApi
  private readonly accountId: string
  private readonly problemId: string
  private readonly language: ProblemLanguage
  private readonly contentVersion: number
  private readonly onStatus: (status: CodeDraftStatus, error: Error | null) => void
  private local: ProblemCodeDraft | null = null
  private localWrites: Promise<void> = Promise.resolve()
  private cloudWrite: Promise<void> | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private cloudConflict: CloudCodeDraft | null = null
  private cloudReadFailed = false
  /** True while the local draft's identity was minted on this device and no cloud draft has been read. */
  private minted = false
  private cloudRead: Promise<string | null> = Promise.resolve(null)
  constructor(library: ProblemLibraryApi, accountId: string, problemId: string, language: ProblemLanguage, contentVersion: number, onStatus: (status: CodeDraftStatus, error: Error | null) => void) {
    this.library = library; this.accountId = accountId; this.problemId = problemId; this.language = language; this.contentVersion = contentVersion; this.onStatus = onStatus
  }
  /**
   * Returns this device's draft, or the starter code when there is none, without waiting for the cloud. The cloud
   * draft is read in the background; `reconciled` reports whether it replaced the code.
   */
  async open(starterCode: string): Promise<string> {
    const stored = readUnprotectedCodeDraft(this.accountId, this.problemId, this.language) ?? await readCodeDraft(this.accountId, this.problemId, this.language)
    this.minted = stored === null
    this.local = stored === null
      ? { id: crypto.randomUUID(), requestId: crypto.randomUUID(), accountId: this.accountId, problemId: this.problemId, language: this.language, contentVersion: this.contentVersion, code: starterCode, cloudRevision: 0, pending: false, updatedAt: new Date().toISOString() }
      : stored.pending && stored.contentVersion === this.contentVersion ? stored : { ...stored, requestId: crypto.randomUUID(), contentVersion: this.contentVersion }
    this.cloudRead = this.readCloud()
    return this.local.code
  }
  /** Resolves with the cloud code when it replaced unedited local code, or null when the code on screen stands. */
  reconciled(): Promise<string | null> { return this.cloudRead }
  protect(code: string): void {
    if (this.local === null) throw new Error('The code draft must load before it can be edited.')
    this.local = { ...this.local, requestId: crypto.randomUUID(), contentVersion: this.contentVersion, code, pending: true, updatedAt: new Date().toISOString() }
    const draft = this.local
    this.onStatus('protecting', null)
    const write = this.queueLocalProtection(draft)
    void write.then(() => { if (this.localWrites === write) this.onStatus('protected', null); this.schedule() }).catch(failure => this.report(failure))
  }
  async protected(): Promise<void> { await this.localWrites }
  async retry(): Promise<string> {
    if (this.local === null) throw new Error('The code draft must load before saving can be retried.')
    try { await this.localWrites } catch (failure) {
      console.warn('Retrying failed local code protection', { problemId: this.problemId, language: this.language, error: failure instanceof Error ? failure.message : String(failure) })
      try { await this.queueLocalProtection(this.local); this.onStatus('protected', null) } catch (retryFailure) { this.report(retryFailure); throw retryFailure }
    }
    if (this.cloudReadFailed) {
      this.cloudRead = this.readCloud()
      await this.cloudRead
      return this.local.code
    }
    await this.sync()
    return this.local.code
  }
  conflict(): CloudCodeDraft | null { return this.cloudConflict }
  async keepLocal(): Promise<void> {
    const remote = this.cloudConflict
    if (this.local === null || remote === null) throw new Error('Both code drafts must exist before resolving their conflict.')
    this.local = { ...this.local, requestId: crypto.randomUUID(), cloudRevision: remote.revision, contentVersion: this.contentVersion, pending: true }
    await this.queueLocalProtection(this.local)
    this.cloudConflict = null
    await this.sync()
  }
  async useCloud(): Promise<string> {
    const remote = await this.library.loadDraft(this.problemId, this.language)
    if (remote === null) throw new Error('The cloud code draft no longer exists. Your local code remains protected.')
    this.local = { id: remote.id, requestId: crypto.randomUUID(), accountId: this.accountId, problemId: this.problemId, language: this.language, contentVersion: remote.contentVersion, code: remote.source, cloudRevision: remote.revision, pending: false, updatedAt: remote.updatedAt }
    await this.queueLocalProtection(this.local)
    this.cloudConflict = null; this.onStatus('saved', null)
    return remote.source
  }
  async sync(): Promise<void> {
    await this.cloudRead
    await this.localWrites
    if (this.cloudWrite !== null) { await this.cloudWrite; if (this.local?.pending === true) return this.sync(); return }
    const draft = this.local
    if (draft === null || !draft.pending) return
    if (this.cloudConflict !== null) throw new Error('Choose which code draft to keep before saving.')
    this.onStatus('saving', null)
    const pending = (async (): Promise<void> => {
      const receipt = await this.library.saveDraft({ id: draft.id, requestId: draft.requestId, problemId: draft.problemId, language: draft.language, contentVersion: draft.contentVersion, source: draft.code, expectedRevision: draft.cloudRevision })
      await this.acknowledge(draft, receipt.revision)
    })()
    this.cloudWrite = pending
    try { await pending } catch (failure) {
      let committed = false
      try {
        const latest = await this.library.loadDraft(this.problemId, this.language)
        if (latest !== null && latest.source === draft.code && latest.contentVersion === draft.contentVersion) {
          await this.acknowledge(draft, latest.revision)
          committed = true
          console.warn('Code save receipt failed, but the exact source was verified in the cloud', { problemId: this.problemId, language: this.language, revision: latest.revision, error: failure instanceof Error ? failure.message : String(failure) })
        } else if (latest !== null && latest.revision !== draft.cloudRevision) this.cloudConflict = latest
      } catch (readFailure) { console.warn('Conflicting code draft could not be retrieved', { problemId: this.problemId, language: this.language, error: readFailure instanceof Error ? readFailure.message : String(readFailure) }) }
      if (!committed) { this.report(failure); throw failure }
    } finally { this.cloudWrite = null }
    if (this.local?.pending === true) this.schedule()
  }
  stop(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
    void this.sync().catch(failure => console.error('Code draft save failed after navigation', { problemId: this.problemId, language: this.language, error: failure instanceof Error ? failure.message : String(failure) }))
  }
  /**
   * Reconciles the cloud draft with the local one. Unedited local code takes the cloud draft; edits made before it
   * arrived conflict with a cloud draft whose revision they did not start from, as pending local drafts always have.
   * The decision and the swap happen synchronously after the read, so no keystroke can land between them.
   */
  private async readCloud(): Promise<string | null> {
    let cloud: CloudCodeDraft | null
    try { cloud = await this.library.loadDraft(this.problemId, this.language) }
    catch (failure) {
      this.cloudReadFailed = true
      this.onStatus('failed', new Error(`Your code is safe on this device, but its cloud draft could not load: ${failure instanceof Error ? failure.message : String(failure)}`))
      return null
    }
    this.cloudReadFailed = false
    const local = this.local
    if (local === null) throw new Error('The code draft must open before its cloud draft is reconciled.')
    const reconciled: ProblemCodeDraft = cloud === null ? local
      : !local.pending ? { id: cloud.id, requestId: crypto.randomUUID(), accountId: this.accountId, problemId: this.problemId, language: this.language, contentVersion: this.contentVersion, code: cloud.source, cloudRevision: cloud.revision, pending: false, updatedAt: cloud.updatedAt }
      : this.minted ? { ...local, id: cloud.id } : local
    this.local = reconciled; this.minted = false
    const written = this.queueLocalProtection(reconciled)
    if (reconciled.pending && cloud !== null && cloud.revision !== reconciled.cloudRevision) {
      this.cloudConflict = cloud
      this.onStatus('protected', new Error('This code was changed on another device. Compare the two drafts before saving.'))
    } else if (reconciled.pending) { this.onStatus('protected', null); this.schedule() }
    else this.onStatus('saved', null)
    void written.catch(failure => this.report(failure))
    return reconciled.code === local.code ? null : reconciled.code
  }
  private schedule(): void {
    if (this.cloudConflict !== null) return
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = setTimeout(() => { this.timer = null; void this.sync().catch(failure => console.warn('Code draft cloud save needs retry', { problemId: this.problemId, language: this.language, error: failure instanceof Error ? failure.message : String(failure) })) }, 600)
  }
  private queueLocalProtection(draft: ProblemCodeDraft): Promise<void> {
    const protectedLocally = beginCodeDraftProtection(draft)
    const write = this.localWrites.then(() => writeCodeDraft(draft), () => writeCodeDraft(draft)).then(protectedLocally)
    this.localWrites = write
    return write
  }
  private async acknowledge(draft: ProblemCodeDraft, revision: number): Promise<void> {
    await this.localWrites
    await acknowledgeCodeDraft(draft.accountId, draft.problemId, draft.language, draft.code, revision)
    if (this.local !== null) this.local = { ...this.local, cloudRevision: revision, pending: this.local.code !== draft.code }
    this.onStatus(this.local?.pending === true ? 'protected' : 'saved', null)
  }
  private report(failure: unknown): void { this.onStatus('failed', failure instanceof Error ? failure : new Error(String(failure))) }
}
