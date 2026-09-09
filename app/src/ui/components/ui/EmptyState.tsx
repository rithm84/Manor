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
      <span className="ui-empty-icon">
        {icon}
        {/* Sketched ink ring: two loose, overlapping ellipse passes. */}
        <svg className="ui-empty-ring" viewBox="0 0 58 58" aria-hidden="true">
          <path d="M29 5 C43 4 53 13 53 28 C53 44 42 53 28 53 C14 53 5 43 5 29 C5 14 16 6 30 6 C42 6 51 15 51 27" />
        </svg>
      </span>
      <span className="ui-empty-title">
        {title}
        {/* Hand-drawn squiggle underline, part of the title's hand voice. */}
        <svg className="ui-empty-squiggle" viewBox="0 0 120 8" preserveAspectRatio="none" aria-hidden="true">
          <path d="M2 5.5 C14 2.5 24 6.8 36 4.6 C50 2.2 60 6.6 74 4.4 C88 2.4 100 6.4 118 3.6" />
        </svg>
      </span>
      <span className="ui-empty-message">{message}</span>
      {action !== undefined ? <span className="ui-empty-action">{action}</span> : null}
    </div>
  )
}
