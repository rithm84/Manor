import type { CSSProperties, ReactNode } from 'react'

export interface CardProps {
  children: ReactNode
  /** Warm cards use the deeper cream surface. */
  tone: 'white' | 'warm'
  /** Interactive cards get hover elevation and press feedback. */
  interactive: boolean
  onClick?: () => void
  className?: string
  style?: CSSProperties
}

export function Card({ children, tone, interactive, onClick, className, style }: CardProps): ReactNode {
  const classes = [
    'ui-card',
    tone === 'warm' ? 'ui-card--warm' : '',
    interactive ? 'ui-card--interactive' : '',
    className ?? ''
  ]
    .filter((c) => c !== '')
    .join(' ')

  if (interactive) {
    return (
      <div className={classes} style={style} onClick={onClick} role="button" tabIndex={0}>
        {children}
      </div>
    )
  }
  return (
    <div className={classes} style={style}>
      {children}
    </div>
  )
}
