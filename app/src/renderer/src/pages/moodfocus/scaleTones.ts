import type { Focus, Mood } from '../../../../shared/moodFocus'

export interface ScaleTone {
  strong: string
  tint: string
}

export const MOOD_TONES: Readonly<Record<Mood, ScaleTone>> = {
  Awful: { strong: 'var(--scale-awful)', tint: 'var(--scale-awful-tint)' },
  Bad: { strong: 'var(--scale-bad)', tint: 'var(--scale-bad-tint)' },
  Neutral: { strong: 'var(--scale-neutral)', tint: 'var(--scale-neutral-tint)' },
  Good: { strong: 'var(--scale-good)', tint: 'var(--scale-good-tint)' },
  Great: { strong: 'var(--scale-great)', tint: 'var(--scale-great-tint)' }
}

export const FOCUS_TONES: Readonly<Record<Focus, ScaleTone>> = {
  'Locked Out': { strong: 'var(--scale-lockedout)', tint: 'var(--scale-lockedout-tint)' },
  Low: { strong: 'var(--scale-low)', tint: 'var(--scale-low-tint)' },
  Medium: { strong: 'var(--scale-medium)', tint: 'var(--scale-medium-tint)' },
  High: { strong: 'var(--scale-high)', tint: 'var(--scale-high-tint)' },
  'Locked In': { strong: 'var(--scale-lockedin)', tint: 'var(--scale-lockedin-tint)' },
  Resting: { strong: 'var(--scale-resting)', tint: 'var(--scale-resting-tint)' }
}

export function moodTone(mood: Mood): ScaleTone {
  return MOOD_TONES[mood]
}

export function focusTone(focus: Focus): ScaleTone {
  return FOCUS_TONES[focus]
}

export function moodToneAtAverage(value: number): ScaleTone {
  const levels: readonly Mood[] = ['Awful', 'Bad', 'Neutral', 'Good', 'Great']
  return MOOD_TONES[levels[Math.max(1, Math.min(5, Math.round(value))) - 1] ?? 'Neutral']
}

export function focusToneAtAverage(value: number): ScaleTone {
  const levels: readonly Focus[] = ['Locked Out', 'Low', 'Medium', 'High', 'Locked In']
  return FOCUS_TONES[levels[Math.max(1, Math.min(5, Math.round(value))) - 1] ?? 'Medium']
}
