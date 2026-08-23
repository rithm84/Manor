import type { MouseEvent, ReactNode } from 'react'

export type ButtonVariant = 'primary' | 'ghost' | 'subtle'

export interface ButtonProps {
  variant: ButtonVariant
  children: ReactNode
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void
  disabled?: boolean
  /** Leading icon (16px lucide). */
  icon?: ReactNode
  title?: string
  ariaLabel?: string
}

export function Button({
  variant,
  children,
  onClick,
  disabled,
  icon,
  title,
  ariaLabel
}: ButtonProps): ReactNode {
  return (
    <button
      type="button"
      className={`ui-button ui-button--${variant}`}
      onClick={onClick}
      disabled={disabled === true}
      title={title}
      aria-label={ariaLabel}
    >
      {icon}
      {children}
    </button>
  )
}
