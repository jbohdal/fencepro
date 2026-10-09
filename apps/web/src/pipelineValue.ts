/**
 * What a pipeline card is worth, and the header numbers built from that.
 *
 * A card carries its own quotePrice / jobValue, but those are typed once and
 * go stale. The value shown is read from the customer's quotes instead: the
 * open quote while the deal is still being sold, the sold quote from Signed
 * Contract onward. The card's own figure is only the fallback for a card
 * whose customer has no such quote.
 */

export const PRE_SALE_STAGES   = new Set(['First Contact', 'Appointment', 'Estimating', 'Pending Signature'])
export const PRODUCTION_STAGES = new Set(['Signed Contract', 'Job Prep', 'Pending Start', 'Jobs In Progress'])
export const CLOSING_STAGES    = new Set(['Job Complete', 'Pending Payment', 'Paid & Closed'])
export const DEAD_STAGES       = new Set(['Lost Sale', 'No Answer'])

/** Signed Contract and everything after it. */
export function isSoldStage(stage: string): boolean {
  return PRODUCTION_STAGES.has(stage) || CLOSING_STAGES.has(stage)
}

/** Still being sold: not sold, not dead. A renamed or custom stage counts as open. */
export function isOpenStage(stage: string): boolean {
  return !isSoldStage(stage) && !DEAD_STAGES.has(stage)
}

export const STAGE_PROBABILITY: Record<string, number> = {
  'First Contact': 0.05, 'Appointment': 0.15, 'Estimating': 0.30, 'Pending Signature': 0.60,
}
const DEFAULT_PROBABILITY = 0.1

export interface LeadForValue {
  id: string
  customerId?: string
  stage: string
  quotePrice?: number
  jobValue?: number
  createdAt?: string
}
export interface QuoteForValue {
  id: string
  customerId?: string
  status: string       // DRAFT | SENT | SOLD | LOST
  date: string         // YYYY-MM-DD
  finalPrice: number
}
export interface JobForValue {
  quoteId: string
  completedDate?: string | null
}

const latest = <T extends { date: string }>(list: T[]): T | undefined =>
  list.reduce<T | undefined>((best, q) => (!best || (q.date || '') > (best.date || '') ? q : best), undefined)

/** The quote a card's value comes from, or undefined when the customer has none that fits. */
export function relevantQuote(lead: LeadForValue, quotes: QuoteForValue[], jobs: JobForValue[] = []): QuoteForValue | undefined {
  if (!lead.customerId) return undefined
  const mine = quotes.filter(q => q.customerId === lead.customerId)
  if (isSoldStage(lead.stage)) {
    const sold = mine.filter(q => q.status === 'SOLD')
    if (PRODUCTION_STAGES.has(lead.stage)) {
      // A repeat customer: the job still to be installed is the one on the board.
      const installed = new Set(jobs.filter(j => j.completedDate).map(j => j.quoteId))
      const pending = sold.filter(q => !installed.has(q.id))
      if (pending.length > 0) return latest(pending)
    }
    return latest(sold)
  }
  // Newest open quote; on the same day a sent quote beats a draft.
  const sent = latest(mine.filter(q => q.status === 'SENT'))
  const draft = latest(mine.filter(q => q.status === 'DRAFT'))
  if (sent && draft) return (draft.date || '') > (sent.date || '') ? draft : sent
  return sent || draft
}

export function leadValue(lead: LeadForValue, quotes: QuoteForValue[], jobs: JobForValue[] = []): number {
  const q = relevantQuote(lead, quotes, jobs)
  if (q) return q.finalPrice || 0
  return lead.quotePrice || lead.jobValue || 0
}

export interface PipelineMetrics {
  /** Open cards (before Signed Contract, not lost): sum of their values. */
  pipelineValue: number
  /** The same cards, each multiplied by its stage's chance of closing. */
  weighted: number
  /** Pipeline value divided by the open cards that have a value. */
  avgDeal: number
  /** Cards at Signed Contract or later: sum of their sold quotes. */
  sold: number
  /** Cards sold in the period as a percent of cards created in the period, 0 to 100. */
  closeRate: number
  openCount: number
  soldCount: number
  soldInPeriod: number
  createdInPeriod: number
}

/** The close rate looks at the period from `since` (YYYY-MM-DD) to now: a card
 *  counts as sold in the period by its sold quote's date, and as created in the
 *  period by its own created date. */
export function pipelineMetrics(leads: LeadForValue[], quotes: QuoteForValue[], jobs: JobForValue[], since: string): PipelineMetrics {
  let pipelineValue = 0, weighted = 0, valued = 0, sold = 0, openCount = 0, soldCount = 0, soldInPeriod = 0
  for (const l of leads) {
    const v = leadValue(l, quotes, jobs)
    if (isSoldStage(l.stage)) {
      sold += v; soldCount++
      const q = relevantQuote(l, quotes, jobs)
      if (q && (q.date || '') >= since) soldInPeriod++
    } else if (isOpenStage(l.stage)) {
      openCount++
      pipelineValue += v
      weighted += v * (STAGE_PROBABILITY[l.stage] ?? DEFAULT_PROBABILITY)
      if (v > 0) valued++
    }
  }
  const createdInPeriod = leads.filter(l => (l.createdAt || '') >= since).length
  return {
    pipelineValue, weighted, sold,
    avgDeal: valued > 0 ? pipelineValue / valued : 0,
    closeRate: createdInPeriod > 0 ? Math.round((soldInPeriod / createdInPeriod) * 100) : 0,
    openCount, soldCount, soldInPeriod, createdInPeriod,
  }
}
