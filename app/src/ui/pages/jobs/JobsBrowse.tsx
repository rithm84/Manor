import { useManorService } from '../../services/ManorServices'
import { Filter, Plus, RotateCcw, Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { Button, Input, Pill, Select, useDismissLayer } from '../../components/ui'
import type { JobFeedPage, JobListing } from '../../../shared/jobFeed'
import type { JobsState } from '../../../shared/jobs'
import { DueDatePicker } from '../home/DueDatePicker'
import {
  changeBrowseRuleProperty,
  changePostedOperator,
  filterListings,
  makeBrowseRule,
  replaceBrowseRule
} from './browseFilters'
import type {
  AddedFilterValue,
  BrowseFilterProperty,
  BrowseFilterRule,
  PostedFilterOperator
} from './browseFilters'
import { postedColorway, postedLabel, termColorway } from './jobsModel'
import { useBrowseQuery, useBrowseRules } from './jobsViewState'
import '../home/master.css'

export interface JobsBrowseProps {
  today: string
  /** Adding a listing returns the whole pipeline, which the page adopts. */
  onAdded: (state: JobsState) => void
}

const TEXT_PROPERTY_OPTIONS = [
  { value: 'company', label: 'Company' },
  { value: 'location', label: 'Location' },
  { value: 'posted', label: 'Posted' },
  { value: 'added', label: 'Pipeline' }
] as const

const POSTED_OPERATOR_OPTIONS = [
  { value: 'before', label: 'Before' },
  { value: 'on', label: 'On' },
  { value: 'after', label: 'After' },
  { value: 'within', label: 'Within range' }
] as const

const ADDED_OPTIONS = [
  { value: 'added', label: 'In pipeline' },
  { value: 'not_added', label: 'Not added' }
] as const

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The job feed could not be reached'
}

function propertyOptions(
  terms: readonly string[],
  categories: readonly string[]
): readonly { value: string; label: string }[] {
  const options: { value: string; label: string }[] = []
  if (terms.length > 0) options.push({ value: 'term', label: 'Term' })
  if (categories.length > 0) options.push({ value: 'category', label: 'Category' })
  return [...options, ...TEXT_PROPERTY_OPTIONS]
}

interface RuleRowProps {
  rule: BrowseFilterRule
  today: string
  terms: readonly string[]
  categories: readonly string[]
  onChange: (rule: BrowseFilterRule) => void
  onRemove: () => void
}

function RuleRow({ rule, today, terms, categories, onChange, onRemove }: RuleRowProps): ReactNode {
  return (
    <div className="master-filter-rule">
      <Select
        value={rule.property}
        options={propertyOptions(terms, categories)}
        onChange={(value) =>
          onChange(changeBrowseRuleProperty(rule, value as BrowseFilterProperty, today, terms, categories))
        }
        placeholder="Property"
        ariaLabel="Filter property"
      />
      <span className="master-filter-is">is</span>
      {rule.property === 'term' ? (
        <Select
          value={rule.value}
          options={terms.map((term) => ({ value: term, label: term, tone: termColorway(term) }))}
          onChange={(value) => onChange({ ...rule, value })}
          placeholder="Term"
          ariaLabel="Term filter value"
        />
      ) : null}
      {rule.property === 'category' ? (
        <Select
          value={rule.value}
          options={categories.map((category) => ({ value: category, label: category }))}
          onChange={(value) => onChange({ ...rule, value })}
          placeholder="Category"
          ariaLabel="Category filter value"
        />
      ) : null}
      {rule.property === 'company' ? (
        <Input
          value={rule.value}
          onChange={(value) => onChange({ ...rule, value })}
          placeholder="Company name"
          ariaLabel="Company filter value"
        />
      ) : null}
      {rule.property === 'location' ? (
        <Input
          value={rule.value}
          onChange={(value) => onChange({ ...rule, value })}
          placeholder="City or state"
          ariaLabel="Location filter value"
        />
      ) : null}
      {rule.property === 'added' ? (
        <Select
          value={rule.value}
          options={ADDED_OPTIONS}
          onChange={(value) => onChange({ ...rule, value: value as AddedFilterValue })}
          placeholder="Pipeline"
          ariaLabel="Pipeline filter value"
        />
      ) : null}
      {rule.property === 'posted' ? (
        <>
          <Select
            value={rule.operator}
            options={POSTED_OPERATOR_OPTIONS}
            onChange={(value) => onChange(changePostedOperator(rule, value as PostedFilterOperator, today))}
            placeholder="Operator"
            ariaLabel="Posted date operator"
          />
          {rule.operator === 'within' ? (
            <div className="master-filter-range">
              <DueDatePicker
                value={rule.from}
                onChange={(from) => onChange({ ...rule, from, to: rule.to < from ? from : rule.to })}
                ariaLabel="Range start"
                min={null}
                max={null}
              />
              <span>to</span>
              <DueDatePicker
                value={rule.to}
                onChange={(to) => onChange({ ...rule, from: rule.from > to ? to : rule.from, to })}
                ariaLabel="Range end"
                min={null}
                max={null}
              />
            </div>
          ) : (
            <DueDatePicker
              value={rule.date}
              onChange={(date) => onChange({ ...rule, date })}
              ariaLabel="Posted date filter"
              min={null}
              max={null}
            />
          )}
        </>
      ) : null}
      <button type="button" className="master-rule-remove" aria-label="Remove filter" onClick={onRemove}>
        <X size={14} />
      </button>
    </div>
  )
}

interface BrowseRowProps {
  listing: JobListing
  today: string
  added: boolean
  pending: boolean
  onAdd: (listingId: string) => void
}

function BrowseRow({ listing, today, added, pending, onAdd }: BrowseRowProps): ReactNode {
  return (
    <div className="browse-row" role="row">
      <span className="browse-company" role="cell">{listing.company}</span>
      <span className="browse-role" role="cell">
        {/* The source's own category is unreliable (it files plenty of
            software roles under Hardware), so it stays a filter rather than
            a label that would misinform at a glance. */}
        <a href={listing.url} target="_blank" rel="noreferrer">{listing.role}</a>
        {listing.openings > 1 ? (
          <span className="browse-openings tnum">{listing.openings} openings</span>
        ) : null}
      </span>
      <span role="cell">{listing.locations === '' ? 'Not listed' : listing.locations}</span>
      <span role="cell">
        {listing.term === '' ? null : (
          <Pill variant="tag" colorway={termColorway(listing.term)} label={listing.term} />
        )}
      </span>
      <span className="tnum" role="cell">
        <Pill
          variant="tag"
          colorway={postedColorway(listing.posted, today)}
          label={postedLabel(listing.posted, today)}
        />
      </span>
      <span className="browse-action" role="cell">
        <Button variant="ghost" disabled={added || pending} onClick={() => onAdd(listing.id)}>
          {added ? 'Added' : pending ? 'Adding' : 'Add'}
        </Button>
      </span>
    </div>
  )
}

/** The shared internship feed, browsed and pulled into the pipeline one row at a time. */
export function JobsBrowse({ today, onAdded }: JobsBrowseProps): ReactNode {
  const jobsApi = useManorService('jobs')
  const [query, setQuery] = useBrowseQuery()
  const [rules, setRules] = useBrowseRules()
  const [page, setPage] = useState<JobFeedPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [addedIds, setAddedIds] = useState<ReadonlySet<string>>(new Set())
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [addError, setAddError] = useState<string | null>(null)
  const [filterOpen, setFilterOpen] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const filterRoot = useRef<HTMLDivElement | null>(null)

  useDismissLayer(filterOpen, () => setFilterOpen(false))

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    jobsApi
      .feedList()
      .then((loaded) => {
        if (cancelled) return
        setPage(loaded)
        setLoading(false)
      })
      .catch((error: unknown) => {
        console.error('Job feed listing failed', { error })
        if (cancelled) return
        setLoadError(errorMessage(error))
        setLoading(false)
      })
    return (): void => {
      cancelled = true
    }
  }, [reloadKey])

  useEffect(() => {
    if (!filterOpen) return
    const onPointerDown = (event: PointerEvent): void => {
      const root = filterRoot.current
      if (root !== null && !root.contains(event.target as Node)) setFilterOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    return (): void => {
      window.removeEventListener('pointerdown', onPointerDown)
    }
  }, [filterOpen])

  const listings = page?.listings ?? []
  const terms = page?.terms ?? []
  const categories = page?.categories ?? []

  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    return filterListings(listings, rules).filter(
      (listing) =>
        normalized === '' ||
        listing.company.toLocaleLowerCase().includes(normalized) ||
        listing.role.toLocaleLowerCase().includes(normalized) ||
        listing.locations.toLocaleLowerCase().includes(normalized)
    )
  }, [listings, query, rules])

  const addRule = (property: BrowseFilterProperty): void => {
    setRules([...rules, makeBrowseRule(property, today, terms, categories)])
  }

  const addListing = (listingId: string): void => {
    setPendingId(listingId)
    setAddError(null)
    jobsApi
      .feedAdd(listingId)
      .then((state) => {
        setAddedIds((current) => new Set(current).add(listingId))
        setPendingId(null)
        onAdded(state)
      })
      .catch((error: unknown) => {
        console.error('Adding a feed listing failed', { listingId, error })
        setPendingId(null)
        setAddError(errorMessage(error))
      })
  }

  if (loading) {
    return <div className="jobs-loading">Loading listings…</div>
  }

  if (loadError !== null || page === null) {
    return (
      <div className="browse-failure">
        <p role="alert">{loadError ?? 'Listings could not be loaded.'}</p>
        <Button variant="ghost" icon={<RotateCcw size={16} />} onClick={() => setReloadKey((key) => key + 1)}>
          Try again
        </Button>
      </div>
    )
  }

  return (
    <section className="browse" aria-label="Browse listings">
      <div className="master-toolbar browse-toolbar">
        <div className="master-search" role="search">
          <Search size={14} aria-hidden="true" />
          <input
            value={query}
            placeholder="Search listings"
            aria-label="Search listings"
            onChange={(event) => setQuery(event.target.value)}
          />
          {query !== '' ? (
            <button type="button" aria-label="Clear search" onClick={() => setQuery('')}>
              <X size={13} />
            </button>
          ) : null}
        </div>

        <div className="master-popover-anchor" ref={filterRoot}>
          <button
            type="button"
            className={`master-tool-button${rules.length > 0 ? ' is-active' : ''}`}
            aria-expanded={filterOpen}
            aria-haspopup="dialog"
            onClick={() => setFilterOpen((open) => !open)}
          >
            <Filter size={14} /> Filter {rules.length > 0 ? <span className="tnum">{rules.length}</span> : null}
          </button>
          {rules.length > 0 ? (
            <button type="button" className="master-clear-filters" onClick={() => setRules([])}>
              <RotateCcw size={13} /> Clear filters
            </button>
          ) : null}
          {filterOpen ? (
            <div className="master-filter-popover browse-filter-popover" role="dialog" aria-label="Listing filters">
              <div className="master-popover-head">
                <span>Match all rules</span>
                <button type="button" aria-label="Close filters" onClick={() => setFilterOpen(false)}>
                  <X size={14} />
                </button>
              </div>
              <div className="master-filter-rules">
                {rules.map((rule) => (
                  <RuleRow
                    key={rule.id}
                    rule={rule}
                    today={today}
                    terms={terms}
                    categories={categories}
                    onChange={(updated) => setRules(replaceBrowseRule(rules, updated))}
                    onRemove={() => setRules(rules.filter((candidate) => candidate.id !== rule.id))}
                  />
                ))}
                {rules.length === 0 ? (
                  <p className="master-filter-empty">No filters. Every listing is shown.</p>
                ) : null}
              </div>
              <div className="master-add-filter">
                <Plus size={14} />
                <Select
                  value={null}
                  options={propertyOptions(terms, categories)}
                  onChange={(value) => addRule(value as BrowseFilterProperty)}
                  placeholder="Add filter"
                  ariaLabel="Add filter"
                />
              </div>
            </div>
          ) : null}
        </div>

        {/* "N of M" only while narrowing; an unfiltered list just counts. */}
        <span className="browse-count">
          {visible.length === listings.length ? (
            <>
              <span className="tnum">{listings.length}</span>{' '}
              {listings.length === 1 ? 'listing' : 'listings'}
            </>
          ) : (
            <>
              <span className="tnum">{visible.length}</span> of{' '}
              <span className="tnum">{listings.length}</span>
            </>
          )}
        </span>
      </div>

      {addError !== null ? (
        <div className="browse-error" role="alert">{addError}</div>
      ) : null}

      <div className="browse-scroll">
        <div className="browse-table" role="table" aria-label="Open listings">
          <div className="browse-row browse-row--head" role="row">
            <span role="columnheader">Company</span>
            <span role="columnheader">Role</span>
            <span role="columnheader">Location</span>
            <span role="columnheader">Term</span>
            <span role="columnheader">Posted</span>
            <span role="columnheader" />
          </div>
          {visible.map((listing) => (
            <BrowseRow
              key={listing.id}
              listing={listing}
              today={today}
              added={listing.added || addedIds.has(listing.id)}
              pending={pendingId === listing.id}
              onAdd={addListing}
            />
          ))}
          {visible.length === 0 ? (
            listings.length === 0 ? (
              <div className="master-empty">No open listings right now.</div>
            ) : (
              <div className="master-empty">
                <span>{rules.length > 0 ? 'No listings match these filters.' : 'No listings match this search.'}</span>
                <button
                  type="button"
                  className="master-empty-clear"
                  onClick={() => {
                    setRules([])
                    setQuery('')
                  }}
                >
                  {rules.length > 0 ? 'Clear filters' : 'Clear search'}
                </button>
              </div>
            )
          ) : null}
        </div>
      </div>
    </section>
  )
}
