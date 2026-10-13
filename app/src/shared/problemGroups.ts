import { filterProblems, searchRank } from './problemLibrary'
import type { ProblemFilters, ProblemRecord, ProblemSort } from './problemLibrary'
import { problemSourceDateBounds } from './problemSourceMetadata'
import type { ProblemSourceDate, ProblemSourceMetadata } from './problemSourceMetadata'

export interface ProblemGroup { readonly problem: ProblemRecord; readonly sources: readonly ProblemRecord[] }

function distinct<T>(values: readonly T[]): T[] {
  return [...new Map(values.map(value => [JSON.stringify(value), value])).values()]
}

/** Scalar report fields remain source-specific; shared evidence retains every distinct snapshot. */
function groupMetadata(canonical: ProblemRecord, sources: readonly ProblemRecord[]): ProblemSourceMetadata | undefined {
  const metadata = sources.flatMap(source => source.sourceMetadata === undefined ? [] : [source.sourceMetadata])
  if (metadata.length === 0) return undefined
  const asked = metadata.flatMap(source => source.lastAsked === undefined ? [] : [source.lastAsked])
  const latest = asked.reduce<ProblemSourceDate | undefined>((selected, current) => selected === undefined || problemSourceDateBounds(current)[0] > problemSourceDateBounds(selected)[0] ? current : selected, undefined)
  const snapshots = distinct(metadata.flatMap(source => source.snapshots ?? []))
  const companyReports = distinct(metadata.flatMap(source => source.companyReports ?? []))
  return { ...canonical.sourceMetadata, ...(latest === undefined ? {} : { lastAsked: latest }), ...(snapshots.length === 0 ? {} : { snapshots }), ...(companyReports.length === 0 ? {} : { companyReports }) }
}

/** The mirror retains raw identities; only the catalog projection hides retained duplicate sources. */
export function problemGroups(records: readonly ProblemRecord[]): ProblemGroup[] {
  const byId = new Map(records.map(record => [record.id, record]))
  const sources = new Map<string, ProblemRecord[]>()
  for (const record of records) {
    const canonicalId = record.canonicalProblemId ?? record.id
    const canonical = byId.get(canonicalId)
    if (canonical === undefined || canonical.canonicalProblemId != null) throw new Error(`The canonical problem for retained source ${record.id} is unavailable. Refresh your library before opening it.`)
    const group = sources.get(canonicalId) ?? []
    group.push(record); sources.set(canonicalId, group)
  }
  return records.filter(record => record.canonicalProblemId == null).map(canonical => {
    const members = sources.get(canonical.id) ?? [canonical]
    if (members.length === 1) return { problem: canonical, sources: members }
    const labels = (property: 'topics' | 'companies' | 'tags' | 'collections'): string[] => [...new Set(members.flatMap(member => member[property]))].sort((left, right) => left.localeCompare(right))
    return { problem: { ...canonical, topics: labels('topics'), companies: labels('companies'), tags: labels('tags'), collections: labels('collections'), sourceMetadata: groupMetadata(canonical, members) }, sources: members }
  })
}

/** Group recency matches any retained source, even when the newest report falls outside the range. While searching, relevance orders results before the chosen sort. */
export function filterProblemGroups(groups: readonly ProblemGroup[], filters: ProblemFilters, sort: readonly ProblemSort[]): ProblemRecord[] {
  const search = filters.search.trim().toLocaleLowerCase()
  const candidates = groups.filter(group => {
    if (search !== '' && group.problem.externalKey !== `leetcode:${search}` && ![group.problem.name, ...group.problem.topics, ...group.problem.companies, ...group.problem.tags, ...group.sources.flatMap(source => [source.name, source.sourceName ?? ''])].join(' ').toLocaleLowerCase().includes(search)) return false
    if (!filters.lastAskedSince && !filters.lastAskedUntil) return true
    return group.sources.some(source => {
      const asked = source.sourceMetadata?.lastAsked
      if (asked === undefined) return false
      const [from, through] = problemSourceDateBounds(asked)
      return (!filters.lastAskedSince || through >= filters.lastAskedSince) && (!filters.lastAskedUntil || from <= filters.lastAskedUntil)
    })
  })
  const sorted = filterProblems(candidates.map(group => group.problem), { ...filters, search: '', lastAskedSince: null, lastAskedUntil: null }, sort)
  // The sort is stable, so relevance leads and the chosen sort orders problems of equal relevance.
  return search === '' ? sorted : sorted.sort((left, right) => searchRank(left, search) - searchRank(right, search))
}
