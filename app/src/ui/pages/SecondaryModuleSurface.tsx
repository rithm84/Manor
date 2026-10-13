import type { ReactNode } from 'react'

import './secondary-module-surface.css'

export interface SecondaryModuleSurfaceProps {
  /**
   * `fluid` spans the page for dense tables; `full` also fills its height, for working surfaces whose panes scroll
   * inside themselves.
   */
  width: 'focused' | 'wide' | 'fluid' | 'full'
  children: ReactNode
}

/**
 * A quiet page rail for secondary modules. It adds breathing room and a
 * readable measure without turning the whole page into an enclosing card.
 */
export function SecondaryModuleSurface({
  width,
  children
}: SecondaryModuleSurfaceProps): ReactNode {
  return <div className={`secondary-module-surface is-${width}`}>{children}</div>
}
