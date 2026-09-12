import type { ReactNode } from 'react'
export interface FreezeCrystalProps { size: number }
/** Frost seal: a consistent line icon that stays legible at 14px and above. */
export function FreezeCrystal({ size }: FreezeCrystalProps): ReactNode {
  return <svg className="freeze-crystal" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path className="freeze-crystal-shell" d="m12 2.5 8.2 4.75v9.5L12 21.5l-8.2-4.75v-9.5Z" strokeWidth="1.4" strokeLinejoin="round" />
    <path d="M12 6v12M6.8 9l10.4 6M6.8 15l10.4-6M10 7.2l2 1.2 2-1.2M10 16.8l2-1.2 2 1.2M7 11.2l2-1.1V7.8M15 16.2v-2.3l2-1.1M7 12.8l2 1.1v2.3M15 7.8v2.3l2 1.1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
}
