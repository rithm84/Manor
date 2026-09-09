import { describe, expect, it } from 'vitest'

import type { JobListing } from '../../../shared/jobFeed'
import type { BrowseFilterRule } from './browseFilters'
import {
  changeBrowseRuleProperty,
  changePostedOperator,
  filterListings,
  listingMatchesRules,
  makeBrowseRule
} from './browseFilters'

const TERMS: readonly string[] = ['Summer 2027', 'Fall 2026']
const CATEGORIES: readonly string[] = ['Software', 'Quant']

const LISTINGS: readonly JobListing[] = [
  { id: 'one', company: 'Ramp', role: 'SWE Intern', locations: 'New York, NY', url: 'https://example.test/1', posted: '2026-08-25', term: 'Summer 2027', category: 'Software', added: false, openings: 1 },
  { id: 'two', company: 'Jane Street', role: 'Quant Intern', locations: 'New York, NY', url: 'https://example.test/2', posted: '2026-08-20', term: 'Summer 2027', category: 'Quant', added: true, openings: 1 },
  { id: 'three', company: 'Stripe', role: 'Infra Intern', locations: 'Seattle, WA', url: 'https://example.test/3', posted: '2026-07-30', term: 'Fall 2026', category: 'Software', added: false, openings: 1 }
]

describe('Browse listing filters', () => {
  it('combines term, category, and pipeline rules with AND semantics', () => {
    const rules: readonly BrowseFilterRule[] = [
      { id: 'term', property: 'term', value: 'Summer 2027' },
      { id: 'category', property: 'category', value: 'Software' },
      { id: 'added', property: 'added', value: 'not_added' }
    ]
    expect(filterListings(LISTINGS, rules).map((listing) => listing.id)).toEqual(['one'])
  })

  it('matches company and location by case-insensitive substring', () => {
    expect(filterListings(LISTINGS, [{ id: 'c', property: 'company', value: 'jane' }]).map((l) => l.id)).toEqual(['two'])
    expect(filterListings(LISTINGS, [{ id: 'l', property: 'location', value: 'SEATTLE' }]).map((l) => l.id)).toEqual(['three'])
  })

  it('treats an empty text rule as no constraint, so a new rule never blanks the table', () => {
    expect(filterListings(LISTINGS, [{ id: 'c', property: 'company', value: '   ' }])).toEqual(LISTINGS)
  })

  it('supports before, on, after, and inclusive range posted rules', () => {
    expect(listingMatchesRules(LISTINGS[2]!, [{ id: 'b', property: 'posted', operator: 'before', date: '2026-08-01' }])).toBe(true)
    expect(listingMatchesRules(LISTINGS[1]!, [{ id: 'o', property: 'posted', operator: 'on', date: '2026-08-20' }])).toBe(true)
    expect(listingMatchesRules(LISTINGS[0]!, [{ id: 'a', property: 'posted', operator: 'after', date: '2026-08-24' }])).toBe(true)
    expect(
      filterListings(LISTINGS, [{ id: 'r', property: 'posted', operator: 'within', from: '2026-08-20', to: '2026-08-25' }]).map((l) => l.id)
    ).toEqual(['one', 'two'])
  })

  it('returns every listing when the rule set is empty', () => {
    expect(filterListings(LISTINGS, [])).toEqual(LISTINGS)
  })

  it('seeds new rules from the feed vocabulary and today', () => {
    expect(makeBrowseRule('term', '2026-08-26', TERMS, CATEGORIES)).toMatchObject({ property: 'term', value: 'Summer 2027' })
    expect(makeBrowseRule('category', '2026-08-26', TERMS, CATEGORIES)).toMatchObject({ property: 'category', value: 'Software' })
    expect(makeBrowseRule('company', '2026-08-26', TERMS, CATEGORIES)).toMatchObject({ property: 'company', value: '' })
    expect(makeBrowseRule('added', '2026-08-26', TERMS, CATEGORIES)).toMatchObject({ property: 'added', value: 'not_added' })
    expect(makeBrowseRule('posted', '2026-08-26', TERMS, CATEGORIES)).toMatchObject({ property: 'posted', operator: 'on', date: '2026-08-26' })
  })

  it('refuses a term rule when the feed reported no hiring cycles', () => {
    expect(() => makeBrowseRule('term', '2026-08-26', [], CATEGORIES)).toThrow(/no hiring cycles/)
    expect(() => makeBrowseRule('category', '2026-08-26', TERMS, [])).toThrow(/no categories/)
  })

  it('keeps the rule id when its property changes', () => {
    const rule = makeBrowseRule('company', '2026-08-26', TERMS, CATEGORIES)
    const changed = changeBrowseRuleProperty(rule, 'posted', '2026-08-26', TERMS, CATEGORIES)
    expect(changed.id).toBe(rule.id)
    expect(changed).toMatchObject({ property: 'posted', operator: 'on', date: '2026-08-26' })
  })

  it('carries the chosen date across posted operator changes in both directions', () => {
    const single = changePostedOperator({ id: 'p', property: 'posted', operator: 'on', date: '2026-08-10' }, 'within', '2026-08-26')
    expect(single).toEqual({ id: 'p', property: 'posted', operator: 'within', from: '2026-08-10', to: '2026-08-10' })
    expect(changePostedOperator(single, 'after', '2026-08-26')).toEqual({
      id: 'p',
      property: 'posted',
      operator: 'after',
      date: '2026-08-10'
    })
  })
})
