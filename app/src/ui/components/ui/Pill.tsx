import type { ReactNode } from 'react'

/**
 * The four due-bucket colorways are the kanban signature; the rest cover
 * tags, statuses, and streak states.
 */
export type PillColorway =
  | 'overdue'
  | 'today'
  | 'tomorrow'
  | 'week'
  | 'neutral'
  | 'success'
  | 'gold'
  | 'info'
  | 'plum'
  | 'forest'

export interface PillProps {
  /** 'group' = filled kanban group pill (cream text, count beside). 'tag' = tinted chip. */
  variant: 'group' | 'tag'
  colorway: PillColorway
  label: string
  /** Optional leading icon, normally 12px and decorative. */
  icon?: ReactNode
  /** Rendered beside a group pill, Notion-board style. Ignored for tags. */
  count?: number
}

export function Pill({ variant, colorway, label, icon, count }: PillProps): ReactNode {
  const pill = (
    <span className={`ui-pill ui-pill--${variant} is-${colorway}`}>
      {icon === undefined ? null : <span className="ui-pill-icon" aria-hidden="true">{icon}</span>}
      {label}
    </span>
  )
  if (variant === 'group' && count !== undefined) {
    return (
      <span className="ui-pill-row">
        {pill}
        <span className="ui-pill-count">{count}</span>
      </span>
    )
  }
  return pill
}
