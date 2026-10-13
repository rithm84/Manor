import { Check, ChevronLeft, ChevronRight, Code2, ExternalLink, FileText, Search } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { emptyProblemFilters } from '../../shared/problemLibrary'
import { filterProblemGroups, problemGroups } from '../../shared/problemGroups'
import type { ProblemDetail, ProblemFilters, ProblemLibraryState, ProblemRecord, ProblemSavedView } from '../../shared/problemLibrary'
import { useManorAccount } from '../../web/accountContext'
import { dateInTimezone } from '../../shared/timezone'
import { Button, Select } from '../components/ui'
import { useCommitVersion } from '../services/useCommitVersion'
import { useManorService } from '../services/ManorServices'
import { SecondaryModuleSurface } from './SecondaryModuleSurface'
import { MistakesPanel } from './leetcode/MistakesPanel'
import { ProblemReviewModal } from './leetcode/ProblemReviewModal'
import { ProblemViewControls, columnLabels, statusLabels } from './leetcode/ProblemViewControls'
import { ProblemFilterBar } from './leetcode/ProblemFilterBar'
import { ProblemWorkspace } from './leetcode/ProblemWorkspace'
import { ProblemRecency } from './leetcode/ProblemSourceDetails'
import { ProblemTagRow } from './leetcode/ProblemTag'
import { ProblemDifficulty } from './leetcode/ProblemDifficulty'
import { problemTitle } from './leetcode/problemTestcases'
import { fittingColumns, problemActionsWidth, problemColumnWidths, useElementWidth } from './leetcode/problemTableColumns'
import { cellPadding } from './leetcode/problemChipWidths'
import { attemptsForProblem, errorMessage, kindLabel } from './leetcode/leetCodeModel'
import { useProblemBenchmark } from './leetcode/problemBenchmark'
import { warmEditorRuntime, warmEditorSandbox, warmLanguageServer } from './leetcode/problemEditorWarmup'
import './leetcode/leetcode.css'
import './leetcode/problemLibrary.css'
import './leetcode/problemWorkspace.css'

/** The switcher's value for the unsaved default view; saved views use their UUIDs. */
const allProblemsView = 'all'
type ViewSettings = Pick<ProblemSavedView, 'filters' | 'sort' | 'groupBy' | 'visibleColumns'>
function initialView(): ViewSettings { return { filters: emptyProblemFilters(), sort: [{ field: 'name', direction: 'asc' }], groupBy: null, visibleColumns: ['difficulty', 'lastAsked', 'topics', 'companies', 'collections', 'status'] } }
function groupLabel(problem: ProblemRecord, group: ProblemSavedView['groupBy']): string {
  if (group === 'topic') return problem.topics[0] ?? 'No topic'
  if (group === 'company') return problem.companies[0] ?? 'No company'
  if (group === 'collection') return problem.collections[0] ?? 'No collection'
  if (group === 'difficulty') return problem.difficulty ?? 'No difficulty'
  if (group === 'kind') return kindLabel[problem.kind]
  return ''
}
function cell(problem: ProblemRecord, column: ProblemSavedView['visibleColumns'][number]): ReactNode {
  if (column === 'difficulty') return <ProblemDifficulty problem={problem} />
  if (column === 'kind') return kindLabel[problem.kind]
  if (column === 'status') return <span className={`problem-status is-${problem.status}`} title={statusLabels[problem.status]}>{problem.status === 'solved' ? <Check size={14} aria-hidden="true" /> : null}<span>{statusLabels[problem.status]}</span></span>
  if (column === 'lastAsked') return <ProblemRecency metadata={problem.sourceMetadata} />
  return <ProblemTagRow category={column} labels={problem[column]} available={problemColumnWidths[column] - cellPadding} />
}

/** General catalog with saved projections and on-demand problem bodies. */
export function LeetCodePage(): ReactNode {
  const api = useManorService('problemLibrary')
  const execution = useManorService('problemExecution')
  const attemptsApi = useManorService('leetcode')
  const account = useManorAccount()
  const commitVersion = useCommitVersion()
  const [state, setState] = useState<ProblemLibraryState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const [settings, setSettings] = useState<ViewSettings>(initialView)
  const [viewId, setViewId] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [busy, setBusy] = useState(false)
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ProblemDetail | null>(null)
  const [reviewProblem, setReviewProblem] = useState<ProblemRecord | null>(null)
  const [tab, setTab] = useState<'library' | 'mistakes'>('library')
  const [searchDraft, setSearchDraft] = useState('')
  const [tableScroll, tableWidth] = useElementWidth()
  const today = dateInTimezone(new Date(), account.timezone)
  useProblemBenchmark(state !== null, settings.filters.search)
  useEffect(() => { warmEditorSandbox(execution, account.id) }, [execution, account.id])
  const loaded = state !== null
  useEffect(() => {
    if (!loaded) return
    // After the frame that paints the library, so warming never delays it.
    let timer: ReturnType<typeof setTimeout> | undefined
    const frame = requestAnimationFrame(() => { timer = setTimeout(warmEditorRuntime, 0) })
    return () => { cancelAnimationFrame(frame); clearTimeout(timer) }
  }, [loaded])
  useEffect(() => {
    let cancelled = false
    void api.load().then(next => { problemGroups(next.problems); if (!cancelled) { setState(next); setError(null) } }).catch(failure => { if (!cancelled) setError(errorMessage(failure)) })
    return () => { cancelled = true }
  }, [api, commitVersion, retry])
  const selectedView = state?.views.find(view => view.id === viewId) ?? null
  const dirty = selectedView !== null && JSON.stringify(settings) !== JSON.stringify({ filters: selectedView.filters, sort: selectedView.sort, groupBy: selectedView.groupBy, visibleColumns: selectedView.visibleColumns })
  const groups = useMemo(() => problemGroups(state?.problems ?? []), [state?.problems])
  const catalog = useMemo(() => groups.map(group => group.problem), [groups])
  const { filters, sort, groupBy } = settings
  const filtered = useMemo(() => {
    const problems = filterProblemGroups(groups, filters, sort)
    return groupBy === null ? problems : [...problems].sort((left, right) => groupLabel(left, groupBy).localeCompare(groupLabel(right, groupBy)))
  }, [groups, filters, sort, groupBy])
  useEffect(() => { setPage(0) }, [filters, sort, groupBy])
  // Filtering re-sorts the whole library, so typing settles briefly before the search applies.
  useEffect(() => {
    const timer = setTimeout(() => setSettings(previous => previous.filters.search === searchDraft ? previous : { ...previous, filters: { ...previous.filters, search: searchDraft } }), 150)
    return () => clearTimeout(timer)
  }, [searchDraft])
  const pages = Math.max(1, Math.ceil(filtered.length / 50))
  const currentPage = Math.min(page, pages - 1)
  const rows = filtered.slice(currentPage * 50, (currentPage + 1) * 50)
  // Lower-priority columns give way before the row outgrows the page; the saved view keeps every chosen column.
  const shownColumns = tableWidth === null ? settings.visibleColumns : fittingColumns(settings.visibleColumns, tableWidth)
  const refresh = useCallback((): void => setRetry(value => value + 1), [])
  const selectView = (view: ProblemSavedView | null): void => {
    setViewId(view?.id ?? null)
    setSettings(view === null ? initialView() : { filters: view.filters, sort: view.sort, groupBy: view.groupBy, visibleColumns: view.visibleColumns })
    setSearchDraft(view?.filters.search ?? '')
  }
  const updateFilters = useCallback((next: ProblemFilters): void => setSettings(previous => ({ ...previous, filters: next })), [])
  const clearFilters = (): void => { setSearchDraft(''); updateFilters(emptyProblemFilters()) }
  const openProblem = async (problem: ProblemRecord): Promise<void> => {
    setOpeningId(problem.id); setError(null)
    try { setDetail(await api.loadProblem(problem.id)) }
    catch (failure) { setError(errorMessage(failure)) } finally { setOpeningId(null) }
  }
  const saveView = async (name: string, asNew: boolean): Promise<void> => {
    setBusy(true); setError(null)
    try {
      const saved = await api.saveView({ id: asNew || selectedView === null ? crypto.randomUUID() : selectedView.id, expectedRevision: asNew || selectedView === null ? 0 : selectedView.revision, name, ...settings })
      setState(await api.load()); selectView(saved)
    } catch (failure) { setError(errorMessage(failure)); throw failure } finally { setBusy(false) }
  }
  const deleteView = async (): Promise<void> => {
    if (selectedView === null) throw new Error('Select a saved view before deleting it.')
    setBusy(true); setError(null)
    try { await api.deleteView({ id: selectedView.id, expectedRevision: selectedView.revision }); setState(await api.load()); selectView(null) }
    catch (failure) { setError(errorMessage(failure)); throw failure } finally { setBusy(false) }
  }
  const persistAttempt = async (mutation: () => Promise<{ attempts: ProblemLibraryState['attempts']; notes: ProblemLibraryState['notes'] }>): Promise<void> => {
    const saved = await mutation()
    setState(previous => previous === null ? null : { ...previous, attempts: saved.attempts, notes: saved.notes }); refresh()
  }
  const solving = detail !== null && detail.canExecute
  // The library and problems span the page; solving also fills its height so the panes scroll inside themselves.
  return <SecondaryModuleSurface width={solving ? 'full' : 'fluid'}><div className={`lc problem-library${detail === null ? '' : ' has-workspace'}${solving ? ' is-solving' : ''}`} data-testid="problem-library">
    {detail !== null ? <ProblemWorkspace key={detail.problem.id} detail={detail} execution={execution} library={api} onBack={() => setDetail(null)} onReview={() => setReviewProblem(detail.problem)} onSubmitted={refresh} /> : <>
      <header className="problem-library-header"><div><h1 className="page-title">Problems</h1><span className="tnum">{state === null ? '…' : catalog.length.toLocaleString()} in your library</span></div></header>
      <nav className="problem-module-tabs" aria-label="Problems views"><button type="button" className={tab === 'library' ? 'is-active' : ''} onClick={() => setTab('library')}>Library</button><button type="button" className={tab === 'mistakes' ? 'is-active' : ''} onClick={() => setTab('mistakes')}>Mistakes</button></nav>
      {error === null ? null : <div className="lc-error lc-error--page" role="alert"><span>{error}</span><Button variant="ghost" onClick={refresh}>Try again</Button></div>}
      {state === null ? <p className="lc-loading" role="status">Loading your library…</p> : tab === 'mistakes' ? <section className="problem-mistakes-page"><MistakesPanel notes={state.notes} onAdd={text => persistAttempt(() => attemptsApi.addNote(text))} onUpdate={(noteId, text, expectedRevision) => persistAttempt(() => attemptsApi.updateNote({ noteId, text, expectedRevision }))} onDelete={noteId => persistAttempt(() => attemptsApi.deleteNote(noteId))} /></section> : <>
        {/* One toolbar: search first, then the common filters and the saved view, with View options and Save view at the end. */}
        <div className="problem-library-toolbar"><label className="problem-search"><Search size={16} /><input data-testid="problem-search" value={searchDraft} placeholder="Search problems, topics, or companies" aria-label="Search problems" onChange={event => setSearchDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Escape' && searchDraft !== '') { event.stopPropagation(); setSearchDraft('') } }} /></label><ProblemFilterBar problems={catalog} filters={settings.filters} onFilters={updateFilters} /><div className="problem-view-switcher" data-testid="problem-view-switcher"><Select value={viewId ?? allProblemsView} ariaLabel="Saved view" placeholder="All problems" options={[{ value: allProblemsView, label: 'All problems' }, ...state.views.map(view => ({ value: view.id, label: view.name }))]} onChange={value => selectView(state.views.find(view => view.id === value) ?? null)} /></div><ProblemViewControls problems={catalog} filters={settings.filters} sort={settings.sort} groupBy={settings.groupBy} columns={settings.visibleColumns} selectedView={selectedView} dirty={dirty} busy={busy} onFilters={updateFilters} onSort={sort => setSettings(previous => ({ ...previous, sort }))} onGroup={groupBy => setSettings(previous => ({ ...previous, groupBy }))} onColumns={visibleColumns => setSettings(previous => ({ ...previous, visibleColumns }))} onSave={saveView} onDelete={deleteView} /></div>
        <div className="problem-table-scroll" ref={tableScroll}><table className="problem-table" data-testid="problem-table"><colgroup><col />{shownColumns.map(column => <col key={column} style={{ width: problemColumnWidths[column] }} />)}<col style={{ width: problemActionsWidth }} /></colgroup><thead><tr><th scope="col">Problem</th>{shownColumns.map(column => <th key={column} scope="col">{columnLabels[column]}</th>)}<th scope="col" aria-label="Problem actions" /></tr></thead><tbody>{rows.map((problem, index) => {
          const group = groupLabel(problem, settings.groupBy)
          const showGroup = settings.groupBy !== null && (index === 0 || groupLabel(rows[index - 1], settings.groupBy) !== group)
          return <ProblemRows key={problem.id} problem={problem} columns={shownColumns} showGroup={showGroup} group={group} opening={openingId === problem.id} onOpen={() => void openProblem(problem)} onWarm={() => warmLanguageServer(execution, account.id)} />
        })}</tbody></table></div>
        {rows.length === 0 ? <div className="problem-library-empty"><Code2 size={28} aria-hidden="true" /><h2>{state.problems.length === 0 ? 'No problems yet' : 'No problems match'}</h2><p>{state.problems.length === 0 ? 'Ask Codex to add a problem of your own.' : 'Try another search or clear some filters.'}</p>{state.problems.length === 0 ? null : <Button variant="subtle" onClick={clearFilters}>Clear filters</Button>}</div> : null}
        <footer className="problem-library-pagination"><span className="tnum">{filtered.length === 0 ? '0' : `${currentPage * 50 + 1}–${Math.min((currentPage + 1) * 50, filtered.length)}`} of {filtered.length.toLocaleString()}</span><div><Button variant="ghost" icon={<ChevronLeft size={16} />} ariaLabel="Previous problem page" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>{null}</Button><span className="tnum">{currentPage + 1} / {pages}</span><Button variant="ghost" icon={<ChevronRight size={16} />} ariaLabel="Next problem page" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>{null}</Button></div></footer>
      </>}
    </>}
    {reviewProblem === null || state === null ? null : <ProblemReviewModal problem={reviewProblem} attempts={attemptsForProblem(state.attempts, reviewProblem.id)} today={today} onClose={() => setReviewProblem(null)} onAddAttempt={input => persistAttempt(() => attemptsApi.addAttempt(input))} onUpdateAttempt={input => persistAttempt(() => attemptsApi.updateAttempt(input))} onDeleteAttempt={id => persistAttempt(() => attemptsApi.deleteAttempt(id))} />}
  </div></SecondaryModuleSurface>
}

function ProblemRows({ problem, columns, showGroup, group, opening, onOpen, onWarm }: { problem: ProblemRecord; columns: readonly ProblemSavedView['visibleColumns'][number][]; showGroup: boolean; group: string; opening: boolean; onOpen: () => void; onWarm: () => void }): ReactNode {
  const title = problemTitle(problem)
  return <>{showGroup ? <tr className="problem-table-group"><th colSpan={columns.length + 2} scope="rowgroup">{group}</th></tr> : null}<tr data-testid={`problem-row-${problem.id}`} onPointerEnter={onWarm}>
    <th scope="row"><button className="problem-name-button" type="button" data-testid={`problem-open-${problem.id}`} onClick={onOpen} onFocus={onWarm} disabled={opening}>{problem.contentAvailable ? <FileText size={16} aria-label="Content available" /> : <Code2 size={16} aria-hidden="true" />}<span className="problem-name-text" title={title}>{title}</span></button></th>
    {columns.map(column => <td key={column}>{cell(problem, column)}</td>)}<td className="problem-row-actions">{problem.sourceUrl === null ? null : <a href={problem.sourceUrl} target="_blank" rel="noreferrer" aria-label={`Open source for ${title}`} title="Open original source"><ExternalLink size={15} /></a>}</td>
  </tr></>
}
