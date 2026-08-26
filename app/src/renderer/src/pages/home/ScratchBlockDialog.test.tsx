// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { ScratchBlock, Task } from '../../../../shared/home'
import { ScratchBlockDialog } from './ScratchBlockDialog'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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
  it('keeps scheduling controls in a centered accessible modal without day or part fields', () => {
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
    expect(markup).toContain('aria-label="Block start time"')
    expect(markup).toContain('aria-label="Block duration')
    expect(markup).not.toContain('aria-label="Block date')
    expect(markup).not.toContain('aria-label="Part of task"')
    expect(markup).not.toContain('aria-label="Sticky note title"')
    expect(markup).toContain('Delete block')
    expect(markup).not.toContain('ui-sidepeek')
  })

  it('lets freestanding stickies edit their title in the dialog header', () => {
    const markup = renderToStaticMarkup(
      <ScratchBlockDialog
        block={{ ...BLOCK, taskId: null, portion: 'Walk the dog' }}
        task={null}
        open
        onClose={() => undefined}
        onUpdate={async () => undefined}
        onDelete={async () => undefined}
      />
    )

    expect(markup).toContain('aria-label="Sticky note title"')
    expect(markup).toContain('value="Walk the dog"')
    expect(markup).toContain('What is this time for?')
    expect(markup).not.toContain('aria-label="Block date')
  })

  it('ignores a cleared start time as transient editing and applies a complete one', () => {
    const updates: ScratchBlock[] = []
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() => {
      root.render(
        <ScratchBlockDialog
          block={BLOCK}
          task={TASK}
          open
          onClose={() => undefined}
          onUpdate={async (block) => {
            updates.push(block)
          }}
          onDelete={async () => undefined}
        />
      )
    })

    const input = container.querySelector<HTMLInputElement>('input[aria-label="Block start time"]')
    if (input === null) throw new Error('Block start time input did not render')
    // Bypass React's value tracker so the dispatched input event registers.
    const setValue = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(input),
      'value'
    )?.set
    if (setValue === undefined) throw new Error('HTMLInputElement value setter was unavailable')

    // Clearing the native time input fires onChange with ''; nothing persists.
    act(() => {
      setValue.call(input, '')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(updates).toHaveLength(0)

    act(() => {
      setValue.call(input, '09:30')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(updates).toHaveLength(1)
    expect(updates[0].start).toBe('09:30')
    expect(updates[0].end).toBe('10:30')

    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it('shows a dragged 75 minute duration as the selected value, not a placeholder', () => {
    const markup = renderToStaticMarkup(
      <ScratchBlockDialog
        block={{ ...BLOCK, taskId: null, end: '11:15', portion: 'Walk the dog' }}
        task={null}
        open
        onClose={() => undefined}
        onUpdate={async () => undefined}
        onDelete={async () => undefined}
      />
    )

    expect(markup).toContain('1 hr 15 min')
  })
})
