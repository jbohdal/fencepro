/**
 * Signed quotes are locked (Jonathan, Oct 2026): once a quote is signed, its
 * price and everything the price is made from stay as signed. A change to the
 * work goes on a change order (routes/change-orders.ts). There is no owner
 * override.
 *
 * Signed means any of: status Sold, accepted on the customer's link
 * (acceptedAt), or a quoted cost saved at signing (JobQuotedCost).
 *
 * This file is pure (no database): the server checks every write with it, and
 * the quote builder (apps/web/src/QuoteBuilder.tsx imports this file) uses the
 * same rules to save only the allowed fields.
 *
 *   refused   the price, costs, pull sheet, style, runs and sections, posts,
 *             gates, tear out, labor and price adjustments, pricing choices,
 *             the move or repair lines (its photo choice excepted), the
 *             proposal's options, prices, footage, gates, deposit and tiers,
 *             the drawn yard's lengths, ends, gates and skips, and going back
 *             to Draft or Sent;
 *   allowed   customer name, phone, email and address (and the customer
 *             link), lead source, sales rep, notes, lead temperature, date,
 *             "needs to be sent again", Sold <-> Lost, the site plan drawing
 *             (side names, headings, where it meets the house, dragged
 *             corners, the aerial photo's turn and position), and the
 *             proposal's words and plan picture.
 */

export const LOCKED_MESSAGE = 'This quote is signed. Make a change order instead.'
export const LOCKED_STATUS_MESSAGE = 'This quote is signed, so it cannot go back to Draft or Sent. Mark it Lost if the sale fell through, or make a change order.'
export const LOCKED_CODE = 'QUOTE_LOCKED'

type Json = any

/** Fields a signed quote never changes. */
export const REFUSED_FIELDS = [
  'fenceStyle', 'runs', 'runRails', 'corners', 'ends', 'walkGates', 'dblGates', 'tearOutSections', 'tearOutGates',
  'adjLaborHrs', 'hasSalesman', 'priceAdjust', 'sections', 'materialCost', 'laborCost', 'tearOutCost', 'totalCOGS',
  'finalPrice', 'gmPct', 'pullSheet', 'pricing', 'work', 'proposal', 'layout', 'chosenOption',
] as const

/** Fields a signed quote may still change. */
export const ALLOWED_FIELDS = [
  'crmContactId', 'customerName', 'customerPhone', 'customerEmail', 'customerAddress', 'leadSource', 'salesRep',
  'notes', 'leadTemp', 'date', 'needsResend', 'status',
] as const

/** Fields only part of which is price-bearing: the rest of them may change. */
export const PARTLY_ALLOWED = ['work', 'proposal', 'layout'] as const

/** Is this quote signed? `hasQuotedCost`: a JobQuotedCost row exists for it. */
export function isSignedQuote(q: { status?: string | null; acceptedAt?: unknown } | null | undefined, hasQuotedCost = false): boolean {
  if (!q) return false
  return q.status === 'SOLD' || !!q.acceptedAt || hasQuotedCost
}

// ── Comparing ────────────────────────────────────────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const blank = (v: unknown) => v === undefined || v === null || (isObj(v) && Object.keys(v).length === 0)

/** Equal for the lock: key order does not matter, a missing key is null, numbers within half a cent. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (blank(a) && blank(b)) return true
  if (typeof a === 'number' || typeof b === 'number') {
    const x = typeof a === 'number' ? a : Number(a ?? 0), y = typeof b === 'number' ? b : Number(b ?? 0)
    return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) < 0.005
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((x, i) => sameValue(x, b[i]))
  }
  if (isObj(a) || isObj(b)) {
    const x = isObj(a) ? a : {}, y = isObj(b) ? b : {}
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) if (!sameValue(x[k], y[k])) return false
    return true
  }
  return (a ?? null) === (b ?? null)
}

/** A pull sheet as priced: part, quantity, unit cost and total (a missing figure is 0). */
function pullSheetPart(sheet: unknown) {
  return (Array.isArray(sheet) ? sheet : []).map((l: Json) => ({ item: String(l?.item ?? ''), qty: Number(l?.qty ?? 0), unitCost: Number(l?.unitCost ?? 0), total: Number(l?.total ?? 0) }))
}

/** A move or repair without its photo choice (the photo on the proposal is not a price). */
function workPart(work: unknown) {
  if (!isObj(work)) return null
  const { photoOverride, ...rest } = work as Json
  void photoOverride
  return rest
}

/** The yard's geometry: what changes footage, posts and gates. Names, headings and the drawing are not in it. */
export function layoutGeometry(layout: unknown) {
  if (!isObj(layout)) return { yard: null, runSections: null }
  const yard = isObj(layout.yard) ? layout.yard as Json : null
  return {
    yard: yard ? {
      closed: !!yard.closed,
      cornersOverride: yard.cornersOverride ?? null,
      endsOverride: yard.endsOverride ?? null,
      sides: (Array.isArray(yard.sides) ? yard.sides : []).map((s: Json) => ({
        on: !!s?.on, lengthIn: Number(s?.lengthIn ?? 0), startFinish: s?.startFinish ?? null, endFinish: s?.endFinish ?? null,
        gate: isObj(s?.gate) ? { type: s.gate.type ?? null, widthIn: s.gate.widthIn ?? null, position: s.gate.position ?? null, distanceIn: s.gate.distanceIn ?? null } : null,
        skip: isObj(s?.skip) ? { kind: s.skip.kind ?? null, lengthIn: s.skip.lengthIn ?? null, position: s.skip.position ?? null, distanceIn: s.skip.distanceIn ?? null } : null,
      })),
    } : null,
    runSections: Array.isArray(layout.runSections) ? layout.runSections : null,
  }
}

/** The proposal's price-bearing part: its options as priced, footage, gates, deposit, financing and tiers. */
export function proposalPrices(proposal: unknown) {
  if (!isObj(proposal)) return null
  const p = proposal as Json
  return {
    footageFt: p.footageFt ?? null, gatesText: p.gatesText ?? null, depositPct: p.depositPct ?? null, financing: p.financing ?? null,
    recommended: p.recommended ?? null, tierSet: p.tierSet ?? null, tierPrefs: p.tierPrefs ?? null, kind: p.kind ?? null,
    options: (Array.isArray(p.options) ? p.options : []).map((o: Json) => ({
      fenceStyle: o?.fenceStyle ?? null, finalPrice: o?.finalPrice ?? null, perFoot: o?.perFoot ?? null, sections: o?.sections ?? null,
      tier: o?.tier?.key ?? null, snapshot: o?.snapshot ?? null,
    })),
  }
}

/** One field's price-bearing part, for comparing. */
function pricePart(field: string, v: unknown): unknown {
  if (field === 'pullSheet') return pullSheetPart(v)
  if (field === 'work') return workPart(v)
  if (field === 'layout') return layoutGeometry(v)
  if (field === 'proposal') return proposalPrices(v)
  return v
}

/**
 * The refused fields this write would change on a signed quote ([] = it may be
 * saved). `incoming` is what would be written; a field it leaves out (undefined)
 * stays as saved and is not a change.
 */
export function lockedChanges(saved: Json, incoming: Json): string[] {
  const out: string[] = []
  if (!incoming || typeof incoming !== 'object') return out
  for (const f of REFUSED_FIELDS) {
    if (incoming[f] === undefined) continue
    let a = pricePart(f, saved?.[f]), b = pricePart(f, incoming[f])
    if (f === 'layout') {
      // Run sections are compared when both sides have them (an older quote has none saved).
      const ga = a as ReturnType<typeof layoutGeometry>, gb = b as ReturnType<typeof layoutGeometry>
      if (ga.runSections === null || gb.runSections === null) { a = { ...ga, runSections: null }; b = { ...gb, runSections: null } }
    }
    if (!sameValue(a, b)) out.push(f)
  }
  // Back to Draft or Sent would unlock it.
  if (incoming.status !== undefined && incoming.status !== saved?.status && (incoming.status === 'DRAFT' || incoming.status === 'SENT')) out.push('status')
  return out
}

/** The sentence for a refused write. */
export function lockMessage(fields: string[]): string {
  return fields.length === 1 && fields[0] === 'status' ? LOCKED_STATUS_MESSAGE : LOCKED_MESSAGE
}

/**
 * The saved quote with only the allowed changes of `edited` on it: what a
 * signed quote (or a sent quote kept at its sent prices) saves. The site plan
 * drawing comes from `edited` where its geometry is unchanged, and the
 * proposal keeps its options and prices with the new plan picture and words.
 */
export function keepPrices<T extends Record<string, any>>(saved: T, edited: Record<string, any>): T {
  const out: Record<string, any> = { ...saved }
  for (const f of ALLOWED_FIELDS) if (edited[f] !== undefined) out[f] = edited[f]
  if ((out.status === 'DRAFT' || out.status === 'SENT') && isSignedQuote(saved)) out.status = saved.status
  if (edited.layout !== undefined && sameValue(layoutGeometry(saved.layout).yard, layoutGeometry(edited.layout).yard) && isObj(edited.layout)) {
    out.layout = { ...(isObj(saved.layout) ? saved.layout : {}), yard: (edited.layout as Json).yard ?? null }
  }
  if (isObj(saved.proposal) && isObj(edited.proposal)) {
    const p = edited.proposal as Json, s = saved.proposal as Json
    const words: Record<string, unknown> = {}
    for (const k of ['planSvg', 'company', 'customer', 'included', 'includedNote', 'warranty', 'depositNote', 'description']) if (p[k] !== undefined) words[k] = p[k]
    // The plan picture only when the drawing it shows is the same yard.
    if (!sameValue(layoutGeometry(saved.layout).yard, layoutGeometry(edited.layout).yard)) delete words.planSvg
    out.proposal = { ...s, ...words }
  }
  if (isObj(saved.work) && isObj(edited.work) && (edited.work as Json).photoOverride !== undefined) out.work = { ...saved.work, photoOverride: (edited.work as Json).photoOverride }
  return out as T
}
