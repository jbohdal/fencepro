/**
 * Finding a customer already on file while a quote is made (audit #44, Oct 28
 * 2026: the quote builder's Customer name step did not look, so a repeat
 * customer could be typed in twice), and what a new customer's save does when
 * someone on file has the same phone or email.
 *
 * Jonathan's rule for customers that come in (Oct 23 2026; portal
 * lib/customerImport.ts decideMatch, the same words here): a match is only by
 * exact phone or email, never by name alone.
 *   - one with the same name             the quote goes on that customer
 *   - a different name                   a NEW customer, with a Possible match
 *                                        notice to merge with one tap
 *   - several, exactly one same name     that one
 *   - several, none or several by name   a new customer with Possible matches
 *                                        (a screen can't skip; it is never guessed)
 * "Same name" is portal sameName: letters only, either all the same, or every
 * word of one (two or more, each two letters or more) is in the other.
 * Put on that customer, a phone or email typed that they have none of is added
 * to them; one where they already have another is not saved, and the dialog
 * says so before Save (contactToAdd; audit #48, Oct 28 2026). A customer has
 * one phone and one email, so theirs is never overwritten.
 *
 * No imports: the portal tests use it too.
 */

export interface PickCustomer { id: string; firstName: string; lastName: string; phone?: string | null; email?: string | null; serviceAddress?: string | null }

const words = (s: string) => String(s || '').normalize('NFD').toLowerCase().split(/[^a-z]+/).filter(Boolean)

/** True when two people's names are the same (portal lib/customerImport.ts sameName). */
export function sameName(a: { first: string; last: string }, b: { first: string; last: string }): boolean {
  const wa = words(`${a.first} ${a.last}`), wb = words(`${b.first} ${b.last}`)
  if (!wa.length || !wb.length) return false
  if (wa.join('') === wb.join('')) return true
  const within = (x: string[], y: string[]) => x.length >= 2 && x.every(w => w.length >= 2 && y.includes(w))
  return within(wa, wb) || within(wb, wa)
}

/**
 * Customers whose name, phone or email has what was typed: every word of it
 * in the name, any order ("ann lee" finds "Lee, Ann" and "Annie Leeds");
 * 3 or more digits in the phone; an email with it. Nothing under 2 letters.
 */
export function customersMatching<C extends PickCustomer>(all: C[], typed: string, limit = 6): C[] {
  const q = typed.trim().toLowerCase()
  if (q.length < 2) return []
  const qWords = q.split(/\s+/).filter(Boolean)
  const qd = q.replace(/\D/g, '')
  // Names where every typed word starts a word of the name come first ("john" finds John Ruiz before Steven Ojohn).
  const hits: Array<{ c: C; rank: number }> = []
  for (const c of all) {
    const name = `${c.firstName} ${c.lastName}`.toLowerCase()
    const nameWords = name.split(/[^a-z0-9]+/).filter(Boolean)
    const hit = qWords.every(w => name.includes(w))
      || (!/[a-z]/.test(q) && qd.length >= 3 && (c.phone || '').replace(/\D/g, '').includes(qd))
      || (!!c.email && c.email.toLowerCase().includes(q))
    if (hit) hits.push({ c, rank: qWords.every(w => nameWords.some(n => n.startsWith(w))) ? 0 : 1 })
  }
  return hits.sort((x, y) => x.rank - y.rank).slice(0, limit).map(h => h.c)
}

export type NewCustomerDecision<C> = { kind: 'attach'; to: C } | { kind: 'new_possible'; matches: C[] } | { kind: 'new' }

/** What saving a new customer named `first last` does, when `hits` are on file with its phone or email. */
export function decideNewCustomer<C extends PickCustomer>(name: { first: string; last: string }, hits: C[]): NewCustomerDecision<C> {
  if (!hits.length) return { kind: 'new' }
  const named = hits.filter(h => sameName(name, { first: h.firstName, last: h.lastName }))
  if (named.length === 1) return { kind: 'attach', to: named[0] }
  return { kind: 'new_possible', matches: hits }
}

export interface ContactAdd { add: { phone?: string; email?: string }; kept: Array<{ what: 'phone' | 'email'; typed: string; theirs: string }> }

const digits = (s: string | null | undefined) => String(s || '').replace(/\D/g, '')
const mail = (s: string | null | undefined) => String(s || '').trim().toLowerCase()

/**
 * A phone and email typed for a new customer that goes on `to` (decideNewCustomer attach): what is added to
 * them (they have none of it), and what is not saved because they have another (theirs kept, never overwritten).
 */
export function contactToAdd(to: Pick<PickCustomer, 'phone' | 'email'>, typed: { phone?: string; email?: string }): ContactAdd {
  const out: ContactAdd = { add: {}, kept: [] }
  const phone = String(typed.phone || '').trim()
  if (digits(phone)) {
    if (!digits(to.phone)) out.add.phone = phone
    else if (digits(phone) !== digits(to.phone)) out.kept.push({ what: 'phone', typed: phone, theirs: String(to.phone) })
  }
  const email = String(typed.email || '').trim()
  if (mail(email)) {
    if (!mail(to.email)) out.add.email = email
    else if (mail(email) !== mail(to.email)) out.kept.push({ what: 'email', typed: email, theirs: String(to.email) })
  }
  return out
}
