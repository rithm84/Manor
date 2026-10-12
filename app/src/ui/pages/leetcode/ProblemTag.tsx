import { useState } from 'react'
import type { ReactNode } from 'react'
import { Pill } from '../../components/ui'
import type { PillColorway } from '../../components/ui/Pill'
import { companyWordmarks } from './companyWordmarks'
import { tagFacet, tagFacets } from './problemTestcases'
import type { TagFacet } from './problemTestcases'

export type ProblemTagCategory = 'topics' | 'companies' | 'tags' | 'collections'

const topicColors: readonly PillColorway[] = ['info', 'tomorrow', 'plum', 'forest', 'gold']
const facetColors: Readonly<Record<TagFacet, PillColorway>> = { Round: 'plum', Role: 'info', Technology: 'forest', Employment: 'gold', Other: 'neutral' }

/** Topic colors stay stable across views; other properties keep one recognizable color family. */
function tagColor(category: Exclude<ProblemTagCategory, 'companies'>, label: string): PillColorway {
  if (category === 'collections') return 'plum'
  if (category === 'tags') return facetColors[tagFacet(label).facet]
  const hash = [...label.trim().toLocaleLowerCase()].reduce((value, character) => (value * 31 + character.charCodeAt(0)) >>> 0, 0)
  return topicColors[hash % topicColors.length]
}

export function ProblemTag({ category, label }: { category: ProblemTagCategory; label: string }): ReactNode {
  if (category === 'companies') {
    const wordmark = companyWordmarks[label.trim().toLowerCase()]
    if (wordmark === undefined) return <span className="problem-company-tag problem-company-tag--text" title={label} data-testid="problem-company-tag" data-company={label}>{label}</span>
    return <span className={`problem-company-tag problem-company-tag--wordmark${wordmark.dark === null ? ' needs-light-surface' : ' has-dark-wordmark'}`} role="img" aria-label={label} title={label} data-testid="problem-company-tag" data-company={label}>
      <img className="problem-company-wordmark-light" src={`/brand/company-wordmarks/${wordmark.light}`} width={wordmark.width} height={18} alt="" aria-hidden="true" loading="lazy" draggable={false} />
      {wordmark.dark === null ? null : <img className="problem-company-wordmark-dark" src={`/brand/company-wordmarks/${wordmark.dark}`} width={wordmark.width} height={18} alt="" aria-hidden="true" loading="lazy" draggable={false} />}
    </span>
  }
  if (category === 'tags') return <span className="problem-facet-tag" title={label}><Pill variant="tag" colorway={tagColor(category, label)} label={tagFacet(label).label} /></span>
  return <Pill variant="tag" colorway={tagColor(category, label)} label={label} />
}

export function ProblemTagList({ category, labels: given, limit }: { category: ProblemTagCategory; labels: readonly string[]; limit: number }): ReactNode {
  const [expanded, setExpanded] = useState(false)
  const labels = category === 'tags' ? tagFacets(given).flatMap(group => group.values.map(value => value.tag)) : given
  return <span className="problem-table-labels">{(expanded ? labels : labels.slice(0, limit)).map(label => <ProblemTag key={label} category={category} label={label} />)}{labels.length <= limit ? null : <button type="button" className="problem-tags-expand" aria-expanded={expanded} aria-label={expanded ? `Show fewer ${category}` : `Show ${labels.length - limit} more ${category}`} onClick={() => setExpanded(value => !value)}>{expanded ? 'Less' : `+${labels.length - limit}`}</button>}</span>
}
