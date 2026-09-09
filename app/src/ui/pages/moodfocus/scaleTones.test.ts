/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { FOCUS_SCALE, MOOD_SCALE } from '../../../shared/moodFocus'
import { FOCUS_TONES, MOOD_TONES } from './scaleTones'

const tokensCss = readFileSync(
  fileURLToPath(new URL('../../styles/tokens.css', import.meta.url)),
  'utf8'
)

function resolveToken(reference: string): string {
  const name = reference.match(/^var\((--[a-z-]+)\)$/)?.[1]
  if (name === undefined) {
    throw new Error(`Not a var() token reference: ${reference}`)
  }
  const value = tokensCss.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6});`))?.[1]
  if (value === undefined) {
    throw new Error(`Token ${name} is not defined as an opaque hex color in tokens.css`)
  }
  return value
}

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255)
  const linear = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  )
  const red = linear[0]
  const green = linear[1]
  const blue = linear[2]
  if (red === undefined || green === undefined || blue === undefined) {
    throw new Error(`Could not calculate luminance for ${hex}`)
  }
  return red * 0.2126 + green * 0.7152 + blue * 0.0722
}

function contrastRatio(first: string, second: string): number {
  const brighter = Math.max(relativeLuminance(first), relativeLuminance(second))
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second))
  return (brighter + 0.05) / (darker + 0.05)
}

function expectCompleteDistinctMapping<T extends string>(
  levels: readonly T[],
  tones: Readonly<Record<T, { strong: string; tint: string }>>
): void {
  const mappedTones = levels.map((level) => tones[level])
  expect(Object.keys(tones).sort()).toEqual([...levels].sort())
  expect(new Set(mappedTones.map((tone) => tone.strong)).size).toBe(levels.length)
  expect(new Set(mappedTones.map((tone) => tone.tint)).size).toBe(levels.length)
  mappedTones.forEach((tone) => {
    expect(tone.strong).toMatch(/^var\(--scale-[a-z]+\)$/)
    expect(tone.tint).toMatch(/^var\(--scale-[a-z]+-tint\)$/)
    expect(resolveToken(tone.strong)).toMatch(/^#[0-9a-fA-F]{6}$/)
    expect(resolveToken(tone.tint)).toMatch(/^#[0-9a-fA-F]{6}$/)
  })
}

describe('mood and focus scale tones', () => {
  it('assigns every mood level one distinct opaque tone pair', () => {
    expectCompleteDistinctMapping(MOOD_SCALE, MOOD_TONES)
  })

  it('assigns every focus level one distinct opaque tone pair', () => {
    expectCompleteDistinctMapping(FOCUS_SCALE, FOCUS_TONES)
  })

  it('keeps the two signal palettes distinct', () => {
    const moodColors = new Set(Object.values(MOOD_TONES).flatMap((tone) => [tone.strong, tone.tint]))
    Object.values(FOCUS_TONES).forEach((tone) => {
      expect(moodColors.has(tone.strong)).toBe(false)
      expect(moodColors.has(tone.tint)).toBe(false)
    })
  })

  it('keeps white icon labels readable on every strong tone', () => {
    const strongTones = [
      ...Object.values(MOOD_TONES).map((tone) => resolveToken(tone.strong)),
      ...Object.values(FOCUS_TONES).map((tone) => resolveToken(tone.strong))
    ]
    strongTones.forEach((tone) => {
      expect(contrastRatio(tone, '#FFFFFF')).toBeGreaterThanOrEqual(4.5)
    })
  })
})
