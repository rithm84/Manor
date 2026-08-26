/** Alfred screen capture -> knowledge base. See PRD §7.8 (generalized 2026-08-25). */

export interface BrowserContext {
  browser: string
  url: string
  title: string
}

export interface CaptureResult {
  entryId: string
  /** Frontmost browser tab if one was readable; screenshot-only otherwise. */
  context: BrowserContext | null
  screenshotPath: string
}

export interface CaptureApi {
  captureToKnowledgeBase: () => Promise<CaptureResult>
}
