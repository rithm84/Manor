import type { ReactNode } from 'react'

export interface KbdProps {
  /** e.g. ['⌥', 'M'] or ['⌘', 'K'] */
  keys: readonly string[]
}

export function Kbd({ keys }: KbdProps): ReactNode {
  return (
    <span className="ui-kbd-group" aria-hidden="true">
      {keys.map((key) => (
        <kbd key={key} className="ui-kbd">
          {key}
        </kbd>
      ))}
    </span>
  )
}
