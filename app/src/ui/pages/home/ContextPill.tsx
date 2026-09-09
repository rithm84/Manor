import type { ReactNode } from 'react'

import { Pill } from '../../components/ui'
import type { ContextDefinition } from '../../../shared/home'
import { ContextGlyph } from './contextIcons'
import { contextDefinitionFor } from './taskModel'

export interface ContextPillProps {
  name: string
  contexts: readonly ContextDefinition[]
}

export function ContextPill({ name, contexts }: ContextPillProps): ReactNode {
  const context = contextDefinitionFor(name, contexts)
  return (
    <Pill
      variant="tag"
      colorway={context.color}
      label={context.name}
      icon={<ContextGlyph icon={context.icon} size={11} />}
    />
  )
}
