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
 *                      or someone edits the labor box. Marked on screen. Saving
 *                      it for another reason keeps it old (frozenOldLaborCents
 *                      holds the number, so changing its hours moves nothing).
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
  /** An old hours entry saved again with its labor box untouched: the old number, so hours can change without moving it. */
  frozenOldLaborCents?: number
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
export function laborBasis(e: Pick<JobCostEntry, 'actualLaborCostCents' | 'crew' | 'frozenOldLaborCents'>): 'saved' | 'crew' | 'hours' {
  if (typeof e.actualLaborCostCents === 'number') return 'saved'
  if (typeof e.frozenOldLaborCents === 'number') return 'hours'
  return crewTotalCents(e.crew) > 0 ? 'crew' : 'hours'
}

/** The old math, for an entry saved before the labor cost existed and with no crew lines. */
export function oldHoursCents(e: Pick<JobCostEntry, 'actualLaborHrs' | 'frozenOldLaborCents'>, q: QuoteLabor): number {
  if (typeof e.frozenOldLaborCents === 'number') return e.frozenOldLaborCents
  const hrs = Number(q.adjLaborHrs) || 0
  return Math.round((Number(e.actualLaborHrs) || 0) * (hrs > 0 ? (Number(q.laborCost) || 0) / hrs : 22) * 100)
}

/** The labor cost of a saved entry, in whole cents. */
export function entryLaborCents(e: Pick<JobCostEntry, 'actualLaborCostCents' | 'crew' | 'actualLaborHrs' | 'frozenOldLaborCents'>, q: QuoteLabor): number {
  const basis = laborBasis(e)
  if (basis === 'saved') return e.actualLaborCostCents as number
  return basis === 'crew' ? crewTotalCents(e.crew) : oldHoursCents(e, q)
}

/**
 * The labor the form shows: a typed number stays; else the crew total when
 * crew flows in; else the prefill. On a sub job the crew does not flow in: the
 * sub amount wins unless typed (crewFlows false).
 */
export function laborShown(f: { typed: boolean; typedCents: number; crewCents: number; baseCents: number; crewFlows?: boolean }): number {
  if (f.typed) return f.typedCents
  return f.crewCents > 0 && f.crewFlows !== false ? f.crewCents : f.baseCents
}

export interface JobResult { priceCents: number; costCents: number; profitCents: number; marginPct: number }

/** Profit and margin for a price and costs (margin % to 0.1). */
export function resultOf(priceCents: number, costCents: number): JobResult {
  const profitCents = priceCents - costCents
  return { priceCents, costCents, profitCents, marginPct: priceCents > 0 ? Math.round((profitCents / priceCents) * 1000) / 10 : 0 }
}

/** A sold quote says something about cost only when it carries one (moneyTruth.hasCost: 659 of 679 sold on dev do not). */
export const quoteHasCost = (q: { totalCOGS?: number | null }) => (Number(q.totalCOGS) || 0) > 0

/**
 * Is the actual good for a margin? With an estimate, any cost entered. A quote
 * with no cost has nothing to fall back on, so both labor and material must be
 * in: $0 labor and $123 material on a $3,700 job is not a 96.7% margin.
 */
export function actualKnown(f: { hasEstimate: boolean; laborCents: number; materialCents: number; actualCents: number }): boolean {
  return f.hasEstimate ? f.actualCents > 0 : f.laborCents > 0 && f.materialCents > 0
}

export interface RowQuote extends QuoteLabor { finalPrice: number; totalCOGS: number }

export interface CostRow {
  laborCents: number
  priceCents: number
  actualCents: number
  /** The quote has a cost on file. */
  hasEstimate: boolean
  /** The actual is good for a margin (actualKnown). */
  hasActual: boolean
  /** Null: the quote has no cost on file. */
  estCents: number | null
  /** Null unless there is an estimate and an actual. */
  varianceCents: number | null
  /** Price less cost, the same footing for both (neither takes off commission). Null when not known. */
  estGM: number | null
  actGM: number | null
}

const dollarsCents = (v: unknown) => Math.round((Number(v) || 0) * 100)

/** One saved entry against its quote: the one rule for the Job Costing screen and the customer's tab. */
export function costRow(e: Pick<JobCostEntry, 'actualLaborCostCents' | 'crew' | 'actualLaborHrs' | 'frozenOldLaborCents' | 'actualMaterialCost' | 'actualOtherCosts'>, q: RowQuote): CostRow {
  const laborCents = entryLaborCents(e, q)
  const actualCents = laborCents + dollarsCents(e.actualMaterialCost) + dollarsCents(e.actualOtherCosts)
  const priceCents = dollarsCents(q.finalPrice)
  const hasEstimate = quoteHasCost(q)
  const materialCents = dollarsCents(e.actualMaterialCost)
  const hasActual = actualKnown({ hasEstimate, laborCents, materialCents, actualCents })
  const estCents = hasEstimate ? dollarsCents(q.totalCOGS) : null
  const margin = (cost: number) => (priceCents > 0 ? (priceCents - cost) / priceCents : null)
  return {
    laborCents, priceCents, actualCents, hasEstimate, hasActual, estCents,
    varianceCents: estCents !== null && hasActual ? actualCents - estCents : null,
    estGM: estCents !== null ? margin(estCents) : null,
    actGM: hasActual ? margin(actualCents) : null,
  }
}

export interface PlBill { jobId?: string | null; category: string; status: string; totalCents: number }

/**
 * Job labor on the P&L (the coordinator's decisions for Jonathan, Nov 2 2026):
 * each job's labor counts once, nothing vanishes, the typed number is the one
 * used, and the P&L agrees with the screen. The number is the job's entry; with
 * no entry (or one that holds no labor), its approved crew takeoff. The bills
 * are already on the P&L by their own date, so that number adds only what it is
 * above the job's Subcontractor and Labor bills: the larger of the two. The top
 * up lands with the bills: Subcontractors when the job has a Subcontractor bill,
 * else Direct Labor. An entry whose quote is gone is left out, as the Job
 * Costing screen leaves it out. Two entries for one job (two browsers, before
 * that was stopped) count once: the newest, the first in the list.
 */
export function plJobLabor(i: {
  records: JobCostEntry[]
  quotes: Array<QuoteLabor & { id: string }>
  jobs: Array<{ id?: string; quoteId?: string | null }>
  bills: PlBill[]
  /** Approved crew takeoffs: used for a job with no entry. */
  takeoffs: Array<{ jobId: string; quoteId: string | null; installDate: string; crewLaborCostCents: number }>
  inPeriod: (day: string) => boolean
}): { directLabor: number; subcontractors: number } {
  const billed = new Map<string, { sub: number; labor: number }>()
  for (const b of i.bills) {
    if (b.status === 'void' || b.status === 'draft' || !b.jobId || (b.category !== 'subcontractor' && b.category !== 'labor')) continue
    const x = billed.get(b.jobId) ?? { sub: 0, labor: 0 }
    if (b.category === 'subcontractor') x.sub += b.totalCents; else x.labor += b.totalCents
    billed.set(b.jobId, x)
  }
  const out = { directLabor: 0, subcontractors: 0 }
  const add = (jobId: string | null | undefined, cents: number) => {
    const b = (jobId && billed.get(jobId)) || { sub: 0, labor: 0 }
    const topUp = Math.max(0, cents - b.sub - b.labor)
    if (b.sub > 0) out.subcontractors += topUp; else out.directLabor += topUp
  }
  const quoteById = new Map(i.quotes.map(q => [q.id, q]))
  const jobOfQuote = new Map(i.jobs.filter(j => j.quoteId).map(j => [j.quoteId as string, j.id]))
  const entered = new Set<string>()
  for (const r of i.records) {
    const q = quoteById.get(r.quoteId)
    if (!q || entered.has(r.quoteId)) continue
    const cents = entryLaborCents(r, q)
    // An old entry with no labor in it says nothing about labor: the takeoff still speaks. A saved $0 was typed.
    if (cents <= 0 && laborBasis(r) !== 'saved') continue
    entered.add(r.quoteId)
    if (r.completionDate && i.inPeriod(r.completionDate)) add(jobOfQuote.get(r.quoteId), cents)
  }
  for (const t of i.takeoffs) if (!(t.quoteId && entered.has(t.quoteId)) && i.inPeriod(t.installDate)) add(t.jobId, t.crewLaborCostCents)
  return out
}
