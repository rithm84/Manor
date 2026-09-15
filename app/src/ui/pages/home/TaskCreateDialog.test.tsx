// @vitest-environment happy-dom
import { act, useState } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'

import type { ContextDefinition, ContextDraft } from '../../../shared/home'
import { renderPortalMarkup } from '../../testing/renderPortalMarkup'
import { TaskCreateDialog } from './TaskCreateDialog'
import type { DraftTask } from './taskModel'

const props = {
  today: '2026-08-22',
  contexts: [
    { name: 'Personal', color: 'success', icon: 'house' },
    { name: 'Uni', color: 'info', icon: 'book-open' }
  ] as const,
  onAddContext: async (context: ContextDraft) => context,
  onUpdateContext: async (_originalName: string, context: ContextDraft) => context,
  onCreate: async (): Promise<void> => undefined,
  onDeleteContext: async (): Promise<void> => undefined,
  onClose: (): void => undefined
} as const

describe('task creation dialog', () => {
  it.each(['deleted', 'refused'] as const)('preserves the unfinished task when last-context removal is %s', async (outcome) => {
    function Composer(): ReactNode {
      const [contexts, setContexts] = useState<readonly ContextDefinition[]>(props.contexts.slice(0, 1))
      return <TaskCreateDialog {...props} contexts={contexts} bucket="today" onDeleteContext={async (name) => {
        if (outcome === 'refused') throw new Error('Context is still used by a task')
        setContexts((current) => current.filter((context) => context.name !== name))
      }} />
    }
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(<Composer />))
      const title = document.body.querySelector<HTMLInputElement>('[aria-label="Task title"]')
      const trigger = document.body.querySelector<HTMLButtonElement>('[data-testid="context-select-trigger"]')
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      if (title === null || trigger === null || setValue === undefined) throw new Error('Composer controls unavailable')
      await act(async () => {
        setValue.call(title, 'Keep this unfinished task')
        title.dispatchEvent(new Event('input', { bubbles: true }))
        trigger.click()
      })
      const option = document.body.querySelector<HTMLButtonElement>('.context-option:has(.is-success)')
      if (option === null) throw new Error('Personal context option unavailable')
      await act(async () => option.click())
      await act(async () => trigger.click())
      const remove = document.body.querySelector<HTMLButtonElement>('[aria-label="Delete context Personal"]')
      if (remove === null) throw new Error('Personal context removal unavailable')
      await act(async () => remove.click())
      expect(title.value).toBe('Keep this unfinished task')
      expect(trigger.getAttribute('aria-label')).toBe(outcome === 'deleted' ? 'Context, required' : 'Context, required: Personal')
      expect(document.body.querySelector('[aria-label="Delete context Personal"]') === null).toBe(outcome === 'deleted')
      expect(document.body.querySelector<HTMLButtonElement>('[data-testid="task-create-dialog"] button[type="submit"]')?.disabled).toBe(outcome === 'deleted')
      if (outcome === 'refused') expect(document.body.querySelector('.context-error')?.textContent).toBe('Context is still used by a task')
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  it('creates the task on Enter after a picker hands focus back to the dialog panel', async () => {
    const created: DraftTask[] = []
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(
        <TaskCreateDialog {...props} bucket="today" onCreate={async (_bucket, draft) => { created.push(draft) }} />
      ))
      const title = document.body.querySelector<HTMLInputElement>('[aria-label="Task title"]')
      const trigger = document.body.querySelector<HTMLButtonElement>('[data-testid="context-select-trigger"]')
      const panel = document.body.querySelector<HTMLElement>('[aria-modal="true"]')
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      if (title === null || trigger === null || panel === null || setValue === undefined) throw new Error('Composer controls unavailable')
      await act(async () => {
        setValue.call(title, 'Apply to the Intuit internship')
        title.dispatchEvent(new Event('input', { bubbles: true }))
        trigger.click()
      })
      const option = document.body.querySelector<HTMLButtonElement>('.context-option:has(.is-success)')
      if (option === null) throw new Error('Personal context option unavailable')
      await act(async () => option.click())

      // Enter while a picker is still open stays with the picker.
      await act(async () => trigger.click())
      expect(panel.querySelector('[aria-expanded="true"]')).not.toBeNull()
      await act(async () => { panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })) })
      expect(created).toHaveLength(0)
      await act(async () => { document.body.querySelector<HTMLButtonElement>('.context-option:has(.is-success)')?.click() })

      // Focus back on the panel itself: Enter creates.
      await act(async () => { panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })) })
      expect(created).toHaveLength(1)
      expect(created[0]).toMatchObject({ title: 'Apply to the Intuit internship', context: 'Personal' })

      // Focus back on the closed picker trigger, where the picker would otherwise reopen: Enter creates.
      expect(trigger.getAttribute('aria-expanded')).not.toBe('true')
      const onTrigger = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
      await act(async () => { trigger.dispatchEvent(onTrigger) })
      expect(onTrigger.defaultPrevented).toBe(true)
      expect(created).toHaveLength(2)
      expect(document.body.querySelector('.context-option')).toBeNull()

      // Enter on the priority select trigger behaves the same way.
      const priority = document.body.querySelector<HTMLButtonElement>('[aria-label="Priority"]')
      if (priority === null) throw new Error('Priority trigger unavailable')
      await act(async () => { priority.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })) })
      expect(created).toHaveLength(3)

      // Enter on a button inside the form is that button's own activation, not a submit.
      const recurrence = document.body.querySelector<HTMLButtonElement>('[data-testid="task-create-recurrence-trigger"]')
      if (recurrence === null) throw new Error('Recurrence trigger unavailable')
      await act(async () => { recurrence.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })) })
      expect(created).toHaveLength(3)
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  it('exposes a compact modal composer with required unset Context', async () => {
    const markup = await renderPortalMarkup(<TaskCreateDialog {...props} bucket="today" />)

    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-label="Task title"')
    expect(markup).toContain('aria-label="Context, required"')
    expect(markup).toContain('Choose or add Context')
    expect(markup).toContain('data-testid="task-create-dialog"')
    expect(markup).toContain('aria-label="Close new task"')
    expect(markup).toContain('data-testid="task-create-recurrence-trigger"')
    expect(markup).toContain("Doesn't repeat")
    expect(markup).not.toContain('data-testid="task-create-recurrence-panel"')
    expect(markup).not.toContain('task-create-eyebrow')
  })

  it('submits the selected recurrence in the initial create command', async () => {
    const created: DraftTask[] = []
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(
        <TaskCreateDialog
          {...props}
          bucket="today"
          onCreate={async (_bucket, draft) => { created.push(draft) }}
        />
      ))

      const title = document.body.querySelector<HTMLInputElement>('[aria-label="Task title"]')
      const contextTrigger = document.body.querySelector<HTMLButtonElement>('[data-testid="context-select-trigger"]')
      const recurrenceTrigger = document.body.querySelector<HTMLButtonElement>('[data-testid="task-create-recurrence-trigger"]')
      if (title === null || contextTrigger === null || recurrenceTrigger === null) {
        throw new Error('Task creation controls did not render')
      }
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      if (setValue === undefined) throw new Error('HTMLInputElement value setter was unavailable')
      await act(async () => {
        setValue.call(title, 'Recurring task')
        title.dispatchEvent(new Event('input', { bubbles: true }))
        contextTrigger.click()
      })
      const contextOption = document.body.querySelector<HTMLElement>('[role="option"]')
      if (contextOption === null) throw new Error('Context option did not render')
      await act(async () => contextOption.click())
      await act(async () => recurrenceTrigger.click())

      const panel = document.body.querySelector<HTMLElement>('[data-testid="task-create-recurrence-panel"]')
      const weekly = Array.from(panel?.querySelectorAll<HTMLButtonElement>('button') ?? [])
        .find((button) => button.textContent === 'Every week')
      if (weekly === undefined) throw new Error('Every week recurrence did not render')
      await act(async () => weekly.click())

      const form = document.body.querySelector<HTMLFormElement>('[data-testid="task-create-dialog"]')
      if (form === null) throw new Error('Task creation form did not render')
      await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))

      expect(created).toHaveLength(1)
      expect(created[0].recurrence).toBe('FREQ=WEEKLY;INTERVAL=1')
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  it('seeds the due picker from the bucket but keeps it editable', async () => {
    const markup = await renderPortalMarkup(<TaskCreateDialog {...props} bucket="today" />)

    expect(markup).toContain('aria-label="Due date: Sat, Aug 22"')
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).not.toContain('task-create-locked-date')
  })

  it('starts This Week with an unset due date the user must pick', async () => {
    const markup = await renderPortalMarkup(<TaskCreateDialog {...props} bucket="week" />)

    expect(markup).toContain('aria-label="New task for This Week"')
    expect(markup).toContain('aria-label="Due date"')
    expect(markup).toContain('datepicker-empty')
    expect(markup).toContain('disabled=""')
    expect(markup).toContain('Choose an exact date in the next seven days.')
  })
})
