import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { ContextDefinition, Task } from '../../../../shared/home'
import { MasterTaskTable } from './MasterTaskTable'

const CONTEXTS: readonly ContextDefinition[] = [
  { name: 'Personal', color: 'success', icon: 'house' }
]

const TASK: Task = {
  id: 'task-one',
  title: 'Read the brief',
  context: 'Personal',
  estimateMinutes: 180,
  priority: 'High',
  status: 'In Progress',
  due: '2026-08-22',
  tags: [],
  recurrence: null
}

describe('Master task property presentation', () => {
  it('renders dense colored pills for every displayed task property', () => {
    const markup = renderToStaticMarkup(
      <MasterTaskTable
        tasks={[TASK]}
        contexts={CONTEXTS}
        today="2026-08-22"
        savedViews={[]}
        onOpenTask={() => undefined}
        onQuickActions={() => undefined}
        onSaveView={async () => undefined}
        onDeleteView={async () => undefined}
      />
    )

    expect(markup).toContain('ui-pill-icon')
    expect(markup).toContain('ui-pill--tag is-success')
    expect(markup).toContain('ui-pill--tag is-today')
    expect(markup).toContain('ui-pill--tag is-plum')
    expect(markup).toContain('ui-pill--tag is-overdue')
    expect(markup).toContain('ui-pill--tag is-info')
  })

  it('offers the By context grouping toggle, off by default with a flat table', () => {
    const markup = renderToStaticMarkup(
      <MasterTaskTable
        tasks={[TASK]}
        contexts={CONTEXTS}
        today="2026-08-22"
        savedViews={[]}
        onOpenTask={() => undefined}
        onQuickActions={() => undefined}
        onSaveView={async () => undefined}
        onDeleteView={async () => undefined}
      />
    )

    expect(markup).toContain('aria-pressed="false"')
    expect(markup.match(/role="columnheader"/g)).toHaveLength(6)
    expect(markup).not.toContain('master-group-head')
    expect(markup).not.toContain('is-grouped')
  })
})
