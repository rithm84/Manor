import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { ContextDefinition, Task } from '../../../../shared/home'
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
  it('renders exactly one directly editable, initially focused title field', () => {
    const markup = renderToStaticMarkup(
      <TaskDetailDialog
        task={TASK}
        open
        contexts={CONTEXTS}
        dueAttention={false}
        onClose={() => undefined}
        onUpdate={async () => undefined}
        onAddContext={async (context) => context}
        onComplete={async () => undefined}
        onDuplicate={async () => undefined}
        onDelete={async () => undefined}
      />
    )

    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-label="Task details for Editable task title"')
    expect(markup.match(/aria-label="Task title"/g)).toHaveLength(1)
    expect(markup).toContain('autofocus=""')
    expect(markup).toContain('peek-duplicate')
    expect(markup).not.toContain('ui-sidepeek')
    expect(markup).not.toContain('Time blocks')
  })
})
