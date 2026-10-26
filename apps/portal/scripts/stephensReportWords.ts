/**
 * Plain words for the Stephens dry run (scripts/stephens-quotes-2026-10-26b.ts),
 * kept apart from the script so they can be tested (tests/stephensReportWords.test.ts).
 * Review, Oct 26 2026: a yard total with $0 parts read as a cheaper price; raw
 * ids and states in the main text; "OK limit 20%" unexplained; same-named
 * quotes impossible to tell apart; a price that did not move (+$0.00) unexplained;
 * the pipe's own effect mixed with every other price change since a quote was saved.
 * Money in cents.
 */

export const dollarsOf = (c: number) => `${c < 0 ? '-' : ''}$${(Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
export const signed = (c: number) => (c > 0 ? `+${dollarsOf(c)}` : c < 0 ? dollarsOf(c) : '$0.00')
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** The first 7 letters of an id, to tell quotes apart ("quote 3f9a21c"). */
export const shortId = (id: string) => String(id ?? '').replace(/-/g, '').slice(0, 7)

/** What "OK limit N%" means. */
export const okLimitWords = (pct: number) => `a price that moves more than ${pct}% is not changed until Jonathan OKs it in Inventory > Invoices`

const STATUS: Record<string, string> = { DRAFT: 'Draft', SENT: 'Sent', SOLD: 'Sold', ACCEPTED: 'Accepted', LOST: 'Lost' }

/** "Jaziel Ortiz · Oct 21, 2026 · Draft · quote 3f9a21c" (archived, move or repair said too). */
export function quoteTitle(q: { id: string; customerName?: string | null; date?: string | null; status?: string | null; archivedAt?: unknown; work?: any }): string {
  const d = q.date && /^\d{4}-\d{2}-\d{2}/.test(q.date) ? new Date(`${q.date.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : (q.date || 'no date')
  const kind = q.work && typeof q.work === 'object' && ['move', 'repair'].includes(q.work.type) ? ` (a ${q.work.type})` : ''
  return `${q.customerName || '(no name)'} · ${d} · ${STATUS[String(q.status)] ?? String(q.status ?? '').toLowerCase()}${q.archivedAt ? ', archived' : ''}${kind} · quote ${shortId(q.id)}`
}

/** One priced line of a saved quote (the quote itself, or one option on its proposal). */
export interface RepriceRow {
  /** "the quote" or the option's name. */
  what: string
  /** The fence it is priced as (its plain name). */
  fence: string
  pipes: number
  savedCents: number
  /** Today with the pipe at its price now, and at the new price (null: not repriced). */
  nowCents: number | null
  afterCents: number | null
  materialNowCents: number | null
  materialAfterCents: number | null
  /** How the price is set (quoteJob priced.priceMethod): 'manual' (typed by hand), 'per_foot', 'cost_factor'. */
  method?: string | null
  /** Rounded to the whole dollar. */
  wholeDollar?: boolean
  note?: string
}

/** "the quote (White Vinyl Privacy, …), 47 pipes"; an option named for its fence is not named twice. */
function headOf(r: RepriceRow): string {
  const fence = r.fence && !r.what.includes(`"${r.fence}"`) ? ` (${r.fence})` : ''
  return `${r.what}${fence}, ${plural(r.pipes, 'pipe')}`
}

/** Why a price did not move when the materials did. */
export function unmovedWhy(r: RepriceRow): string | null {
  if (r.nowCents == null || r.afterCents == null || r.materialNowCents == null || r.materialAfterCents == null) return null
  if (r.afterCents !== r.nowCents || r.materialAfterCents === r.materialNowCents) return null
  if (r.method === 'manual') return 'its price was typed by hand, so a material cost does not move it'
  if (r.method === 'per_foot') return 'it is priced per foot, so a material cost does not move it'
  if (r.wholeDollar && Math.abs(r.materialAfterCents - r.materialNowCents) < 100) return 'the change is under a dollar and the price is rounded to the whole dollar'
  return 'the price is held where it was (for example a price typed by hand, or rounding to the whole dollar)'
}

/** An open quote's line: saved, today with the pipe at its price now, today with the new pipe price; the pipe's own effect apart from every other change since it was saved. */
export function openRowWords(r: RepriceRow, pipeNow: string, pipeAfter: string): string[] {
  const head = headOf(r)
  if (r.nowCents == null || r.afterCents == null) return [`${head}: saved ${dollarsOf(r.savedCents)}; not repriced${r.note ? `: ${r.note}` : ''}`]
  const pipe = r.afterCents - r.nowCents
  const other = r.nowCents - r.savedCents
  const out = [`${head}: saved ${dollarsOf(r.savedCents)} | today with pipe at ${pipeNow}: ${dollarsOf(r.nowCents)} | today with pipe at ${pipeAfter}: ${dollarsOf(r.afterCents)}`]
  const bits = [`the pipe's own effect ${signed(pipe)} (materials ${dollarsOf(r.materialNowCents!)} → ${dollarsOf(r.materialAfterCents!)})`]
  if (other !== 0) bits.push(`other price changes since it was saved ${signed(other)}`)
  const why = unmovedWhy(r)
  if (why) bits.push(`the price does not move: ${why}`)
  out.push(`   ${bits.join('; ')}`)
  return out
}

/** A sold quote's line: its price is the signed one; only what the job's materials cost us changes. */
export function soldRowWords(r: RepriceRow): string {
  const head = headOf(r)
  if (r.materialNowCents == null || r.materialAfterCents == null) return `${head}: price ${dollarsOf(r.savedCents)} (kept); materials not worked out${r.note ? `: ${r.note}` : ''}`
  return `${head}: price ${dollarsOf(r.savedCents)} (kept) | materials ${dollarsOf(r.materialNowCents)} → ${dollarsOf(r.materialAfterCents)} (${signed(r.materialAfterCents - r.materialNowCents)})`
}

/** One side of a test yard: its totals and how many of its parts have no price. */
export interface YardSide { materialCents: number; laborCents: number; cogsCents: number; priceCents: number; perFootCents: number; gmPct: number; unpriced: number }

/**
 * The totals of a test yard, black and green side by side. A side with parts
 * that have no price is INCOMPLETE: its total would read cheaper than it is,
 * so it is not shown as a price and no green − black difference is given.
 */
export function yardTotalsWords(black: YardSide, green: YardSide): string[] {
  const pad = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length))
  const lpad = (s: string, n: number) => (s.length >= n ? s : ' '.repeat(n - s.length) + s)
  const incomplete = (s: YardSide) => `INCOMPLETE: ${s.unpriced} part${s.unpriced === 1 ? ' has' : 's have'} no price (listed)`
  const out: string[] = []
  const both = !black.unpriced && !green.unpriced
  if (both) {
    out.push(`TOTALS: black ${dollarsOf(black.priceCents)} · green ${dollarsOf(green.priceCents)} · green − black ${signed(green.priceCents - black.priceCents)}`)
  } else {
    out.push(`TOTALS: black ${black.unpriced ? incomplete(black) : dollarsOf(black.priceCents)} · green ${green.unpriced ? incomplete(green) : dollarsOf(green.priceCents)}`)
    out.push('   A side with parts that have no price is not a price yet: its parts count $0.00, so it would read cheaper than it is. No green − black difference until every part has a price.')
  }
  const row = (k: string, f: (s: YardSide) => string, d?: (s: YardSide) => number, money = true) => {
    const cell = (s: YardSide) => (money && s.unpriced ? 'INCOMPLETE' : f(s))
    out.push(`${pad(k, 22)} black ${lpad(cell(black), 12)}   green ${lpad(cell(green), 12)}${both && d ? `   green − black ${lpad(signed(d(green) - d(black)), 11)}` : ''}`)
  }
  row('Price', s => dollarsOf(s.priceCents), s => s.priceCents)
  row('Price per foot', s => dollarsOf(s.perFootCents), s => s.perFootCents)
  row('Cost (COGS)', s => dollarsOf(s.cogsCents), s => s.cogsCents)
  row('Material', s => dollarsOf(s.materialCents), s => s.materialCents)
  row('Labor', s => dollarsOf(s.laborCents), s => s.laborCents, false)
  if (both) row('Gross margin', s => `${(s.gmPct * 100).toFixed(1)}%`, undefined, false)
  for (const [name, s] of [['black', black], ['green', green]] as const) {
    if (s.unpriced) out.push(`   ${name}, the parts that have a price only (not a price to quote): material ${dollarsOf(s.materialCents)}`)
  }
  return out
}
