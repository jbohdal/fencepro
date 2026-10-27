/**
 * The contract terms (Settings → Contract Templates) on the proposal and the
 * signed contract, frozen on the proposal (the rules: web/src/contractTerms.ts,
 * run here through the estimate bundle).
 *
 *   - Saving a draft quote: today's terms and the company's address go on its
 *     proposal. A sent or signed one keeps what it went out with.
 *   - The proposal page shows the frozen terms; a proposal sent before terms
 *     were frozen shows today's terms, and they are frozen on it when the
 *     customer signs (routes/proposal.ts acceptQuote).
 *   - The signed contract PDF prints the frozen terms only: a contract signed
 *     before terms were frozen prints none (the customer never saw them).
 */

import prisma from './prisma.js'
import { pricingModule } from './estimates.js'

export interface Term { key: string; title: string; text: string }

async function settingsOf(accountId: string): Promise<{ sections: unknown; company: unknown }> {
  const b = await prisma.businessState.findUnique({ where: { accountId }, select: { contractSections: true, config: true } }).catch(() => null)
  return { sections: b?.contractSections ?? null, company: (b?.config as any)?.company ?? null }
}

/** Today's terms from Settings → Contract Templates, as a proposal shows them (a repair's say repair: termsForRepair). */
export async function currentTerms(accountId: string, opts: { repair?: boolean } = {}): Promise<Term[]> {
  const [m, s] = await Promise.all([pricingModule(), settingsOf(accountId)])
  const terms: Term[] = m.proposalTerms(s.sections)
  return opts.repair ? termsForRepair(terms) : terms
}

/** The company's address from Settings → Company ('' when it is not filled in). */
export async function companyAddress(accountId: string): Promise<string> {
  const [m, s] = await Promise.all([pricingModule(), settingsOf(accountId)])
  return m.companyAddressOf(s.company)
}

/** The terms frozen on a proposal, or null. */
export async function termsOn(proposal: unknown): Promise<Term[] | null> {
  return (await pricingModule()).frozenTerms(proposal)
}

/** The stock first sentence of Settings → Contract Templates' Scope and Exclusions (web/src/contractTerms.ts). */
export const STOCK_SCOPE_OPENING = 'Installation is per plan and scope above.'
export const REPAIR_SCOPE_OPENING = 'Repair work is per the items listed above.'

/** The stock phrase of Settings → Contract Templates' Property and Access, and what a repair's says. */
export const STOCK_ACCESS_DAY = 'on the day of installation'
export const REPAIR_ACCESS_DAY = 'on the day of the repair'

/**
 * A repair's terms: the stock opening of Scope and Exclusions, "Installation
 * is per plan and scope above.", reads "Repair work is per the items listed
 * above." (recheck Oct 27 2026: a signed repair contract said Installation),
 * and Property and Access's "on the day of installation" reads "on the day of
 * the repair" (round 6 review, Oct 27 2026). The rest of each section, and any
 * words Jonathan typed in their place, stay as they are.
 */
export function termsForRepair(terms: Term[]): Term[] {
  return terms.map(t => {
    if (t.key === 'scope_exclusions' && t.text.startsWith(STOCK_SCOPE_OPENING)) return { ...t, text: REPAIR_SCOPE_OPENING + t.text.slice(STOCK_SCOPE_OPENING.length) }
    if (t.key === 'property_access' && t.text.includes(STOCK_ACCESS_DAY)) return { ...t, text: t.text.split(STOCK_ACCESS_DAY).join(REPAIR_ACCESS_DAY) }
    return t
  })
}

/**
 * The proposal to save with its terms and the company's address. `frozen`: it
 * was sent or signed, so it keeps the terms and address it went out with.
 * `repair`: the quote is a repair (its work), so the terms say repair (termsForRepair).
 */
export async function stampQuoteTerms(accountId: string, proposal: unknown, existing: { proposal?: unknown } | null, frozen: boolean, opts: { repair?: boolean } = {}): Promise<unknown> {
  if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal) || !Array.isArray((proposal as any).options)) return proposal
  const [m, s] = await Promise.all([pricingModule(), settingsOf(accountId)])
  const out = m.stampTerms(proposal, s.sections, existing?.proposal ?? null, frozen) as Record<string, any>
  if (!frozen && opts.repair && Array.isArray(out.terms)) out.terms = termsForRepair(out.terms)
  const company = out.company && typeof out.company === 'object' ? { ...out.company } : {}
  const was = (existing?.proposal as any)?.company?.address
  if (frozen) {
    if (typeof was === 'string' && was) company.address = was
    else delete company.address
  } else {
    const address = m.companyAddressOf(s.company)
    if (address) company.address = address
    else delete company.address
  }
  return { ...out, company }
}
