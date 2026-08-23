import type { Focus, Mood } from '../../../../shared/moodFocus'

export interface ScaleTone {
  strong: string
  tint: string
}

export const MOOD_TONES: Readonly<Record<Mood, ScaleTone>> = {
  Awful: { strong: '#9C3D4A', tint: '#F7E3E6' },
  Bad: { strong: '#9A5538', tint: '#F6E8DF' },
  Neutral: { strong: '#6F655B', tint: '#EEEAE5' },
  Good: { strong: '#5E7035', tint: '#EAF0DF' },
  Great: { strong: '#2F684A', tint: '#E3EEE7' }
}

export const FOCUS_TONES: Readonly<Record<Focus, ScaleTone>> = {
  'Locked Out': { strong: '#765681', tint: '#EEE7F1' },
  Low: { strong: '#5E6092', tint: '#E9E9F3' },
  Medium: { strong: '#4E6E91', tint: '#E5ECF3' },
  High: { strong: '#39728B', tint: '#E2EDF1' },
  'Locked In': { strong: '#245F70', tint: '#DEEAEE' },
  Resting: { strong: '#6C676F', tint: '#ECE9EE' }
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
