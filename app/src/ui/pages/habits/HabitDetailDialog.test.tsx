import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { monthKey } from '../../../shared/habits'
import type { HabitsState } from '../../../shared/habits'
import { HabitDetailDialog } from './HabitDetailDialog'
import { createHabitSeed } from './habitSeed'
import { habitViewModel } from './habitModel'

describe('habit detail dialog', () => {
  it('keeps streak history and lifecycle actions in a centered accessible modal', () => {
    const seed = createHabitSeed()
    const state: HabitsState = {
      today: seed.today,
      habits: seed.habits,
      lifecycle: seed.lifecycle,
      entries: seed.entries,
      intents: [],
      freezes: seed.freezes,
      grants: seed.grants,
      pools: []
    }
    const definition = state.habits[0]
    if (definition === undefined) throw new Error('Habit detail test requires a seeded habit')
    const habit = habitViewModel(state, definition, state.today)
    const markup = renderToStaticMarkup(
      <HabitDetailDialog
        open
        onClose={() => undefined}
        state={state}
        habit={habit}
        month={monthKey(state.today)}
        onMonthChange={() => undefined}
        onEdit={() => undefined}
        onPause={() => undefined}
        onResume={() => undefined}
        onRetire={() => undefined}
        />
    )

    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-modal="true"')
    expect(markup).toContain(`aria-label="Habit details for ${definition.name}"`)
    expect(markup).toContain('Current streak')
    expect(markup).toContain('Retire habit')
    expect(markup).not.toContain('<aside')
    expect(markup).not.toContain('ui-sidepeek')
  })
})
