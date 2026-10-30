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
 *   PRICES_CHANGED      it was priced on an older copy of the price data than
 *                       the server's now (lib/pricingStamp.ts): the phone
 *                       reloads the prices, reprices and asks before saving.
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
import { dataFor, requestFrom } from './quotePricing.js'
import { currentPricingStamp } from './pricingStamp.js'
import { isSignedQuote, lockedChanges } from './quoteLock.js'
import { proposalSent } from './ownTier.js'

type Json = any

export const PRICES_CHANGED_CODE = 'PRICES_CHANGED'
export const STYLE_NOT_QUOTABLE_CODE = 'STYLE_NOT_QUOTABLE'
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
 * The check for one save. `body` is what the phone sent (pricingStamp,
 * priceRequest), `data` the quote as it will be written, `existing` the saved
 * quote (null for a new one).
 */
export async function checkQuotePrices(accountId: string, body: Json, data: Json, existing: Json | null): Promise<PriceCheck> {
  if (await pricesStand(existing)) return { kind: 'ok' }
  if (!pricesTheQuote(existing, data)) return { kind: 'ok' }
  const gone = await unavailableStyles(accountId, data, existing)
  if (gone.length) {
    return {
      kind: 'refuse', code: STYLE_NOT_QUOTABLE_CODE, styles: gone,
      error: `${gone.join(', ')} ${gone.length === 1 ? 'is' : 'are'} not available for quoting now. Pick another fence, then save again.`,
    }
  }
  // Priced here from the quote builder's inputs, with today's data: nothing to compare.
  if (body?.priceRequest) return { kind: 'ok' }
  const sent = typeof body?.pricingStamp === 'string' && body.pricingStamp ? body.pricingStamp : null
  if (!sent) return { kind: 'unstamped' }
  const now = await currentPricingStamp(accountId)
  if (sent !== now.stamp) return { kind: 'refuse', code: PRICES_CHANGED_CODE, error: PRICES_CHANGED_MESSAGE, stamp: now.stamp }
  return { kind: 'ok' }
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
