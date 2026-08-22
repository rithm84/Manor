import type { ReactNode } from 'react'

export interface PageShellProps {
  /** Display-face page headline (EB Garamond 500). Not rendered when fullBleed. */
  title: string
  /**
   * true: children render edge-to-edge with no padding and no title band
   * (for pages that bring their own chrome: Notes, Journal, Calendar).
   * false: standard padded page with the display title.
   */
  fullBleed: boolean
  children: ReactNode
}

/** Standard page scaffold. Page agents build inside this. */
export function PageShell({ title, fullBleed, children }: PageShellProps): ReactNode {
  if (fullBleed) {
    return <div className="pageshell-fullbleed">{children}</div>
  }
  return (
    <div className="pageshell">
      <h1 className="page-title">{title}</h1>
      {children}
    </div>
  )
}
