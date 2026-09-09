import type { ReactNode } from 'react'
import { useId } from 'react'

/**
 * lit: streak alive and today handled. blazing: a freeze-free week on top.
 * dim: streak alive but today still pending (the flame is going out).
 * ember: no streak yet.
 */
export type StreakFlameState = 'ember' | 'dim' | 'lit' | 'blazing'

export interface StreakFlameProps {
  size: number
  state: StreakFlameState
}

const BODY_PATH =
  'M12 2c.4 2.9-.7 4.6-2.3 6.4C8 10.2 6.4 12 6.4 14.6c0 3.8 2.5 6.6 5.6 6.6s5.6-2.8 5.6-6.6c0-1.9-.8-3.3-1.8-4.6-.3 1-.9 1.7-1.5 2.2.3-3-.6-6.8-2.3-10.2z'

const CORE_PATH =
  'M12 12.4c.2 1.6-.9 2.4-1.5 3.4-.4.7-.6 1.4-.4 2.3.3 1.3 1.4 2.1 2.6 1.9 1.3-.2 2.3-1.4 2.3-2.9 0-1.9-1.5-2.6-2.2-3.7-.3-.4-.6-.8-.8-1z'

/** Two-layer flame mark: gradient body with a live core drawn over it. */
export function StreakFlame({ size, state }: StreakFlameProps): ReactNode {
  const gradientId = useId()

  return (
    <svg
      className={`streak-flame is-${state}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          {state === 'blazing' ? (
            <>
              <stop offset="0%" stopColor="var(--streak-glow)" />
              <stop offset="55%" stopColor="var(--streak)" />
              <stop offset="100%" stopColor="var(--overdue-error)" />
            </>
          ) : (
            <>
              <stop offset="0%" stopColor="var(--streak-glow)" />
              <stop offset="100%" stopColor="var(--streak-deep)" />
            </>
          )}
        </linearGradient>
      </defs>
      <path
        className="streak-flame-body"
        d={BODY_PATH}
        fill={state === 'lit' || state === 'blazing' ? `url(#${gradientId})` : 'currentColor'}
      />
      <path className="streak-flame-core" d={CORE_PATH} />
    </svg>
  )
}
