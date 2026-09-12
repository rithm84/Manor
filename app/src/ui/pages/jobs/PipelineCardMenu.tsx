import { Menu } from '@base-ui/react/menu'
import { ArrowRight, MoreHorizontal, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'

import type { JobStage } from '../../../shared/jobs'
import type { BoardCard } from './jobsModel'
import { jobStageOptions } from './jobsModel'

interface PipelineCardMenuProps {
  card: BoardCard
  onMove: (stage: JobStage) => void
  onRemove: () => void
}

export function PipelineCardMenu({ card, onMove, onRemove }: PipelineCardMenuProps): ReactNode {
  return (
    <div className="pipeline-card-menu" onClick={(event) => event.stopPropagation()}>
      <Menu.Root modal={false}>
        <Menu.Trigger
          className="pipeline-card-menu-btn"
          data-testid={`pipeline-options-${card.role.id}`}
          aria-label={`Options for ${card.role.company}`}
        >
          <MoreHorizontal size={14} />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner className="ui-popover-positioner" side="bottom" align="end" sideOffset={6} collisionPadding={12}>
            <Menu.Popup className="pipeline-menu" aria-label={`Actions for ${card.role.company}`}>
              <Menu.Group>
                <Menu.GroupLabel className="pipeline-menu-label">Move to</Menu.GroupLabel>
                {jobStageOptions
                  .filter((option) => option.value !== 'to_apply' && option.value !== card.role.stage)
                  .map((option) => (
                    <Menu.Item
                      key={option.value}
                      className="pipeline-menu-item"
                      data-testid={`pipeline-move-${option.value}`}
                      onClick={() => onMove(option.value)}
                    >
                      <ArrowRight size={14} />
                      {option.label}
                    </Menu.Item>
                  ))}
              </Menu.Group>
              <Menu.Item className="pipeline-menu-item pipeline-menu-item--danger" data-testid="pipeline-remove" onClick={onRemove}>
                <Trash2 size={14} />
                Remove
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </div>
  )
}
