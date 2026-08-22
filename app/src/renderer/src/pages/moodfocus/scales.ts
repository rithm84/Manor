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

import { FOCUS_SCALE, MOOD_SCALE } from '../../data/mock'
import type { Focus, Mood } from '../../data/mock'

export interface ScaleOption<T extends string> {
  value: T
  icon: LucideIcon
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
  icon: MOOD_ICONS[mood]
}))

export const focusOptions: readonly ScaleOption<Focus>[] = FOCUS_SCALE.map((focus) => ({
  value: focus,
  icon: FOCUS_ICONS[focus]
}))

const MOOD_LEVELS: Record<Mood, number> = {
  Great: 5,
  Good: 4,
  Neutral: 3,
  Bad: 2,
  Awful: 1
}

const FOCUS_LEVELS: Record<Focus, number> = {
  'Locked In': 5,
  High: 4,
  Medium: 3,
  Low: 2,
  'Locked Out': 1,
  Resting: 0
}

/** 1 (rough day) .. 5 (great day) on the single amber ramp. */
export function moodLevel(mood: Mood): number {
  return MOOD_LEVELS[mood]
}

/** 1 (locked out) .. 5 (locked in) on the teal ramp; 0 = resting, drawn hollow. */
export function focusLevel(focus: Focus): number {
  return FOCUS_LEVELS[focus]
}

/** "2026-08-19" -> "Aug 19". */
export function shortDate(iso: string): string {
  return `Aug ${Number.parseInt(iso.slice(8), 10)}`
}
