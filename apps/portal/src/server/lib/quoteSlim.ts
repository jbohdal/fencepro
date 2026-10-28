/**
 * The quote list without each proposal's drawing and option copies (Jonathan,
 * Oct 28 2026: "Yes, do the phone load cut"). The drawn site plan (planSvg)
 * and every option's priced snapshot (the copy of the quote put on it when the
 * customer picks that option: costs, pull sheet, rails, sections) were about
 * 0.75 MB of every phone's start up. The list carries the rest of the
 * proposal, so every option's label, tier, warranty and sent price
 * (finalPrice, perFoot, sections) is on every screen as before; the drawing
 * and the copies come with the one quote when it is opened
 * (GET /api/saved-quotes/:id; web quoteStore.ts loadFullQuote).
 *
 * A slim proposal says so (`slim: true`). A save that sends one back (an
 * older screen, a queued save) never loses them: the server puts the saved
 * drawing and copies back first (withHeavyParts), so a sent quote never
 * reprices and never loses its plan.
 */

type Json = any

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)

/** The proposal as the list sends it: no drawing, no option copies, marked slim. Anything else is as saved. */
export function slimProposal(p: Json): Json {
  if (!isObj(p)) return p
  const { planSvg: _plan, ...rest } = p as Record<string, unknown>
  const options = Array.isArray(p.options) ? p.options.map((o: Json) => {
    if (!isObj(o)) return o
    const { snapshot: _snap, ...keep } = o as Record<string, unknown>
    return keep
  }) : p.options
  return { ...rest, options, slim: true }
}

/** A quote row as the list sends it. */
export function slimQuote<T extends { proposal?: Json }>(q: T): T {
  return q && isObj(q.proposal) ? { ...q, proposal: slimProposal(q.proposal) } : q
}

/**
 * A proposal sent back slim: the saved drawing and each option's saved copy
 * put back (by place, the option's fence and price the same), the mark taken
 * off. A proposal that is not slim is returned as it is.
 */
export function withHeavyParts(incoming: Json, saved: Json): Json {
  if (!isObj(incoming) || incoming.slim !== true) return incoming
  const { slim: _slim, ...out } = incoming as Record<string, unknown>
  if (!isObj(saved)) return out
  if (out.planSvg === undefined && typeof saved.planSvg === 'string') out.planSvg = saved.planSvg
  const savedOptions: Json[] = Array.isArray(saved.options) ? saved.options : []
  if (Array.isArray(out.options)) {
    out.options = (out.options as Json[]).map((o, i) => {
      if (!isObj(o) || o.snapshot !== undefined) return o
      const s = savedOptions[i]
      const same = isObj(s) && s.fenceStyle === o.fenceStyle && Math.round(Number(s.finalPrice) * 100) === Math.round(Number(o.finalPrice) * 100)
      return same && s.snapshot !== undefined ? { ...o, snapshot: s.snapshot } : o
    })
  }
  return out
}
