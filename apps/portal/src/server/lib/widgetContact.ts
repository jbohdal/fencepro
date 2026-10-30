/**
 * When the website instant quote has enough to call someone back (Jonathan,
 * Oct 29 2026: "As soon as they've typed a name plus a phone or email, save
 * them as a lead"). Plain functions, used by the page (it saves the lead the
 * moment these say yes) and by the server (it refuses anything less).
 *
 *   name   2 to 120 characters with at least 2 letters; not an email, a web
 *          address or markup (form robots put those in name boxes).
 *   phone  a US number: 10 digits once a leading 1 is taken off, the area
 *          code and the exchange each starting 2 to 9 (no number starts with
 *          0 or 1 there), and not one digit over and over (000 000 0000).
 *   email  something@something.something, no spaces, up to 200 characters.
 */

export const phoneDigits = (raw: string | null | undefined): string => {
  const d = String(raw || '').replace(/\D/g, '')
  return d.length === 11 && d.startsWith('1') ? d.slice(1) : d
}

export function validPhone(raw: string | null | undefined): boolean {
  const d = phoneDigits(raw)
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(d) && !/^(\d)\1{9}$/.test(d)
}

export function validEmail(raw: string | null | undefined): boolean {
  const e = String(raw || '').trim()
  return e.length <= 200 && /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[A-Za-z]{2,}$/.test(e)
}

export function validName(raw: string | null | undefined): boolean {
  const n = String(raw || '').trim()
  if (n.length < 2 || n.length > 120) return false
  if ((n.match(/\p{L}/gu) ?? []).length < 2) return false
  return !/[@<>{}]|https?:|www\./i.test(n)
}

/**
 * The name and the phone and email that pass, when that is enough to call
 * them back (a name, and a phone or an email); null when it is not yet. A
 * half typed phone next to a good email still makes a lead (with the email).
 */
export function callableContact(c: { name?: string | null; phone?: string | null; email?: string | null }): { name: string; phone: string; email: string } | null {
  if (!validName(c.name)) return null
  const phone = validPhone(c.phone) ? String(c.phone).trim() : ''
  const email = validEmail(c.email) ? String(c.email).trim().toLowerCase() : ''
  if (!phone && !email) return null
  return { name: String(c.name).trim().replace(/\s+/g, ' '), phone, email }
}
