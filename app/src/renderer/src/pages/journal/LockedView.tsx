import { Fingerprint, Lock } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from '../../components/ui'
import { journal } from '../../data/mock'

export interface LockedViewProps {
  onUnlock: () => void
}

/** Widths for the blurred suggestion of entries behind the gate. */
const ghostEntries: readonly (readonly number[])[] = [
  [92, 84, 61],
  [78, 88, 45],
  [85, 70, 90, 38],
  [66, 81, 52],
  [90, 58, 74],
  [72, 86, 49]
]

/** The journal's default face: sealed, calm, and not apologetic about it. */
export function LockedView({ onUnlock }: LockedViewProps): ReactNode {
  return (
    <div className="jlock">
      <div className="jlock-ghost" aria-hidden="true">
        {ghostEntries.map((lines, entryIndex) => (
          <div key={entryIndex} className="jlock-ghost-entry">
            <div className="jlock-ghost-date" />
            {lines.map((width, lineIndex) => (
              <div key={lineIndex} className="jlock-ghost-line" style={{ width: `${width}%` }} />
            ))}
          </div>
        ))}
      </div>
      <div className="jlock-front">
        <span className="jlock-glyph">
          <Lock size={22} />
        </span>
        <span className="jlock-heading display">Journal</span>
        <span className="jlock-entries">{journal.entryCount} entries</span>
        <p className="jlock-privacy">
          Yours alone. Never leaves this Mac unencrypted, and Alfred cannot read it.
        </p>
        <Button variant="primary" icon={<Fingerprint size={16} />} onClick={onUnlock}>
          {journal.unlockLabel}
        </Button>
      </div>
    </div>
  )
}
