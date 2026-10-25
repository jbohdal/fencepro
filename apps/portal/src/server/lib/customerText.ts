/**
 * Every text a customer gets goes through customerText: it starts with the
 * company name and a colon, and ends "Reply STOP to opt out.", once each,
 * the wording the texting registration uses (twilio plan, Oct 21 2026,
 * part 6): "Getter Done Fence: Hi Manuel, ... Reply STOP to opt out."
 * Phone numbers in it are written (352) 844 2677.
 *
 * Pure, no imports: the server (installDays, serviceTicketModel, automation
 * texts, sms.ts) and the web app (appointmentMessages.asText and every Text
 * button) use this one file. tests/customerText.test.ts checks every text
 * path ends with the STOP wording.
 */

export const STOP_WORDS = 'Reply STOP to opt out.'
export const DEFAULT_COMPANY = 'Getter Done Fence'

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** US phone numbers written as (352) 844 2677; a number inside a link or a longer number is left alone. */
export function formatPhonesIn(text: string): string {
  return text.replace(/(?<![\w/=?&.%#+-])(?:\+?1[\s.-]?)?(?:\((\d{3})\)|(\d{3}))[\s.-]?(\d{3})[\s.-]?(\d{4})(?![\w/])/g,
    (_all, a1: string | undefined, a2: string | undefined, b: string, c: string) => `(${a1 ?? a2}) ${b} ${c}`)
}

/** The text as it goes to the customer: "Company: <body> Reply STOP to opt out." */
export function customerText(body: string, company?: string | null): string {
  const name = (company ?? '').trim() || DEFAULT_COMPANY
  let t = String(body ?? '').replace(/\s+/g, ' ').trim()
  // The opt out words go once, at the end, wherever they were typed.
  t = t.replace(/\s*reply\s+stop\s+to\s+opt\s+out\.?/gi, ' ').replace(/\s+/g, ' ').trim()
  // The company name goes once, in front.
  const lead = new RegExp(`^(?:${escape(name)}\\s*:\\s*)+`, 'i')
  t = t.replace(lead, '').trim()
  t = formatPhonesIn(t)
  // A sentence ends with a stop; a link at the end is left as it is (a dot after it would break it on some phones).
  if (t && !/[.!?]$/.test(t) && !/\bhttps?:\/\/\S+$/.test(t)) t = `${t}.`
  return `${name}: ${t ? `${t} ` : ''}${STOP_WORDS}`
}

/**
 * A text the person writes themselves (the plain Text buttons): it opens as
 * "Getter Done Fence: Hi Manuel, " ... "Reply STOP to opt out.", the words
 * typed in between.
 */
export function customerTextStart(firstName: string | null | undefined, company?: string | null): string {
  const name = (company ?? '').trim() || DEFAULT_COMPANY
  const first = String(firstName ?? '').trim().split(/\s+/)[0] || 'there'
  return `${name}: Hi ${first},  ${STOP_WORDS}`
}

/** True when a text is already in the registered form (used by the tests and the send buttons' checks). */
export function isCustomerText(text: string, company?: string | null): boolean {
  const name = (company ?? '').trim() || DEFAULT_COMPANY
  const t = String(text ?? '').trim()
  const stops = t.match(/reply\s+stop\s+to\s+opt\s+out\.?/gi) ?? []
  return t.toLowerCase().startsWith(`${name.toLowerCase()}:`) && t.endsWith(STOP_WORDS) && stops.length === 1
}
