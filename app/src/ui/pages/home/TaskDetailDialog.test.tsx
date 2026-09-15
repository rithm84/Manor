// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
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

  it('saves and closes on Enter from the panel or a closed picker trigger, and leaves Delete alone', async () => {
    const updates: Task[] = []
    let closed = 0
    let deleted = 0
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(
        <TaskDetailDialog
          task={TASK}
          open
          contexts={CONTEXTS}
          dueAttention={false}
          onClose={() => { closed += 1 }}
          onUpdate={async (task) => { updates.push(task) }}
          onAddContext={async (context) => context}
          onUpdateContext={async (_originalName, context) => ({ context, tasks: [TASK] })}
          onDeleteContext={async () => undefined}
          onDuplicate={async () => undefined}
          onDelete={async () => { deleted += 1 }}
        />
      ))
      const priority = document.body.querySelector<HTMLButtonElement>('[aria-label="Priority: High"]')
      const panel = document.body.querySelector<HTMLElement>('[aria-modal="true"]')
      const remove = document.body.querySelector<HTMLButtonElement>('.peek-delete')
      if (priority === null || panel === null || remove === null) throw new Error('Detail controls unavailable')

      // Pick Low, then Enter on the trigger that has focus again.
      await act(async () => priority.click())
      const low = Array.from(document.body.querySelectorAll<HTMLElement>('.ui-select-option')).find((option) => option.textContent?.includes('Low'))
      if (low === undefined) throw new Error('Low option unavailable')
      await act(async () => low.click())
      const onTrigger = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
      await act(async () => { priority.dispatchEvent(onTrigger) })
      expect(onTrigger.defaultPrevented).toBe(true)
      expect(updates.map((task) => task.priority)).toEqual(['Low'])
      expect(closed).toBe(1)

      // Enter on Delete is the button's own activation.
      const onDelete = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
      await act(async () => { remove.dispatchEvent(onDelete) })
      expect(onDelete.defaultPrevented).toBe(false)
      expect(closed).toBe(1)
      expect(deleted).toBe(0)

      // Enter on the panel itself saves and closes.
      await act(async () => { panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })) })
      expect(closed).toBe(2)
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  it('opens from the idle state without a hook-order error, as it does when a task is clicked on Home', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const errors: unknown[] = []
    const onError = (event: ErrorEvent): void => { errors.push(event.error); event.preventDefault() }
    window.addEventListener('error', onError)
    const render = (task: Task | null, open: boolean): Promise<void> => act(async () => root.render(
      <TaskDetailDialog
        task={task}
        open={open}
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
    ))
    try {
      // Home mounts the dialog with no task, then hands it the clicked task.
      await render(null, false)
      expect(document.querySelector('[data-testid="task-detail-dialog"]')).toBeNull()
      await render(TASK, true)
      expect(document.querySelector('[data-testid="task-detail-dialog"]')).not.toBeNull()
      await render(null, false)
      expect(document.querySelector('[data-testid="task-detail-dialog"]')).toBeNull()
      expect(errors).toEqual([])
    } finally {
      window.removeEventListener('error', onError)
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
