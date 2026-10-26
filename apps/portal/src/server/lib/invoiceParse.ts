/**
 * Pulling an invoice apart from the rows the reader found (lib/invoiceReader).
 * Works for any vendor's layout without a template, by what each row looks
 * like:
 *
 *   - a line ends in: quantity, [unit], unit price, amount
 *     (or starts with quantity [unit] when that is the vendor's order);
 *     what is left is the vendor item number (a code) and the description.
 *   - totals are rows with a label and one amount: Subtotal, Sales Tax,
 *     Freight / Delivery / Shipping, Fuel / Fee / Surcharge / Handling /
 *     Discount (other fees), Total / Amount Due / Balance Due. On several
 *     pages the last one wins.
 *     A row with two labels and two amounts (a PDF that prints "Fuel Charge"
 *     and "7.5% Tax" on top of each other) is split by the printed tax rate:
 *     the amount nearest rate x subtotal is the tax.
 *   - a lone amount right after the lines that equals their sum is the
 *     subtotal, even without a label.
 *   - layouts with Ordered / Shipped / BackOrder / Unit first, and a Packing
 *     column before the price (Stephens Pipe & Steel) are read too.
 *   - skipped: notes starting with "*" (*Fab:), separator rows, $0.00 lines.
 *   - QUOTATION or INVOICE, its number, date and vendor come from the header.
 *
 * Nothing is guessed silently: anything that does not fit is marked as a
 * problem on its line, and the invoice goes to Needs review.
 */

import type { Row } from './invoiceReader.js'

export type LineProblem = 'math' | 'unclear' | 'no_quantity' | 'no_price' | 'no_amount' | 'credit'
export type HeaderProblem = 'no_vendor' | 'no_number' | 'no_date' | 'no_total'

export interface ParsedLine {
  page: number
  row: number
  box: Row['box'] | null
  itemNumber: string
  description: string
  qty: number | null
  unit: string
  /** Unit price in hundredths of a cent (ten-thousandths of a dollar), so $0.0425 is kept exactly. */
  unitPriceHc: number | null
  totalCents: number | null
  /** How sure the reader was of this row, 0..1. */
  conf: number
  problems: LineProblem[]
  /** The row as read, for showing next to the picture. */
  raw: string
  /** The vendor's packing, when printed ("6 rll"). */
  packing?: string
}

export interface ParsedFee { label: string; cents: number; page: number; row: number; box: Row['box'] | null }

export interface SkippedRow { page: number; row: number; text: string; why: 'note' | 'separator' | 'zero' }

export interface ParsedInvoice {
  /** A quotation never changes prices until it is marked ordered. */
  docType: 'invoice' | 'quote'
  vendorName: string
  invoiceNumber: string
  /** YYYY-MM-DD */
  invoiceDate: string
  subtotalCents: number | null
  taxCents: number
  freightCents: number
  fees: ParsedFee[]
  totalCents: number | null
  lines: ParsedLine[]
  /** Rows left out on purpose. */
  skipped: SkippedRow[]
  /** A tax row was printed (an invoice without one waits for an OK). */
  taxFound: boolean
  /** The tax rate as printed ("7.22%"), when there is one. */
  taxRate: string
  problems: HeaderProblem[]
  /** Where each total was found, to highlight it. */
  totalsAt: Partial<Record<'subtotal' | 'tax' | 'freight' | 'total', { page: number; row: number; box: Row['box'] | null }>>
}

/** Below this the reader was not sure enough of a number to trust it. */
export const LOW_CONFIDENCE = 0.35

const UNITS = new Set(['EA', 'EACH', 'BX', 'BOX', 'BDL', 'BUN', 'BNDL', 'BD', 'FT', 'LF', 'PC', 'PCS', 'RL', 'RLL', 'ROLL', 'LBS', 'BG', 'BAG', 'CS', 'CASE', 'PR', 'PK', 'PKG', 'SET', 'LB', 'GAL', 'SF', 'C', 'M', 'CT', 'SK', 'TN', 'TON', 'SHT', 'DZ', 'UN', 'PAL', 'PLT', 'CTN', 'KIT', 'SQ', 'LG', 'LEN', 'STK'])

// ── Numbers ───────────────────────────────────────────────────────────────────

const MONEY = /^\(?-?\$?(\d{1,3}(,\d{3})+|\d+)(\.\d{1,4})?\)?-?$/

/** "$1,093.60" → 109360; "(12.00)" and "12.00-" are negative. Null when it is not an amount. */
export function moneyToCents(s: string): number | null {
  const v = moneyToHc(s)
  if (v == null) return null
  if (v % 100 !== 0) return null // an amount has at most 2 decimals
  return v / 100
}

/** An amount or price in hundredths of a cent: "0.0425" → 425, "25.00" → 250000. */
export function moneyToHc(s: string): number | null {
  const t = s.trim()
  if (!MONEY.test(t)) return null
  const neg = /^\(.*\)$/.test(t) || t.startsWith('-') || t.endsWith('-') || t.startsWith('(-')
  const digits = t.replace(/[()$,\-]/g, '')
  const [whole, frac = ''] = digits.split('.')
  if (frac.length > 4) return null
  const hc = Number(whole) * 10000 + Number((frac + '0000').slice(0, 4))
  if (!Number.isFinite(hc)) return null
  return neg ? -hc : hc
}

const isAmount = (s: string) => /\.\d{2}\)?-?$/.test(s.trim()) && moneyToHc(s) != null
const isPrice = (s: string) => /\.\d{2,4}\)?-?$/.test(s.trim()) && moneyToHc(s) != null
const isQty = (s: string) => /^\d{1,6}(\.\d{1,3})?$/.test(s.replace(/,/g, '')) && s.replace(/,/g, '').length <= 9
const isUnit = (s: string) => UNITS.has(s.toUpperCase().replace(/[./]$/, ''))
/** A vendor item number: has a digit, no spaces, letters/digits/dashes/dots/slashes. */
const isCode = (s: string) => /^[A-Z0-9][A-Z0-9\-./#]{1,29}$/i.test(s) && /\d/.test(s) && !isAmount(s)

// ── Dates ─────────────────────────────────────────────────────────────────────

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const pad = (n: number) => String(n).padStart(2, '0')

/** "10/02/2026", "10-2-26", "2026-10-02", "Oct 2, 2026" → "2026-10-02". */
export function parseDate(s: string): string | null {
  let m = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/.exec(s)
  if (m) return valid(+m[1], +m[2], +m[3])
  m = /\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})\b/.exec(s)
  if (m) { const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; return valid(y, +m[1], +m[2]) }
  m = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/i.exec(s)
  if (m) return valid(+m[3], MONTHS.indexOf(m[1].toLowerCase()) + 1, +m[2])
  return null
}
function valid(y: number, mo: number, d: number): string | null {
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null
  return `${y}-${pad(mo)}-${pad(d)}`
}

// ── Labels ────────────────────────────────────────────────────────────────────

type TotalKind = 'subtotal' | 'tax' | 'freight' | 'fee' | 'total'

/** What a totals row is, from its label (the words before its amount). */
export function totalKind(label: string): TotalKind | null {
  const l = label.toLowerCase().replace(/[:.]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!l || l.length > 40) return null
  if (/\b(page|qty|quantity|items?|weight|lbs?)\b/.test(l) && !/\bitems? total\b/.test(l)) return null
  if (/^(sub ?-?total|merchandise( total)?|items? total|net amount|goods total)\b/.test(l)) return 'subtotal'
  if (/\b(tax|gst|vat)\b/.test(l)) return 'tax'
  if (/\b(freight|delivery|shipping|ship & handling|ship and handling|transport|haul)\b/.test(l)) return 'freight'
  if (/\b(fuel|surcharge|fee|fees|handling|restock|core|pallet|environmental|misc|other|discount|credit|deposit)\b/.test(l)) return 'fee'
  if (/^(invoice total|total|grand total|total due|amount due|balance due|total amount|invoice amount|net due|please pay|order total|total order)\b/.test(l) || /^order total$/.test(l)) return 'total'
  return null
}

const HEADER_WORDS = /\b(description|qty|quantity|item ?#|item no|unit price|amount|ext(ended)?|u\/?m)\b/i

// ── Parsing ───────────────────────────────────────────────────────────────────

type LineCore = Omit<ParsedLine, 'page' | 'row' | 'box' | 'conf' | 'raw'>

/**
 * Ordered, Shipped, BackOrder, Unit, Description, [Packing], Price, Amount
 * (Stephens Pipe & Steel). The quantity priced is the one that adds up:
 * ordered, else shipped. No vendor item numbers: matched by description.
 */
function osbLine(t: string[]): LineCore | null {
  if (t.length < 6 || !isQty(t[0]) || !isQty(t[1]) || !isQty(t[2])) return null
  // Some lines print no unit ("20 20 0 HINGE PVC 35.29 705.80"): each.
  const hasUnit = isUnit(t[3])
  if (!hasUnit && (isQty(t[3]) || !/[a-z]/i.test(t[3]))) return null
  const amount = t[t.length - 1], price = t[t.length - 2]
  if (!isAmount(amount) || !isPrice(price)) return null
  const totalCents = moneyToCents(amount)
  const unitPriceHc = moneyToHc(price)
  if (totalCents == null || unitPriceHc == null) return null
  const unit = hasUnit ? t[3].toUpperCase() : 'EA'
  const ordered = Number(t[0].replace(/,/g, '')), shipped = Number(t[1].replace(/,/g, ''))
  const qty = !lineAddsUp(ordered, unitPriceHc, totalCents, unit) && lineAddsUp(shipped, unitPriceHc, totalCents, unit) ? shipped : ordered
  let desc = t.slice(hasUnit ? 4 : 3, -2)
  let packing = ''
  if (desc.length >= 3 && isQty(desc[desc.length - 2]) && isUnit(desc[desc.length - 1])) { packing = desc.slice(-2).join(' '); desc = desc.slice(0, -2) }
  const description = desc.join(' ')
  if (!/[a-z]{2}/i.test(description)) return null
  const problems: LineProblem[] = []
  if (!lineAddsUp(qty, unitPriceHc, totalCents, unit)) problems.push('math')
  if (totalCents < 0) problems.push('credit')
  return { itemNumber: '', description, qty, unit, unitPriceHc, totalCents, problems, ...(packing ? { packing } : {}) }
}

function lineFromTokens(tokens: string[]): LineCore | null {
  const t = [...tokens]
  if (t.length < 3) return null
  const osb = osbLine(t)
  if (osb) return osb
  const amount = t[t.length - 1]
  if (!isAmount(amount)) return null
  const problems: LineProblem[] = []
  let qty: number | null = null, unit = '', unitPriceHc: number | null = null
  const totalHc = moneyToHc(amount)!
  const totalCents = Math.round(totalHc / 100)
  if (totalHc % 100 !== 0) problems.push('unclear')
  t.pop()
  let left: string[]
  // Order 1: ... qty [unit] price amount
  if (t.length && isPrice(t[t.length - 1])) {
    unitPriceHc = moneyToHc(t.pop()!)!
    if (t.length && isUnit(t[t.length - 1]) && t.length >= 2 && isQty(t[t.length - 2])) { unit = t.pop()!.toUpperCase(); qty = Number(t.pop()!.replace(/,/g, '')) }
    else if (t.length && isQty(t[t.length - 1]) && t.length >= 2) { qty = Number(t.pop()!.replace(/,/g, '')) }
    left = t
    // Order 2: qty [unit] item description price amount
    if (qty == null && t.length >= 2 && isQty(t[0])) {
      qty = Number(t[0].replace(/,/g, ''))
      left = t.slice(1)
      if (left.length && isUnit(left[0])) unit = left.shift()!.toUpperCase()
    }
  } else {
    return null
  }
  if (!left.length) return null
  let itemNumber = ''
  if (left.length >= 2 && isCode(left[0])) itemNumber = left.shift()!
  // A unit just after the item number (some layouts put U/M by the code).
  if (!unit && left.length >= 2 && isUnit(left[left.length - 1]) && qty != null) unit = left.pop()!.toUpperCase()
  const description = left.join(' ')
  if (!/[a-z]{2}/i.test(description)) return null
  if (qty == null) problems.push('no_quantity')
  if (unitPriceHc == null) problems.push('no_price')
  if (qty != null && unitPriceHc != null && !lineAddsUp(qty, unitPriceHc, totalCents, unit)) problems.push('math')
  if (totalCents < 0) problems.push('credit')
  return { itemNumber, description, qty, unit: unit || 'EA', unitPriceHc, totalCents, problems }
}

/**
 * Quantity x unit price is the amount (C = per hundred, M = per thousand).
 * A printed price is rounded to its last decimal (Stephens prints $17.075 for
 * $17.07451...), so the amount may be off by up to quantity x half of that
 * last decimal, plus a cent. The lines must still add up to the subtotal to
 * the penny, so a misread amount is caught there.
 */
export function lineAddsUp(qty: number, unitPriceHc: number, totalCents: number, unit = ''): boolean {
  const per = unit === 'C' ? 100 : unit === 'M' ? 1000 : 1
  const cents = (qty * unitPriceHc) / per / 100
  // Decimals printed: 4 when hc is not a multiple of 10, 3 when not a multiple of 100, else 2.
  const decimals = unitPriceHc % 10 !== 0 ? 4 : unitPriceHc % 100 !== 0 ? 3 : 2
  const slack = (Math.abs(qty) * 0.5 * Math.pow(10, 2 - decimals)) / per
  return Math.abs(cents - totalCents) <= 1.0001 + slack
}

export interface KnownVendor { id: string; name: string; aliases?: string[] }

export const normalizeName = (s: string) => s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/\b(inc|llc|co|corp|company|ltd)\b/g, '').replace(/\s+/g, ' ').trim()

/** The known vendor whose name (or a name its invoices use) is printed on the invoice. */
export function findVendor(text: string, vendors: KnownVendor[]): KnownVendor | null {
  const hay = ` ${normalizeName(text)} `
  let best: KnownVendor | null = null, bestLen = 0
  for (const v of vendors) {
    for (const n of [v.name, ...(v.aliases ?? [])]) {
      const k = normalizeName(n)
      if (k.length >= 4 && hay.includes(` ${k} `) && k.length > bestLen) { best = v; bestLen = k.length }
    }
  }
  return best
}

/**
 * A row holding two (or more) totals rows printed close one above the other,
 * e.g. Stephens 06-251608: "Fuel Charge 25.00" and "Freight 125.00" read as
 * "Fuel Freight Charge 125.00 25.00". Each amount takes the label words
 * nearest its own height, from the label column (where the first totals word
 * starts). Null unless the amounts are at different heights and every label
 * is a known totals label.
 */
export function splitStackedTotals(r: Pick<Row, 'words'>): Array<{ kind: TotalKind; label: string; cents: number }> | null {
  const words = r.words ?? []
  const amounts = words.filter(w => isAmount(w.t))
  if (amounts.length < 2) return null
  const tol = Math.max(0.001, Math.min(...amounts.map(w => w.h || 0.01)) * 0.3)
  for (let i = 0; i < amounts.length; i++) for (let j = i + 1; j < amounts.length; j++) if (Math.abs(amounts[i].y - amounts[j].y) <= tol) return null
  const keyX = words.filter(w => !isAmount(w.t) && totalKind(w.t) != null).map(w => w.x)
  if (!keyX.length) return null
  const from = Math.min(...keyX) - 0.005
  const right = Math.min(...amounts.map(w => w.x))
  const labelWords = words.filter(w => !isAmount(w.t) && w.x >= from && w.x < right && /[a-z]/i.test(w.t))
  const groups = amounts.map(() => [] as typeof words)
  for (const w of labelWords) {
    let best = 0
    amounts.forEach((a, k) => { if (Math.abs(a.y - w.y) < Math.abs(amounts[best].y - w.y)) best = k })
    groups[best].push(w)
  }
  const out: Array<{ kind: TotalKind; label: string; cents: number }> = []
  for (const [k, a] of amounts.entries()) {
    const label = groups[k].sort((p, q) => p.x - q.x).map(w => w.t).join(' ')
    const kind = totalKind(label)
    const cents = moneyToCents(a.t)
    if (!kind || cents == null) return null
    out.push({ kind, label, cents })
  }
  return out
}

export function parseInvoice(pages: Array<{ page: number; rows: Row[] }>, vendors: KnownVendor[] = []): ParsedInvoice {
  const rows = pages.flatMap(p => p.rows)
  const out: ParsedInvoice = {
    docType: 'invoice', vendorName: '', invoiceNumber: '', invoiceDate: '', subtotalCents: null, taxCents: 0, freightCents: 0, fees: [],
    totalCents: null, lines: [], skipped: [], taxFound: false, taxRate: '', problems: [], totalsAt: {},
  }
  const allText = rows.map(r => r.text).join('\n')

  // Vendor: one already known, else the first name-like row at the top of page 1.
  const known = findVendor(allText, vendors)
  if (known) out.vendorName = known.name
  else {
    const top = (pages[0]?.rows ?? []).slice(0, 6)
    for (const r of top) {
      const cell = (r.cells[0] ?? r.text).trim()
      if (/invoice|page \d|date|sold to|ship to|bill to|remit/i.test(cell)) continue
      if (/[a-z]{3}/i.test(cell) && !/^\d/.test(cell) && cell.length <= 60) { out.vendorName = cell.replace(/\s+/g, ' '); break }
    }
  }

  // Quotation or invoice, from the header (the first rows of page 1).
  const head = (pages[0]?.rows ?? []).slice(0, 15).map(r => r.cells.join('  ')).join('\n')
  if (/\b(quotation|quote)\s*(#|no\b|number)/i.test(head) && !/\binvoice\s*(#|no\b|number)/i.test(head)) out.docType = 'quote'

  // Invoice (or quotation) number and date: the labelled ones in the header.
  for (const r of rows) {
    const text = r.cells.join('  ')
    if (!out.invoiceNumber) {
      const m = /\b(?:invoice|inv|quotation|quote)\s*(?:no\.?|number|num|#)?\s*[:#]?\s*#?\s*([A-Z0-9][A-Z0-9\-/]{2,24})\b/i.exec(text)
      if (m && /\d/.test(m[1]) && !parseDate(m[1])) out.invoiceNumber = m[1].toUpperCase()
    }
    if (!out.invoiceDate) {
      const m = /\b(?:invoice\s*date|inv\.?\s*date|date)\s*:?\s*(.+)$/i.exec(text)
      const d = m ? parseDate(m[1]) : null
      if (d) out.invoiceDate = d
    }
  }
  if (!out.invoiceDate) for (const r of pages[0]?.rows ?? []) { const d = parseDate(r.text); if (d) { out.invoiceDate = d; break } }

  // Lines and totals.
  let lastLine: ParsedLine | null = null
  let inTotals = false
  const linesSum = () => out.lines.reduce((s, l) => s + (l.totalCents ?? 0), 0)
  const put = (kind: TotalKind, label: string, cents: number, at: { page: number; row: number; box: Row['box'] | null }) => {
    if (kind === 'subtotal') { out.subtotalCents = cents; out.totalsAt.subtotal = at }
    else if (kind === 'tax') { out.taxCents = cents; out.totalsAt.tax = at; out.taxFound = true; const m = /(\d+(\.\d+)?)%/.exec(label); if (m) out.taxRate = `${m[1]}%` }
    else if (kind === 'freight') { out.freightCents = cents; out.totalsAt.freight = at }
    else if (kind === 'fee') {
      const name = label.replace(/[-_=]{2,}/g, ' ').replace(/\s+/g, ' ').trim()
      const signed = /discount|credit/i.test(name) && cents > 0 ? -cents : cents
      out.fees = out.fees.filter(f => f.label.toLowerCase() !== name.toLowerCase())
      out.fees.push({ label: name, cents: signed, ...at })
    }
    else if (kind === 'total') { out.totalCents = cents; out.totalsAt.total = at }
  }
  for (const r of rows) {
    // "5,325.41Total" is an amount and a word printed together.
    const tokens = r.text.split(/\s+/).filter(Boolean).flatMap(x => { const m = /^([\d,]+\.\d{2})([A-Za-z]{2,})$/.exec(x); return m ? [m[1], m[2]] : [x] })
    if (!tokens.length) continue
    const trimmed = r.text.trim()
    if (/^page \d+( of \d+)?$/i.test(trimmed) || /continued/i.test(r.text)) { lastLine = null; continue }
    // Notes ("*Fab: ...") and separator rows are not lines.
    if (trimmed.startsWith('*')) { out.skipped.push({ page: r.page, row: r.i, text: trimmed, why: 'note' }); lastLine = null; continue }
    if (/^[-_=.\s]{4,}$/.test(trimmed)) { if (out.lines.length) out.skipped.push({ page: r.page, row: r.i, text: trimmed, why: 'separator' }); continue }
    const at = { page: r.page, row: r.i, box: r.box }
    const amounts = tokens.filter(isAmount)
    // The label is the words in the amount's own column, else the column just before it
    // (a row can also carry unrelated text further left).
    const words = (c: string) => c.split(/\s+/).filter(Boolean).flatMap(x => { const m = /^([\d,]+\.\d{2})([A-Za-z]{2,})$/.exec(x); return m ? [m[1], m[2]] : [x] })
    const plain = (ts: string[]) => ts.filter(x => !isAmount(x) && !/^\d+(\.\d+)?%$/.test(x) && !/^[-_=]{3,}$/.test(x))
    let k = -1
    r.cells.forEach((c, i) => { if (words(c).some(isAmount)) k = i })
    let labelWords = k >= 0 ? plain(words(r.cells[k])) : []
    if (!labelWords.length && k > 0) labelWords = plain(words(r.cells[k - 1]))
    const label = labelWords.join(' ')
    const rate = /(\d+(\.\d+)?)%/.exec(r.text)
    // A totals row: a label and one amount.
    if (amounts.length === 1 && tokens.filter(x => isAmount(x) || isQty(x)).length <= 3) {
      const kind = totalKind(label) ?? (/%/.test(r.text) && /\btax\b/i.test(r.text) ? 'tax' : null)
      const cents = moneyToCents(amounts[0])
      if (kind && cents != null) { put(kind, rate && kind === 'tax' ? `${rate[0]} ${label}` : label, cents, at); inTotals = true; lastLine = null; continue }
      // No label, right after the lines, equal to their sum: the subtotal.
      if (!kind && cents != null && out.lines.length && out.subtotalCents == null && !inTotals && cents === linesSum() && !lineFromTokens(tokens)) {
        put('subtotal', 'Subtotal', cents, at); inTotals = true; lastLine = null; continue
      }
    }
    // Two labels printed on top of each other with their two amounts ("Fuel 7.5% Tax Charge  369.80 25.00").
    if (amounts.length === 2 && rate && /\btax\b/i.test(label) && /\b(fuel|freight|delivery|charge|fee|surcharge)\b/i.test(label)) {
      const base = out.subtotalCents ?? linesSum()
      const want = (base * Number(rate[1])) / 100
      const cents = amounts.map(a => moneyToCents(a)!)
      const taxAt = Math.abs(cents[0] - want) <= Math.abs(cents[1] - want) ? 0 : 1
      const otherLabel = label.replace(/\btax\b/i, '').replace(/\s+/g, ' ').trim()
      const otherKind = totalKind(otherLabel) ?? 'fee'
      put('tax', `${rate[0]} Tax`, cents[taxAt], at)
      put(otherKind, /fuel/i.test(otherLabel) ? 'Fuel Charge' : otherLabel, cents[1 - taxAt], at)
      inTotals = true; lastLine = null; continue
    }
    // Two totals rows read as one ("Fuel Charge 25.00" right above "Freight 125.00"): each amount takes the label at its own height.
    if (amounts.length >= 2 && !rate) {
      const stacked = splitStackedTotals(r)
      if (stacked) {
        for (const s of stacked) put(s.kind, s.label, s.cents, at)
        inTotals = true; lastLine = null; continue
      }
    }
    if (HEADER_WORDS.test(r.text) && tokens.filter(isAmount).length === 0) { lastLine = null; inTotals = false; continue }
    const parsed = lineFromTokens(tokens)
    if (parsed && parsed.totalCents === 0) { out.skipped.push({ page: r.page, row: r.i, text: r.cells.join('  '), why: 'zero' }); lastLine = null; continue }
    if (parsed) {
      const line: ParsedLine = { ...parsed, page: r.page, row: r.i, box: r.box, conf: r.conf, raw: r.cells.join('  ') }
      // Only the numbers matter for "unclear": a shaky word in a description is fine.
      const numConf = Math.min(1, ...r.words.filter(w => /\d/.test(w.t)).map(w => w.c))
      if (numConf < LOW_CONFIDENCE && !line.problems.includes('unclear')) line.problems.push('unclear')
      line.conf = numConf
      out.lines.push(line)
      lastLine = line
      inTotals = false
      continue
    }
    // A description that wrapped onto the next row: no numbers, right under a line.
    if (lastLine && !inTotals && lastLine.page === r.page && r.i === lastLine.row + 1 && !tokens.some(isAmount) && /[a-z]{3}/i.test(r.text) && r.text.length < 80) {
      lastLine.description = `${lastLine.description} ${r.text}`.trim()
      lastLine.raw += `  ${r.text}`
      lastLine = null
    }
  }

  if (!out.vendorName) out.problems.push('no_vendor')
  if (!out.invoiceNumber) out.problems.push('no_number')
  if (!out.invoiceDate) out.problems.push('no_date')
  if (out.totalCents == null) out.problems.push('no_total')
  return out
}
