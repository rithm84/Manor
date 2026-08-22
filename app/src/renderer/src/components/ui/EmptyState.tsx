import type { ReactNode } from 'react'

export interface EmptyStateProps {
  /** A 20px lucide icon. */
  icon: ReactNode
  /** Display-face line; keep it warm and short. */
  title: string
  /** Product-voice sentence. No mechanics, no em-dashes. */
  message: string
  /** Optional call to action (usually a primary Button). */
  action?: ReactNode
}

export function EmptyState({ icon, title, message, action }: EmptyStateProps): ReactNode {
  return (
    <div className="ui-empty">
      <span className="ui-empty-icon">{icon}</span>
      <span className="ui-empty-title">{title}</span>
      <span className="ui-empty-message">{message}</span>
      {action !== undefined ? <span className="ui-empty-action">{action}</span> : null}
    </div>
  )
}
