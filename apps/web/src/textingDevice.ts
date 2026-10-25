/**
 * Can this device hand a text to a texting app? An iPhone or an Android phone
 * opens its Messages app with the words filled in (an sms: link), so tapping
 * "Text the receipt" there is the text being handed over. A computer or a
 * tablet may open nothing at all (or Messages on a Mac, which may or may not
 * send), so there the app asks "Did you send it?" before it records the text
 * as sent (Oct 24, 2026 walkthrough: "Text the receipt" on a computer was
 * recorded as texted).
 */

export function phoneCanText(ua: string): boolean {
  if (/iPhone|iPod/.test(ua)) return true
  // Android phones say "Mobile"; Android tablets do not.
  if (/Android/.test(ua) && /Mobile/.test(ua)) return true
  return false
}

/** This browser: a phone that texts. */
export function canTextHere(): boolean {
  return typeof navigator !== 'undefined' && phoneCanText(navigator.userAgent || '')
}
