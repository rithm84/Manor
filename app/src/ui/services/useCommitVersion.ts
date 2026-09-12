import { useEffect, useState } from 'react'

/** Requery committed data while keeping mounted forms and their local drafts intact. */
export function useCommitVersion(): number {
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const changed = (): void => setVersion((value) => value + 1)
    window.addEventListener('manor:committed', changed)
    return (): void => window.removeEventListener('manor:committed', changed)
  }, [])
  return version
}
