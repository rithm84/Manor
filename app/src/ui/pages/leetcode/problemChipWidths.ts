import { companyWordmarks } from './companyWordmarks'
import { tagFacet } from './problemTestcases'
import type { ProblemTagCategory } from './ProblemTag'

/**
 * Chip widths for the library table, computed from text metrics and the chip recipes in ui.css and problemLibrary.css
 * instead of laid-out DOM, so fitting a page of cells never forces layout. Each distinct chip is measured once.
 */
export const chipGap = 4
/** Each table cell's horizontal padding, `--space-3` on both sides. */
export const cellPadding = 24

const pillPadding = 14 // `.ui-pill--tag`: 7px on each side
const companyChipChrome = 18 // `.problem-company-tag`: 8px padding and a 1px border on each side
const wordmarkMaxWidth = 112 // `.problem-company-tag img`
const iconMarkWidth = 22 // `.problem-company-tag--icon`: an 18px logo and a 4px gap before the name
const counterPadding = 8 // `.problem-tags-expand`: 4px on each side

let context: CanvasRenderingContext2D | null = null
let fontFamily: string | null = null
const widths = new Map<string, number>()

function measureText(text: string, weight: number, size: number): number {
  if (context === null) {
    context = document.createElement('canvas').getContext('2d')
    if (context === null) throw new Error('Canvas text measurement is unavailable, so table chips cannot be fitted.')
    fontFamily = getComputedStyle(document.documentElement).getPropertyValue('--font-ui').trim()
    if (fontFamily === '') throw new Error('The --font-ui token is missing, so table chips cannot be measured.')
  }
  const font = `${weight} ${size}px ${fontFamily}`
  context.font = font
  const width = Math.ceil(context.measureText(text).width) + 1
  return width
}

/** Caches a width only once the interface font has loaded, so a fallback font's metrics never stick. */
function cached(key: string, weight: number, size: number, compute: () => number): number {
  const known = widths.get(key)
  if (known !== undefined) return known
  const width = compute()
  if (fontFamily !== null && document.fonts.check(`${weight} ${size}px ${fontFamily}`)) widths.set(key, width)
  return width
}

export function chipWidth(category: ProblemTagCategory, label: string): number {
  if (category === 'companies') {
    const wordmark = companyWordmarks[label.trim().toLowerCase()]
    if (wordmark?.mark === 'icon') return cached(`company-icon\u0000${label}`, 600, 13, () => iconMarkWidth + measureText(label, 600, 13) + companyChipChrome)
    if (wordmark !== undefined) return Math.ceil(Math.min(wordmark.width, wordmarkMaxWidth)) + companyChipChrome
    return cached(`companies\u0000${label}`, 600, 13, () => measureText(label, 600, 13) + companyChipChrome)
  }
  const text = category === 'tags' ? tagFacet(label).label : label
  return cached(`pill\u0000${text}`, 500, 12, () => measureText(text, 500, 12) + pillPadding)
}

export function counterWidth(hidden: number): number {
  const text = `+${hidden}`
  return cached(`counter\u0000${text}`, 400, 12, () => measureText(text, 400, 12) + counterPadding)
}
