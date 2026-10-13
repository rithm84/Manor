import { Columns3, Filter, Save, Trash2, X } from 'lucide-react'
import { memo, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { PROBLEM_COLUMNS, PROBLEM_KINDS, PROBLEM_SOURCE_TYPES, PROBLEM_STATUSES } from '../../../shared/problemLibrary'
import { PROBLEM_TOPIC_GROUPS } from '../../../shared/problemTopics'
import type { ProblemFilters, ProblemRecord, ProblemSavedView, ProblemSort } from '../../../shared/problemLibrary'
import { Button, DatePicker, Modal } from '../../components/ui'
import { errorMessage, kindLabel } from './leetCodeModel'
import { ProblemTag } from './ProblemTag'
import { tagFacets } from './problemTestcases'

export const columnLabels: Readonly<Record<typeof PROBLEM_COLUMNS[number], string>> = { difficulty: 'Difficulty', kind: 'Kind', topics: 'Topics', companies: 'Companies', tags: 'Interview', collections: 'Collections', status: 'Status', lastAsked: 'Last asked' }
export const statusLabels = { unattempted: 'Not started', attempted: 'Attempted', solved: 'Solved' } as const
interface Props { problems: readonly ProblemRecord[]; filters: ProblemFilters; sort: readonly ProblemSort[]; groupBy: ProblemSavedView['groupBy']; columns: readonly typeof PROBLEM_COLUMNS[number][]; selectedView: ProblemSavedView | null; dirty: boolean; busy: boolean; onFilters: (value: ProblemFilters) => void; onSort: (value: ProblemSort[]) => void; onGroup: (value: ProblemSavedView['groupBy']) => void; onColumns: (value: typeof PROBLEM_COLUMNS[number][]) => void; onSave: (name: string, asNew: boolean) => Promise<void>; onDelete: () => Promise<void> }
function toggle(values: readonly string[], value: string): string[] { return values.includes(value) ? values.filter(item => item !== value) : [...values, value] }
type FacetProperty = 'topics' | 'companies' | 'tags' | 'collections'
interface FacetSection { readonly key: string; readonly title: string; readonly property: FacetProperty; readonly options: readonly { readonly value: string; readonly label: string }[] }
function distinctLabels(problems: readonly ProblemRecord[], property: FacetProperty): string[] { return [...new Set(problems.flatMap(problem => problem[property]))].sort((left, right) => left.localeCompare(right)) }

/** Topics follow the taxonomy's groups, evidence tags their facets, and companies and collections stay alphabetical. */
function facetSections(problems: readonly ProblemRecord[]): FacetSection[] {
  const topics = new Set(distinctLabels(problems, 'topics'))
  const grouped = PROBLEM_TOPIC_GROUPS.map(group => ({ key: `topic-${group.group}`, title: `Topics: ${group.group.toLocaleLowerCase()}`, property: 'topics' as const, options: group.topics.filter(topic => topics.has(topic.label)).map(topic => ({ value: topic.label, label: topic.label })) }))
  const known = new Set(PROBLEM_TOPIC_GROUPS.flatMap(group => group.topics.map(topic => topic.label)))
  const otherTopics = [...topics].filter(topic => !known.has(topic)).map(topic => ({ value: topic, label: topic }))
  const tags = tagFacets(distinctLabels(problems, 'tags')).map(group => ({ key: `tag-${group.facet}`, title: group.facet === 'Other' ? 'Other tags' : group.facet, property: 'tags' as const, options: group.values.map(value => ({ value: value.tag, label: value.label })) }))
  const plain = (property: 'companies' | 'collections'): FacetSection => ({ key: property, title: columnLabels[property], property, options: distinctLabels(problems, property).map(value => ({ value, label: value })) })
  return [...tags, ...grouped, { key: 'topic-other', title: 'Other topics', property: 'topics' as const, options: otherTopics }, plain('companies'), plain('collections')].filter(section => section.options.length > 0)
}

/** The interview round is the most common narrowing, so its values sit in the toolbar as toggles. */
export const RoundFilter = memo(function RoundFilter({ problems, selected, onChange }: { problems: readonly ProblemRecord[]; selected: readonly string[]; onChange: (tags: string[]) => void }): ReactNode {
  const rounds = useMemo(() => tagFacets(distinctLabels(problems, 'tags')).find(group => group.facet === 'Round')?.values ?? [], [problems])
  if (rounds.length === 0) return null
  return <div className="problem-round-filter" role="group" aria-label="Interview round" data-testid="problem-round-filter"><span>Round</span>{rounds.map(round => <button type="button" key={round.tag} aria-pressed={selected.includes(round.tag)} className={selected.includes(round.tag) ? 'is-active' : ''} data-testid={`problem-round-${round.label}`} onClick={() => onChange(toggle(selected, round.tag))}>{round.label}</button>)}</div>
})

export function ProblemViewControls({ problems, filters, sort, groupBy, columns, selectedView, dirty, busy, onFilters, onSort, onGroup, onColumns, onSave, onDelete }: Props): ReactNode {
  const [open, setOpen] = useState(false)
  const [saveOpen, setSaveOpen] = useState(false)
  const [name, setName] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const save = async (asNew: boolean): Promise<void> => { setSaveError(null); try { await onSave(name, asNew); setSaveOpen(false) } catch (failure) { setSaveError(errorMessage(failure)) } }
  const remove = async (): Promise<void> => { setSaveError(null); try { await onDelete(); setDeleting(false); setSaveOpen(false) } catch (failure) { setSaveError(errorMessage(failure)) } }
  const count = Object.values(filters).filter(value => Array.isArray(value) ? value.length > 0 : typeof value === 'boolean').length + (filters.lastAskedSince || filters.lastAskedUntil ? 1 : 0)
  const invalidDateRange = Boolean(filters.lastAskedSince && filters.lastAskedUntil && filters.lastAskedSince > filters.lastAskedUntil)
  return <>
    <Button variant="subtle" icon={<Filter size={15} />} onClick={() => setOpen(true)} testId="problem-view-options">View options{count === 0 ? '' : ` · ${count}`}</Button>
    <Button variant="ghost" icon={<Save size={15} />} onClick={() => { setName(selectedView?.name ?? ''); setSaveOpen(true) }} disabled={busy || invalidDateRange} testId="problem-save-view">{selectedView && dirty ? 'Save changes' : 'Save view'}</Button>
    <Modal open={open} onClose={() => setOpen(false)} width={680} ariaLabel="Problem view options"><div className="problem-view-options" data-testid="problem-view-options-dialog">
      <header><h2>View options</h2><Button variant="ghost" icon={<X size={18} />} ariaLabel="Close view options" onClick={() => setOpen(false)}>{null}</Button></header>
      <div className="problem-view-options-body">
        <div className="problem-view-arrangement"><label>Sort<select data-testid="problem-sort-field" value={sort[0]?.field ?? 'name'} onChange={event => onSort([{ field: event.target.value as ProblemSort['field'], direction: sort[0]?.direction ?? 'asc' }])}>{[['name', 'Name'], ['difficulty', 'Difficulty'], ['kind', 'Kind'], ['lastAsked', 'Last asked'], ['createdAt', 'Created'], ['updatedAt', 'Updated']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Direction<select value={sort[0]?.direction ?? 'asc'} onChange={event => onSort([{ field: sort[0]?.field ?? 'name', direction: event.target.value as 'asc' | 'desc' }])}><option value="asc">Ascending</option><option value="desc">Descending</option></select></label><label>Group by<select data-testid="problem-group-by" value={groupBy ?? ''} onChange={event => onGroup(event.target.value === '' ? null : event.target.value as ProblemSavedView['groupBy'])}>{[['', 'None'], ['topic', 'Topic'], ['company', 'Company'], ['difficulty', 'Difficulty'], ['kind', 'Kind'], ['collection', 'Collection']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
        <fieldset className="problem-filter-section"><legend>Last asked</legend><div className="problem-date-filters"><div data-testid="problem-last-asked-since"><span>From</span><DatePicker value={filters.lastAskedSince ?? null} min={null} max={filters.lastAskedUntil ?? null} ariaLabel="Last asked from" onChange={lastAskedSince => onFilters({ ...filters, lastAskedSince })} /></div><div data-testid="problem-last-asked-until"><span>Through</span><DatePicker value={filters.lastAskedUntil ?? null} min={filters.lastAskedSince ?? null} max={null} ariaLabel="Last asked through" onChange={lastAskedUntil => onFilters({ ...filters, lastAskedUntil })} /></div></div><p className={invalidDateRange ? 'lc-error' : 'problem-filter-help'} role={invalidDateRange ? 'alert' : undefined}>{invalidDateRange ? 'The start date must be on or before the end date.' : 'Undated problems are excluded. Month and year reports keep their recorded precision.'}</p></fieldset>
        <fieldset className="problem-filter-section"><legend><Columns3 size={15} /> Columns</legend><div className="problem-check-options">{PROBLEM_COLUMNS.map(column => <label key={column}><input type="checkbox" checked={columns.includes(column)} disabled={columns.length === 1 && columns.includes(column)} onChange={() => onColumns(toggle(columns, column) as typeof PROBLEM_COLUMNS[number][])} />{columnLabels[column]}</label>)}</div></fieldset>
        <fieldset className="problem-filter-section"><legend>Kind</legend><div className="problem-check-options">{PROBLEM_KINDS.map(value => <label key={value}><input type="checkbox" checked={filters.kinds.includes(value)} onChange={() => onFilters({ ...filters, kinds: toggle(filters.kinds, value) as ProblemFilters['kinds'] })} />{kindLabel[value]}</label>)}</div></fieldset>
        <fieldset className="problem-filter-section"><legend>Difficulty</legend><div className="problem-check-options">{(['Easy', 'Medium', 'Hard'] as const).map(value => <label key={value}><input type="checkbox" checked={filters.difficulties.includes(value)} onChange={() => onFilters({ ...filters, difficulties: toggle(filters.difficulties, value) as ProblemFilters['difficulties'] })} />{value}</label>)}</div></fieldset>
        <fieldset className="problem-filter-section"><legend>Status</legend><div className="problem-check-options">{PROBLEM_STATUSES.map(value => <label key={value}><input type="checkbox" checked={filters.statuses.includes(value)} onChange={() => onFilters({ ...filters, statuses: toggle(filters.statuses, value) as ProblemFilters['statuses'] })} />{statusLabels[value]}</label>)}</div></fieldset>
        <fieldset className="problem-filter-section"><legend>Source</legend><div className="problem-check-options">{PROBLEM_SOURCE_TYPES.map(value => <label key={value}><input type="checkbox" checked={filters.sourceTypes.includes(value)} onChange={() => onFilters({ ...filters, sourceTypes: toggle(filters.sourceTypes, value) as ProblemFilters['sourceTypes'] })} />{value === 'stock' ? 'LeetCode catalog' : value === 'imported' ? 'Imported' : 'Custom'}</label>)}</div><label className="problem-content-filter">Content<select value={filters.hasContent === null ? '' : String(filters.hasContent)} onChange={event => onFilters({ ...filters, hasContent: event.target.value === '' ? null : event.target.value === 'true' })}><option value="">Any</option><option value="true">Content available</option><option value="false">Metadata only</option></select></label></fieldset>
        <FacetFilters problems={problems} filters={filters} onFilters={onFilters} />
      </div><footer><Button variant="ghost" onClick={() => onFilters({ search: filters.search, kinds: [], difficulties: [], topics: [], companies: [], tags: [], collections: [], sourceTypes: [], statuses: [], hasContent: null, lastAskedSince: null, lastAskedUntil: null })}>Clear filters</Button><Button variant="primary" onClick={() => setOpen(false)} disabled={invalidDateRange} testId="problem-view-options-done">Done</Button></footer>
    </div></Modal>
    <Modal open={saveOpen} onClose={() => setSaveOpen(false)} width={420} ariaLabel="Save problem view"><div className="problem-save-view"><h2>Save view</h2><label>Name<input data-testid="problem-view-name" value={name} autoFocus maxLength={120} onChange={event => setName(event.target.value)} /></label><p>Your filters, sorting, grouping, and columns are saved together.</p>{saveError === null ? null : <p className="lc-error" role="alert">{saveError}</p>}<footer>{selectedView === null ? null : <Button variant="ghost" icon={<Trash2 size={15} />} onClick={() => setDeleting(true)} disabled={busy}>Delete</Button>}<Button variant="ghost" onClick={() => setSaveOpen(false)}>Cancel</Button>{selectedView === null ? null : <Button variant="subtle" disabled={busy || name.trim() === ''} onClick={() => void save(true)}>Save as new</Button>}<Button variant="primary" disabled={busy || name.trim() === ''} testId="problem-view-save" onClick={() => void save(false)}>Save</Button></footer></div></Modal>
    <Modal open={deleting} onClose={() => setDeleting(false)} width={380} ariaLabel="Delete saved problem view"><div className="ui-confirm"><h2>Delete this view?</h2><p>The problems stay in your library.</p>{saveError === null ? null : <p className="lc-error" role="alert">{saveError}</p>}<div className="ui-confirm-actions"><Button variant="ghost" onClick={() => setDeleting(false)}>Cancel</Button><Button variant="primary" disabled={busy} onClick={() => void remove()}>Delete view</Button></div></div></Modal>
  </>
}

/** Mounted only while the dialog is open, so the library's facets are gathered when they are needed rather than on every keystroke. */
function FacetFilters({ problems, filters, onFilters }: { problems: readonly ProblemRecord[]; filters: ProblemFilters; onFilters: (value: ProblemFilters) => void }): ReactNode {
  const [search, setSearch] = useState('')
  const sections = useMemo(() => facetSections(problems), [problems])
  const query = search.trim().toLocaleLowerCase()
  const visible = sections.map(section => ({ ...section, options: query === '' ? section.options : section.options.filter(option => option.label.toLocaleLowerCase().includes(query)) })).filter(section => section.options.length > 0)
  return <>
    <input className="problem-facet-search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Find rounds, roles, topics, or companies" aria-label="Find filter options" />
    {visible.length === 0 ? <p className="problem-filter-help">No filter options match.</p> : null}
    {visible.map(section => <fieldset className="problem-filter-section" key={section.key} data-testid={`problem-filter-section-${section.key}`}><legend>{section.title}</legend><div className="problem-check-options problem-check-options--scroll">{section.options.map(option => <label key={option.value}><input type="checkbox" checked={filters[section.property].includes(option.value)} data-testid={`problem-filter-${section.property}-${option.value}`} onChange={() => onFilters({ ...filters, [section.property]: toggle(filters[section.property], option.value) })} />{section.property === 'companies' ? <ProblemTag category="companies" label={option.value} /> : section.property === 'tags' ? option.label : <ProblemTag category={section.property} label={option.value} />}</label>)}</div></fieldset>)}
  </>
}
