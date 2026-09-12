import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip'
import type { ReactNode } from 'react'

export interface TooltipProps {
  label: string
  children: ReactNode
  side: 'top' | 'bottom'
}

/** Shared delayed hints stay inside the viewport and escape clipping containers. */
export function Tooltip({ label, children, side }: TooltipProps): ReactNode {
  return <BaseTooltip.Root>
    <BaseTooltip.Trigger render={<span className="ui-tooltip-anchor" />}>
      {children}
    </BaseTooltip.Trigger>
    <BaseTooltip.Portal>
      <BaseTooltip.Positioner className="ui-tooltip-positioner" side={side} sideOffset={6} collisionPadding={12}>
        <BaseTooltip.Popup className="ui-tooltip">{label}</BaseTooltip.Popup>
      </BaseTooltip.Positioner>
    </BaseTooltip.Portal>
  </BaseTooltip.Root>
}
