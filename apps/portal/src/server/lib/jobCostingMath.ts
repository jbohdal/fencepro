/**
 * Job costing math: quoted vs actual (Jonathan, Oct 2026). Pure functions,
 * shared by the server (lib/jobCosting.ts) and the web app (JobCosting.tsx,
 * JobCostingReport.tsx). Money is integer cents throughout.
 *
 * Quoted cost: the sold quote as priced, frozen when it was signed: the pull
 * sheet lines (qty x unit cost), labor, tear out, and any material on the quote
 * that is not a pull sheet line (a move's disposal, rounding).
 *
 * Actual cost, once the crew's takeoff is in:
 *   material  = sum over lines of (used qty x landed cost on the install date);
 *               a job lot invoice linked to the job replaces the Inventory cost
 *               for the parts it covers. "Used" is what went into the job
 *               (installed, broken, cut to waste); what came back to the shop or
 *               went back to the vendor is recorded on the line and is not a job
 *               cost.
 *   labor     = sub: the amount the takeoff records as paid to the sub ("Sub
 *               paid $", entered by the owner or office), else units
 *               paid (sections or feet, as the quote was priced) x the sub rate
 *               saved at signing (JobQuotedCost); crew: hours x the hourly rate
 *               saved at signing; plus any other labor pay the office adds
 *               (Jonathan, Oct 20, 2026). A job signed before job costing has
 *               no saved rates, so it uses Settings' rates of today.
 *   tear out and other quoted material: carried as quoted (the takeoff does
 *               not count them), and labeled so.
 *
 * Field names: quantities never contain "cost", so the cost scrubber
 * (lib/costRedact.ts) leaves them for the crew; every cost field does.
 */

// ── Shapes ────────────────────────────────────────────────────────────────────

/** A pull sheet line as priced at signing (owner and office only). */
export interface QuotedLine {
  key: string
  part: string
  inventoryItemId: string | null
  qty: number
  unitCostCents: number
  totalCostCents: number
}

export type LaborMode = 'sub' | 'crew'

export interface QuotedLabor {
  /** How the quote priced labor: sub (per section or foot), crew (man hours), flat (typed on the quote). */
  mode: LaborMode | 'flat'
  subUnit: 'section' | 'foot'
  /** Sections or feet the sub was to be paid on. */
  subUnits: number
  /** The sub rate per unit the quote was priced with. */
  subRateCostCents: number
  /** Settings' hourly rate when it was signed. */
  hourlyCostCents: number
  /**
   * Sub labor the quote paid besides the sections or feet, at signing: walk
   * and double gates, tear out and extra hours, at the rates in Settings then
   * (as pricingEngine.ts prices them), never more than the quote's labor
   * beyond the sections. Costs saved before Oct 25, 2026 have none (0).
   */
  subOtherCents?: number
}

/** The sub labor a quote paid beyond units x rate (gates, tear out, extra hours), in cents; 0 when not sub labor or not saved. */
export function subOtherOf(q: Pick<QuotedCost, 'labor'> | null | undefined): number {
  if (!q || q.labor?.mode !== 'sub') return 0
  const v = q.labor.subOtherCents
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0
}

export interface QuotedCost {
  quoteId: string
  signedAt: string
  signedVia: string
  fenceStyle: string
  salesRep: string
  jobType: string
  sections: number
  footage: number
  priceCents: number
  materialCents: number
  laborCents: number
  tearOutCents: number
  totalCents: number
  lines: QuotedLine[]
  labor: QuotedLabor
}

/** One line of the crew's takeoff: quantities only. */
export interface TakeoffLine {
  id: string
  /** The pull sheet line it came from (QuotedLine.key); null for an item added on the job. */
  key: string | null
  part: string
  inventoryItemId: string | null
  /** On the pull sheet (0 for an added item). */
  plannedQty: number
  /** Went into the job: installed, broken, cut to waste. */
  usedQty: number
  /** Brought back to the shop (into stock). */
  shopReturnQty: number
  /** Sent back to the vendor (credit expected). */
  vendorReturnQty: number
  /** Added on the job, not on the pull sheet. */
  extra: boolean
  /** Why it was added: extra, broken, other. */
  reason: string
  note: string
  photoClientId: string | null
}

export interface CrewHours { id: string; name: string; hours: number }

export interface TakeoffLabor {
  mode: LaborMode
  subUnit: 'section' | 'foot'
  /** Sections (or feet) the sub was paid for. */
  subUnits: number
  /** What the sub was actually paid, in cents, entered by the owner or office (a cost: never on an installer's phone); null: units x the rate saved at signing. */
  subPaidCents?: number | null
  crew: CrewHours[]
}

export type TakeoffStatus = 'draft' | 'submitted' | 'approved'

/** Where a line's actual unit cost came from. */
export type CostSource = 'invoice' | 'job_lot' | 'inventory' | 'quote' | 'none'

export interface ActualLine {
  lineId: string
  key: string | null
  part: string
  inventoryItemId: string | null
  plannedQty: number
  usedQty: number
  shopReturnQty: number
  vendorReturnQty: number
  extra: boolean
  unitCostCents: number
  totalCostCents: number
  costSource: CostSource
  invoiceId?: string
}

export interface ActualCost {
  installDate: string
  lines: ActualLine[]
  materialCents: number
  laborCents: number
  /** How labor was worked out, in words. */
  laborMath: string
  otherLaborCostCents: number
  tearOutCents: number
  /** Quoted material not on the pull sheet, carried as quoted. */
  otherMaterialCents: number
  totalCents: number
  /** Frozen (approved) or worked out now (a preview). */
  frozen: boolean
}

// ── Small helpers ─────────────────────────────────────────────────────────────

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : d)
/** Dollars (a float as saved on quotes and Inventory) to integer cents. */
export const toCents = (dollars: unknown) => Math.round(num(dollars) * 100)
/** A quantity: whole or a fraction to 2 places, never negative. */
export const qty = (v: unknown) => Math.max(0, Math.round(num(v) * 100) / 100)

/** The match key for a part: its Inventory item when known, else its name (case and spaces ignored). */
export function partKey(p: { inventoryItemId?: string | null; part: string }): string {
  return p.inventoryItemId ? `id:${p.inventoryItemId}` : `name:${p.part.trim().toLowerCase().replace(/\s+/g, ' ')}`
}

/** An Inventory item for a pull sheet name: exact name, else the same name ignoring case and spaces. */
export function findItemId(items: Array<{ id?: unknown; name?: unknown }>, name: string): string | null {
  const exact = items.find(i => i?.name === name && typeof i.id === 'string')
  if (exact) return exact.id as string
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')
  const n = norm(name)
  const loose = items.find(i => typeof i?.name === 'string' && norm(i.name) === n && typeof i.id === 'string')
  return loose ? (loose.id as string) : null
}

// ── Quoted cost, at signing ───────────────────────────────────────────────────

export interface QuoteForSnapshot {
  id: string
  fenceStyle: string
  salesRep: string
  sections: number
  runs: unknown
  materialCost: number
  laborCost: number
  tearOutCost: number
  totalCOGS: number
  finalPrice: number
  pullSheet: unknown
  pricing: unknown
  work: unknown
  /** Gates, tear out and extra hours: the sub's pay for them is part of its labor (subOtherCents). */
  walkGates?: number | null
  dblGates?: number | null
  tearOutSections?: number | null
  tearOutGates?: number | null
  adjLaborHrs?: number | null
}

export interface PricingSettings {
  laborMode?: string
  subUnit?: string
  manHourRate?: number
  subRateDefault?: number
  subRateByCategory?: Record<string, number>
  subWalkGate?: number
  subDblGate?: number
  subTearOutSection?: number
  subTearOutGate?: number
}

export interface StyleForRate { name?: string; category?: string; subRate?: number }

const pos = (v: unknown) => { const n = num(v, NaN); return Number.isFinite(n) && n > 0 ? n : undefined }

/** The sub rate a quote is priced with: its own, the style's, the style category's, Settings' default (as pricingEngine.resolveSubRate). */
export function subRateFor(style: StyleForRate | undefined, pricing: PricingSettings, quoteOverride?: unknown): number {
  return pos(quoteOverride) ?? pos(style?.subRate) ?? pos(style?.category ? pricing.subRateByCategory?.[style.category] : undefined) ?? pos(pricing.subRateDefault) ?? 0
}

/** The quoted cost of a quote as it is now (called once, when it is signed). */
export function quotedCostOf(q: QuoteForSnapshot, ctx: {
  inventory: Array<{ id?: unknown; name?: unknown }>
  pricing: PricingSettings
  style?: StyleForRate
  signedVia: string
  signedAt: Date
}): QuotedCost {
  const sheet = Array.isArray(q.pullSheet) ? (q.pullSheet as any[]) : []
  const lines: QuotedLine[] = sheet
    .filter(l => l && typeof l.item === 'string' && l.item.trim())
    .map((l, i) => {
      const unitCostCents = toCents(l.unitCost)
      const n = qty(l.qty)
      return {
        key: `q${i}`, part: String(l.item), inventoryItemId: findItemId(ctx.inventory, String(l.item)), qty: n,
        unitCostCents, totalCostCents: typeof l.total === 'number' ? toCents(l.total) : Math.round(n * unitCostCents),
      }
    })
  const pricing = (q.pricing && typeof q.pricing === 'object' ? q.pricing : {}) as Record<string, unknown>
  const work = (q.work && typeof q.work === 'object' ? q.work : null) as Record<string, unknown> | null
  const runs = Array.isArray(q.runs) ? (q.runs as unknown[]).map(r => num(typeof r === 'object' && r ? (r as any).ft : r)).filter(n => n > 0) : []
  const footage = Math.round(runs.reduce((s, n) => s + n, 0))
  const requested = String(pricing.laborMode ?? ctx.pricing.laborMode ?? 'hourly')
  const flat = typeof pricing.laborCost === 'number'
  // The unit travels with the rate (pricingEngine.subUnitOf, Oct 30 2026): the quote's own only when picked on it or with its own rate.
  const ownUnit = pricing.subUnitPicked === true || pos(pricing.subRate) !== undefined
  const subUnit = ((ownUnit ? pricing.subUnit : undefined) ?? ctx.pricing.subUnit) === 'section' ? 'section' : 'foot'
  const laborMode: QuotedLabor['mode'] = flat || work ? 'flat' : requested === 'subcontractor' ? 'sub' : 'crew'
  const materialCents = toCents(q.materialCost)
  const laborCents = toCents(q.laborCost)
  const tearOutCents = toCents(q.tearOutCost)
  const subUnits = subUnit === 'section' ? Math.max(0, Math.round(num(q.sections))) : footage
  const subRateCostCents = toCents(subRateFor(ctx.style, ctx.pricing, pricing.subRate))
  return {
    quoteId: q.id, signedAt: ctx.signedAt.toISOString(), signedVia: ctx.signedVia, fenceStyle: q.fenceStyle, salesRep: q.salesRep,
    jobType: work && (work.type === 'move' || work.type === 'repair') ? String(work.type) : 'new',
    sections: Math.max(0, Math.round(num(q.sections))), footage,
    priceCents: toCents(q.finalPrice), materialCents, laborCents, tearOutCents,
    totalCents: toCents(q.totalCOGS) || materialCents + laborCents + tearOutCents,
    lines,
    labor: {
      mode: laborMode, subUnit, subUnits, subRateCostCents, hourlyCostCents: toCents(ctx.pricing.manHourRate),
      // The gates (and tear out, extra hours) the sub is paid for besides the sections, as priced.
      ...(laborMode === 'sub' ? { subOtherCents: Math.min(
        Math.max(0, laborCents - Math.round(subUnits * subRateCostCents)),
        toCents(num(q.walkGates) * num(ctx.pricing.subWalkGate) + num(q.dblGates) * num(ctx.pricing.subDblGate)
          + num(q.tearOutSections) * num(ctx.pricing.subTearOutSection) + num(q.tearOutGates) * num(ctx.pricing.subTearOutGate)
          + num(q.adjLaborHrs) * num(ctx.pricing.manHourRate)),
      ) } : {}),
    },
  }
}

/** Quoted material that is not a pull sheet line (a move's disposal, rounding); never below 0. */
export function otherQuotedMaterial(q: Pick<QuotedCost, 'materialCents' | 'lines'>): number {
  return Math.max(0, q.materialCents - q.lines.reduce((s, l) => s + l.totalCostCents, 0))
}

// ── The takeoff ───────────────────────────────────────────────────────────────

/** The takeoff's starting lines: the pull sheet, used = planned. */
export function linesFromQuoted(lines: QuotedLine[], newId: (key: string) => string): TakeoffLine[] {
  return lines.map(l => ({
    id: newId(l.key), key: l.key, part: l.part, inventoryItemId: l.inventoryItemId, plannedQty: l.qty, usedQty: l.qty,
    shopReturnQty: 0, vendorReturnQty: 0, extra: false, reason: '', note: '', photoClientId: null,
  }))
}

/** The takeoff's starting labor: as the quote was priced (sub units = the quote's sections or feet). */
export function laborFromQuoted(q: QuotedLabor | null, fallback: { mode: LaborMode; subUnit: 'section' | 'foot'; subUnits: number }): TakeoffLabor {
  if (!q) return { mode: fallback.mode, subUnit: fallback.subUnit, subUnits: fallback.subUnits, crew: [] }
  return { mode: q.mode === 'sub' ? 'sub' : 'crew', subUnit: q.subUnit, subUnits: q.mode === 'sub' ? q.subUnits : 0, crew: [] }
}

/** The amount the takeoff records as paid to the sub, in whole cents, or null when none is entered. */
export function subPaidOf(l: { subPaidCents?: unknown }): number | null {
  const v = l?.subPaidCents
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null
}

export const crewHoursTotal = (l: TakeoffLabor) => Math.round(l.crew.reduce((s, c) => s + qty(c.hours), 0) * 100) / 100

// ── Actual cost ───────────────────────────────────────────────────────────────

export interface UnitCost { cents: number; source: CostSource; invoiceId?: string }

/**
 * The actual cost of a takeoff. `unitCostOf` gives each line's landed cost
 * (job lot invoice, else Inventory on the install date, else the quote's).
 */
export function actualCostOf(t: { lines: TakeoffLine[]; labor: TakeoffLabor; installDate: string }, ctx: {
  quoted: QuotedCost | null
  unitCostOf: (line: TakeoffLine) => UnitCost
  /** Settings' hourly rate today: used only when there is no quoted cost (nothing saved at signing). */
  hourlyCostCents: number
  /** Settings' sub rate today: used only when there is no quoted cost. */
  subRateCostCents: number
  otherLaborCostCents: number
  frozen: boolean
}): ActualCost {
  const lines: ActualLine[] = t.lines.map(l => {
    const u = ctx.unitCostOf(l)
    const used = qty(l.usedQty)
    return {
      lineId: l.id, key: l.key, part: l.part, inventoryItemId: l.inventoryItemId, plannedQty: qty(l.plannedQty), usedQty: used, shopReturnQty: qty(l.shopReturnQty), vendorReturnQty: qty(l.vendorReturnQty),
      extra: l.extra, unitCostCents: u.cents, totalCostCents: Math.round(used * u.cents), costSource: u.source, ...(u.invoiceId ? { invoiceId: u.invoiceId } : {}),
    }
  })
  const materialCents = lines.reduce((s, l) => s + l.totalCostCents, 0)
  const other = Math.max(0, Math.round(ctx.otherLaborCostCents))
  let laborCents: number
  let laborMath: string
  // The rates saved at signing; Settings' rates of today only for a job signed before job costing.
  const savedSub = ctx.quoted ? ctx.quoted.labor?.subRateCostCents : undefined
  const savedHourly = ctx.quoted ? ctx.quoted.labor?.hourlyCostCents : undefined
  let source = ''
  const paid = subPaidOf(t.labor)
  if (t.labor.mode === 'sub' && paid !== null) {
    laborCents = paid
    laborMath = `Sub paid ${usd(paid)}`
    source = 'entered on the takeoff'
  } else if (t.labor.mode === 'sub') {
    const rate = typeof savedSub === 'number' && savedSub > 0 ? savedSub : ctx.subRateCostCents
    const units = qty(t.labor.subUnits)
    // Gates, tear out and extra hours the sub is paid for besides the sections, as the quote priced them.
    const gates = subOtherOf(ctx.quoted)
    laborCents = Math.round(units * rate) + gates
    laborMath = `${units} ${t.labor.subUnit === 'section' ? 'sections' : 'ft'} paid × ${usd(rate)}${gates ? ` + ${usd(gates)} gates and other sub work as quoted` : ''}`
    source = typeof savedSub === 'number' && savedSub > 0 ? 'sub rate saved at signing' : "Settings' sub rate today (none saved at signing)"
  } else {
    const rate = typeof savedHourly === 'number' && savedHourly > 0 ? savedHourly : ctx.hourlyCostCents
    const hours = crewHoursTotal(t.labor)
    laborCents = Math.round(hours * rate)
    laborMath = `${hours} crew hours × ${usd(rate)}/hr`
    source = typeof savedHourly === 'number' && savedHourly > 0 ? 'hourly rate saved at signing' : "Settings' hourly rate today (none saved at signing)"
  }
  if (other) laborMath += ` + ${usd(other)} other labor`
  laborMath += ` (${source})`
  laborCents += other
  const tearOutCents = ctx.quoted?.tearOutCents ?? 0
  const otherMaterialCents = ctx.quoted ? otherQuotedMaterial(ctx.quoted) : 0
  return {
    installDate: t.installDate, lines, materialCents, laborCents, laborMath, otherLaborCostCents: other, tearOutCents, otherMaterialCents,
    totalCents: materialCents + laborCents + tearOutCents + otherMaterialCents, frozen: ctx.frozen,
  }
}

/**
 * Unit cost from job lot invoice lines, by Inventory item: each line's landed
 * cents is what the whole line really cost (its amount plus its share of tax,
 * freight and fees; lib/priceHistory.ts), so the unit cost is the lines'
 * landed total over their quantity.
 */
export function jobLotUnitCosts(lines: Array<{ invoiceId: string; inventoryItemId: string | null; quantity: number; landedCents: number }>): Map<string, UnitCost> {
  const acc = new Map<string, { qty: number; cents: number; invoiceId: string }>()
  for (const l of lines) {
    if (!l.inventoryItemId || !(l.quantity > 0) || !(l.landedCents >= 0)) continue
    const a = acc.get(l.inventoryItemId) ?? { qty: 0, cents: 0, invoiceId: l.invoiceId }
    a.qty += l.quantity
    a.cents += l.landedCents
    acc.set(l.inventoryItemId, a)
  }
  return new Map([...acc].map(([id, a]) => [id, { cents: Math.round(a.cents / a.qty), source: 'job_lot' as const, invoiceId: a.invoiceId }]))
}

// ── Quoted vs actual ──────────────────────────────────────────────────────────

export interface CompareRow {
  part: string
  extra: boolean
  plannedQty: number
  usedQty: number
  qtyDiff: number
  shopReturnQty: number
  vendorReturnQty: number
  quotedUnitCostCents: number
  actualUnitCostCents: number
  quotedCostCents: number
  actualCostCents: number
  diffCostCents: number
  costSource: CostSource | null
}

export interface Comparison {
  rows: CompareRow[]
  quoted: { materialCents: number; laborCents: number; tearOutCents: number; otherMaterialCents: number; totalCents: number; priceCents: number; profitCents: number; marginPct: number } | null
  actual: { materialCents: number; laborCents: number; tearOutCents: number; otherMaterialCents: number; totalCents: number; priceCents: number; profitCents: number; marginPct: number; laborMath: string } | null
  diffCents: number | null
}

/** Profit and margin % (to 0.1) for a price and a cost. */
export function marginOf(priceCents: number, costCents: number): { profitCents: number; marginPct: number } {
  const profitCents = priceCents - costCents
  return { profitCents, marginPct: priceCents > 0 ? Math.round((profitCents / priceCents) * 1000) / 10 : 0 }
}

/**
 * Line by line: each pull sheet line next to what the crew confirmed, items
 * added on the job last. `priceCents` for actual is the job's contract value
 * (change orders in); quoted uses the price it was signed at.
 */
export function compare(quoted: QuotedCost | null, actual: ActualCost | null, actualPriceCents: number): Comparison {
  const rows: CompareRow[] = []
  const byKey = new Map<string, ActualLine[]>()
  for (const a of actual?.lines ?? []) {
    const k = a.key ?? `extra:${partKey(a)}`
    byKey.set(k, [...(byKey.get(k) ?? []), a])
  }
  const sum = (ls: ActualLine[], f: (l: ActualLine) => number) => ls.reduce((s, l) => s + f(l), 0)
  for (const q of quoted?.lines ?? []) {
    const as = byKey.get(q.key) ?? []
    byKey.delete(q.key)
    const used = actual ? sum(as, l => l.usedQty) : 0
    const actualCost = sum(as, l => l.totalCostCents)
    rows.push({
      part: q.part, extra: false, plannedQty: q.qty, usedQty: used, qtyDiff: actual ? round2(used - q.qty) : 0,
      shopReturnQty: sum(as, l => l.shopReturnQty), vendorReturnQty: sum(as, l => l.vendorReturnQty),
      quotedUnitCostCents: q.unitCostCents, actualUnitCostCents: as[0]?.unitCostCents ?? 0,
      quotedCostCents: q.totalCostCents, actualCostCents: actualCost, diffCostCents: actual ? actualCost - q.totalCostCents : 0, costSource: as[0]?.costSource ?? null,
    })
  }
  // Lines with no quoted line: added on the job (or a takeoff with no quoted cost).
  for (const as of byKey.values()) {
    const a = as[0]
    const used = sum(as, l => l.usedQty)
    const planned = sum(as, l => l.plannedQty)
    rows.push({
      part: a.part, extra: as.every(l => l.extra), plannedQty: planned, usedQty: used, qtyDiff: round2(used - planned),
      shopReturnQty: sum(as, l => l.shopReturnQty), vendorReturnQty: sum(as, l => l.vendorReturnQty),
      quotedUnitCostCents: 0, actualUnitCostCents: a.unitCostCents, quotedCostCents: 0, actualCostCents: sum(as, l => l.totalCostCents),
      diffCostCents: quoted ? sum(as, l => l.totalCostCents) : 0, costSource: a.costSource,
    })
  }
  const q = quoted ? (() => {
    const other = otherQuotedMaterial(quoted)
    return { materialCents: quoted.materialCents - other, laborCents: quoted.laborCents, tearOutCents: quoted.tearOutCents, otherMaterialCents: other, totalCents: quoted.totalCents, priceCents: quoted.priceCents, ...marginOf(quoted.priceCents, quoted.totalCents) }
  })() : null
  const a = actual ? { materialCents: actual.materialCents, laborCents: actual.laborCents, tearOutCents: actual.tearOutCents, otherMaterialCents: actual.otherMaterialCents, totalCents: actual.totalCents, priceCents: actualPriceCents, laborMath: actual.laborMath, ...marginOf(actualPriceCents, actual.totalCents) } : null
  return { rows, quoted: q, actual: a, diffCents: q && a ? a.totalCents - q.totalCents : null }
}

const round2 = (n: number) => Math.round(n * 100) / 100

// ── The report ────────────────────────────────────────────────────────────────

/** One completed job in the report. Costs are null when there is no takeoff (or no quoted cost). */
export interface ReportJob {
  jobId: string
  customerName: string
  fenceStyle: string
  salesRep: string
  /** YYYY-MM of the install date (or completion). */
  month: string
  priceCents: number
  quotedCents: number | null
  actualCents: number | null
  /** No approved takeoff: "No takeoff". */
  takeoff: TakeoffStatus | 'none'
  /** Per part: planned vs used (approved takeoffs only). */
  parts: Array<{ part: string; plannedQty: number; usedQty: number }>
}

export interface ReportGroup {
  key: string
  label: string
  jobs: number
  /** Jobs with an approved takeoff and a quoted cost (what the totals are made of). */
  costed: number
  noTakeoff: number
  priceCents: number
  quotedCents: number
  actualCents: number
  diffCents: number
  profitCents: number
  marginPct: number
}

/** Group jobs; the money adds up only jobs with both a quoted cost and an approved takeoff. */
export function groupReport(jobs: ReportJob[], keyOf: (j: ReportJob) => string, labelOf: (key: string) => string = k => k): ReportGroup[] {
  const groups = new Map<string, ReportGroup>()
  for (const j of jobs) {
    const key = keyOf(j) || 'Not set'
    const g = groups.get(key) ?? { key, label: labelOf(key), jobs: 0, costed: 0, noTakeoff: 0, priceCents: 0, quotedCents: 0, actualCents: 0, diffCents: 0, profitCents: 0, marginPct: 0 }
    g.jobs += 1
    if (j.takeoff !== 'approved') g.noTakeoff += 1
    if (j.takeoff === 'approved' && j.quotedCents != null && j.actualCents != null) {
      g.costed += 1
      g.priceCents += j.priceCents
      g.quotedCents += j.quotedCents
      g.actualCents += j.actualCents
    }
    groups.set(key, g)
  }
  return [...groups.values()].map(g => {
    const m = marginOf(g.priceCents, g.actualCents)
    return { ...g, diffCents: g.actualCents - g.quotedCents, profitCents: m.profitCents, marginPct: m.marginPct }
  }).sort((a, b) => b.jobs - a.jobs || a.label.localeCompare(b.label))
}

export interface PartTrend { part: string; jobs: number; overJobs: number; underJobs: number; overQty: number; underQty: number; netQty: number }

/** Parts most often over or under the pull sheet, across approved takeoffs (to fix the kits). */
export function partTrends(jobs: ReportJob[]): PartTrend[] {
  const m = new Map<string, PartTrend>()
  for (const j of jobs) {
    if (j.takeoff !== 'approved') continue
    for (const p of j.parts) {
      const t = m.get(p.part) ?? { part: p.part, jobs: 0, overJobs: 0, underJobs: 0, overQty: 0, underQty: 0, netQty: 0 }
      const d = round2(p.usedQty - p.plannedQty)
      t.jobs += 1
      if (d > 0) { t.overJobs += 1; t.overQty = round2(t.overQty + d) }
      if (d < 0) { t.underJobs += 1; t.underQty = round2(t.underQty - d) }
      t.netQty = round2(t.netQty + d)
      m.set(p.part, t)
    }
  }
  return [...m.values()].filter(t => t.overJobs || t.underJobs).sort((a, b) => (b.overJobs + b.underJobs) - (a.overJobs + a.underJobs) || Math.abs(b.netQty) - Math.abs(a.netQty))
}

/** Planned vs used per part for one takeoff (same part on two lines is one). */
export function partsOf(lines: TakeoffLine[]): Array<{ part: string; plannedQty: number; usedQty: number }> {
  const m = new Map<string, { part: string; plannedQty: number; usedQty: number }>()
  for (const l of lines) {
    const p = m.get(l.part) ?? { part: l.part, plannedQty: 0, usedQty: 0 }
    p.plannedQty = round2(p.plannedQty + qty(l.plannedQty))
    p.usedQty = round2(p.usedQty + qty(l.usedQty))
    m.set(l.part, p)
  }
  return [...m.values()]
}

export function usd(cents: number): string {
  const neg = cents < 0
  const s = (Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${neg ? '-' : ''}$${s}`
}
