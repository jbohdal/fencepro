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

const dollars = (c: number) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 })}`
const listed = (a: string[]) => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`)

/** What the login is told: the same words on the screen and from the server. */
export function underMinimumWarning(under: UnderMinimum[], minimumCents: number, owner: boolean): string {
  const prices = listed(under.map(u => `${u.name || 'The price'} would be ${dollars(u.priceCents)}`))
  return owner
    ? `${prices}, under the ${dollars(minimumCents)} minimum job price. As the owner you can save it anyway.`
    : `This cannot be saved. ${prices}, under the ${dollars(minimumCents)} minimum job price. Take less off, or ask Jonathan.`
}
