import { Bookmark, Filter, Plus, RotateCcw, Search, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { Pill, Select, useClickIntent } from '../../components/ui'
import type { QuickActionPoint } from '../../components/ui'
import type { ContextDefinition, Task } from '../../data/mock'
import type {
  DueFilterOperator,
  MasterFilterProperty,
  MasterFilterRule,
  SavedTaskView,
  TaskPriority,
  TaskStatus
} from '../../../../shared/home'
import { DueDatePicker } from './DueDatePicker'
import { ContextPill } from './ContextPill'
import { ContextGlyph } from './contextIcons'
import { changeDueOperator, changeRuleProperty, filterTasks, makeFilterRule } from './masterFilters'
import {
  ESTIMATE_COLORWAY,
  PRIORITY_COLORWAY,
  STATUS_COLORWAY,
  dueColorway,
  estimateLabel,
  formatDayLabel
} from './taskModel'
import './master.css'

export interface MasterTaskTableProps {
  tasks: readonly Task[]
  contexts: readonly ContextDefinition[]
  today: string
  savedViews: readonly SavedTaskView[]
  onOpenTask: (taskId: string) => void
  onQuickActions: (taskId: string, point: QuickActionPoint) => void
  onSaveView: (view: SavedTaskView) => Promise<void>
  onDeleteView: (viewId: string) => Promise<void>
}

const PROPERTY_OPTIONS = [
  { value: 'context', label: 'Context' },
  { value: 'status', label: 'Status' },
  { value: 'priority', label: 'Priority' },
  { value: 'due', label: 'Due date' }
] as const
const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'Not started', label: 'Not started', tone: STATUS_COLORWAY['Not started'] },
  { value: 'In Progress', label: 'In progress', tone: STATUS_COLORWAY['In Progress'] },
  { value: 'Done', label: 'Done', tone: STATUS_COLORWAY.Done }
] as const
const PRIORITY_OPTIONS = [
  { value: 'Low', label: 'Low', tone: PRIORITY_COLORWAY.Low },
  { value: 'Medium', label: 'Medium', tone: PRIORITY_COLORWAY.Medium },
  { value: 'High', label: 'High', tone: PRIORITY_COLORWAY.High }
] as const
const DUE_OPERATOR_OPTIONS = [
  { value: 'before', label: 'Before' },
  { value: 'on', label: 'On' },
  { value: 'after', label: 'After' },
  { value: 'within', label: 'Within range' }
] as const

function replaceRule(rules: readonly MasterFilterRule[], updated: MasterFilterRule): readonly MasterFilterRule[] {
  return rules.map((rule) => (rule.id === updated.id ? updated : rule))
}

function statusLabel(status: TaskStatus): string {
  return status === 'In Progress' ? 'In progress' : status
}

interface RuleRowProps {
  rule: MasterFilterRule
  contexts: readonly ContextDefinition[]
  today: string
  onChange: (rule: MasterFilterRule) => void
  onRemove: () => void
}

function RuleRow({ rule, contexts, today, onChange, onRemove }: RuleRowProps): ReactNode {
  const firstContext = contexts[0]?.name
  if (firstContext === undefined) throw new Error('Master filters require a persisted context')
  return (
    <div className="master-filter-rule">
      <Select
        value={rule.property}
        options={PROPERTY_OPTIONS}
        onChange={(value) => onChange(changeRuleProperty(rule, value as MasterFilterProperty, today, firstContext))}
        placeholder="Property"
        ariaLabel="Filter property"
      />
      <span className="master-filter-is">is</span>
      {rule.property === 'context' ? (
        <Select
          value={rule.value}
          options={contexts.map((context) => ({
            value: context.name,
            label: context.name,
            leading: <ContextGlyph icon={context.icon} size={12} />,
            tone: context.color
          }))}
          onChange={(value) => onChange({ ...rule, value })}
          placeholder="Context"
          ariaLabel="Context filter value"
        />
      ) : null}
      {rule.property === 'status' ? (
        <Select
          value={rule.value}
          options={STATUS_OPTIONS}
          onChange={(value) => {
            if (value === 'all') onRemove()
            else onChange({ ...rule, value: value as TaskStatus })
          }}
          placeholder="All statuses"
          ariaLabel="Status filter value"
        />
      ) : null}
      {rule.property === 'priority' ? (
        <Select value={rule.value} options={PRIORITY_OPTIONS} onChange={(value) => onChange({ ...rule, value: value as TaskPriority })} placeholder="Priority" ariaLabel="Priority filter value" />
      ) : null}
      {rule.property === 'due' ? (
        <>
          <Select value={rule.operator} options={DUE_OPERATOR_OPTIONS} onChange={(value) => onChange(changeDueOperator(rule, value as DueFilterOperator, today))} placeholder="Operator" ariaLabel="Due date operator" />
          {rule.operator === 'within' ? (
            <div className="master-filter-range">
              <DueDatePicker value={rule.from} onChange={(from) => onChange({ ...rule, from, to: rule.to < from ? from : rule.to })} ariaLabel="Range start" min={null} max={null} />
              <span>to</span>
              <DueDatePicker value={rule.to} onChange={(to) => onChange({ ...rule, from: rule.from > to ? to : rule.from, to })} ariaLabel="Range end" min={null} max={null} />
            </div>
          ) : (
            <DueDatePicker value={rule.date} onChange={(date) => onChange({ ...rule, date })} ariaLabel="Due date filter" min={null} max={null} />
          )}
        </>
      ) : null}
      <button type="button" className="master-rule-remove" aria-label="Remove filter" onClick={onRemove}><X size={14} /></button>
    </div>
  )
}

interface MasterTaskRowProps {
  task: Task
  contexts: readonly ContextDefinition[]
  today: string
  onOpenTask: (taskId: string) => void
  onQuickActions: (taskId: string, point: QuickActionPoint) => void
}

function MasterTaskRow({ task, contexts, today, onOpenTask, onQuickActions }: MasterTaskRowProps): ReactNode {
  const clickIntent = useClickIntent<HTMLButtonElement>(
    () => onOpenTask(task.id),
    (point) => onQuickActions(task.id, point),
    false
  )
  return (
    <button
      type="button"
      className="master-row"
      role="row"
      onClick={clickIntent.onClick}
      onContextMenu={clickIntent.onContextMenu}
      onKeyDown={clickIntent.onKeyDown}
    >
      <span className="master-title" role="cell">{task.title}</span>
      <span role="cell"><ContextPill name={task.context} contexts={contexts} /></span>
      <span className="tnum" role="cell"><Pill variant="tag" colorway={dueColorway(task.due, today)} label={formatDayLabel(task.due)} /></span>
      <span role="cell">
        {task.estimateMinutes === null ? (
          <Pill variant="tag" colorway="neutral" label="Empty" />
        ) : (
          <Pill variant="tag" colorway={ESTIMATE_COLORWAY[task.estimateMinutes]} label={estimateLabel(task.estimateMinutes)} />
        )}
      </span>
      <span role="cell">
        {task.priority === null ? (
          <Pill variant="tag" colorway="neutral" label="Empty" />
        ) : (
          <Pill variant="tag" colorway={PRIORITY_COLORWAY[task.priority]} label={task.priority} />
        )}
      </span>
      <span role="cell"><Pill variant="tag" colorway={STATUS_COLORWAY[task.status]} label={statusLabel(task.status)} /></span>
    </button>
  )
}

export function MasterTaskTable({ tasks, contexts, today, savedViews, onOpenTask, onQuickActions, onSaveView, onDeleteView }: MasterTaskTableProps): ReactNode {
  const [query, setQuery] = useState('')
  const [rules, setRules] = useState<readonly MasterFilterRule[]>([])
  const [filterOpen, setFilterOpen] = useState(false)
  const [viewsOpen, setViewsOpen] = useState(false)
  const [viewName, setViewName] = useState('')
  const [activeViewId, setActiveViewId] = useState<string | null>(null)
  const filterRoot = useRef<HTMLDivElement | null>(null)
  const viewsRoot = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!filterOpen && !viewsOpen) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node
      if (filterOpen && filterRoot.current !== null && !filterRoot.current.contains(target)) setFilterOpen(false)
      if (viewsOpen && viewsRoot.current !== null && !viewsRoot.current.contains(target)) setViewsOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setFilterOpen(false)
        setViewsOpen(false)
      }
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return (): void => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [filterOpen, viewsOpen])

  const visible = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    const filtered = filterTasks(tasks, rules).filter((task) => normalizedQuery === '' || task.title.toLocaleLowerCase().includes(normalizedQuery))
    return [...filtered].sort((left, right) =>
      left.due.localeCompare(right.due) || left.title.localeCompare(right.title)
    )
  }, [query, rules, tasks])

  const addRule = (property: MasterFilterProperty): void => {
    const firstContext = contexts[0]?.name
    if (firstContext === undefined) throw new Error('Cannot add a filter without a context')
    setRules((current) => [...current, makeFilterRule(property, today, firstContext)])
    setActiveViewId(null)
  }

  const saveView = async (): Promise<void> => {
    const name = viewName.trim()
    if (name === '') return
    const view: SavedTaskView = { id: crypto.randomUUID(), name, rules }
    await onSaveView(view)
    setViewName('')
    setActiveViewId(view.id)
  }

  return (
    <section className="master" aria-label="Master task view">
      <div className="master-toolbar">
        <div className="master-search" role="search">
          <Search size={14} aria-hidden="true" />
          <input value={query} placeholder="Search tasks" aria-label="Search tasks" onChange={(event) => setQuery(event.target.value)} />
          {query !== '' ? <button type="button" aria-label="Clear search" onClick={() => setQuery('')}><X size={13} /></button> : null}
        </div>

        <div className="master-popover-anchor" ref={filterRoot}>
          <button type="button" className={`master-tool-button${rules.length > 0 ? ' is-active' : ''}`} aria-expanded={filterOpen} aria-haspopup="dialog" onClick={() => { setFilterOpen((open) => !open); setViewsOpen(false) }}>
            <Filter size={14} /> Filter {rules.length > 0 ? <span className="tnum">{rules.length}</span> : null}
          </button>
          {rules.length > 0 ? (
            <button
              type="button"
              className="master-clear-filters"
              onClick={() => {
                setRules([])
                setActiveViewId(null)
              }}
            >
              <RotateCcw size={13} /> Clear filters
            </button>
          ) : null}
          {filterOpen ? (
            <div className="master-filter-popover" role="dialog" aria-label="Task filters">
              <div className="master-popover-head"><span>Match all rules</span><button type="button" aria-label="Close filters" onClick={() => setFilterOpen(false)}><X size={14} /></button></div>
              <div className="master-filter-rules">
                {rules.map((rule) => (
                  <RuleRow key={rule.id} rule={rule} contexts={contexts} today={today}
                    onChange={(updated) => { setRules((current) => replaceRule(current, updated)); setActiveViewId(null) }}
                    onRemove={() => { setRules((current) => current.filter((candidate) => candidate.id !== rule.id)); setActiveViewId(null) }} />
                ))}
                {rules.length === 0 ? <p className="master-filter-empty">No filters. Every task is shown.</p> : null}
              </div>
              <div className="master-add-filter"><Plus size={14} /><Select value={null} options={PROPERTY_OPTIONS} onChange={(value) => addRule(value as MasterFilterProperty)} placeholder="Add filter" ariaLabel="Add filter" /></div>
            </div>
          ) : null}
        </div>

        <div className="master-popover-anchor" ref={viewsRoot}>
          <button type="button" className={`master-tool-button${activeViewId !== null ? ' is-active' : ''}`} aria-expanded={viewsOpen} aria-haspopup="dialog" onClick={() => { setViewsOpen((open) => !open); setFilterOpen(false) }}><Bookmark size={14} /> Saved views</button>
          {viewsOpen ? (
            <div className="master-views-popover" role="dialog" aria-label="Saved task views">
              <div className="master-popover-head"><span>Saved views</span><button type="button" aria-label="Close saved views" onClick={() => setViewsOpen(false)}><X size={14} /></button></div>
              <form className="master-save-view" onSubmit={(event) => { event.preventDefault(); void saveView() }}>
                <input value={viewName} maxLength={48} placeholder="View name" aria-label="Saved view name" onChange={(event) => setViewName(event.target.value)} />
                <button type="submit" disabled={viewName.trim() === ''}>Save</button>
              </form>
              <div className="master-saved-list">
                {savedViews.map((saved) => (
                  <div key={saved.id} className={saved.id === activeViewId ? 'is-active' : ''}>
                    <button type="button" className="master-saved-apply" onClick={() => { setRules(saved.rules); setActiveViewId(saved.id); setViewsOpen(false) }}><span>{saved.name}</span><span className="tnum">{saved.rules.length}</span></button>
                    <button type="button" className="master-saved-delete" aria-label={`Delete ${saved.name}`} onClick={() => { void onDeleteView(saved.id); if (activeViewId === saved.id) setActiveViewId(null) }}><Trash2 size={13} /></button>
                  </div>
                ))}
                {savedViews.length === 0 ? <p>No saved views yet.</p> : null}
              </div>
            </div>
          ) : null}
        </div>

        <span className="master-count tnum">{visible.length}</span>
      </div>

      <div className="master-table" role="table" aria-label="All tasks">
        <div className="master-row master-row--head" role="row"><span role="columnheader">Task</span><span role="columnheader">Context</span><span role="columnheader">Due</span><span role="columnheader">Time</span><span role="columnheader">Priority</span><span role="columnheader">Status</span></div>
        {visible.map((task) => (
          <MasterTaskRow
            key={task.id}
            task={task}
            contexts={contexts}
            today={today}
            onOpenTask={onOpenTask}
            onQuickActions={onQuickActions}
          />
        ))}
        {visible.length === 0 ? <div className="master-empty">No tasks match these filters.</div> : null}
      </div>
    </section>
  )
}
