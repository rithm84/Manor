import { useState } from 'react'
import type { ReactNode } from 'react'
import type { LeetCodeFreezeAction, LeetCodeFreezeMutation } from '../../../shared/leetcode'
import { FreezeCrystal, Tooltip } from '../../components/ui'

export function FreezeControl({ action, logged, onApply, onClear }: {
  action: LeetCodeFreezeAction
  logged: boolean
  onApply: (mutation: LeetCodeFreezeMutation) => Promise<void>
  onClear: (mutation: LeetCodeFreezeMutation) => Promise<void>
}): ReactNode {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const change = async (): Promise<void> => {
    if (pending) return
    setPending(true); setError(null)
    try {
      const mutation = { date: action.date, expectedRevision: action.revision }
      await (action.applied ? onClear(mutation) : onApply(mutation))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The freeze could not be updated')
    } finally { setPending(false) }
  }
  if (logged && !action.applied) return null
  const available = action.applied ? action.canClear : action.canApply
  const hint = action.applied
    ? logged ? 'Your attempt refunded this freeze. You can remove its saved selection.' : 'Remove the freeze from yesterday and return it to that month’s pool.'
    : available ? 'Cover yesterday with one freeze. Logging an attempt for that date refunds it.' : 'No freezes are available for yesterday.'
  return <div className="lc-freeze-control">
    <Tooltip label={hint} side="bottom">
      <button type="button" className={`lc-freeze-button${action.applied ? ' is-applied' : ''}`} data-testid="leetcode-freeze-toggle" aria-label={`${action.applied ? 'Undo' : 'Use'} LeetCode freeze for ${action.date}`} aria-pressed={action.applied} disabled={pending || !available} onClick={() => { void change() }}>
        <FreezeCrystal size={15} />{pending ? 'Saving…' : action.applied ? 'Undo freeze' : 'Freeze yesterday'}
      </button>
    </Tooltip>
    {error !== null ? <span className="lc-freeze-error" role="alert">{error}</span> : null}
  </div>
}
