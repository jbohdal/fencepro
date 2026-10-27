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

/** Today's terms from Settings → Contract Templates, as a proposal shows them. */
export async function currentTerms(accountId: string): Promise<Term[]> {
  const [m, s] = await Promise.all([pricingModule(), settingsOf(accountId)])
  return m.proposalTerms(s.sections)
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

/**
 * A repair's terms: the stock opening of Scope and Exclusions, "Installation
 * is per plan and scope above.", reads "Repair work is per the items listed
 * above." (recheck Oct 27 2026: a signed repair contract said Installation).
 * The rest of the section, and any words Jonathan typed in its place, stay as
 * they are.
 */
export function termsForRepair(terms: Term[]): Term[] {
  return terms.map(t => (t.key === 'scope_exclusions' && t.text.startsWith(STOCK_SCOPE_OPENING) ? { ...t, text: REPAIR_SCOPE_OPENING + t.text.slice(STOCK_SCOPE_OPENING.length) } : t))
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
