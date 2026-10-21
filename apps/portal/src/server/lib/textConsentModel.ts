/**
 * Texting consent: the words and the plain rules, no database, so the web app
 * (the customer page and the website quote) and the server share them.
 *
 * A customer's answer is yes, no or unknown ("Not asked"). The app texts only
 * a yes (lib/textConsent.ts). A yes or no is recorded by a team member (they
 * asked on the phone or in person: verbal) or by the customer on the website
 * quote (the checkbox below: website_checkbox).
 */

export type TextConsent = 'yes' | 'no' | 'unknown'
export type TextConsentSource = 'verbal' | 'website_checkbox'

/** The website quote's checkbox, word for word; a website yes stores these words with it. */
export const TEXT_CONSENT_WORDING = 'Text me updates about my quote and installation. Msg frequency varies. Msg and data rates may apply. Reply STOP to opt out. Terms: gdfencepro.com/terms.cfm'
export const TEXT_CONSENT_TERMS_URL = 'https://gdfencepro.com/terms.cfm'

export interface TextConsentState {
  textConsent: TextConsent
  textConsentAt: string | null
  textConsentBy: string | null
  textConsentSource: TextConsentSource | null
}

export const asTextConsent = (v: unknown): TextConsent => (v === 'yes' || v === 'no' ? v : 'unknown')

const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' })

/** "Yes, verbal, recorded by Christa on Oct 21" / "No, website checkbox left unchecked on Oct 21" / "Not asked". */
export function describeTextConsent(s: Partial<TextConsentState>): string {
  const consent = asTextConsent(s.textConsent)
  if (consent === 'unknown') return 'Not asked'
  const word = consent === 'yes' ? 'Yes' : 'No'
  const on = s.textConsentAt ? ` on ${day(s.textConsentAt)}` : ''
  if (s.textConsentSource === 'website_checkbox') return `${word}, website checkbox ${consent === 'yes' ? 'checked' : 'left unchecked'}${on}`
  return `${word}, verbal${s.textConsentBy ? `, recorded by ${s.textConsentBy}` : ''}${on}`
}

/** Why a text is not sent to this customer, in plain words; null when texts may go. */
export function textBlockedReason(name: string, consent: TextConsent | null | undefined): string | null {
  const c = asTextConsent(consent)
  if (c === 'yes') return null
  const who = name.trim() || 'This customer'
  return c === 'no'
    ? `Not sent: ${who} said no to texts.`
    : `Not sent: ${who} has not agreed to texts yet (Texts: Not asked). Record a yes on the customer page first.`
}
