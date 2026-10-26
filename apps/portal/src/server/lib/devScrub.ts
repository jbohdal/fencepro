/**
 * Fake contact details for the dev copy (scripts/scrub-dev-db.ts).
 *
 * The dev database is a copy of live. After the copy every email address and
 * phone number in it is replaced with one that cannot reach anybody:
 *   - email: <staff login>@example.invalid for staff (so they can still sign
 *     in to dev with their own password), c-<10 hex>@example.invalid for
 *     everyone else. The same address always becomes the same fake one
 *     (case ignored), so duplicate and same customer checks still behave.
 *   - phone: (0AB) CDE-WXYZ, keeping the last 4 digits (WXYZ) and the
 *     number's own layout. An area code starting with 0 does not exist, so it
 *     cannot ring or text. AB CDE come from the whole number, so equal numbers
 *     stay equal and different ones almost always stay different.
 * Running it twice changes nothing more (fakes are left as they are).
 */

import crypto from 'crypto'

export const FAKE_EMAIL_DOMAIN = 'example.invalid'

/** Addresses on these domains reach nobody (RFC 2606 / 6761) and are left alone. */
const RESERVED = /(^|\.)(invalid|test|example|localhost|local)$|^example\.(com|org|net)$/i
/** "logo@2x.png" is a file name, not an address. */
const FILE_TLD = /^(png|jpe?g|gif|svg|webp|pdf|js|css|heic|mp4|mov|txt|json|automations)$/i

export const EMAIL_RE = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g
/** A North American number written with separators: (352) 555-1234, 352.555.1234, +1 352 555 1234. */
const PHONE_FORMATTED = /(?<![\w+])(?:\+?1[\s.-]?)?\(?[2-9]\d{2}\)?[\s.-]?\d{3}[\s.-]\d{4}(?![\w])/g
/** Ten (or 1 + ten) digits run together, with a real area code and exchange: 3525551234. */
const PHONE_DIGITS = /(?<![\w.+-])(?:\+?1)?[2-9]\d{2}[2-9]\d{6}(?![\w.])/g
/** A seven digit local number (598-9785): counted, not changed (too easily something else). */
export const LOCAL7_RE = /(?<!\(?\d{3}\)?[\s.-]?)(?<![\w.-])[2-9]\d{2}-\d{4}(?![\w-])/g

const md5 = (s: string) => crypto.createHash('md5').update(s).digest('hex')

export function isReservedEmail(email: string): boolean {
  const domain = email.slice(email.lastIndexOf('@') + 1).toLowerCase()
  return RESERVED.test(domain) || FILE_TLD.test(domain.slice(domain.lastIndexOf('.') + 1))
}

/** Staff logins → <their login name>@example.invalid, each one different. */
export function staffEmailMap(emails: string[]): Map<string, string> {
  const map = new Map<string, string>()
  const used = new Set<string>()
  for (const e of emails.map(x => x.trim().toLowerCase()).filter(Boolean).sort()) {
    if (map.has(e)) continue
    if (isReservedEmail(e)) { map.set(e, e); used.add(e); continue }
    const base = (e.split('@')[0].replace(/[^a-z0-9._-]/g, '') || 'staff').slice(0, 40)
    let name = base, n = 2
    while (used.has(`${name}@${FAKE_EMAIL_DOMAIN}`)) name = `${base}-${n++}`
    map.set(e, `${name}@${FAKE_EMAIL_DOMAIN}`)
    used.add(`${name}@${FAKE_EMAIL_DOMAIN}`)
  }
  return map
}

export function fakeEmail(email: string, staff: Map<string, string>): string {
  const lower = email.toLowerCase()
  if (isReservedEmail(lower)) return email
  return staff.get(lower) ?? `c-${md5(lower).slice(0, 10)}@${FAKE_EMAIL_DOMAIN}`
}

/** The fake ten digits for a real ten digit number: 0 + 5 digits from the number + its last 4. */
export function fakeTen(ten: string): string {
  const five = String(parseInt(md5(ten).slice(0, 8), 16) % 100000).padStart(5, '0')
  return `0${five}${ten.slice(6)}`
}

/** The same layout with the digits swapped for the fake ones (a leading country code 1 is kept). */
function swapDigits(match: string): string {
  const digits = match.replace(/\D/g, '')
  const ten = digits.slice(-10)
  const fake = fakeTen(ten)
  let skip = digits.length - 10 // the leading 1, kept
  let i = 0
  return match.replace(/\d/g, d => {
    if (skip > 0) { skip--; return d }
    return fake[i++]
  })
}

export interface Counts { emails: number; phones: number }

/** One string with every address and number made fake. */
export function scrubText(s: string, staff: Map<string, string>, counts: Counts = { emails: 0, phones: 0 }): string {
  if (!s || s.startsWith('data:')) return s // an image or file inside the record
  let out = s
  if (out.includes('@')) {
    out = out.replace(EMAIL_RE, e => {
      const f = fakeEmail(e, staff)
      if (f !== e) counts.emails++
      return f
    })
  }
  if (/\d{4}/.test(out)) {
    out = out.replace(PHONE_FORMATTED, m => { counts.phones++; return swapDigits(m) })
    out = out.replace(PHONE_DIGITS, m => { counts.phones++; return swapDigits(m) })
  }
  return out
}

/** A JSON value with every string (and object key) scrubbed. Numbers are left alone. */
export function scrubJson(v: unknown, staff: Map<string, string>, counts: Counts = { emails: 0, phones: 0 }): unknown {
  if (typeof v === 'string') return scrubText(v, staff, counts)
  if (Array.isArray(v)) return v.map(x => scrubJson(x, staff, counts))
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[scrubText(k, staff, counts)] = scrubJson(x, staff, counts)
    return out
  }
  return v
}

/** Is this a phone number that reaches nobody (a scrubbed fake, no such area code or exchange, the 555-01xx film range, or empty)? */
export function isFakePhone(p: string | null | undefined): boolean {
  const d = String(p ?? '').replace(/\D/g, '')
  if (!d) return true
  const ten = d.length === 11 && d[0] === '1' ? d.slice(1) : d
  if (ten.length !== 10) return true // not a whole number: cannot be dialled as is
  if (ten[0] === '0' || ten[0] === '1' || ten[3] === '0' || ten[3] === '1') return true // no such area code or exchange
  return ten.slice(3, 6) === '555' && ten.slice(6, 8) === '01'
}

export function isFakeEmail(e: string | null | undefined): boolean {
  const s = String(e ?? '').trim()
  if (!s || !s.includes('@')) return true
  return isReservedEmail(s)
}
