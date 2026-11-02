/**
 * The labor on a saved job cost (Budget > Job Costing), the one rule every
 * reader uses (Jonathan, Nov 2 2026, docs/DECISIONS.md "Job costing: real labor
 * cost"): the Job Costing screen, the customer page's Job Costing tab, the P&L.
 * Pure (no app imports): the portal tests use it too.
 *
 *   Saved labor cost   the number the owner saved (actualLaborCostCents). Hours never change it.
 *   Crew lines         an entry saved before that field: its crew hours x rates.
 *   Old hours math     an entry saved before that field with no crew lines:
 *                      hours x the quote's rate, what it has always shown,
 *                      until Jonathan OKs the fix (scripts/job-cost-labor-fix-2026-11-02.ts)
 *                      or the entry is saved again. Marked on screen.
 *
 * Money on the entry stays as saved before this change: dollars in
 * actualMaterialCost and actualOtherCosts, and in a crew member's rate. The new
 * field is integer cents.
 */

export interface CrewEntry {
  name: string
  hours: number
  rate: number
}

export interface JobCostEntry {
  id: string
  quoteId: string
  completionDate: string
  /** Optional, for the record: never part of the cost. */
  actualLaborHrs: number
  crew: CrewEntry[]
  actualMaterialCost: number
  actualOtherCosts: number
  notes: string
  /** The labor cost used for profit, whole cents. Missing on an entry saved before Nov 2 2026. */
  actualLaborCostCents?: number
  /** True: typed over (it stays, whatever the crew adds up to). False: follows the crew total, or the prefill. */
  laborCostTyped?: boolean
  /** Sub job or crew job when saved. */
  laborKind?: 'sub' | 'crew'
  /** Where the labor and material numbers came from, in words, as saved. */
  laborSource?: string
  materialSource?: string
}

/** What the old hours math needs from the quote. */
export interface QuoteLabor { laborCost: number; adjLaborHrs?: number | null }

/** One crew member's pay in whole cents (rate is dollars an hour). */
export const crewLineCents = (c: Pick<CrewEntry, 'hours' | 'rate'>) => Math.round((Number(c.hours) || 0) * (Number(c.rate) || 0) * 100)

/** The crew breakdown added up, in whole cents. */
export const crewTotalCents = (crew: CrewEntry[] | null | undefined) => (crew ?? []).reduce((s, c) => s + crewLineCents(c), 0)

/** Where an entry's labor comes from. */
export function laborBasis(e: Pick<JobCostEntry, 'actualLaborCostCents' | 'crew'>): 'saved' | 'crew' | 'hours' {
  if (typeof e.actualLaborCostCents === 'number') return 'saved'
  return crewTotalCents(e.crew) > 0 ? 'crew' : 'hours'
}

/** The old math, for an entry saved before the labor cost existed and with no crew lines. */
export function oldHoursCents(e: Pick<JobCostEntry, 'actualLaborHrs'>, q: QuoteLabor): number {
  const hrs = Number(q.adjLaborHrs) || 0
  return Math.round((Number(e.actualLaborHrs) || 0) * (hrs > 0 ? (Number(q.laborCost) || 0) / hrs : 22) * 100)
}

/** The labor cost of a saved entry, in whole cents. */
export function entryLaborCents(e: Pick<JobCostEntry, 'actualLaborCostCents' | 'crew' | 'actualLaborHrs'>, q: QuoteLabor): number {
  const basis = laborBasis(e)
  if (basis === 'saved') return e.actualLaborCostCents as number
  return basis === 'crew' ? crewTotalCents(e.crew) : oldHoursCents(e, q)
}

/** The labor the form shows: a typed number stays; else the crew total when there is one; else the prefill. */
export function laborShown(f: { typed: boolean; typedCents: number; crewCents: number; baseCents: number }): number {
  if (f.typed) return f.typedCents
  return f.crewCents > 0 ? f.crewCents : f.baseCents
}

export interface JobResult { priceCents: number; costCents: number; profitCents: number; marginPct: number }

/** Profit and margin for a price and costs (margin % to 0.1). */
export function resultOf(priceCents: number, costCents: number): JobResult {
  const profitCents = priceCents - costCents
  return { priceCents, costCents, profitCents, marginPct: priceCents > 0 ? Math.round((profitCents / priceCents) * 1000) / 10 : 0 }
}

/**
 * The quote's margin on the same footing as the actual: price less cost. The
 * saved gmPct also takes off the commission, and the actual never has, so the
 * two could not be compared (a job right on estimate read 35% vs 44%).
 */
export function estMargin(q: { finalPrice: number; totalCOGS: number; gmPct: number }): number {
  return q.finalPrice > 0 && q.totalCOGS > 0 ? (q.finalPrice - q.totalCOGS) / q.finalPrice : q.gmPct
}

/** A saved entry as the P&L reads it (any older shape). */
export interface PlRecord {
  quoteId?: string
  actualLaborHrs?: number
  crew?: Array<{ hours?: number; rate?: number }>
  actualLaborCostCents?: number
  laborKind?: 'sub' | 'crew'
  laborCents?: number
  labor?: number
}

/** A sub job's pay reaches the P&L through its bill: with one linked, the hand entry is left out so it is not counted twice. */
export function plLaborCents(r: PlRecord, manHourRate: number, paidByBill: boolean): number {
  if (typeof r.actualLaborCostCents === 'number') return r.laborKind === 'sub' && paidByBill ? 0 : r.actualLaborCostCents
  if (typeof r.laborCents === 'number') return r.laborCents
  if (typeof r.labor === 'number') return Math.round(r.labor * 100)
  // Crew lines if there are any, otherwise actual hours at the man hour rate (the entry is from before the labor cost).
  const crewDollars = Array.isArray(r.crew) ? r.crew.reduce((sum, c) => sum + (Number(c.hours) || 0) * (Number(c.rate) || 0), 0) : 0
  return Math.round((crewDollars > 0 ? crewDollars : (Number(r.actualLaborHrs) || 0) * manHourRate) * 100)
}
