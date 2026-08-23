import type { ReactNode } from 'react'

const manorLogoUrl = new URL('../../../../resources/icon.svg', import.meta.url).href

export interface BrandMarkProps {
  className: string
}

export function BrandMark({ className }: BrandMarkProps): ReactNode {
  return (
    <img
      className={className}
      src={manorLogoUrl}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  )
}
