/**
 * The owner's message after changing a customer's Salesman (SalesmanOnCustomer.tsx). Pure, no screen.
 */

/** The same person as a rep is written (case and spaces aside). */
function sameName(a: string | null | undefined, b: string | null | undefined): boolean {
  const n = (s: string | null | undefined) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
  return !!n(a) && n(a) === n(b)
}

/**
 * What the owner's Change did, in plain words (review, Oct 30 2026): "Christa Feagin keeps Dana because of the
 * signed quote; the open quote and the visit went to AUD Sales." or "Christa Feagin no longer has Dana."
 */
export function changeWords(r: { to: string; was: string; customer: string; quotesMoved: number; visitsMoved: number; wasKeeps: number }): string {
  const went = [
    r.quotesMoved ? (r.quotesMoved === 1 ? 'the open quote' : `the ${r.quotesMoved} open quotes`) : '',
    r.visitsMoved ? (r.visitsMoved === 1 ? 'the visit' : `the ${r.visitsMoved} upcoming visits`) : '',
  ].filter(Boolean)
  const moved = went.length ? `${went.join(' and ')} went to ${r.to}` : ''
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
  if (!r.was || sameName(r.was, r.to)) return `${r.to} is the Salesman of ${r.customer}.${moved ? ` ${cap(moved)}.` : ''}`
  const head = `${r.to} is the Salesman of ${r.customer} now.`
  if (r.wasKeeps > 0) return `${head} ${r.was} keeps ${r.customer} because of ${r.wasKeeps === 1 ? 'the signed quote' : `${r.wasKeeps} signed quotes`}${moved ? `; ${moved}` : ''}.`
  return `${head} ${r.was} no longer has ${r.customer}.${moved ? ` ${cap(moved)}.` : ''}`
}

