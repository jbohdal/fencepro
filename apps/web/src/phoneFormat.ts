/**
 * A phone number as the cards show it: "(352) 555 1234" (a space, no dash).
 * A US number typed any way ("352-555-1234", "+1 352 555 1234") comes out the
 * same; anything else (an extension, a foreign number) is shown as typed.
 */
export function formatPhone(raw: string | null | undefined): string {
  const s = String(raw ?? '').trim()
  let d = s.replace(/\D/g, '')
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1)
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)} ${d.slice(6)}` : s
}

/** The tel: link that calls it. */
export function telHref(raw: string | null | undefined): string {
  return `tel:${String(raw ?? '').replace(/[^\d+]/g, '')}`
}
