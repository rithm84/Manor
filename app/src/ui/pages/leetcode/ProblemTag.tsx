import { useState } from 'react'
import type { ReactNode } from 'react'
import { Pill } from '../../components/ui'
import type { PillColorway } from '../../components/ui/Pill'
import { problemTopicCategory } from '../../../shared/problemTopics'
import { companyWordmarks } from './companyWordmarks'
import { tagFacet, tagFacets } from './problemTestcases'
import type { TagFacet } from './problemTestcases'
import { fittingChipCount } from './problemTableColumns'
import { chipGap, chipWidth, counterWidth } from './problemChipWidths'

export type ProblemTagCategory = 'topics' | 'companies' | 'tags' | 'collections'

const topicColors: readonly PillColorway[] = ['info', 'tomorrow', 'plum', 'forest', 'gold']
const facetColors: Readonly<Record<TagFacet, PillColorway>> = { Round: 'plum', Role: 'info', Technology: 'forest', Employment: 'gold', Other: 'neutral' }

/** Topics take their category's color, so patterns of one category read as a family; other properties keep one recognizable color family. */
function tagColor(category: Exclude<ProblemTagCategory, 'companies'>, label: string): PillColorway {
  if (category === 'collections') return 'plum'
  if (category === 'tags') return facetColors[tagFacet(label).facet]
  const family = problemTopicCategory(label) ?? label
  const hash = [...family.trim().toLocaleLowerCase()].reduce((value, character) => (value * 31 + character.charCodeAt(0)) >>> 0, 0)
  return topicColors[hash % topicColors.length]
}

export function ProblemTag({ category, label }: { category: ProblemTagCategory; label: string }): ReactNode {
  if (category === 'companies') {
    const wordmark = companyWordmarks[label.trim().toLowerCase()]
    if (wordmark === undefined) return <span className="problem-company-tag problem-company-tag--text" title={label} data-testid="problem-company-tag" data-company={label}><span>{label}</span></span>
    return <span className={`problem-company-tag problem-company-tag--wordmark${wordmark.dark === null ? ' needs-light-surface' : ' has-dark-wordmark'}`} role="img" aria-label={label} title={label} data-testid="problem-company-tag" data-company={label}>
      <img className="problem-company-wordmark-light" src={`/brand/company-wordmarks/${wordmark.light}`} width={wordmark.width} height={18} alt="" aria-hidden="true" loading="lazy" draggable={false} />
      {wordmark.dark === null ? null : <img className="problem-company-wordmark-dark" src={`/brand/company-wordmarks/${wordmark.dark}`} width={wordmark.width} height={18} alt="" aria-hidden="true" loading="lazy" draggable={false} />}
    </span>
  }
  if (category === 'tags') return <span className="problem-tag" title={label}><Pill variant="tag" colorway={tagColor(category, label)} label={tagFacet(label).label} /></span>
  return <span className="problem-tag" title={label}><Pill variant="tag" colorway={tagColor(category, label)} label={label} /></span>
}

export function ProblemTagList({ category, labels: given, limit }: { category: ProblemTagCategory; labels: readonly string[]; limit: number }): ReactNode {
  const [expanded, setExpanded] = useState(false)
  const labels = category === 'tags' ? tagFacets(given).flatMap(group => group.values.map(value => value.tag)) : given
  return <span className="problem-table-labels">{(expanded ? labels : labels.slice(0, limit)).map(label => <ProblemTag key={label} category={category} label={label} />)}{labels.length <= limit ? null : <button type="button" className="problem-tags-expand" aria-expanded={expanded} aria-label={expanded ? `Show fewer ${category}` : `Show ${labels.length - limit} more ${category}`} onClick={() => setExpanded(value => !value)}>{expanded ? 'Less' : `+${labels.length - limit}`}</button>}</span>
}

/**
 * A one-line row of whole chips for a table cell: as many as fit in `available` pixels, then "+N" for the rest, which
 * expands the row in place. Widths come from cached text metrics, so fitting never reads layout. Only when not even
 * the first chip fits does it shrink, ending in an ellipsis with its full name in the title.
 */
export function ProblemTagRow({ category, labels: given, available }: { category: ProblemTagCategory; labels: readonly string[]; available: number }): ReactNode {
  const [expanded, setExpanded] = useState(false)
  const labels = category === 'tags' ? tagFacets(given).flatMap(group => group.values.map(value => value.tag)) : given
  const whole = fittingChipCount(labels.map(label => chipWidth(category, label)), chipGap, counterWidth(labels.length), available)
  const truncated = !expanded && whole === 0 && labels.length > 0
  const count = expanded ? labels.length : truncated ? 1 : whole
  const hidden = labels.length - count
  const firstMax = truncated ? available - (hidden > 0 ? chipGap + counterWidth(hidden) : 0) : undefined
  return <span className={`problem-table-labels problem-tag-row${expanded ? ' is-expanded' : ''}`}>
    {labels.slice(0, count).map((label, index) => <span key={label} className={`problem-tag-chip${truncated && index === 0 ? ' is-truncated' : ''}`} style={truncated && index === 0 ? { maxWidth: firstMax } : undefined}><ProblemTag category={category} label={label} /></span>)}
    {expanded ? <button type="button" className="problem-tags-expand" aria-expanded={true} aria-label={`Show fewer ${category}`} onClick={() => setExpanded(false)}>Less</button>
      : hidden === 0 ? null : <button type="button" className="problem-tags-expand" aria-expanded={false} aria-label={`Show ${hidden} more ${category}: ${labels.slice(count).join(', ')}`} title={labels.slice(count).join(', ')} onClick={() => setExpanded(true)}>+{hidden}</button>}
  </span>
}
