import type { ReactNode } from 'react'

import { DetailDialog } from '../../components/ui'
import { HabitDetailCard } from './HabitDetailCard'
import type { HabitDetailCardProps } from './HabitDetailCard'

export interface HabitDetailDialogProps extends HabitDetailCardProps {
  open: boolean
  onClose: () => void
}

export function HabitDetailDialog({
  open,
  onClose,
  state,
  habit,
  month,
  onMonthChange,
  onEdit,
  onPause,
  onResume,
  onRetire
}: HabitDetailDialogProps): ReactNode {
  return (
    <DetailDialog
      open={open}
      onClose={onClose}
      title="Habit details"
      width={560}
      ariaLabel={`Habit details for ${habit.definition.name}`}
    >
      <HabitDetailCard
        state={state}
        habit={habit}
        month={month}
        onMonthChange={onMonthChange}
        onEdit={onEdit}
        onPause={onPause}
        onResume={onResume}
        onRetire={onRetire}
      />
    </DetailDialog>
  )
}
