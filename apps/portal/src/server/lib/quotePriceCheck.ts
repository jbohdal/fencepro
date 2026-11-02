/**
 * A quote saved at prices the server no longer has (broken list #58, Oct 29
 * 2026): the server's safety net under the quote builder's own check.
 *
 * A save that prices a quote (a new quote, or a draft whose price, fence,
 * footage, gates or options change) is refused with 409 when:
 *
 *   STYLE_NOT_QUOTABLE  it puts on a fence style that is not available for
 *                       quoting now (switched off, or held back: its prices
 *                       were removed). A style the saved quote already had
 *                       stays allowed, as the quote builder keeps it;
 *   SUB_RATE_MISSING    its sub is paid per a unit Settings has no rate for
 *                       (per section while Settings pays per foot) and no
 *                       rate is typed on it (Oct 30 2026);
 *   PRICES_CHANGED      it was priced on an older copy of the price data than
 *                       the server's now (lib/pricingStamp.ts), or at an
 *                       Overhead % other than the one in use now
 *                       (lib/liveOverhead.ts; a saved quote's own stays): the
 *                       phone reloads the prices, reprices and asks before saving.
 *
 * Never refused for this: a sent, shared, sold or signed quote (its saved
 * prices stand: lib/quoteLock.ts and the kept sent prices in
 * routes/saved-quotes.ts), a save that changes no price (a note, the stage),
 * and a Salesman's or Installer's save priced on the server (priceRequest:
 * priced here with today's data). A phone on an older build sends no stamp:
 * its save is taken, and the audit log records it with the price the server
 * works out for it today (priceCheckAudit).
 */

import prisma from './prisma.js'
import { pricingModule } from './estimates.js'
import { dataFor, requestFrom, optKey } from './quotePricing.js'
import { currentPricingStamp } from './pricingStamp.js'
import { overheadInUseFor } from './liveOverhead.js'
import { isSignedQuote, lockedChanges } from './quoteLock.js'
import { proposalSent, styleRecords } from './ownTier.js'
import { can } from './permissions.js'

type Json = any

export const PRICES_CHANGED_CODE = 'PRICES_CHANGED'
export const STYLE_NOT_QUOTABLE_CODE = 'STYLE_NOT_QUOTABLE'
export const SUB_RATE_MISSING_CODE = 'SUB_RATE_MISSING'
export const TOO_MANY_OPTIONS_CODE = 'TOO_MANY_OPTIONS'
export const QUOTE_CHANGED_CODE = 'QUOTE_CHANGED'
export const PRICES_CHANGED_MESSAGE = 'Prices changed since this quote was priced. Open it to see the new price, then save it again.'

export type PriceCheck =
  | { kind: 'ok' }
  /** An older app sent no stamp: saved, and recorded (priceCheckAudit). */
  | { kind: 'unstamped' }
  | { kind: 'refuse'; code: string; error: string; stamp?: string; styles?: string[] }

/** A sent, shared or signed quote: its saved prices stand, whatever the price data says now. */
export async function pricesStand(existing: Json | null): Promise<boolean> {
  if (!existing) return false
  if (isSignedQuote(existing) || proposalSent(existing) || !!existing.shareToken) return true
  return !!(await prisma.jobQuotedCost.findUnique({ where: { accountId_quoteId: { accountId: existing.accountId, quoteId: existing.id } }, select: { id: true } }))
}

/** Does this write price the quote? A new quote always; a saved one only when a price-bearing field changes. */
export function pricesTheQuote(existing: Json | null, data: Json): boolean {
  if (!existing) return true
  return lockedChanges(existing, data).some(f => f !== 'status')
}

/** The fence styles a quote puts on: its own and each proposal option's. */
export function stylesOf(q: Json): string[] {
  const out = new Set<string>()
  if (q && typeof q.fenceStyle === 'string' && q.fenceStyle) out.add(q.fenceStyle)
  for (const o of Array.isArray(q?.proposal?.options) ? q.proposal.options : []) if (typeof o?.fenceStyle === 'string' && o.fenceStyle) out.add(o.fenceStyle)
  return [...out]
}

/** The styles on `data` that are not available for quoting now and were not on the saved quote. Unknown names are left alone. */
export async function unavailableStyles(accountId: string, data: Json, existing: Json | null): Promise<string[]> {
  const asked = stylesOf(data)
  if (!asked.length) return []
  const had = new Set(existing ? stylesOf(existing) : [])
  const fresh = asked.filter(s => !had.has(s))
  if (!fresh.length) return []
  const m = await pricingModule() as Json
  const d = await dataFor(accountId)
  const labels: Record<string, string> = m.styleLabels(d.config, d)
  const quotable = new Set((m.estimateStyles(d.config, d) as Array<{ name: string }>).map(s => s.name))
  return fresh.filter(s => s in labels && !quotable.has(s)).map(s => labels[s] || s)
}

/**
 * A save whose sub is paid per a unit Settings has no rate for, with no rate
 * typed (pricingEngine.subUnitRateMissing): what to tell the person, or null.
 * Read from the pricing choices the save writes (the Salesman's are the
 * server's own, lib/quotePricing.ts), else the saved ones.
 */
export async function subRateMissing(accountId: string, data: Json, existing: Json | null): Promise<string | null> {
  const pricing = data?.pricing !== undefined ? data.pricing : existing?.pricing
  if (!pricing || typeof pricing !== 'object') return null
  const m = await pricingModule() as Json
  const d = await dataFor(accountId)
  return m.subRateMissingFor(d.config, pricing, data?.fenceStyle ?? existing?.fenceStyle ?? null)
}

/**
 * The check for one save. `body` is what the phone sent (pricingStamp,
 * priceRequest), `data` the quote as it will be written, `existing` the saved
 * quote (null for a new one).
 */
export async function checkQuotePrices(accountId: string, body: Json, data: Json, existing: Json | null, role?: string | null): Promise<PriceCheck> {
  // A new version of a sent quote goes to the customer too: same checks of the limit and of the prices.
  const stands = await pricesStand(existing)
  if (stands && !(data?.needsResend === true && !isSignedQuote(existing))) return { kind: 'ok' }
  if (!pricesTheQuote(existing, data)) return { kind: 'ok' }
  const over = await overOptionLimit(data, existing)
  if (over) return over
  const mine = role && !can(role as any, 'prices.change') && can(role as any, 'costs.view') ? await pricedByServer(accountId, body, data, existing) : null
  if (mine) return mine
  if (stands) return { kind: 'ok' }
  const gone = await unavailableStyles(accountId, data, existing)
  if (gone.length) {
    return {
      kind: 'refuse', code: STYLE_NOT_QUOTABLE_CODE, styles: gone,
      error: `${gone.join(', ')} ${gone.length === 1 ? 'is' : 'are'} not available for quoting now. Pick another fence, then save again.`,
    }
  }
  // Paid per a unit Settings has no rate for, with no rate typed: never priced with the other unit's rate (Oct 30 2026).
  const missing = await subRateMissing(accountId, data, existing)
  if (missing) return { kind: 'refuse', code: SUB_RATE_MISSING_CODE, error: missing }
  // Priced here from the quote builder's inputs, with today's data: nothing to compare. (A login that sees costs prices
  // on its phone and sends its stamp too: checked below.)
  if (body?.priceRequest && !body?.pricingStamp) return { kind: 'ok' }
  const sent = typeof body?.pricingStamp === 'string' && body.pricingStamp ? body.pricingStamp : null
  if (!sent) return { kind: 'unstamped' }
  const now = await currentPricingStamp(accountId)
  if (sent !== now.stamp) return { kind: 'refuse', code: PRICES_CHANGED_CODE, error: PRICES_CHANGED_MESSAGE, stamp: now.stamp }
  if (!(await atOverheadInUse(accountId, data, existing))) return { kind: 'refuse', code: PRICES_CHANGED_CODE, error: PRICES_CHANGED_MESSAGE, stamp: now.stamp }
  return { kind: 'ok' }
}

/**
 * The limit: 1 to 3 options on a proposal ("I can add or remove options (1 to 3)", Jonathan). Refused when styles ticked
 * in Compare options or added by hand take the customer's cards over it. Good, Better, Best plus a quote's own fence that
 * is none of them, nothing ticked, stays as it always was (today's automatic options).
 */
export async function overOptionLimit(data: Json, existing: Json | null): Promise<PriceCheck | null> {
  const p = data?.proposal
  if (!p || !Array.isArray(p.options) || p.kind) return null
  const own = data?.fenceStyle ?? existing?.fenceStyle
  const chosen = p.options.some((o: Json) => (!o?.tier && o?.fenceStyle !== own) || (o?.tier?.swapped && String(o.tier.key).startsWith('added')))
  if (!chosen) return null
  const m = await pricingModule() as Json
  const quote = { ...(existing ?? {}), ...data, fenceStyle: own }
  const shown = m.shownOptions(p.options, m.proposalFold(p, quote, await styleRecords())).length
  if (shown <= 3) return null
  return { kind: 'refuse', code: TOO_MANY_OPTIONS_CODE, error: `A proposal has 3 options at most, and this one has ${shown}. Take one off, then save again.` }
}

/** Each price a phone saved, against the server's own, for a login that prices on its phone but may not set prices. */
export async function pricedByServer(accountId: string, body: Json, data: Json, existing: Json | null): Promise<PriceCheck | null> {
  const refuse = (error: string): PriceCheck => ({ kind: 'refuse', code: PRICES_CHANGED_CODE, error })
  // A draft with no price and no options has nothing for a customer to get.
  const asked = Number(data?.finalPrice) > 0 || (Array.isArray(data?.proposal?.options) && data.proposal.options.length > 0)
  if (!asked) return null
  if (!body?.priceRequest) return refuse('This save came from an older copy of the app, so its price was not checked. Close the app, open it again and save.')
  try {
    const m = await pricingModule() as Json
    const { req, overheadPct } = requestFrom(body.priceRequest, existing, m.importedOldPrice, m.keepsCents, { ownChoices: true })
    const d = await dataFor(accountId)
    req.tierSet = await trustedTierSet(accountId, req.tierSet, existing)
    const job = m.quoteJobFor(d, req, overheadPct)
    const t = job.totals
    const cents = (n: unknown) => Math.round((Number(n) || 0) * 100)
    if (data?.finalPrice !== undefined && Math.abs(cents(data.finalPrice) - cents(t.price)) > 1) return refuse(PRICES_CHANGED_MESSAGE)
    if (t.price > 0 && cents(t.price) < cents(t.totalCOGS)) return refuse('This price is under what the fence costs, so it was not saved. Ask Jonathan.')
    const priced = new Map<string, Json>(job.proposalOptions.map((o: Json) => [optKey(o), o]))
    for (const o of Array.isArray(data?.proposal?.options) ? data.proposal.options : []) {
      if (o?.fenceStyle === req.fenceStyle) { if (Math.abs(cents(o.finalPrice) - cents(t.price)) > 1) return refuse(PRICES_CHANGED_MESSAGE); continue }
      const p = priced.get(optKey(o))
      if (!p || Math.abs(cents(o.finalPrice) - cents(p.finalPrice)) > 1) return refuse(PRICES_CHANGED_MESSAGE)
      if (cents(p.finalPrice) < cents(p.snapshot?.totalCOGS)) return refuse('An option\'s price is under what the fence costs, so it was not saved. Ask Jonathan.')
    }
    return null
  } catch (err) {
    console.error('[price check] could not price the quote:', err)
    return refuse('The price could not be checked. Try again in a moment.')
  }
}

/** The tier set a request may price with: each tier's Price adjust % as in Settings or as the quote already has it, never the phone's. */
async function trustedTierSet(accountId: string, sent: Json | null, existing: Json | null): Promise<Json | null> {
  if (!sent) return sent
  const rows = await prisma.proposalTierSet.findMany({ where: { accountId }, select: { category: true, tiers: true } })
  const live = rows.flatMap(r => (Array.isArray(r.tiers) ? r.tiers as Json[] : []).filter(t => r.category === sent.category))
  const saved = (existing?.proposal?.tierSet?.category === sent.category ? existing.proposal.tierSet.tiers : []) as Json[]
  return { ...sent, tiers: (sent.tiers as Json[]).map(t => ({ ...t, priceAdjustPct: (saved.find(x => x?.key === t?.key) ?? live.find(x => x?.key === t?.key))?.priceAdjustPct ?? null })) }
}

/**
 * Two browsers on one quote (review Nov 2 2026: A added a Wood option, B, opened before it, saved and Wood was gone
 * without a word). The quote builder says which options it opened with (proposalBase); a save built on others, that
 * would put different ones on, is refused and the app reloads the quote. The same save sent twice passes.
 */
export async function quoteChangedSince(body: Json, data: Json, existing: Json): Promise<Extract<PriceCheck, { kind: 'refuse' }> | null> {
  const base = body?.proposalBase
  if (typeof base !== 'string' || !data?.proposal) return null
  const m = await pricingModule() as Json
  const now = m.proposalStamp(existing?.proposal ?? null)
  if (now === base || m.proposalStamp(data.proposal) === now) return null
  return { kind: 'refuse', code: QUOTE_CHANGED_CODE, error: 'This quote was changed on another phone or computer while you had it open, so this save was not made. Open the quote again to see the changes.' }
}

/**
 * Priced at the Overhead % in use now (lib/liveOverhead.ts), or at the one the
 * saved quote keeps. A phone that worked live overhead out from its own jobs
 * (a Salesman's: her jobs only) priced at the typed 30% while the owner's was
 * at the live 36.9%, and the save was taken (Oct 30 2026). A quote that does
 * not say what it was priced at is left alone.
 */
export async function atOverheadInUse(accountId: string, data: Json, existing: Json | null): Promise<boolean> {
  const priced = data?.pricing?.overheadPct
  if (typeof priced !== 'number' || !Number.isFinite(priced)) return true
  const same = (a: unknown) => typeof a === 'number' && Math.abs(a - priced) < 0.05
  if (same(existing?.pricing?.overheadPct)) return true
  return same(await overheadInUseFor(accountId))
}

/** The 409 for a refused save; nothing is saved. */
export function refusePrices(res: Json, r: Extract<PriceCheck, { kind: 'refuse' }>) {
  res.status(409).json({ success: false, code: r.code, error: r.error, ...(r.stamp ? { stamp: r.stamp } : {}), ...(r.styles ? { styles: r.styles } : {}) })
}

/**
 * A saved quote priced again on the server with today's data, as the quote
 * builder would (its own style, runs, posts, gates, choices and the Overhead %
 * it was priced at). Null when it cannot be priced (no style, an unknown one).
 */
export async function priceToday(accountId: string, q: Json): Promise<number | null> {
  try {
    if (!q?.fenceStyle) return null
    const m = await pricingModule() as Json
    const runs = (Array.isArray(q.runs) ? q.runs : []).map((ft: unknown, i: number) => ({ ft: Number(ft) || 0, rail: Array.isArray(q.runRails) ? q.runRails[i] ?? 'auto' : 'auto' }))
    const work = q.work && typeof q.work === 'object' ? q.work : null
    const body = {
      fenceStyle: q.fenceStyle, runs, corners: q.corners, ends: q.ends, walkGates: q.walkGates, dblGates: q.dblGates,
      ...(q.layout?.gateWidths ? { gateWidths: q.layout.gateWidths } : {}),
      ...(Number(q.layout?.teeLinePosts) > 0 ? { extraLinePosts: Number(q.layout.teeLinePosts) } : {}),
      tearOutSections: q.tearOutSections, tearOutGates: q.tearOutGates, extraLaborHrs: q.adjLaborHrs, hasSalesman: q.hasSalesman, priceAdjust: q.priceAdjust,
      overrides: q.pricing ?? {}, jobType: work?.type ?? 'new', move: work?.move ?? null, repair: work?.repair ?? null,
    }
    const { req, overheadPct } = requestFrom(body, q, m.importedOldPrice, m.keepsCents)
    const job = m.quoteJobFor(await dataFor(accountId), req, overheadPct)
    const price = Number(job?.totals?.price)
    return Number.isFinite(price) ? price : null
  } catch (err) {
    console.error('[price check] could not price the quote today:', err)
    return null
  }
}

/**
 * An older app's save with no stamp: taken, and recorded in the audit log
 * (Settings > Audit log) with the price the server works out for it today, so
 * a quote saved at old prices can be found ("differs": true).
 */
export async function priceCheckAudit(audit: (action: any, entity: string, id: string, opts: Json) => Promise<void>, saved: Json): Promise<void> {
  const today = await priceToday(saved.accountId, saved)
  const savedCents = Math.round(Number(saved.finalPrice || 0) * 100)
  const todayCents = today == null ? null : Math.round(today * 100)
  const differs = todayCents != null && Math.abs(todayCents - savedCents) >= 100
  if (differs) console.warn(`[price check] quote ${saved.id} saved by an older app at $${savedCents / 100}; today's data prices it at $${(todayCents ?? 0) / 100}`)
  await audit('price_check', 'SavedQuote', saved.id, {
    newValues: { check: 'saved without a price stamp (older app)', savedCents, todayCents, differs },
  })
}
