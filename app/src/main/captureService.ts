import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { desktopCapturer, screen } from 'electron'

import type { BrowserContext, CaptureResult } from '../shared/capture'
import { currentAccount, supabase } from './supabaseAuth'

const execFileAsync = promisify(execFile)

/** Browsers Alfred can read the active tab from, in preference order. */
const BROWSER_SCRIPTS: readonly { browser: string; script: string }[] = [
  {
    browser: 'Google Chrome',
    script:
      'tell application "Google Chrome" to if (count of windows) > 0 then get (URL of active tab of front window) & "\n" & (title of active tab of front window)'
  },
  {
    browser: 'Arc',
    script:
      'tell application "Arc" to if (count of windows) > 0 then get (URL of active tab of front window) & "\n" & (title of active tab of front window)'
  },
  {
    browser: 'Safari',
    script:
      'tell application "Safari" to if (count of windows) > 0 then get (URL of current tab of front window) & "\n" & (name of current tab of front window)'
  }
]

async function runningApplications(): Promise<ReadonlySet<string>> {
  const { stdout } = await execFileAsync('osascript', [
    '-e',
    'tell application "System Events" to get name of every process whose background only is false'
  ])
  return new Set(stdout.trim().split(', '))
}

/** Active-tab context from the first running browser that answers. */
export async function frontBrowserContext(): Promise<BrowserContext | null> {
  const running = await runningApplications()
  for (const candidate of BROWSER_SCRIPTS) {
    if (!running.has(candidate.browser)) continue
    try {
      const { stdout } = await execFileAsync('osascript', ['-e', candidate.script])
      const [url, ...titleParts] = stdout.trim().split('\n')
      if (url === undefined || !/^https?:\/\//.test(url)) continue
      return { browser: candidate.browser, url, title: titleParts.join(' ').trim() }
    } catch (error) {
      // Automation permission for this browser was declined or not yet granted;
      // the capture still proceeds with the screenshot alone.
      console.warn('Browser tab read failed', { browser: candidate.browser, error })
    }
  }
  return null
}

/** PNG of the display under the cursor at native resolution. */
export async function captureScreenPng(): Promise<Buffer> {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: Math.round(display.size.width * display.scaleFactor),
      height: Math.round(display.size.height * display.scaleFactor)
    }
  })
  const source =
    sources.find((candidate) => candidate.display_id === String(display.id)) ?? sources[0]
  if (source === undefined) {
    throw new Error('No screen source was available for capture')
  }
  const image = source.thumbnail
  if (image.isEmpty()) {
    throw new Error(
      'Screen capture returned an empty image. Grant Manor screen recording access in ' +
        'System Settings > Privacy & Security > Screen Recording, then try again.'
    )
  }
  return image.toPNG()
}

/** Screenshot + tab context -> storage + kb_entries row -> normalization job. */
export async function captureToKnowledgeBase(): Promise<CaptureResult> {
  const account = await currentAccount()
  if (account === null) {
    throw new Error('Sign in to Manor before capturing to the knowledge base')
  }

  const [png, context] = await Promise.all([captureScreenPng(), frontBrowserContext()])

  const entryId = randomUUID()
  const screenshotPath = `${account.userId}/${entryId}.png`
  const client = supabase()

  const upload = await client.storage
    .from('captures')
    .upload(screenshotPath, png, { contentType: 'image/png' })
  if (upload.error !== null) {
    throw new Error(`Screenshot upload failed: ${upload.error.message}`)
  }

  const insert = await client.from('kb_entries').insert({
    id: entryId,
    source: 'capture',
    url: context?.url ?? null,
    title: context?.title ?? null,
    screenshot_path: screenshotPath,
    status: 'pending',
    raw: { browser: context?.browser ?? null }
  })
  if (insert.error !== null) {
    throw new Error(`Knowledge base insert failed: ${insert.error.message}`)
  }

  // Fire the normalization job; the entry stays visible as pending meanwhile.
  const invocation = await client.functions.invoke('normalize-capture', {
    body: { entryId }
  })
  if (invocation.error !== null) {
    console.warn('Capture normalization invocation failed; entry stays pending', {
      entryId,
      error: invocation.error
    })
  }

  return { entryId, context, screenshotPath }
}
