import { annotate } from 'rough-notation'
import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

export interface HandCircleProps {
  /** Draws the ink circle while true; removes it when false. */
  active: boolean
  children: ReactNode
}

/**
 * A rough hand-drawn ink circle around its content. Reserved for rare
 * celebration moments (charter: ink marks never ride frequent actions).
 */
export function HandCircle({ active, children }: HandCircleProps): ReactNode {
  const ref = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    if (!active || ref.current === null) return
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const annotation = annotate(ref.current, {
      type: 'circle',
      color: 'var(--primary)',
      strokeWidth: 2,
      padding: 6,
      animate: !reduceMotion,
      animationDuration: 500
    })
    annotation.show()
    return () => annotation.remove()
  }, [active])

  return (
    <span ref={ref} className="ui-hand-circle">
      {children}
    </span>
  )
}
