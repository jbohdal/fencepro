/**
 * Which options a proposal shows, and which one starts selected.
 *
 * Pure: the server (routes/proposal.ts, through the estimate bundle) and the
 * app (ProposalSend's "N options offered") use the same rules.
 *
 * The same fence twice: a vinyl "best price" quote (6 or 8 ft panels, the
 * cheaper per run) often comes out all 8 ft panels, so its own option is the
 * Better tier's fence at the same price (audit Oct 26, 2026: a fourth card at
 * $7,363 next to Better at $7,363). Two options are the same fence when they
 * cost the same to the cent, carry the same warranty and the same parts in
 * the same amounts (the pull sheet, in any order). The first one is shown and
 * the later one is hidden. Nothing is taken off the saved proposal, so every
 * option keeps its place (the chosen option and the time per option are kept
 * by place).
 *
 * The option that starts selected: the one the quote was made with (its
 * style at its price), so a customer who signs without tapping an option
 * signs what the Salesman quoted. When that option is hidden as the same
 * fence as another, the one shown in its place. Only when the quote's own
 * option is not on the proposal: the recommended one.
 */

interface OptionLike {
  fenceStyle?: string
  finalPrice?: number
  warranty?: { name?: string } | null
  snapshot?: { pullSheet?: Array<{ item?: string; name?: string; qty?: number }> } | null
}

const cents = (n: unknown) => Math.round((Number(n) || 0) * 100)

/** What makes two options the same fence for the customer: price, warranty and the parts. '' when an option has no parts list (never matched). */
export function sameFenceKey(o: OptionLike | null | undefined): string {
  const sheet = o?.snapshot?.pullSheet
  if (!Array.isArray(sheet) || sheet.length === 0) return ''
  const parts = sheet
    .map(l => `${String(l?.item ?? l?.name ?? '').trim()}×${Math.round((Number(l?.qty) || 0) * 1000) / 1000}`)
    .sort()
    .join('|')
  return `${cents(o?.finalPrice)}#${String(o?.warranty?.name ?? '')}#${parts}`
}

/** For each option: the place of the earlier option it is the same fence as, or -1 (shown). */
export function sameFenceAs(options: OptionLike[] | null | undefined): number[] {
  const list = Array.isArray(options) ? options : []
  const first = new Map<string, number>()
  return list.map((o, i) => {
    const k = sameFenceKey(o)
    if (!k) return -1
    const at = first.get(k)
    if (at === undefined) { first.set(k, i); return -1 }
    return at
  })
}

/** The places of the options the customer sees. */
export function shownOptions(options: OptionLike[] | null | undefined): number[] {
  return sameFenceAs(options).map((d, i) => (d < 0 ? i : -1)).filter(i => i >= 0)
}

/**
 * The option selected when the page opens (not yet accepted): the quote's own
 * (its style at its price, else its style), shown in its place by its twin,
 * else `recommended`.
 */
export function startingOption(options: OptionLike[] | null | undefined, quote: { fenceStyle?: string | null; finalPrice?: number | null }, recommended: number): number {
  const list = Array.isArray(options) ? options : []
  if (!list.length) return 0
  const dup = sameFenceAs(list)
  const style = String(quote.fenceStyle ?? '')
  let own = style ? list.findIndex(o => o?.fenceStyle === style && cents(o?.finalPrice) === cents(quote.finalPrice)) : -1
  if (own < 0 && style) own = list.findIndex(o => o?.fenceStyle === style)
  const rec = Math.min(Math.max(0, recommended || 0), list.length - 1)
  const pick = own >= 0 ? own : rec
  return dup[pick] >= 0 ? dup[pick] : pick
}
