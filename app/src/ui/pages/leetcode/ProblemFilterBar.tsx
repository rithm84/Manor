import { usePortalContainer } from '../../components/ui/PortalContainer'
import { Popover } from '@base-ui/react/popover'
import { ChevronDown, ChevronRight, Search } from 'lucide-react'
import { memo, useMemo, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { PROBLEM_STATUSES } from '../../../shared/problemLibrary'
import type { ProblemFilters, ProblemRecord } from '../../../shared/problemLibrary'
import { PROBLEM_TOPIC_CATEGORIES, problemTopicCategories } from '../../../shared/problemTopics'
import { tagFacets } from './problemTestcases'
import { statusLabels } from './ProblemViewControls'
const difficulties = ['Easy', 'Medium', 'Hard'] as const

/** An option may hold sub-options, such as a topic category over its patterns; choosing the parent selects all of them. */
interface FilterOption { readonly value: string; readonly label: string; readonly count: number; readonly tone: string | null; readonly children?: readonly FilterOption[] }
interface MenuProps {
  label: string; testId: string; selected: readonly string[]; searchable: boolean
  /** Builds the options when the menu opens, so the catalog is only counted for a menu someone is looking at. */
  options: () => readonly FilterOption[]
  onChange: (next: string[]) => void
}

function countBy(problems: readonly ProblemRecord[], values: (problem: ProblemRecord) => readonly string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const problem of problems) for (const value of values(problem)) counts.set(value, (counts.get(value) ?? 0) + 1)
  return counts
}

/** Most-used values first, so the common choices are at the top of long lists. */
function byCount(counts: ReadonlyMap<string, number>): FilterOption[] {
  return [...counts].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).map(([value, count]) => ({ value, label: value, count, tone: null }))
}

/** Topic categories in vocabulary order, each over its patterns with counts; labels outside the vocabulary follow by count. */
function topicOptionsFor(problems: readonly ProblemRecord[]): FilterOption[] {
  const patterns = countBy(problems, problem => problem.topics)
  const categories = countBy(problems, problem => problemTopicCategories(problem.topics))
  const known = new Set(PROBLEM_TOPIC_CATEGORIES.flatMap(category => category.topics.map(topic => topic.label)))
  const grouped = PROBLEM_TOPIC_CATEGORIES.filter(category => categories.has(category.category)).map(category => {
    const children = category.topics.filter(topic => patterns.has(topic.label)).map(topic => ({ value: topic.label, label: topic.label, count: patterns.get(topic.label) ?? 0, tone: null }))
    return { value: category.category, label: category.category, count: categories.get(category.category) ?? 0, tone: null, children: children.length <= 1 ? [] : children }
  })
  return [...grouped, ...byCount(new Map([...patterns].filter(([label]) => !known.has(label))))]
}

function OptionRow({ option, checked, onToggle, expanded, onExpand }: { option: FilterOption; checked: boolean; onToggle: () => void; expanded: boolean | null; onExpand: () => void }): ReactNode {
  return <div className={`problem-filter-row${expanded === null ? '' : ' has-children'}`}>
    <label className="problem-filter-option">
      <input type="checkbox" checked={checked} onChange={onToggle} />
      <span className={option.tone ?? undefined}>{option.label}</span>
      <span className="problem-filter-count tnum">{option.count.toLocaleString()}</span>
    </label>
    {expanded === null ? null : <button type="button" className="problem-filter-expand" aria-expanded={expanded} aria-label={`${expanded ? 'Hide' : 'Show'} ${option.label} patterns`} onClick={onExpand}><ChevronRight className="problem-disclosure-icon" size={14} aria-hidden="true" /></button>}
  </div>
}

function MenuOptions({ selected, searchable, options, onChange, search }: Omit<MenuProps, 'label' | 'testId'> & { search: RefObject<HTMLInputElement | null> }): ReactNode {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const all = useMemo(options, [options])
  const needle = query.trim().toLocaleLowerCase()
  const hit = (option: FilterOption): boolean => option.label.toLocaleLowerCase().includes(needle)
  const shown = needle === '' ? all : all.flatMap(option => {
    const children = (option.children ?? []).filter(hit)
    return hit(option) || children.length > 0 ? [{ ...option, children: hit(option) ? option.children : children }] : []
  })
  const toggle = (value: string): void => onChange(selected.includes(value) ? selected.filter(item => item !== value) : [...selected, value])
  const expand = (value: string): void => setOpen(current => { const next = new Set(current); if (next.has(value)) next.delete(value); else next.add(value); return next })
  return <>
    {searchable ? <label className="problem-filter-search"><Search size={14} aria-hidden="true" /><input ref={search} value={query} placeholder="Search" aria-label="Search options" onChange={event => setQuery(event.target.value)} /></label> : null}
    <div className="problem-filter-options" role="group">
      {shown.length === 0 ? <p className="problem-filter-none">No matches</p> : shown.map(option => {
        const children = option.children ?? []
        const expanded = children.length === 0 ? null : open.has(option.value) || (needle !== '' && !hit(option))
        return <div key={option.value} className="problem-filter-group">
          <OptionRow option={option} checked={selected.includes(option.value)} onToggle={() => toggle(option.value)} expanded={expanded} onExpand={() => expand(option.value)} />
          {expanded ? <div className="problem-filter-children" role="group" aria-label={`${option.label} patterns`}>{children.map(child => <OptionRow key={child.value} option={child} checked={selected.includes(child.value)} onToggle={() => toggle(child.value)} expanded={null} onExpand={() => undefined} />)}</div> : null}
        </div>
      })}
    </div>
  </>
}

/** One filter in the bar: a trigger that shows how many values are chosen, over a checklist with a Clear action. */
function FilterMenu({ label, testId, selected, searchable, options, onChange }: MenuProps): ReactNode {
  const portalContainer = usePortalContainer()
  const search = useRef<HTMLInputElement | null>(null)
  const active = selected.length > 0
  return <Popover.Root>
    <Popover.Trigger className={`problem-filter-trigger${active ? ' is-active' : ''}`} data-testid={testId} aria-label={active ? `${label}: ${selected.length} selected` : label}>
      {label}{active ? <span className="tnum"> · {selected.length}</span> : null}<ChevronDown size={14} aria-hidden="true" />
    </Popover.Trigger>
    <Popover.Portal container={portalContainer}>
      <Popover.Positioner className="ui-popover-positioner" side="bottom" align="start" sideOffset={6} collisionPadding={12}>
        <Popover.Popup className="problem-filter-popup" aria-label={label} data-testid={`${testId}-menu`} initialFocus={searchable ? search : true}>
          <MenuOptions selected={selected} searchable={searchable} options={options} onChange={onChange} search={search} />
          <footer><button type="button" className="problem-filter-clear" disabled={!active} onClick={() => onChange([])}>Clear</button></footer>
        </Popover.Popup>
      </Popover.Positioner>
    </Popover.Portal>
  </Popover.Root>
}

interface BarProps { problems: readonly ProblemRecord[]; filters: ProblemFilters; onFilters: (next: ProblemFilters) => void }

/**
 * LeetCode's filter bar: the common narrowings as dropdowns under the search. Values combine with OR inside a menu
 * and AND across menus, as every library filter does; the Advanced dialog keeps the finer controls.
 */
export const ProblemFilterBar = memo(function ProblemFilterBar({ problems, filters, onFilters }: BarProps): ReactNode {
  const rounds = useMemo(() => new Set(tagFacets([...new Set(problems.flatMap(problem => problem.tags))]).find(group => group.facet === 'Round')?.values.map(value => value.tag) ?? []), [problems])
  const chosenRounds = filters.tags.filter(tag => rounds.has(tag))
  const anyActive = filters.difficulties.length + filters.statuses.length + filters.topics.length + filters.companies.length + filters.collections.length + chosenRounds.length > 0
  const difficultyOptions = useMemo(() => () => { const counts = countBy(problems, problem => problem.difficulty === null ? [] : [problem.difficulty]); return difficulties.map(value => ({ value, label: value, count: counts.get(value) ?? 0, tone: `problem-filter-tone is-${value.toLowerCase()}` })) }, [problems])
  const statusOptions = useMemo(() => () => { const counts = countBy(problems, problem => [problem.status]); return PROBLEM_STATUSES.map(value => ({ value, label: statusLabels[value], count: counts.get(value) ?? 0, tone: null })) }, [problems])
  const topicOptions = useMemo(() => () => topicOptionsFor(problems), [problems])
  const companyOptions = useMemo(() => () => byCount(countBy(problems, problem => problem.companies)), [problems])
  const collectionOptions = useMemo(() => () => byCount(countBy(problems, problem => problem.collections)), [problems])
  const roundOptions = useMemo(() => () => { const counts = countBy(problems, problem => problem.tags.filter(tag => rounds.has(tag))); return tagFacets([...rounds]).flatMap(group => group.values.map(value => ({ value: value.tag, label: value.label, count: counts.get(value.tag) ?? 0, tone: null }))) }, [problems, rounds])
  return <div className="problem-filter-bar" role="group" aria-label="Filters" data-testid="problem-filter-bar">
    <FilterMenu label="Difficulty" testId="problem-filter-difficulty" selected={filters.difficulties} searchable={false} options={difficultyOptions} onChange={next => onFilters({ ...filters, difficulties: difficulties.filter(value => next.includes(value)) })} />
    <FilterMenu label="Status" testId="problem-filter-status" selected={filters.statuses} searchable={false} options={statusOptions} onChange={next => onFilters({ ...filters, statuses: PROBLEM_STATUSES.filter(value => next.includes(value)) })} />
    <FilterMenu label="Topics" testId="problem-filter-topics" selected={filters.topics} searchable={true} options={topicOptions} onChange={topics => onFilters({ ...filters, topics })} />
    <FilterMenu label="Companies" testId="problem-filter-companies" selected={filters.companies} searchable={true} options={companyOptions} onChange={companies => onFilters({ ...filters, companies })} />
    <FilterMenu label="Collections" testId="problem-filter-collections" selected={filters.collections} searchable={true} options={collectionOptions} onChange={collections => onFilters({ ...filters, collections })} />
    {rounds.size === 0 ? null : <FilterMenu label="Round" testId="problem-filter-round" selected={chosenRounds} searchable={false} options={roundOptions} onChange={next => onFilters({ ...filters, tags: [...filters.tags.filter(tag => !rounds.has(tag)), ...next] })} />}
    {anyActive ? <button type="button" className="problem-filter-reset" data-testid="problem-filter-reset" onClick={() => onFilters({ ...filters, difficulties: [], statuses: [], topics: [], companies: [], collections: [], tags: filters.tags.filter(tag => !rounds.has(tag)) })}>Clear all</button> : null}
  </div>
})
