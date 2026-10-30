/**
 * Shared by the Oct 30 2026 sub unit scripts (sub-unit-report, sub-unit-drafts,
 * sub-unit-requotes): which quotes, and pricing them the way the app does.
 *
 * Settings → Pricing went from $23 per section to $5 per foot at 9:23 am on
 * Oct 30. Quotes saved before kept `pricing.subUnit: 'section'` with no sub
 * rate of their own (the rate followed Settings). The app now follows Settings
 * for the unit too (pricingEngine.subUnitOf). These scripts list them, fix the
 * unsent drafts, and make requotes of the sent ones.
 *
 * Pricing goes through the server's own path: lib/quotePricing.ts requestFrom
 * and the estimate bundle's quoteJobFor (what a Salesman's save and the price
 * check use), and withServerCosts for what a save stores.
 */

import prisma from '../src/server/lib/prisma.js'
import { pricingModule } from '../src/server/lib/estimates.js'
import { dataFor, requestFrom, withServerCosts } from '../src/server/lib/quotePricing.js'
import { stampQuoteWarranties } from '../src/server/lib/warranties.js'
import { stampQuoteTerms } from '../src/server/lib/contractTerms.js'
import { stampOwnTier } from '../src/server/lib/ownTier.js'
import { calculatePrice } from '../../web/src/pricingEngine'

type Json = any

export const LABEL = 'Requote, new sub rates, Oct 30'

const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? v : {})
export const id8 = (id: string) => id.slice(0, 8)
export const usd = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '—' : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
export const cents = (n: unknown) => Math.round((Number(n) || 0) * 100)

/** Subcontractor quotes saved per section (not deleted), oldest change first. */
export async function sectionQuotes(statuses: string[]): Promise<Json[]> {
  return prisma.savedQuote.findMany({
    where: {
      deletedAt: null, status: { in: statuses as any },
      AND: [{ pricing: { path: ['laborMode'], equals: 'subcontractor' } }, { pricing: { path: ['subUnit'], equals: 'section' } }],
    },
    orderBy: [{ status: 'asc' }, { updatedAt: 'asc' }],
  })
}

export const ownRate = (q: Json): number | null => (Number(q.pricing?.subRate) > 0 ? Number(q.pricing.subRate) : null)
export const picked = (q: Json) => q.pricing?.subUnitPicked === true
/** A link the customer may have: a share token, or a proposal sent, opened, accepted or sold (lib/ownTier.ts proposalSent). */
export const shared = (q: Json) => !!q.shareToken || q.status !== 'DRAFT' || !!q.acceptedAt || !!q.soldAt || !!q.firstViewedAt || (Number(q.viewCount) || 0) > 0

export function footageOf(q: Json): number {
  const ft = (Array.isArray(q.runs) ? q.runs : []).reduce((s: number, r: unknown) => s + (Number(typeof r === 'object' && r ? (r as Json).ft : r) || 0), 0)
  return ft > 0 ? ft : Number(q.proposal?.footageFt) || 0
}

/** The quote builder's request for a saved quote (as lib/quotePriceCheck.ts priceToday builds it), plus its proposal choices. */
export function builderBody(q: Json, overrides: Json, extra: Json = {}): Json {
  const runs = (Array.isArray(q.runs) ? q.runs : []).map((ft: unknown, i: number) => ({ ft: Number(ft) || 0, rail: Array.isArray(q.runRails) ? q.runRails[i] ?? 'auto' : 'auto' }))
  const work = q.work && typeof q.work === 'object' ? q.work : null
  const layout = obj(q.layout)
  return {
    fenceStyle: q.fenceStyle, runs, corners: q.corners, ends: q.ends, walkGates: q.walkGates, dblGates: q.dblGates,
    ...(layout.gateWidths ? { gateWidths: layout.gateWidths } : {}),
    ...(layout.yard ? { yard: layout.yard } : {}),
    ...(Number(layout.teeLinePosts) > 0 ? { extraLinePosts: Number(layout.teeLinePosts) } : {}),
    tearOutSections: q.tearOutSections, tearOutGates: q.tearOutGates, extraLaborHrs: q.adjLaborHrs, hasSalesman: q.hasSalesman, priceAdjust: q.priceAdjust,
    overrides, jobType: work?.type ?? 'new', move: work?.move ?? null, repair: work?.repair ?? null,
    ...(work?.newFence?.offered ? { offerNewFence: true } : {}),
    ...extra,
  }
}

/**
 * Pricing choices with the sub unit following Settings, as the quote builder
 * sends them now (pricingEngine.subUnitOf): Settings' unit, not picked (the
 * rate was never the quote's own). `settingsUnit` omitted: no unit at all.
 */
export function followingSettings(pricing: Json, settingsUnit?: string): Json {
  const p = { ...obj(pricing) }
  delete p.subUnit; delete p.subUnitPicked
  if (settingsUnit && p.laborMode === 'subcontractor') p.subUnit = settingsUnit
  return p
}

/** Settings' sub unit now. */
export async function settingsSubUnit(accountId: string): Promise<string> {
  const m = await pricingModule() as Json
  return m.estimateConfig((await dataFor(accountId)).config).pricing.subUnit ?? 'foot'
}

/** A saved quote priced today through the server's path, with these pricing choices (the saved quote's cost choices kept). */
export async function priceSaved(accountId: string, q: Json, overrides: Json) {
  const m = await pricingModule() as Json
  const { req, overheadPct } = requestFrom(builderBody(q, overrides), q, m.importedOldPrice, m.keepsCents)
  return m.quoteJobFor(await dataFor(accountId), req, overheadPct)
}

/**
 * The saved quote's price with only its labor changed to `laborCost` (materials,
 * tear out, cost factor and commission as saved / as Settings say): the
 * "labor only" price. Null for a move or repair (priced from its own lines).
 */
export async function laborOnlyPrice(accountId: string, q: Json, laborCost: number): Promise<number | null> {
  if (q.work && typeof q.work === 'object' && q.work.type) return null
  const m = await pricingModule() as Json
  const cfg = m.estimateConfig((await dataFor(accountId)).config)
  const p = obj(q.pricing)
  const cf = Number(p.costFactor) > 0 ? Number(p.costFactor) : null
  if (!cf) return null
  const r = calculatePrice({
    sections: Number(q.sections) || 0, footage: footageOf(q), walkGates: q.walkGates, dblGates: q.dblGates,
    tearOutSections: q.tearOutSections, tearOutGates: q.tearOutGates, materialCost: Number(q.materialCost) || 0,
    extraLaborHrs: 0, hasSalesman: !!q.hasSalesman, priceAdjust: Number(q.priceAdjust) || 0,
    style: { margin: cf, sectionsPerMH: 1 }, pricing: cfg.pricing,
    overrides: { ...followingSettings(p), laborCost, costFactor: cf, roundingCents: undefined },
  })
  return r.price
}

/** The live tier set for a style's category (what the quote builder uses on a quote not sent), or null. */
export async function liveTierSet(accountId: string, fenceStyle: string): Promise<Json | null> {
  const m = await pricingModule() as Json
  const d = await dataFor(accountId)
  const style = (m.estimateConfig(d.config).fenceStyles as Json[]).find(s => s.name === fenceStyle)
  if (!style?.category) return null
  const sets = await prisma.proposalTierSet.findMany({ where: { accountId }, orderBy: { sortOrder: 'asc' }, select: { category: true, tiers: true, popular: true } })
  const c = String(style.category).trim().toLowerCase()
  const s = sets.find(x => x.category.trim().toLowerCase() === c)
  return s ? { category: s.category, tiers: Array.isArray(s.tiers) ? s.tiers : [], popular: s.popular ?? null } : null
}

/**
 * What saving `q` from the quote builder today stores, with the sub unit
 * following Settings: the builder's request (live tier set, the options it
 * offered, its photos), the proposal's options priced fresh, then the
 * server's save pricing (withServerCosts) and the proposal stamps a save makes
 * (warranties, terms, own tier: not frozen, it is not sent). `existing` is the
 * saved quote when repricing it, null for a new quote; `costFrom` a quote
 * whose cost choices a new quote keeps (a requote keeps the sent quote's cost
 * factor, commission and Overhead %, so only the labor moves).
 */
export async function repricedSave(accountId: string, q: Json, existing: Json | null, fields: Json = {}, costFrom: Json | null = null): Promise<Json> {
  // The quote whose cost choices (cost factor, commission, Overhead %) price it: the saved quote, or for a new one `costFrom`.
  const pricedAs = existing ?? costFrom
  const m = await pricingModule() as Json
  const proposal = obj(q.proposal)
  const opts: Json[] = Array.isArray(proposal.options) ? proposal.options : []
  const offer = [...new Set(opts.filter(o => !o?.tier && o?.fenceStyle && o.fenceStyle !== q.fenceStyle).map(o => String(o.fenceStyle)))]
  const photoIds: Record<string, string> = {}
  for (const o of opts) if (o?.fenceStyle && typeof o.photoId === 'string' && o.photoId) photoIds[o.fenceStyle] = o.photoId
  const tierSet = await liveTierSet(accountId, q.fenceStyle)
  const tierPrefs = proposal.tierPrefs && typeof proposal.tierPrefs === 'object' ? proposal.tierPrefs : { off: [], swap: {} }
  const priceRequest = builderBody(q, followingSettings(q.pricing, await settingsSubUnit(accountId)), { tierSet, tierPrefs, compare: false, offer, photoIds, keepCents: false, keepStyle: pricedAs?.fenceStyle ?? null })
  // The proposal's options as the builder would make them now (same request, same pricing).
  const { req, overheadPct } = requestFrom(priceRequest, pricedAs, m.importedOldPrice, m.keepsCents)
  const job = m.quoteJobFor(await dataFor(accountId), req, overheadPct)
  const layout = obj(q.layout)
  const runSections = (job.calc.perRunSections as number[]).filter((_: number, i: number) => (req.runs[i]?.ft ?? 0) > 0)
  const body: Json = {
    crmContactId: q.crmContactId, customerName: q.customerName, customerPhone: q.customerPhone, customerEmail: q.customerEmail,
    customerAddress: q.customerAddress, leadSource: q.leadSource, salesRep: q.salesRep, fenceStyle: q.fenceStyle,
    runs: q.runs, runRails: q.runRails, layout: q.layout ? { ...layout, runSections: job.work ? layout.runSections ?? runSections : runSections } : q.layout,
    corners: q.corners, ends: q.ends, walkGates: q.walkGates, dblGates: q.dblGates, tearOutSections: q.tearOutSections, tearOutGates: q.tearOutGates,
    adjLaborHrs: q.adjLaborHrs, hasSalesman: q.hasSalesman, priceAdjust: q.priceAdjust, leadTemp: q.leadTemp,
    work: q.work, status: q.status, date: q.date, notes: q.notes,
    proposal: q.proposal ? {
      ...proposal, createdAt: new Date().toISOString(), options: job.proposalOptions,
      ...(tierSet ? { tierSet } : {}), tierPrefs,
    } : q.proposal,
    ...fields,
    priceRequest,
  }
  if (!tierSet) delete body.proposal?.tierSet
  // Sent-only stamps are made again by the stamps below (a new or unsent proposal).
  if (body.proposal) { delete body.proposal.ownTier; delete body.proposal.terms }
  const out = await withServerCosts(accountId, body, pricedAs)
  const repair = (out.work && typeof out.work === 'object' ? out.work.type : null) === 'repair'
  if (out.proposal) out.proposal = await stampQuoteWarranties(accountId, out.proposal, existing, false)
  if (out.proposal) out.proposal = await stampQuoteTerms(accountId, out.proposal, existing, false, { repair })
  if (out.proposal) out.proposal = await stampOwnTier(out.proposal, out.fenceStyle, existing?.proposal ?? null, false)
  return out
}

/** The columns a save writes for the priced fields (what routes/saved-quotes.ts stores). */
export function pricedColumns(out: Json): Json {
  return {
    sections: Math.round(Number(out.sections) || 0), materialCost: out.materialCost, laborCost: out.laborCost, tearOutCost: out.tearOutCost,
    totalCOGS: out.totalCOGS, finalPrice: out.finalPrice, gmPct: out.gmPct, pullSheet: out.pullSheet ?? [], pricing: out.pricing ?? undefined,
    work: out.work ?? undefined, proposal: out.proposal ?? undefined, layout: out.layout ?? undefined,
  }
}

/** Markdown table. */
export function table(head: string[], rows: Array<Array<string | number>>): string {
  const esc = (v: string | number) => String(v).replace(/\|/g, '\\|')
  return [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map(r => `| ${r.map(esc).join(' | ')} |`)].join('\n')
}
