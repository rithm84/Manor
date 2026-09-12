/** Read-only weekly reviews written by scheduled ChatGPT Work. */
export interface WeeklyReview {
  id: string
  title: string
  timezone: string
  periodStart: string
  periodEnd: string
  content: string
  model: string
  createdAt: string
}

export interface ReviewsSnapshot {
  timezone: string
  reviews: readonly WeeklyReview[]
}

export interface ReviewsApi {
  load: () => Promise<ReviewsSnapshot>
}
