import type { ReactNode } from 'react'

import './secondary-module-surface.css'

export interface SecondaryModuleSurfaceProps {
  width: 'focused' | 'wide'
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
