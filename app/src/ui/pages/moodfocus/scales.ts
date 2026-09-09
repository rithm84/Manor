import {
  Angry,
  BatteryLow,
  CircleOff,
  Crosshair,
  Frown,
  Gauge,
  Laugh,
  Meh,
  Moon,
  Smile,
  Zap
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { FOCUS_SCALE, MOOD_SCALE } from '../../../shared/moodFocus'
import type { Focus, Mood } from '../../../shared/moodFocus'
import { focusLevel, moodLevel } from './moodFocusModel'
import { focusTone, moodTone } from './scaleTones'
import type { ScaleTone } from './scaleTones'

export interface ScaleOption<T extends string> {
  value: T
  icon: LucideIcon
  level: number
  tone: ScaleTone
}

const MOOD_ICONS: Record<Mood, LucideIcon> = {
  Great: Laugh,
  Good: Smile,
  Neutral: Meh,
  Bad: Frown,
  Awful: Angry
}

const FOCUS_ICONS: Record<Focus, LucideIcon> = {
  'Locked In': Crosshair,
  High: Zap,
  Medium: Gauge,
  Low: BatteryLow,
  'Locked Out': CircleOff,
  Resting: Moon
}

export const moodOptions: readonly ScaleOption<Mood>[] = MOOD_SCALE.map((mood) => ({
  value: mood,
  icon: MOOD_ICONS[mood],
  level: moodLevel(mood),
  tone: moodTone(mood)
}))

export const focusOptions: readonly ScaleOption<Focus>[] = FOCUS_SCALE.map((focus) => ({
  value: focus,
  icon: FOCUS_ICONS[focus],
  level: focusLevel(focus),
  tone: focusTone(focus)
}))
