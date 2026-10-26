/**
 * The website quote's thank-you words follow what the customer ticked: a free
 * visit only when they asked for one (review, Oct 25, 2026: the lead said "no
 * visit" while the page promised one).
 */
import { formatPhone } from '../phoneFormat'

/** The phone as the app writes it everywhere, (352) 555 0185 (round 2 review, Oct 26 2026: it read "3525550185"). */
export function thanksText(phone: string, wantsVisit: boolean): string {
  const at = phone.trim() ? ` at ${formatPhone(phone)}` : ''
  return wantsVisit
    ? `We will call you${at} to set up a free visit and confirm the price.`
    : `We will call you${at} about your estimate. If you would like a free visit to confirm the price, just ask.`
}
