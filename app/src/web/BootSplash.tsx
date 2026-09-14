import type { ReactNode } from 'react'

/** The startup screen: the mark, breathing gently until the account is open. The same markup and styles ship in index.html so it paints before any script runs. */
export function BootSplash(): ReactNode {
  return (
    <main className="boot-splash" role="status" aria-label="Opening Manor">
      <img className="boot-mark" src="/brand/manor-mark.svg" alt="" width="82" height="48" />
    </main>
  )
}
