import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { ScratchBlock, Task } from '../../../../shared/home'
import { ScratchBlockDialog } from './ScratchBlockDialog'

const TASK: Task = {
  id: 'task-one',
  title: 'Draft report',
  context: 'Personal',
  estimateMinutes: 60,
  priority: 'Medium',
  status: 'Not started',
  due: '2026-08-22',
  tags: [],
  recurrence: null
}

const BLOCK: ScratchBlock = {
  id: 'block-one',
  taskId: TASK.id,
  date: '2026-08-22',
  start: '10:00',
  end: '11:00',
  portion: 'outline',
  createdAt: '2026-08-22T09:00:00.000Z',
  expiresAt: '2026-08-24T11:00:00.000Z'
}

describe('scratch block detail dialog', () => {
  it('keeps every scheduling control in a centered accessible modal', () => {
    const markup = renderToStaticMarkup(
      <ScratchBlockDialog
        block={BLOCK}
        task={TASK}
        open
        onClose={() => undefined}
        onUpdate={async () => undefined}
        onDelete={async () => undefined}
      />
    )

    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-modal="true"')
    expect(markup).toContain('aria-label="Time block details for Draft report"')
    expect(markup).toContain('aria-label="Block date: Sat, Aug 22"')
    expect(markup).toContain('aria-label="Block start time"')
    expect(markup).toContain('aria-label="Part of task"')
    expect(markup).toContain('Delete block')
    expect(markup).not.toContain('ui-sidepeek')
  })
})
