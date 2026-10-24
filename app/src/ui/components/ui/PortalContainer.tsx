import { createContext, useContext } from 'react'

/** Module overlays share their page's visibility while escaping its scroll clipping. */
export const PortalContainerContext = createContext<HTMLElement | undefined>(undefined)

export function usePortalContainer(): HTMLElement | undefined {
  return useContext(PortalContainerContext)
}
