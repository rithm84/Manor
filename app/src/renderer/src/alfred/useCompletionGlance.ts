import { useEffect, useState } from 'react'

import type { AlfredCompletionGlance } from './completion'
import { buildAlfredCompletionGlance } from './completion'
import { createHomeSeed } from '../pages/home/homeSeed'
import { createHabitSeed } from '../pages/habits/habitSeed'
import { createMoodFocusSeed } from '../pages/moodfocus/moodFocusSeed'
import { LEETCODE_SEED } from '../pages/leetcode/leetCodeSeed'

export interface CompletionGlanceState {
  glance: AlfredCompletionGlance | null
  loading: boolean
  error: string | null
}

export function useCompletionGlance(active: boolean): CompletionGlanceState {
  const [state, setState] = useState<CompletionGlanceState>({
    glance: null,
    loading: false,
    error: null
  })

  useEffect(() => {
    if (!active) return
    let cancelled = false
    setState({ glance: null, loading: true, error: null })
    void Promise.all([
      window.manor.home.load(createHomeSeed()),
      window.manor.habits.load(createHabitSeed()),
      window.manor.moodFocus.load(createMoodFocusSeed()),
      window.manor.leetcode.load(LEETCODE_SEED)
    ])
      .then(([home, habits, moodFocus, leetcode]) => {
        if (!cancelled) {
          setState({
            glance: buildAlfredCompletionGlance({ home, habits, moodFocus, leetcode }),
            loading: false,
            error: null
          })
        }
      })
      .catch((error: unknown) => {
        console.error('Alfred completion glance load failed', { error })
        if (!cancelled) {
          setState({
            glance: null,
            loading: false,
            error: error instanceof Error ? error.message : 'Today could not be loaded'
          })
        }
      })
    return (): void => {
      cancelled = true
    }
  }, [active])

  return state
}
