import type { MoodFocusSeed } from '../../../shared/moodFocus'
import { moodFocusHistory, TODAY_ISO } from '../../data/mock'

export function createMoodFocusSeed(): MoodFocusSeed {
  return {
    today: TODAY_ISO,
    entries: moodFocusHistory
  }
}
