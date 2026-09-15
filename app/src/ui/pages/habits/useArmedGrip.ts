import { useEffect, useState } from 'react'

/**
 * Which row's drag grip is pressed, so only that row is `draggable`. A release
 * anywhere disarms it: a press that slides off the grip must not leave the row
 * draggable from its whole surface. A real drag ends through `dragend`, which
 * the caller also routes to `disarm`.
 */
export function useArmedGrip(): [string | null, (id: string | null) => void] {
  const [armedId, setArmedId] = useState<string | null>(null)
  useEffect(() => {
    if (armedId === null) return
    const disarm = (): void => setArmedId(null)
    window.addEventListener('pointerup', disarm)
    return (): void => window.removeEventListener('pointerup', disarm)
  }, [armedId])
  return [armedId, setArmedId]
}
