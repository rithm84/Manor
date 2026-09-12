import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

export type StreakFlameState = 'ember' | 'dim' | 'lit' | 'blazing'
export interface StreakFlameProps { size: number; state: StreakFlameState }

/** A quiet outlined ember fills on completion; feedback runs once on an earned state change. */
export function StreakFlame({ size, state }: StreakFlameProps): ReactNode {
  const mark = useRef<SVGSVGElement>(null)
  const previous = useRef(state)
  useEffect(() => {
    const earned = previous.current !== state && (state === 'lit' || state === 'blazing')
    previous.current = state
    if (!earned || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const animation = mark.current?.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.14)', offset: .4 }, { transform: 'scale(1)' }], { duration: 240, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' })
    return () => animation?.cancel()
  }, [state])
  return <svg ref={mark} className={`streak-flame is-${state}`} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path className="streak-flame-body" d="M13.1 2.6c.5 4.3-4.8 5.4-4.8 9.2 0 1.1.5 1.8 1.1 2.2-2-.4-3-1.8-3.2-3.1C4.9 12.6 4.3 14 4.3 15.7a7.7 7.7 0 0 0 15.4 0c0-4.7-3.4-6.7-3.9-9.8-.5 1.2-.5 2.5-.1 3.4-1.7-1.2-1-4.3-2.6-6.7Z" strokeWidth="1.5" strokeLinejoin="round" />
    <path className="streak-flame-core" d="M12.8 12.9c.2 2.2-2.5 2.8-2.5 4.7a2.4 2.4 0 0 0 4.8 0c0-1.8-1.6-2.5-2.3-4.7Z" strokeWidth="1.2" strokeLinejoin="round" />
  </svg>
}
