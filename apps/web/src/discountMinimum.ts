/**
 * A discount below the minimum job price (Jonathan, Nov 2 2026): "block it and
 * warn the salesman. Owner can override."
 *
 * The minimum lifts a price; the ± dollar adjustment and a price typed by hand
 * go on after it, so they are the only ways under it. Nothing here changes a
 * price: this only reads the prices a save would write, the quote's own and
 * each proposal option's, so the screen and the server (portal
 * lib/discountMinimum.ts) ask the same question of the same figures.
 *
 * A price is held to the minimum only when it is new or lower than the saved
 * one: an old quote saved again as it is, or a price the owner already let
 * through, is left alone. A quote with no discount is never under it, as the
 * minimum lifted it.
 */

import { moveRepairSettings, type MoveRepairSettings } from './moveRepair'
import { plainFence } from './sentReprice'

/** A repair's option of a new fence: the minimum does not lift it (the job is a repair), so it is not held to it. */
const NEW_FENCE_INSTEAD = 'New fence instead'

export interface MinimumOption { label?: string | null; fenceStyle?: string | null; finalPrice?: number | null; tier?: { label?: string | null } | null }
export interface MinimumQuote { fenceStyle?: string | null; finalPrice?: number | null; proposal?: { options?: MinimumOption[] | null } | null }
export interface UnderMinimum {
  key: string
  /** The option's fence, by its plain name (not its card's name); blank for the quote's own price. */
  name: string
  priceCents: number
  own: boolean
}

const OWN_KEY = '(quote)'
const cents = (dollars: unknown): number => (typeof dollars === 'number' && Number.isFinite(dollars) ? Math.round(dollars * 100) : 0)
// Its name in today's words (sentReprice.ts plainFence): an option sent saying "panels" is the same option saying "sections".
const optionKey = (o: MinimumOption) => `${o.fenceStyle ?? ''}|${plainFence(o.label)}`
const optionsOf = (q: MinimumQuote): MinimumOption[] => (Array.isArray(q.proposal?.options) ? q.proposal!.options! : [])

/**
 * The minimum a quote's prices are held to, in cents (0: none): moves and
 * repairs always, a new fence when Settings apply it to new fences. In whole
 * dollars, as the prices are: a $350.50 minimum prices at $350.
 */
export function jobMinimumCents(cfg: { moveRepair?: Partial<MoveRepairSettings> | null } | null | undefined, isWork: boolean): number {
  const mr = moveRepairSettings(cfg)
  return isWork || mr.minimumAppliesToNew ? Math.floor(mr.minimumJobCents / 100) * 100 : 0
}

/** Every price on the quote under the minimum. The quote's own price and its own option are one price. */
export function pricesUnderMinimum(q: MinimumQuote, minimumCents: number): UnderMinimum[] {
  if (!(minimumCents > 0)) return []
  const out: UnderMinimum[] = []
  for (const o of optionsOf(q)) {
    if (String(o.label ?? '').startsWith(NEW_FENCE_INSTEAD)) continue
    const c = cents(o.finalPrice)
    if (c > 0 && c < minimumCents) out.push({ key: optionKey(o), name: plainFence(o.label) || o.tier?.label || o.fenceStyle || '', priceCents: c, own: !!q.fenceStyle && o.fenceStyle === q.fenceStyle })
  }
  const own = cents(q.finalPrice)
  if (own > 0 && own < minimumCents && !out.some(u => u.own && u.priceCents === own)) out.push({ key: OWN_KEY, name: '', priceCents: own, own: true })
  return out
}

/** The prices under the minimum that a save would put there: not on the saved quote, or lower than saved. `saved`: null for a new quote. */
export function newlyUnderMinimum(after: MinimumQuote, saved: MinimumQuote | null | undefined, minimumCents: number): UnderMinimum[] {
  const under = pricesUnderMinimum(after, minimumCents)
  if (!saved) return under
  const was = new Map(optionsOf(saved).map(o => [optionKey(o), cents(o.finalPrice)]))
  const ownWas = cents(saved.finalPrice)
  return under.filter(u => {
    const before = was.get(u.key) ?? (u.own && ownWas > 0 ? ownWas : undefined)
    return before === undefined || u.priceCents < before
  })
}

// A contract taken below nothing keeps its minus sign (review Nov 3 2026: "it would be $650" for −$650).
const dollars = (c: number) => `${c < 0 ? '−' : ''}$${(Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 })}`
const listed = (a: string[]) => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`)

/** What the login is told: the same words on the screen and from the server. */
export function underMinimumWarning(under: UnderMinimum[], minimumCents: number, owner: boolean): string {
  const prices = listed(under.map(u => `${u.name || 'The price'} would be ${dollars(u.priceCents)}`))
  return owner
    ? `${prices}, under the ${dollars(minimumCents)} minimum job price. As the owner you can save it anyway.`
    : `This cannot be saved. ${prices}, under the ${dollars(minimumCents)} minimum job price. Take less off, or ask Jonathan.`
}

/**
 * A change order that takes work off a job stops at the minimum job price
 * (Jonathan, Nov 3 2026, item 32: "yes, a cut stops at $350. Owner can
 * override."). The floor is the minimum job price itself, to the whole dollar,
 * never moved by the quote's own dollar discount (review Nov 3 2026: a repair
 * signed with $146 off was held only to $204); 0 when there is no minimum.
 * The minimum is the one the quote's prices are held to (jobMinimumCents):
 * moves and repairs always, a new fence when Settings apply it to new fences.
 */
export function cutFloorCents(minimumCents: number): number {
  return minimumCents > 0 ? Math.floor(minimumCents / 100) * 100 : 0
}

/** A change order as a cut's contract counts it. */
export interface CutOrder { status: string; totalCents: number; signedAt?: unknown; deletedAt?: unknown }

/**
 * The contract a cut is counted from, in cents: the price signed for, the
 * contract adjustments on the payment schedule, every cut not voided (open or
 * approved) and each addition only once it is approved or signed (review Nov 3
 * 2026: an unsigned +$500 counted, was voided after, and the cut left $340).
 * The screen and the server (portal lib/changeOrderMinimum.ts) count the same way.
 */
export function cutContractCents(signedCents: number, orders: CutOrder[], adjustmentsCents = 0): number {
  return signedCents + adjustmentsCents + orders
    .filter(o => o.status !== 'void' && !o.deletedAt && (o.totalCents < 0 || o.status === 'approved' || !!o.signedAt))
    .reduce((t, o) => t + o.totalCents, 0)
}

/**
 * The most a change order can take off, in cents (a negative amount, or 0):
 * down to the floor, and no credit at all on a contract already at or under
 * it. Null when the change is no credit or there is no floor. `contractCents`:
 * the contract as cutContractCents counts it.
 */
export function cutLimitCents(contractCents: number, changeCents: number, floorCents: number): number | null {
  if (!(floorCents > 0) || !(changeCents < 0)) return null
  return Math.min(0, floorCents - contractCents)
}

/** A credit past the floor: the screen and the server (portal lib/changeOrderMinimum.ts) ask the same. */
export function cutUnderMinimum(contractCents: number, changeCents: number, floorCents: number): boolean {
  const limit = cutLimitCents(contractCents, changeCents, floorCents)
  return limit !== null && changeCents < limit
}

/** What the login is told of a credit past the floor: the same words on the screen and from the server. */
export function cutUnderMinimumWarning(contractCents: number, changeCents: number, floorCents: number, owner: boolean): string {
  return owner
    ? `This takes the job under the ${dollars(floorCents)} minimum job price. As the owner you can give the full credit anyway.`
    : `This cannot be saved. It takes the job under the ${dollars(floorCents)} minimum job price: the contract would be ${dollars(contractCents + changeCents)}. Take less off, or ask Jonathan.`
}

/** The owner's note once the box gives the full credit (in place of "the credit stops at"). */
export function cutFullCreditNote(contractCents: number, changeCents: number, floorCents: number): string {
  return `Full credit given: the contract becomes ${dollars(contractCents + changeCents)}, under the ${dollars(floorCents)} minimum.`
}
