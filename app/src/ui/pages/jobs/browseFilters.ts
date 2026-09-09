import type { JobListing } from '../../../shared/jobFeed'

/**
 * Browse view filters: AND-only rules over the read-only listing feed,
 * mirroring the master task filters. Everything here is pure so the table
 * and its tests share one definition of what a rule means.
 */

export type BrowseFilterProperty = 'term' | 'category' | 'company' | 'location' | 'posted' | 'added'

export type PostedFilterOperator = 'before' | 'on' | 'after' | 'within'

/** 'added' = already in the pipeline on this machine. */
export type AddedFilterValue = 'added' | 'not_added'

export type BrowseFilterRule =
  | { id: string; property: 'term'; value: string }
  | { id: string; property: 'category'; value: string }
  | { id: string; property: 'company'; value: string }
  | { id: string; property: 'location'; value: string }
  | { id: string; property: 'added'; value: AddedFilterValue }
  | { id: string; property: 'posted'; operator: 'before' | 'on' | 'after'; date: string }
  | { id: string; property: 'posted'; operator: 'within'; from: string; to: string }

export type PostedFilterRule = Extract<BrowseFilterRule, { property: 'posted' }>

/** An empty text rule matches everything, so a just-added rule never blanks the table. */
function containsText(haystack: string, needle: string): boolean {
  const trimmed = needle.trim().toLocaleLowerCase()
  return trimmed === '' || haystack.toLocaleLowerCase().includes(trimmed)
}

export function listingMatchesRules(
  listing: JobListing,
  rules: readonly BrowseFilterRule[]
): boolean {
  return rules.every((rule) => {
    if (rule.property === 'term') return listing.term === rule.value
    if (rule.property === 'category') return listing.category === rule.value
    if (rule.property === 'company') return containsText(listing.company, rule.value)
    if (rule.property === 'location') return containsText(listing.locations, rule.value)
    if (rule.property === 'added') return listing.added === (rule.value === 'added')
    if (rule.operator === 'within') return listing.posted >= rule.from && listing.posted <= rule.to
    if (rule.operator === 'before') return listing.posted < rule.date
    if (rule.operator === 'on') return listing.posted === rule.date
    return listing.posted > rule.date
  })
}

export function filterListings(
  listings: readonly JobListing[],
  rules: readonly BrowseFilterRule[]
): readonly JobListing[] {
  return listings.filter((listing) => listingMatchesRules(listing, rules))
}

export function makeBrowseRule(
  property: BrowseFilterProperty,
  today: string,
  terms: readonly string[],
  categories: readonly string[]
): BrowseFilterRule {
  const id = crypto.randomUUID()
  if (property === 'term') {
    const first = terms[0]
    if (first === undefined) {
      throw new Error('Cannot add a term filter: the feed reported no hiring cycles')
    }
    return { id, property, value: first }
  }
  if (property === 'category') {
    const first = categories[0]
    if (first === undefined) {
      throw new Error('Cannot add a category filter: the feed reported no categories')
    }
    return { id, property, value: first }
  }
  if (property === 'company') return { id, property, value: '' }
  if (property === 'location') return { id, property, value: '' }
  if (property === 'added') return { id, property, value: 'not_added' }
  return { id, property, operator: 'on', date: today }
}

export function changeBrowseRuleProperty(
  rule: BrowseFilterRule,
  property: BrowseFilterProperty,
  today: string,
  terms: readonly string[],
  categories: readonly string[]
): BrowseFilterRule {
  return { ...makeBrowseRule(property, today, terms, categories), id: rule.id }
}

export function changePostedOperator(
  rule: PostedFilterRule,
  operator: PostedFilterOperator,
  today: string
): PostedFilterRule {
  const date = rule.operator === 'within' ? rule.from : rule.date
  if (operator === 'within') {
    return { id: rule.id, property: 'posted', operator, from: date, to: date }
  }
  return { id: rule.id, property: 'posted', operator, date: date === '' ? today : date }
}

export function replaceBrowseRule(
  rules: readonly BrowseFilterRule[],
  updated: BrowseFilterRule
): readonly BrowseFilterRule[] {
  return rules.map((rule) => (rule.id === updated.id ? updated : rule))
}
