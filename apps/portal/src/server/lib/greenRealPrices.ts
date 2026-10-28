/**
 * Real green prices for the green chain link parts still priced from Black
 * (Jonathan, Oct 27 2026, for the morning of Oct 28):
 *
 *   "Green parts: check all 17 Stephens quotes in Downloads (including
 *   06-251608) for real green prices on every part now marked 'From Black'
 *   (gates any size, dig set posts, fittings). The 3 plain bolts on 06-251707
 *   came on my green job, so use them as the Green bolt prices. Same rules: no
 *   fuel, 7.22% tax if no tax line."
 *
 * Pure. Every line of every Stephens document is looked at; a GREEN line
 * ("GRN ...", or a line 06-251707 prints for its green order) is matched to
 * the green part it is, by these rules only (nothing beyond them is guessed):
 *
 *   1. 06-251707's own words (lib/greenChainLink GREEN_LINES), spacing and
 *      the stick count ("x 7pc" / "x 8pc") ignored;
 *   2. a green residential single gate 4 ft tall, any width ("GRN RES SNG GATE
 *      5Wx4 ..."): the green 4 ft gate leaf of that width in Inventory;
 *   3. a green drop fork ("GRN PLY DROP FORK 2-1/2in"): Green, Fork, PS, of that size;
 *   4. green 0.055 wall post pipe, by Jonathan's dig set rule
 *      (lib/digSetPipeMatch: 6 ft long = 4 ft tall, 7 ft long = 5 ft tall;
 *      1-5/8" = line post, 2-1/2" = terminal): Green is 4 ft only, so only a
 *      6 ft pipe is a Green dig set post;
 *   5. the three plain BOLT/NUT lines on 06-251707 only (no color printed):
 *      the Green bolts, because Jonathan said so (on any other document a
 *      plain bolt is not green).
 *
 * Landed each, as "We ordered this" works it out (lib/invoiceMath): the
 * printed amount + its share of printed tax, freight and fees (never fuel),
 * + its share of 7.22% estimated tax when no tax is printed; per Inventory
 * unit (the line's unit conversion).
 *
 * For each part still priced from Black, the NEWEST document that prices it
 * gives its price; a part with a real price already is never changed here, and
 * a part no document prices stays from Black (listed).
 */

import { checkTotals, landedParts, spreadExtras, toInventoryQty, unitLanded } from './invoiceMath.js'
import { DIG_SET_HEIGHT_FOR_LENGTH } from './digSetPipeMatch.js'
import { GREEN_ASK, GREEN_CATEGORY, GREEN_LINES } from './greenChainLink.js'

export const GREEN_PRICES_KEY = 'migration:green-real-prices-2026-10-28'
/** The green order whose plain bolts Jonathan named as the green bolts. */
export const GREEN_BOLTS_DOC = '06-251707'
export const GREEN_BOLTS_WHY = "Jonathan, Oct 27: the plain bolts on 06-251707 came on his green job, so they are the Green bolt prices."

const norm = (s: string) => String(s ?? '').toLowerCase().replace(/\s+/g, '')
/** A rail's words without its stick count ("... SW x 7pc" and "... SW x 8pc" are the same rail). */
const noSticks = (s: string) => norm(s).replace(/x\d+pc$/, '')

export interface DocLine { description: string; qty: number | null; unit: string; unitPriceHc: number | null; totalCents: number | null; problems?: unknown[] }
export interface Doc {
  number: string
  /** YYYY-MM-DD */
  date: string
  files: string[]
  subtotalCents: number | null
  taxCents: number
  taxFound: boolean
  freightCents: number
  fees: Array<{ label: string; cents: number }>
  totalCents: number | null
  lines: DocLine[]
}

export interface Rule { part: string; vendorPer: number; invPer: number; unitWords: string; rule: string; note?: string }
export type LineMatch = { rule: Rule } | { none: string }

const isItem = (items: any[], name: string) => items.find(i => norm(i?.name) === norm(name) && i?.status !== 'discontinued') ?? null

/** Which green part a printed line is, by the rules at the top; null when the line is not green. */
export function greenRuleFor(doc: string, description: string, items: any[]): LineMatch | null {
  const d = description.replace(/\s+/g, ' ').trim()
  // 5. The plain bolts on 06-251707, by Jonathan's word.
  const ask = GREEN_ASK.find(a => norm(a.description) === norm(d))
  if (ask) {
    if (doc !== GREEN_BOLTS_DOC) return null
    const part = ask.candidates.find(c => /^green,/i.test(c))!
    return { rule: { part, vendorPer: 1, invPer: 1, unitWords: 'each', rule: GREEN_BOLTS_WHY } }
  }
  // 1. 06-251707's own words.
  const g = GREEN_LINES.find(x => noSticks(x.description) === noSticks(d))
  if (g) return { rule: { part: g.part, vendorPer: g.vendorPer, invPer: g.invPer, unitWords: g.unitWords, rule: `the words 06-251707 prints for it${g.note ? ` (${g.note})` : ''}` } }
  if (!/\bGRN\b/i.test(d)) return null
  // 2. A green residential single gate, 4 ft tall, any width.
  let m = /^GRN RES SNG GATE (\d+)'?\s*W\s*x\s*(\d+)'?/i.exec(d)
  if (m) {
    const w = Number(m[1]), h = Number(m[2])
    if (h !== 4) return { none: `a ${h} ft tall gate: Green chain link is 4 ft only` }
    const re = new RegExp(`^chainlink,green,gate,1-3/8",4'x${w}'\\(\\.0\\d\\d\\)$`)
    const item = items.find(i => re.test(norm(i?.name)) && (i?.category === GREEN_CATEGORY || String(i?.madeFor ?? '').startsWith('chain:finish:')))
    if (!item) return { none: `no green 4 ft tall gate ${w} ft wide in Inventory` }
    const frame = /SP0?(\d{2,3})/i.exec(d)?.[1]
    const named = /\((\.0\d\d)\)$/.exec(String(item.name).trim())?.[1]
    const note = frame && named && `.0${frame.replace(/^0/, '')}` !== named ? `printed frame .0${frame.replace(/^0/, '')}, the part's name says ${named} (named after the black leaf it was swapped from)` : undefined
    return { rule: { part: String(item.name).trim(), vendorPer: 1, invPer: 1, unitWords: 'each', rule: `green residential single gate, ${w} ft wide x 4 ft tall = the green 4 ft gate leaf ${w} ft wide`, ...(note ? { note } : {}) } }
  }
  // 3. A green drop fork.
  m = /^GRN PLY DROP FORK (1-3\/8|2-1\/2)\s*in$/i.exec(d)
  if (m) {
    const part = `Green, Fork, PS, ${m[1]}"`
    return isItem(items, part) ? { rule: { part, vendorPer: 1, invPer: 1, unitWords: 'each', rule: `green drop fork ${m[1]}"` } } : { none: `no "${part}" in Inventory` }
  }
  // 4. Green 0.055 wall post pipe, by Jonathan's dig set rule.
  m = /^GRN PLY (1-5\/8|2-1\/2)" x (\d+)' x PP055$/i.exec(d)
  if (m) {
    const len = Number(m[2])
    const h = DIG_SET_HEIGHT_FOR_LENGTH[len]
    if (!h) return { none: `${len} ft long 0.055 pipe: not in Jonathan's dig set rule (6 ft long = 4 ft tall, 7 ft long = 5 ft tall)` }
    if (h !== 4) return { none: `${len} ft long = the ${h} ft tall dig set post (Jonathan's rule); Green chain link is 4 ft only, so no Green part is this length` }
    const role = m[1] === '1-5/8' ? 'Line Post' : 'Terminal Post'
    const part = `DS, Pipe, Green, ${role}, ${m[1]}" 0.055 wall, 4' Chain Link`
    return isItem(items, part) ? { rule: { part, vendorPer: 1, invPer: 1, unitWords: '1 piece = 1 each', rule: `Jonathan's dig set rule: 6 ft long = 4 ft tall, ${m[1]}" = ${role.toLowerCase()}` } } : { none: `no "${part}" in Inventory` }
  }
  return { none: 'no Green chain link part is this (not in the Green kits)' }
}

export interface LandedLine { lineCents: number; extraCents: number; estTaxCents: number; landedCents: number }
export interface DocLanded { ok: boolean; problems: string[]; lines: LandedLine[]; estBp: number | null; estTaxCents: number; fuelCents: number; spreadCents: number }

/** Each line's landed amount, as "We ordered this" works it out. */
export function docLanded(doc: Doc, estTaxBp: number): DocLanded {
  const check = checkTotals(doc.lines.map(l => ({ totalCents: l.totalCents, problems: Array.isArray(l.problems) ? l.problems as any[] : [] })), {
    subtotalCents: doc.subtotalCents, taxCents: doc.taxCents, freightCents: doc.freightCents, feesCents: doc.fees.reduce((s, f) => s + f.cents, 0), totalCents: doc.totalCents,
  })
  const estBp = doc.taxFound ? null : estTaxBp
  const parts = landedParts({ linesCents: check.linesCents, taxCents: doc.taxCents, freightCents: doc.freightCents, fees: doc.fees, taxFound: doc.taxFound, taxOk: false, estTaxBp: estBp ?? 0 })
  const cents = doc.lines.map(l => l.totalCents ?? 0)
  const spread = spreadExtras(cents, parts.spreadCents)
  const est = spreadExtras(cents, parts.estTaxCents)
  return {
    ok: check.ok, problems: check.problems.map(p => JSON.stringify(p)), estBp, estTaxCents: parts.estTaxCents, fuelCents: parts.fuelCents, spreadCents: parts.spreadCents,
    lines: cents.map((c, k) => ({ lineCents: c, extraCents: spread[k] + est[k], estTaxCents: est[k], landedCents: c + spread[k] + est[k] })),
  }
}

export interface PrintedGreen {
  doc: string
  date: string
  files: string[]
  seq: number
  description: string
  qty: number
  unit: string
  /** The line's amount and its landed amount. */
  lineCents: number
  landedCents: number
  /** Per Inventory unit: as printed, and landed (rounded and exact). */
  printedEachCents: number | null
  landedEachCents: number | null
  landedEachExact: number | null
  /** How the landed price was made, in words. */
  how: string
  part: string | null
  rule: Rule | null
  /** Why no part, when part is null. */
  none: string | null
}

const dollars = (c: number) => `$${(c / 100).toFixed(2)}`

/** Every green line printed on the documents, each with its part (or why none) and landed price each. */
export function greenLinesOf(docs: Doc[], items: any[], estTaxBp: number): PrintedGreen[] {
  const out: PrintedGreen[] = []
  for (const doc of docs) {
    const landed = docLanded(doc, estTaxBp)
    doc.lines.forEach((l, k) => {
      const match = greenRuleFor(doc.number, l.description, items)
      if (!match) return
      const rule = 'rule' in match ? match.rule : null
      const qty = Number(l.qty) || 0
      const L = landed.lines[k]
      let printedEach: number | null = null, each: { cents: number; exact: number } | null = null
      // A document that does not add up as read is not used for a price (it would wait in Needs review in the app).
      if (rule && qty > 0 && landed.ok) {
        const invQty = toInventoryQty(qty, rule)
        printedEach = unitLanded(L.lineCents, 0, invQty).cents
        each = unitLanded(L.landedCents, 0, invQty)
      }
      const how = [
        doc.taxFound ? `printed tax ${dollars(doc.taxCents)} spread` : `no tax printed: ${(estTaxBp / 100).toFixed(2)}% estimated tax`,
        doc.freightCents ? `freight ${dollars(doc.freightCents)} spread` : 'no freight',
        landed.fuelCents ? `fuel ${dollars(landed.fuelCents)} left out` : 'no fuel',
      ].join(', ')
      out.push({
        doc: doc.number, date: doc.date, files: doc.files, seq: k + 1, description: l.description, qty, unit: l.unit,
        lineCents: L.lineCents, landedCents: L.landedCents, printedEachCents: printedEach, landedEachCents: each?.cents ?? null, landedEachExact: each?.exact ?? null,
        how, part: rule?.part ?? null, rule, none: rule ? (landed.ok ? null : `the document does not add up as read (${landed.problems.join('; ')}): not used`) : (match as { none: string }).none,
      })
    })
  }
  return out
}

/** Newest first: by date, then by document number. */
const newestFirst = (a: PrintedGreen, b: PrintedGreen) => b.date.localeCompare(a.date) || b.doc.localeCompare(a.doc) || a.seq - b.seq

export interface GreenPriceSet {
  part: string
  itemId: string
  black: string
  beforeCents: number
  afterCents: number
  afterExact: number
  printedCents: number
  source: PrintedGreen
  /** Older printed prices for the same part (not used). */
  older: PrintedGreen[]
}
export interface GreenStillBlack { part: string; itemId: string; black: string; cents: number; why: string; seen: PrintedGreen[] }
export interface GreenKept { part: string; cents: number | null; date: string | null; newest: PrintedGreen | null }

export interface GreenPricePlan {
  printed: PrintedGreen[]
  set: GreenPriceSet[]
  stillFromBlack: GreenStillBlack[]
  /** Green parts with a price of their own: never changed here (shown with the newest printed price). */
  kept: GreenKept[]
}

/**
 * The plan: each part still priced from Black (borrowed) and a printed green
 * price gets the newest one; the rest stay from Black. `borrowed` tells
 * whether an item's borrowed price still stands (web/src/priceAge.ts borrowedPrice).
 */
export function planGreenRealPrices(docs: Doc[], items: any[], estTaxBp: number, borrowed: (item: any) => { part: string; cents: number } | null): GreenPricePlan {
  const printed = greenLinesOf(docs, items, estTaxBp)
  const byPart = new Map<string, PrintedGreen[]>()
  for (const p of printed) if (p.part && p.landedEachCents != null) byPart.set(norm(p.part), [...(byPart.get(norm(p.part)) ?? []), p])
  for (const ps of byPart.values()) ps.sort(newestFirst)
  const set: GreenPriceSet[] = [], still: GreenStillBlack[] = [], kept: GreenKept[] = []
  const seen = new Set<string>()
  for (const item of items) {
    const k = norm(item?.name)
    if (!k || seen.has(k)) continue
    const green = item?.category === GREEN_CATEGORY || String(item?.madeFor ?? '').startsWith('chain:finish:')
    const b = borrowed(item)
    const ps = byPart.get(k) ?? []
    if (b) {
      seen.add(k)
      const cents = Math.round(Number(item.unitCost) * 100)
      if (!ps.length) {
        still.push({ part: String(item.name).trim(), itemId: String(item.id), black: b.part.trim(), cents, why: 'no green price printed for it on any of the documents', seen: printed.filter(p => !p.part && p.none && partWordsNear(p.description, String(item.name))) })
        continue
      }
      const [src, ...older] = ps
      set.push({ part: String(item.name).trim(), itemId: String(item.id), black: b.part.trim(), beforeCents: cents, afterCents: src.landedEachCents!, afterExact: src.landedEachExact!, printedCents: src.printedEachCents!, source: src, older })
    } else if (green && ps.length) {
      seen.add(k)
      const n = Number(item.unitCost)
      kept.push({ part: String(item.name).trim(), cents: Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null, date: typeof item.priceUpdatedAt === 'string' ? item.priceUpdatedAt : null, newest: ps[0] })
    }
  }
  const byName = (a: { part: string }, b: { part: string }) => a.part.localeCompare(b.part)
  return { printed, set: set.sort(byName), stillFromBlack: still.sort(byName), kept: kept.sort(byName) }
}

/** A green line that is not a part but reads close to one (a 7 ft post next to the 6 ft dig set post), to say why it was not used. */
function partWordsNear(description: string, part: string): boolean {
  const d = description.toUpperCase(), p = part.toUpperCase()
  if (/GATE/.test(d) && /GATE/.test(p)) return true
  if (/FORK/.test(d) && /FORK/.test(p)) return true
  if (/PP055/.test(d) && /0\.055 WALL/.test(p)) return /1-5\/8/.test(d) === /1-5\/8/.test(p)
  if (/BOLT/.test(d) && /BOLT/.test(p)) return true
  return false
}
