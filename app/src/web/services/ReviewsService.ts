import { z } from 'zod'
import type { ReviewsApi, ReviewsSnapshot } from '../../shared/reviews'
import type { ManorGateway } from '../ManorGateway'
import { accountToday, camelRow } from './rows'

const reviewSchema = z.object({
  id: z.string().min(1), title: z.string().min(1), timezone: z.string().min(1),
  periodStart: z.iso.datetime({ offset: true }), periodEnd: z.iso.datetime({ offset: true }),
  content: z.string().min(1), model: z.string().min(1), createdAt: z.iso.datetime({ offset: true })
})

export class ReviewsService implements ReviewsApi {
  private readonly gateway: ManorGateway
  constructor(gateway: ManorGateway) { this.gateway = gateway }
  async load(): Promise<ReviewsSnapshot> {
    const [rows, { timezone }] = await Promise.all([this.gateway.rows('weekly_reviews'), accountToday(this.gateway)])
    return { timezone, reviews: rows.map((row) => reviewSchema.parse(camelRow(row))) }
  }
}
