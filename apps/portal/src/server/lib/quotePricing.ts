/**
 * Quotes priced on the server for a Salesman or Installer (prices only on
 * their phones; lib/costRedact.ts). The quote builder's own math runs here
 * (web/src/quoteJob.ts through the estimate bundle) on the company's saved
 * Settings, Inventory and kits:
 *
 *   view   what the quote builder shows them while they quote: sections, the
 *          6 / 8 ft choice, the parts list without costs, every price, the
 *          tiers, Compare options and the proposal's options;
 *   save   a quote they save gets its costs here (material, labor, tear out,
 *          cost of goods, margin, the pull sheet with costs, the move's or
 *          repair's cost lines, each proposal option's internal snapshot), so
 *          their blanks never reach the saved quote.
 *
 * What they send is taken as inputs only. The cost choices on a saved quote
 * (its own sub rate, flat labor, cost factor, commission) and the Overhead %
 * it was priced at stay as saved; a new quote uses Settings.
 */

import prisma from './prisma.js'
import { pricingModule } from './estimates.js'
import { restoreCosts } from './costRedact.js'

type Json = any

/** The price choices a limited login may set on a quote; every other choice stays as saved. */
// The ± dollar adjustment is a price choice like the slider: the engine never lets it take the price under cost.
const PRICE_CHOICES = ['laborMode', 'subUnit', 'priceMethod', 'pricePerFoot', 'finalPrice', 'priceAdjustmentCents', 'showDiscountOnProposal'] as const
/** The cost choices kept from the saved quote. */
const COST_CHOICES = ['subRate', 'laborCost', 'costFactor', 'commissionPct', 'commissionMode'] as const

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d)

export async function dataFor(accountId: string) {
  const [b, inv] = await Promise.all([
    prisma.businessState.findUnique({ where: { accountId }, select: { config: true } }),
    prisma.inventoryState.findUnique({ where: { accountId }, select: { items: true, kits: true } }),
  ])
  return {
    config: (b?.config ?? null) as Json,
    inventory: (Array.isArray(inv?.items) ? inv!.items : []) as Json[],
    kits: (Array.isArray(inv?.kits) ? inv!.kits : []) as Json[],
  }
}

/** The quote builder's request, with the saved quote's cost choices and Overhead %. */
export function requestFrom(body: Json, existing: Json | null, importedOldPrice: (q: Json) => number | null, keepsCents: (q: Json) => boolean = () => false): { req: Json; overheadPct: number | null } {
  const b = body && typeof body === 'object' ? body : {}
  const runs = (Array.isArray(b.runs) ? b.runs : []).slice(0, 200).map((r: Json) => ({
    ft: num(typeof r === 'number' ? r : r?.ft), rail: r?.rail === '6ft' || r?.rail === '8ft' ? r.rail : 'auto',
  }))
  const sent = b.overrides && typeof b.overrides === 'object' ? b.overrides : {}
  // A quote brought in from JobNimbus and not sold is priced from its parts (QuoteBuilder does the same).
  const oldPrice = existing ? importedOldPrice(existing) : null
  const savedPricing = existing && !(oldPrice != null && existing.status !== 'SOLD') && existing.pricing && typeof existing.pricing === 'object' ? existing.pricing : {}
  const overrides: Record<string, unknown> = {}
  for (const k of COST_CHOICES) if (savedPricing[k] !== undefined && savedPricing[k] !== null) overrides[k] = savedPricing[k]
  for (const k of PRICE_CHOICES) if (sent[k] !== undefined && sent[k] !== null && sent[k] !== '') overrides[k] = sent[k]
  // Whole dollar prices (Oct 21 2026): a quote sent, sold or accepted before keeps its cents while it is
  // unchanged (the phone says keepCents: false once it is changed); every other quote is priced to the whole dollar.
  if (existing && keepsCents(existing) && b.keepCents !== false) overrides.wholeDollar = false
  const jobType = b.jobType === 'move' || b.jobType === 'repair' ? b.jobType : 'new'
  const req = {
    fenceStyle: String(b.fenceStyle ?? ''),
    runs,
    corners: num(b.corners), ends: num(b.ends), walkGates: num(b.walkGates), dblGates: num(b.dblGates),
    // Vinyl tees counted as line posts (yardLayout.ts VINYL_TEE_POST).
    ...(num(b.extraLinePosts) > 0 ? { extraLinePosts: Math.round(num(b.extraLinePosts)) } : {}),
    tearOutSections: num(b.tearOutSections), tearOutGates: num(b.tearOutGates),
    extraLaborHrs: num(b.extraLaborHrs), hasSalesman: !!b.hasSalesman, priceAdjust: num(b.priceAdjust),
    overrides,
    jobType,
    move: jobType === 'move' && b.move && typeof b.move === 'object' ? b.move : null,
    repair: jobType === 'repair' && b.repair && typeof b.repair === 'object' ? b.repair : null,
    tierSet: b.tierSet && typeof b.tierSet === 'object' && Array.isArray(b.tierSet.tiers) ? b.tierSet : null,
    tierPrefs: b.tierPrefs && typeof b.tierPrefs === 'object' ? { off: Array.isArray(b.tierPrefs.off) ? b.tierPrefs.off : [], swap: b.tierPrefs.swap && typeof b.tierPrefs.swap === 'object' ? b.tierPrefs.swap : {} } : { off: [], swap: {} },
    compare: !!b.compare,
    offer: Array.isArray(b.offer) ? b.offer.filter((x: unknown) => typeof x === 'string') : [],
    offerNewFence: !!b.offerNewFence,
    offerMoveAsIs: b.offerMoveAsIs !== false,
    photoIds: b.photoIds && typeof b.photoIds === 'object' ? b.photoIds : {},
    keepStyle: existing?.fenceStyle ?? null,
  }
  const overheadPct = existing && typeof existing.pricing?.overheadPct === 'number' ? existing.pricing.overheadPct : null
  return { req, overheadPct }
}

/** What the quote builder shows a Salesman or Installer: prices only. */
export async function quoteViewFor(accountId: string, body: Json, quoteId?: string | null) {
  const m = await pricingModule() as Json
  const existing = quoteId ? await prisma.savedQuote.findFirst({ where: { id: quoteId, accountId } }) : null
  const { req, overheadPct } = requestFrom(body, existing, m.importedOldPrice, m.keepsCents)
  const job = m.quoteJobFor(await dataFor(accountId), req, overheadPct)
  return m.quoteView(job)
}

const optKey = (o: Json) => `${o?.fenceStyle ?? ''}|${o?.tier?.key ?? ''}|${o?.label ?? ''}`

/**
 * A quote a Salesman or Installer saves, with its costs filled in on the
 * server. `body` is what their phone sent (no costs; priceRequest is the
 * quote builder's request). Returns the body to save.
 */
export async function withServerCosts(accountId: string, body: Json, existing: Json | null): Promise<Json> {
  const m = await pricingModule() as Json
  const { req, overheadPct } = requestFrom(body.priceRequest, existing, m.importedOldPrice, m.keepsCents)
  const job = m.quoteJobFor(await dataFor(accountId), req, overheadPct)
  const out: Json = { ...body }
  delete out.priceRequest
  const t = job.totals
  out.fenceStyle = req.fenceStyle
  out.sections = job.work ? job.work.sections : job.calc.sections
  out.materialCost = t.materialCost
  out.laborCost = t.laborCost
  out.tearOutCost = t.tearOutCost
  out.totalCOGS = t.totalCOGS
  out.finalPrice = t.price
  out.gmPct = t.gmPct
  out.pullSheet = job.pullSheet
  out.pricing = job.pricing ?? null
  out.work = job.work ? m.savedWorkOf(job, req, { photoOverride: body.work?.photoOverride ?? existing?.work?.photoOverride ?? null }) : null
  // Each proposal option gets its priced snapshot (and its price) from the server.
  if (out.proposal && Array.isArray(out.proposal.options)) {
    const priced = new Map<string, Json>(job.proposalOptions.map((o: Json) => [optKey(o), o]))
    const feet = req.runs.reduce((s: number, r: Json) => s + (r.ft > 0 ? r.ft : 0), 0)
    out.proposal = {
      ...out.proposal,
      options: out.proposal.options.map((o: Json) => {
        const p = priced.get(optKey(o))
        const own = o.fenceStyle === req.fenceStyle && !job.work
        const next: Json = { ...o }
        if (p) {
          next.snapshot = p.snapshot; next.finalPrice = p.finalPrice; next.perFoot = p.perFoot; next.sections = p.sections
          if (p.adjustmentCents) next.adjustmentCents = p.adjustmentCents; else delete next.adjustmentCents
        } else { delete next.snapshot; delete next.adjustmentCents }
        // The quote's own option keeps the quote's price (QuoteBuilder's buildProposal does the same).
        if (own && t.price > 0) {
          next.finalPrice = t.price; next.perFoot = feet > 0 ? Math.round((t.price / feet) * 100) / 100 : 0
          if (t.adjustmentCents) next.adjustmentCents = t.adjustmentCents; else delete next.adjustmentCents
          if (next.snapshot) next.snapshot = { ...next.snapshot, roundingCents: t.roundingCents }
        }
        return next
      }),
    }
    // Priced to the whole dollar unless this quote keeps its cents: the deposit follows (lib/paymentMath.ts).
    if (req.overrides.wholeDollar === false) delete out.proposal.wholeDollar
    else out.proposal.wholeDollar = true
    // The list price, Discount line and final show only when the quote says so and an option has a reduction.
    if (job.pricing?.showDiscountOnProposal === true && out.proposal.options.some((o: Json) => Number(o.adjustmentCents) < 0)) out.proposal.showDiscount = true
    else delete out.proposal.showDiscount
  }
  return out
}

/**
 * A limited login's save that was not priced here (a stage change, notes):
 * every cost stays as saved. The cost columns are left out (Prisma keeps
 * them), the pull sheet is not theirs to send, and the costs inside pricing,
 * the move or repair and the proposal come back from the saved quote.
 */
export function keepSavedCosts(body: Json, existing: Json | null): Json {
  const out: Json = { ...body }
  for (const k of ['materialCost', 'laborCost', 'tearOutCost', 'totalCOGS', 'gmPct', 'pullSheet', 'priceRequest']) delete out[k]
  for (const k of ['pricing', 'work', 'proposal']) if (out[k] !== undefined && out[k] !== null) out[k] = restoreCosts(out[k], existing?.[k])
  return out
}
