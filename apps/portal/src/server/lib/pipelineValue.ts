/**
 * What a pipeline card is worth, and the header numbers built from that.
 *
 * A card carries its own quotePrice / jobValue, but those are typed once and
 * go stale. The value shown is read from the customer's quotes instead: the
 * open quote while the deal is still being sold, the sold quote from the
 * Signed stage onward. The card's own figure is only the fallback for a card
 * whose customer has no such quote.
 *
 * Which stages are Selling, Sold or Lost, and each Selling stage's chance of
 * closing, come from Settings > Pipeline Stages (the `stages` list passed in).
 *
 * One copy for both sides: the server's paged board (lib/pipelinePages.ts)
 * totals its columns with it, and the app imports it (apps/web/src/pipelineValue.ts).
 */

import { isSoldStage, isOpenStage, groupOf, chanceOf, type PipelineStageDef } from './pipelineStageModel.js'

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
  /** Approved change orders on the job's quote, in dollars (the server keeps it): a sold card is worth its contract. */
  changeOrderTotal?: number
}

/** A sold quote's value: the signed price plus the approved change orders on its job. */
// Quotes by customer and jobs by quote, built once per list. The stores replace
// their lists on every change (never edit them in place), so a list seen before
// has the same index. Without it every card searched every quote: with ~2,800
// cards and ~2,000 quotes that was millions of steps on each draw of the board.
const quoteIndex = new WeakMap<object, Map<string, QuoteForValue[]>>()
function quotesOf(quotes: QuoteForValue[], customerId: string): QuoteForValue[] {
  let m = quoteIndex.get(quotes)
  if (!m) {
    m = new Map()
    for (const q of quotes) {
      if (!q?.customerId) continue
      const list = m.get(q.customerId)
      if (list) list.push(q); else m.set(q.customerId, [q])
    }
    quoteIndex.set(quotes, m)
  }
  return m.get(customerId) ?? []
}
const jobIndex = new WeakMap<object, { byQuote: Map<string, JobForValue>; installed: Set<string> }>()
function jobsIndexed(jobs: JobForValue[]) {
  let ix = jobIndex.get(jobs)
  if (!ix) {
    ix = { byQuote: new Map(), installed: new Set() }
    for (const j of jobs) {
      if (!j) continue
      if (!ix.byQuote.has(j.quoteId)) ix.byQuote.set(j.quoteId, j)
      if (j.completedDate) ix.installed.add(j.quoteId)
    }
    jobIndex.set(jobs, ix)
  }
  return ix
}

function soldValue(q: QuoteForValue, jobs: JobForValue[]): number {
  const co = q.status === 'SOLD' ? jobsIndexed(jobs).byQuote.get(q.id)?.changeOrderTotal ?? 0 : 0
  return Math.round(((q.finalPrice || 0) + co) * 100) / 100
}

// The newest by date. Two on the same day: the same one whatever order the list came in (by id), so the
// server's column total and the app's cards agree (they read the quotes in different orders: e2e/pipeline-paging
// found Signed Contract $9,993 on the server and $7,981 on the board, Oct 26 2026).
const latest = <T extends { date: string; id?: string }>(list: T[]): T | undefined =>
  list.reduce<T | undefined>((best, q) => {
    if (!best) return q
    const a = q.date || '', b = best.date || ''
    return a > b || (a === b && String(q.id ?? '') > String(best.id ?? '')) ? q : best
  }, undefined)

/** The quote a card's value comes from, or undefined when the customer has none that fits. */
export function relevantQuote(lead: LeadForValue, quotes: QuoteForValue[], jobs: JobForValue[], stages: PipelineStageDef[]): QuoteForValue | undefined {
  if (!lead.customerId) return undefined
  const mine = quotesOf(quotes, lead.customerId)
  if (isSoldStage(stages, lead.stage)) {
    const sold = mine.filter(q => q.status === 'SOLD')
    if (groupOf(stages, lead.stage) === 'sold_ahead') {
      // A repeat customer: the job still to be installed is the one on the board.
      const installed = jobsIndexed(jobs).installed
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

export function leadValue(lead: LeadForValue, quotes: QuoteForValue[], jobs: JobForValue[], stages: PipelineStageDef[]): number {
  const q = relevantQuote(lead, quotes, jobs, stages)
  if (q) return soldValue(q, jobs)
  return lead.quotePrice || lead.jobValue || 0
}

export interface PipelineMetrics {
  /** Open cards (Selling, not sold or lost): sum of their values. */
  pipelineValue: number
  /** The same cards, each multiplied by its stage's chance of closing. */
  weighted: number
  /** Pipeline value divided by the open cards that have a value. */
  avgDeal: number
  /** Cards in a Sold stage: sum of their sold quotes. */
  sold: number
  /** The same, counting only cards whose sold quote is dated in `year`. */
  soldThisYear: number
  /** Cards sold in the period as a percent of cards created in the period, 0 to 100. */
  closeRate: number
  openCount: number
  soldCount: number
  soldInPeriod: number
  createdInPeriod: number
}

/** The close rate looks at the period from `since` (YYYY-MM-DD) to now: a card
 *  counts as sold in the period by its sold quote's date, and as created in the
 *  period by its own created date. `year` (YYYY) is the calendar year for
 *  soldThisYear. */
export function pipelineMetrics(leads: LeadForValue[], quotes: QuoteForValue[], jobs: JobForValue[], stages: PipelineStageDef[], since: string, year: string = since.slice(0, 4)): PipelineMetrics {
  let pipelineValue = 0, weighted = 0, valued = 0, sold = 0, soldThisYear = 0, openCount = 0, soldCount = 0, soldInPeriod = 0
  for (const l of leads) {
    const v = leadValue(l, quotes, jobs, stages)
    if (isSoldStage(stages, l.stage)) {
      sold += v; soldCount++
      const q = relevantQuote(l, quotes, jobs, stages)
      if (q && (q.date || '') >= since) soldInPeriod++
      if (q && q.status === 'SOLD' && (q.date || '').slice(0, 4) === year) soldThisYear += soldValue(q, jobs)
    } else if (isOpenStage(stages, l.stage)) {
      openCount++
      pipelineValue += v
      weighted += v * chanceOf(stages, l.stage)
      if (v > 0) valued++
    }
  }
  const createdInPeriod = leads.filter(l => (l.createdAt || '') >= since).length
  return {
    pipelineValue, weighted, sold, soldThisYear,
    avgDeal: valued > 0 ? pipelineValue / valued : 0,
    closeRate: createdInPeriod > 0 ? Math.round((soldInPeriod / createdInPeriod) * 100) : 0,
    openCount, soldCount, soldInPeriod, createdInPeriod,
  }
}
