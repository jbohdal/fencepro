/**
 * Numbers typed into a box, pure (no browser): what NumberField reads when a
 * box is left, and what it shows. Money is worked out in whole cents from the
 * typed digits, never through a float, so "$1,234.50" is exactly 123450.
 *
 *   parseCents("$1,234.50") → 123450     parseCents("1234.5") → 123450
 *   parseCents("") → null (blank)         parseCents("-") → null (not a number)
 *   parseNumber("24.5%") → 24.5           parseNumber("2,040") → 2040
 */

export type NumberKind = 'money' | 'percent' | 'number'

/**
 * The digits of a typed number: sign, whole part and decimals, with "$",
 * "%", commas and spaces between digits allowed. "(12.50)" is a negative, the
 * way a bank statement writes it. Null when it is not a number.
 */
function digitsOf(text: string): { neg: boolean; whole: string; frac: string } | null {
  let s = String(text ?? '').trim()
  if (!s) return null
  let neg = false
  const paren = s.match(/^\((.*)\)$/)
  if (paren) { neg = true; s = paren[1].trim() }
  // A sign before or after the dollar sign: "-$5", "$-5".
  s = s.replace(/^\$\s*/, '')
  if (/^[-−–]/.test(s)) { neg = !neg; s = s.slice(1).trim() }
  else if (s.startsWith('+')) s = s.slice(1).trim()
  s = s.replace(/^\$\s*/, '').replace(/\s*%$/, '')
  // Commas and spaces only as thousands separators between digits.
  if (/[,\s]/.test(s) && !/^\d{1,3}([,\s]\d{3})*(\.\d*)?$/.test(s)) return null
  s = s.replace(/[,\s]/g, '')
  const m = s.match(/^(\d*)(?:\.(\d*))?$/)
  if (!m) return null
  const whole = m[1] ?? '', frac = m[2] ?? ''
  if (!whole && !frac) return null
  return { neg, whole: whole || '0', frac }
}

/** True for a blank box (nothing but spaces). */
export function isBlank(text: string): boolean {
  return !String(text ?? '').trim()
}

/** Whole cents from typed money, rounded half up on the third decimal. Null when blank or not a number. */
export function parseCents(text: string): number | null {
  const d = digitsOf(text)
  if (!d) return null
  const frac = (d.frac + '000').slice(0, 3)
  let cents = Number(d.whole) * 100 + Number(frac.slice(0, 2))
  if (Number(frac[2]) >= 5) cents += 1
  if (!Number.isSafeInteger(cents)) return null
  return d.neg && cents !== 0 ? -cents : cents
}

/** A typed number or percent ("24.5", "24.5%", "2,040"). Null when blank or not a number. */
export function parseNumber(text: string): number | null {
  const d = digitsOf(text)
  if (!d) return null
  const n = Number(`${d.whole}.${d.frac || '0'}`)
  if (!Number.isFinite(n)) return null
  return d.neg && n !== 0 ? -n : n
}

/** Dollars to whole cents, for a number kept in dollars (the budget keeps dollars). */
export function dollarsToCents(dollars: number): number {
  return Number.isFinite(dollars) ? Math.round(dollars * 100) : 0
}

/** Whole cents back to dollars, exact to the cent. */
export function centsToDollars(cents: number): number {
  return Math.round(cents) / 100
}

const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')

/**
 * Money for a box that is not being typed in: "$1,234.50", or "$1,234" when it
 * is whole dollars (or `cents: false`). Negative as "-$5.00".
 */
export function formatCents(cents: number, opts: { cents?: boolean | 'auto' } = {}): string {
  const c = Math.round(Number(cents) || 0)
  const neg = c < 0
  const abs = Math.abs(c)
  const whole = Math.floor(abs / 100), part = abs % 100
  const showCents = opts.cents === true || ((opts.cents ?? 'auto') === 'auto' && part !== 0)
  const body = showCents ? `${group(String(whole))}.${String(part).padStart(2, '0')}` : group(String(opts.cents === false ? Math.round(abs / 100) : whole))
  return `${neg ? '-' : ''}$${body}`
}

/** The money as it is typed: "1234.50", "1234", "-5". No "$" or commas, so a phone's number pad can edit it. */
export function editCents(cents: number): string {
  const c = Math.round(Number(cents) || 0)
  const abs = Math.abs(c)
  const part = abs % 100
  return `${c < 0 ? '-' : ''}${Math.floor(abs / 100)}${part ? '.' + String(part).padStart(2, '0') : ''}`
}

/** A plain number to at most `decimals` places, without trailing zeros: 21.4, 2040. */
export function roundTo(n: number, decimals: number): number {
  const f = 10 ** decimals
  return Math.round((Number(n) || 0) * f) / f
}

/** A number or percent for a box that is not being typed in: "2,040", "21.4%". */
export function formatNumber(n: number, opts: { decimals?: number; percent?: boolean } = {}): string {
  const r = roundTo(n, opts.decimals ?? 2)
  const [w, f] = String(Math.abs(r)).split('.')
  return `${r < 0 ? '-' : ''}${group(w)}${f ? '.' + f : ''}${opts.percent ? '%' : ''}`
}

/** The number as it is typed: "21.4", "2040". */
export function editNumber(n: number, decimals = 2): string {
  return String(roundTo(n, decimals))
}

/**
 * Read what was typed in a box of the given kind. `blank` is what an empty box
 * means (0 for an amount); `null` there means an empty box is refused.
 * Returns the value (cents for money) or an error in words.
 */
export function readBox(kind: NumberKind, text: string, opts: { blank?: number | null; min?: number; max?: number; decimals?: number } = {}): { ok: true; value: number } | { ok: false; error: string } {
  if (isBlank(text)) {
    const blank = opts.blank === undefined ? 0 : opts.blank
    return blank === null ? { ok: false, error: 'Type a number' } : { ok: true, value: blank }
  }
  const raw = kind === 'money' ? parseCents(text) : parseNumber(text)
  if (raw == null) return { ok: false, error: kind === 'money' ? 'Type an amount, like 1234.50' : kind === 'percent' ? 'Type a percent, like 24.5' : 'Type a number, like 2040' }
  const v = kind === 'money' ? raw : roundTo(raw, opts.decimals ?? 2)
  const show = (n: number) => kind === 'money' ? formatCents(n) : formatNumber(n, { percent: kind === 'percent' })
  if (opts.min != null && v < opts.min) return { ok: false, error: `No less than ${show(opts.min)}` }
  if (opts.max != null && v > opts.max) return { ok: false, error: `No more than ${show(opts.max)}` }
  return { ok: true, value: v }
}

/** A box's text when it is not being typed in. */
export function showBox(kind: NumberKind, value: number, opts: { decimals?: number; cents?: boolean | 'auto' } = {}): string {
  return kind === 'money' ? formatCents(value, { cents: opts.cents }) : formatNumber(value, { decimals: opts.decimals, percent: kind === 'percent' })
}

/** A box's text when it is tapped, ready to be typed over. */
export function editBox(kind: NumberKind, value: number, opts: { decimals?: number } = {}): string {
  return kind === 'money' ? editCents(value) : editNumber(value, opts.decimals ?? 2)
}

/** A fraction kept in the budget (0.214) as a percent (21.4), without float noise. */
export function fractionToPercent(f: number, decimals = 2): number {
  return roundTo((Number(f) || 0) * 100, decimals)
}

/** A percent (21.4) as the fraction the budget keeps (0.214), without float noise. */
export function percentToFraction(p: number): number {
  return Number(((Number(p) || 0) / 100).toFixed(8))
}
