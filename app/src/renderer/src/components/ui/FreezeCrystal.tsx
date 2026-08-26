import type { ReactNode } from 'react'
import { useId } from 'react'

export interface FreezeCrystalProps {
  size: number
}

/** Faceted ice gem for streak freezes: the frost counterpart to the flame. */
export function FreezeCrystal({ size }: FreezeCrystalProps): ReactNode {
  const gradientId = useId()

  return (
    <svg
      className="freeze-crystal"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0%" stopColor="color-mix(in srgb, var(--frozen-info) 40%, white)" />
          <stop offset="100%" stopColor="var(--frozen-info)" />
        </linearGradient>
      </defs>
      <path
        d="M12 2.4 20 7v10l-8 4.6L4 17V7z"
        fill={`url(#${gradientId})`}
      />
      <path
        d="M12 6.6 16.6 12 12 17.4 7.4 12z"
        fill="color-mix(in srgb, var(--frozen-info) 22%, white)"
      />
      <path d="M12 2.4 20 7l-3.4 1.9L9 4.1z" fill="#ffffff" opacity="0.5" />
    </svg>
  )
}
