import { browserSurfaces } from '../../web/browserTools'
import { useCommitVersion } from '../services/useCommitVersion'
import { CalendarCheck, ChevronRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { ReviewsSnapshot, WeeklyReview } from '../../shared/reviews'
import { DetailDialog, EmptyState } from '../components/ui'
import { useManorService } from '../services/ManorServices'
import { PageShell } from './PageShell'
import './reviews/reviews.css'

function periodLabel(review: WeeklyReview): string {
  const formatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: review.timezone })
  return `${formatter.format(new Date(review.periodStart))} – ${formatter.format(new Date(review.periodEnd))}`
}

export function WeeklyReviewsPage(): ReactNode {
  const api = useManorService('reviews')
  const commitVersion = useCommitVersion()
  const [snapshot, setSnapshot] = useState<ReviewsSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<WeeklyReview | null>(null)
  useEffect(() => browserSurfaces.attachModule({
    module: 'weekly-reviews',
    context: () => ({ ready: snapshot !== null, selected_object_id: selected?.id ?? null, navigation_blocked: false, filters: {}, presentation: 'dialog' }),
    open: id => {
      const review = snapshot?.reviews.find(candidate => candidate.id === id)
      if (!review) throw new Error(`Weekly review ${id} is not available in the current account`)
      setSelected(review)
    },
    filter: null
  }), [snapshot, selected])

  useEffect(() => {
    let disposed = false
    void api.load().then((value) => { if (!disposed) setSnapshot(value) }).catch((cause: Error) => { if (!disposed) setError(cause.message) })
    return (): void => { disposed = true }
  }, [api, commitVersion])
  return <PageShell title="Weekly reviews" fullBleed={false}>
    <p className="reviews-intro">A little perspective on the week.</p>
    {error !== null ? <p className="reviews-error" role="alert">{error}</p> : snapshot === null ? <p role="status">Loading reviews…</p> : snapshot.reviews.length === 0 ? <EmptyState icon={<CalendarCheck size={20} />} title="Your week, reflected" message="Your weekly reviews will appear here when they’re ready." /> : <div className="reviews-list">
      {[...snapshot.reviews].sort((a, b) => b.periodEnd.localeCompare(a.periodEnd)).map((review) => <button type="button" key={review.id} className="reviews-row" data-testid={`review-${review.id}`} onClick={() => setSelected(review)}>
        <CalendarCheck size={18} /><span><strong>{review.title}</strong><span>{periodLabel(review)}</span><span>{review.content.slice(0, 220)}</span></span><ChevronRight size={16} />
      </button>)}
    </div>}
    <DetailDialog open={selected !== null} onClose={() => setSelected(null)} title={selected !== null && snapshot !== null ? periodLabel(selected) : 'Weekly review'} width={760} ariaLabel="Weekly review">
      {selected !== null ? <article className="review-document"><p className="review-byline">Weekly review · ChatGPT</p><div>{selected.content}</div></article> : null}
    </DetailDialog>
  </PageShell>
}
