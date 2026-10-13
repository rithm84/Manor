import { ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { latestCompanyReport, reportWindowOrder } from '../../../shared/problemSourceMetadata'
import type { ProblemSourceDate, ProblemSourceMetadata } from '../../../shared/problemSourceMetadata'
import { Button } from '../../components/ui'

/** Date-only source values retain their recorded precision and do not shift with local time. */
export function sourceDateLabel(value: ProblemSourceDate): string {
  if (value.precision === 'year') return value.value
  if (value.precision === 'month') return new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value.value}-01T00:00:00Z`))
  if (value.precision === 'day') return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value.value}T00:00:00Z`))
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short' }).format(new Date(value.value))
}

function SourceDate({ value }: { value: ProblemSourceDate }): ReactNode {
  return <time dateTime={value.value} title={value.precision === 'month' ? 'Reported to the month' : value.precision === 'year' ? 'Reported to the year' : undefined}>{sourceDateLabel(value)}</time>
}

/** A reporting window is useful recency evidence, while remaining distinct from an exact asked date. */
export function ProblemRecency({ metadata }: { metadata: ProblemSourceMetadata | undefined }): ReactNode {
  const asked = metadata?.lastAsked
  // An exact instant reads as its local day in the one-line cell; the full time stays in the title.
  if (asked !== undefined) return <span className="problem-recency tnum">{asked.precision === 'instant' ? <time dateTime={asked.value} title={sourceDateLabel(asked)}>{new Date(asked.value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</time> : <SourceDate value={asked} />}</span>
  const report = latestCompanyReport(metadata?.companyReports ?? [])
  if (report === undefined) return <span className="problem-empty-value">Not reported</span>
  // Rows stay one line tall, so the snapshot date behind a reporting window lives in the title.
  return <span className="problem-recency problem-recency--window tnum" title={`${windowLabels[report.window]}, as of ${sourceDateLabel({ value: report.snapshotDate, precision: 'day' })}`}>{windowLabels[report.window]}</span>
}

const windowLabels = { '30d': 'Last 30 days', '3m': 'Last 3 months', '6m': 'Last 6 months', '1y': 'Last year', all: 'All time', older_than_6m: '6+ months ago' } as const

export function ProblemSourceDetails({ metadata }: { metadata: ProblemSourceMetadata | undefined }): ReactNode {
  const [page, setPage] = useState(0)
  const reports = useMemo(() => [...metadata?.companyReports ?? []].sort((left, right) => right.snapshotDate.localeCompare(left.snapshotDate) || left.company.localeCompare(right.company) || reportWindowOrder[left.window] - reportWindowOrder[right.window]), [metadata?.companyReports])
  if (metadata === undefined) return null
  const facts = [metadata.lastAsked, metadata.reportedFrom, metadata.reportedTo, metadata.frequency, metadata.reportCount, metadata.durationMinutes, metadata.status].some(value => value !== undefined) || metadata.isNew === true
  if (!facts && reports.length === 0 && (metadata.snapshots?.length ?? 0) === 0) return null
  const pages = Math.max(1, Math.ceil(reports.length / 25))
  const currentPage = Math.min(page, pages - 1)
  return <section className="problem-source-details" data-testid="problem-source-details" aria-label="Source details">
    {!facts ? null : <dl>
      {metadata.lastAsked === undefined ? null : <div><dt>Last asked</dt><dd><SourceDate value={metadata.lastAsked} /></dd></div>}
      {metadata.reportedFrom === undefined && metadata.reportedTo === undefined ? null : <div><dt>Reported period</dt><dd>{metadata.reportedFrom === undefined ? 'Through ' : metadata.reportedTo === undefined ? 'Since ' : ''}{metadata.reportedFrom === undefined ? null : <SourceDate value={metadata.reportedFrom} />}{metadata.reportedFrom === undefined || metadata.reportedTo === undefined ? null : ' to '}{metadata.reportedTo === undefined ? null : <SourceDate value={metadata.reportedTo} />}</dd></div>}
      {metadata.frequency === undefined ? null : <div><dt>Frequency</dt><dd>{metadata.frequency}</dd></div>}
      {metadata.reportCount === undefined ? null : <div><dt>Reports</dt><dd className="tnum">{metadata.reportCount.toLocaleString()}</dd></div>}
      {metadata.durationMinutes === undefined ? null : <div><dt>Duration</dt><dd className="tnum">{metadata.durationMinutes} min</dd></div>}
      {metadata.status === undefined ? null : <div><dt>Source status</dt><dd>{metadata.status}</dd></div>}
      {metadata.isNew !== true ? null : <div><dt>Source listing</dt><dd>New</dd></div>}
    </dl>}
    {reports.length === 0 ? null : <details className="problem-source-reports"><summary><ChevronRight className="problem-disclosure-icon" size={14} aria-hidden="true" />Company reports <span className="tnum">({reports.length.toLocaleString()})</span></summary><p>Reporting windows reflect the source snapshot.</p><div className="problem-source-report-scroll"><table><thead><tr><th scope="col">Company</th><th scope="col">Window</th><th scope="col">Frequency</th><th scope="col">Snapshot</th><th scope="col" aria-label="Source" /></tr></thead><tbody>{reports.slice(currentPage * 25, (currentPage + 1) * 25).map((report, index) => <tr key={`${report.company}-${report.window}-${report.snapshotDate}-${index}`}><td>{report.company}</td><td>{windowLabels[report.window]}</td><td className="tnum">{report.frequency === null ? 'Not reported' : `${report.frequency}%`}</td><td><SourceDate value={{ value: report.snapshotDate, precision: 'day' }} /></td><td><a href={report.sourceUrl} target="_blank" rel="noreferrer">Source</a></td></tr>)}</tbody></table></div>{pages <= 1 ? null : <div className="problem-source-report-pages"><Button variant="ghost" onClick={() => setPage(currentPage - 1)} disabled={currentPage === 0}>Previous</Button><span className="tnum">{currentPage + 1} / {pages}</span><Button variant="ghost" onClick={() => setPage(currentPage + 1)} disabled={currentPage + 1 >= pages}>Next</Button></div>}</details>}
    {metadata.snapshots === undefined || metadata.snapshots.length === 0 ? null : <details className="problem-source-reports"><summary><ChevronRight className="problem-disclosure-icon" size={14} aria-hidden="true" />Source snapshots</summary><ul>{metadata.snapshots.map((snapshot, index) => <li key={`${snapshot.sourceUrl}-${snapshot.snapshotDate}-${index}`}><a href={snapshot.sourceUrl} target="_blank" rel="noreferrer"><SourceDate value={{ value: snapshot.snapshotDate, precision: 'day' }} /></a></li>)}</ul></details>}
  </section>
}
