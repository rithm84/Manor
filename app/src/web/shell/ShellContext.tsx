import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'

import type { DesktopShell } from './DesktopShell'

const ShellContext = createContext<DesktopShell | null>(null)

export function ShellProvider({ shell, children }: { shell: DesktopShell; children: ReactNode }): ReactNode {
  return <ShellContext.Provider value={shell}>{children}</ShellContext.Provider>
}

/** The window the surrounding tree runs in, for components that link or open something outside it. */
export function useShell(): DesktopShell {
  const shell = useContext(ShellContext)
  if (shell === null) throw new Error('Manor components need a ShellProvider above them')
  return shell
}
