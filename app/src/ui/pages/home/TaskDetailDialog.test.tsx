// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'

import type { ContextDefinition, Task } from '../../../shared/home'
import { renderPortalMarkup } from '../../testing/renderPortalMarkup'
import { TaskDetailDialog } from './TaskDetailDialog'

const CONTEXTS: readonly ContextDefinition[] = [
  { name: 'Personal', color: 'success', icon: 'house' }
]

const TASK: Task = {
  id: 'task-one',
  title: 'Editable task title',
  context: 'Personal',
  estimateMinutes: 60,
  priority: 'High',
  status: 'Not started',
  due: '2026-08-22',
  tags: [],
  recurrence: null
}

describe('centered task detail', () => {
  it('renders exactly one directly editable, initially focused title field', async () => {
    const markup = await renderPortalMarkup(
      <TaskDetailDialog
        task={TASK}
        open
        contexts={CONTEXTS}
        dueAttention={false}
        onClose={() => undefined}
        onUpdate={async () => undefined}
        onAddContext={async (context) => context}
        onUpdateContext={async (_originalName, context) => ({ context, tasks: [TASK] })}
        onDeleteContext={async () => undefined}
        onDuplicate={async () => undefined}
        onDelete={async () => undefined}
      />
    )

    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-label="Task details for Editable task title"')
    expect(markup.match(/aria-label="Task title"/g)).toHaveLength(1)
    expect(markup).toContain('peek-duplicate')
    expect(markup).toContain('data-testid="task-detail-dialog"')
    expect(markup).toContain('data-testid="task-recurrence-trigger"')
    expect(markup).not.toContain('data-testid="task-recurrence-panel"')
    // Save is the primary action, disabled until something changes; the
    // card's checkbox owns completion.
    expect(markup).toContain('Save changes')
    expect(markup).toContain('disabled=""')
    expect(markup).not.toContain('Mark complete')
    expect(markup).not.toContain('ui-sidepeek')
    expect(markup).not.toContain('Time blocks')
  })
})
