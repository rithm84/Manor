import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { ContextDraft } from '../../../../shared/home'
import { TaskCreateDialog } from './TaskCreateDialog'

const props = {
  today: '2026-08-22',
  contexts: [
    { name: 'Personal', color: 'success', icon: 'house' },
    { name: 'Uni', color: 'info', icon: 'book-open' }
  ] as const,
  onAddContext: async (context: ContextDraft) => context,
  onCreate: async (): Promise<void> => undefined,
  onClose: (): void => undefined
} as const

describe('task creation dialog', () => {
  it('exposes a focused, modal form with required unset Context', () => {
    const markup = renderToStaticMarkup(<TaskCreateDialog {...props} bucket="today" />)

    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-modal="true"')
    expect(markup).toContain('aria-label="Task title"')
    expect(markup).toContain('autofocus=""')
    expect(markup).toContain('aria-label="Context, required"')
    expect(markup).toContain('Choose or add Context')
    expect(markup).toContain('Due Saturday, August 22')
    expect(markup).toContain('Fixed for Today')
  })

  it('requires an exact constrained date for This Week', () => {
    const markup = renderToStaticMarkup(<TaskCreateDialog {...props} bucket="week" />)

    expect(markup).toContain('aria-label="New task for This Week"')
    expect(markup).toContain('Choose an exact date from Monday, August 24 to Saturday, August 29')
    expect(markup).toContain('aria-label="Exact due date for This Week task"')
    expect(markup).toContain('disabled=""')
  })
})
