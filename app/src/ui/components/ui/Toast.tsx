import { X } from 'lucide-react'
import { useEffect } from 'react'
import type { ReactNode } from 'react'

export interface ToastProps {
  message: string
  /** Optional reversal, for actions that are recoverable within the toast's lifetime. */
  action: { label: string; onSelect: () => void } | null
  onDismiss: () => void
  /** Milliseconds before the toast dismisses itself. */
  duration: number
}

/** Transient feedback at the bottom of the viewport. One toast at a time; a new one replaces the previous. */
export function Toast({ message, action, onDismiss, duration }: ToastProps): ReactNode {
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, duration)
    return (): void => window.clearTimeout(timer)
  }, [duration, message, onDismiss])
  return (
    <div className="ui-toast" role="status">
      <span className="ui-toast-message">{message}</span>
      {action !== null ? <button type="button" className="ui-toast-action" onClick={action.onSelect}>{action.label}</button> : null}
      <button type="button" className="ui-toast-close" aria-label="Dismiss" onClick={onDismiss}><X size={14} /></button>
    </div>
  )
}
