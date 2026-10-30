/**
 * The contract terms (Settings → Contract Templates) as the customer reads and
 * signs them: on the proposal link and on the signed contract PDF.
 *
 * Pure (no browser storage, no app stores), so the server runs this same code
 * (bundled with estimate.ts) when it freezes the terms on a proposal.
 *
 *   - The sections as saved in Settings, in their order; a section never saved
 *     is its default text (as Settings shows it).
 *   - Only the ones ticked "Show on quotes".
 *   - Not the Warranty section: the proposal and the contract print each
 *     option's own warranty (Settings → Warranties) in its place.
 *   - Plain text: the words exactly as typed, with any HTML tags taken off
 *     (a line break stays a line break). The wording is never changed.
 */

export interface ContractSection {
  key: string
  title: string
  body: string      // HTML or plain text — rendered via dangerouslySetInnerHTML in the printable templates
  visible: boolean
}

/** One term as frozen on a proposal: what the customer reads and signs. */
export interface ContractTerm { key: string; title: string; text: string }

/**
 * Permits (Jonathan, Oct 29 2026, audit #32): "Getter Done Fence obtains all
 * required permits. Permit fees are billed separately at cost." It takes the
 * place of the stock sentence that had the customer get the permit, in
 * Settings as saved and on every proposal not yet signed. A contract already
 * signed keeps the words it was signed with (frozen on its proposal).
 */
export const PERMIT_SENTENCE = 'Getter Done Fence obtains all required permits. Permit fees are billed separately at cost.'
export const OLD_PERMIT_SENTENCE = 'Unless noted otherwise, the customer is responsible for obtaining any required permits.'

export const DEFAULT_CONTRACT_SECTIONS: ContractSection[] = [
  {
    key: 'payment_terms',
    title: 'Payment Terms',
    body: `A 50% deposit is required to schedule the project. The remaining balance is due upon completion. We accept cash, check, ACH, and major credit cards.`,
    visible: true,
  },
  {
    key: 'scope_exclusions',
    title: 'Scope and Exclusions',
    body: `Installation is per plan and scope above. Unless otherwise noted, the following are excluded: demolition beyond what is specified, landscaping / irrigation repair, HOA approvals, engineered drawings, and any work not explicitly listed.`,
    visible: true,
  },
  {
    key: 'warranty',
    title: 'Warranty',
    body: `Materials are covered by the manufacturer's warranty. Workmanship is warranted for 1 year from installation date against defects in workmanship. Warranty does not cover damage from impact, severe weather, or misuse.`,
    visible: true,
  },
  {
    key: 'property_access',
    title: 'Property and Access',
    body: `The customer is responsible for marking property lines, clearing the fence line of obstructions, and providing access (including unlocked gates) on the day of installation. Delays due to access issues may incur additional charges.`,
    visible: true,
  },
  {
    key: 'permits',
    title: 'Permits',
    body: `${PERMIT_SENTENCE} If a permit is denied after materials are ordered, any non-refundable costs will be billed.`,
    visible: true,
  },
  {
    key: 'cancellation',
    title: 'Cancellation Policy',
    body: `The deposit is non-refundable once materials are ordered. Change orders requested after materials are ordered may incur additional costs. Cancellation within 3 days of signing is accepted with no penalty.`,
    visible: true,
  },
  {
    key: 'dispute_resolution',
    title: 'Dispute Resolution',
    body: `Any dispute arising from this agreement shall first be resolved through good-faith discussion. If unresolved, disputes shall be settled by binding arbitration under the laws of the state where work was performed.`,
    visible: true,
  },
]

/** The sections as Settings shows them: saved ones by key, a default for any never saved. */
export function contractSectionsOf(saved: unknown): ContractSection[] {
  const list = Array.isArray(saved) ? saved.filter((s): s is ContractSection => !!s && typeof s === 'object' && typeof (s as any).key === 'string') : []
  if (list.length === 0) return DEFAULT_CONTRACT_SECTIONS
  const byKey = new Map(list.map(s => [s.key, s]))
  return DEFAULT_CONTRACT_SECTIONS.map(d => {
    const s = byKey.get(d.key)
    if (!s) return d
    // The stock permit sentence as saved before Oct 29 2026 reads as it does now (the rest as typed).
    return s.key === 'permits' && typeof s.body === 'string' && s.body.includes(OLD_PERMIT_SENTENCE) ? { ...s, body: s.body.split(OLD_PERMIT_SENTENCE).join(PERMIT_SENTENCE) } : s
  })
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' }

/** A section's words as plain text: tags off, a <br> or paragraph end a new line, the words as typed. */
export function plainTermText(body: unknown): string {
  return String(body ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_m, k: string) => ENTITIES[k] ?? _m)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** The terms a proposal carries: the shown sections but the warranty, as plain text, none empty. */
export function proposalTerms(saved: unknown): ContractTerm[] {
  return contractSectionsOf(saved)
    .filter(s => s.visible !== false && s.key !== 'warranty')
    .map(s => ({ key: s.key, title: String(s.title || '').trim(), text: plainTermText(s.body) }))
    .filter(t => t.text.length > 0)
}

/** Terms frozen on a proposal (null: the proposal has none frozen, e.g. sent before terms were frozen). */
export function frozenTerms(proposal: unknown): ContractTerm[] | null {
  const t = proposal && typeof proposal === 'object' ? (proposal as { terms?: unknown }).terms : undefined
  if (!Array.isArray(t)) return null
  return t.filter(x => x && typeof x === 'object' && typeof (x as any).text === 'string')
    .map(x => ({ key: String((x as any).key ?? ''), title: String((x as any).title ?? ''), text: String((x as any).text) }))
}

/**
 * The terms to save on a proposal. A sent or signed proposal (`frozen`) keeps
 * the terms it went out with; one sent before terms were frozen keeps none
 * (its page shows today's terms until it is signed, and they are frozen then).
 * A draft takes today's terms from Settings.
 */
export function stampTerms(proposal: unknown, savedSections: unknown, savedProposal: unknown, frozen: boolean): unknown {
  if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) return proposal
  const out: Record<string, unknown> = { ...(proposal as Record<string, unknown>) }
  if (frozen) {
    const was = frozenTerms(savedProposal)
    if (was) out.terms = was
    else delete out.terms
    return out
  }
  out.terms = termsAsAsked(proposalTerms(savedSections), (proposal as { depositPct?: unknown }).depositPct)
  return out
}

/** The deposit percent a proposal asks for; null when it asks none (0 or blank: Jonathan, Oct 29 2026, D2). */
export function askedDepositPct(pct: unknown): number | null {
  const n = typeof pct === 'number' ? pct : typeof pct === 'string' && pct.trim() ? Number(pct) : NaN
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : null
}

const DEPOSIT_SENTENCE = /\bA \d+(?:\.\d+)?% deposit is required to schedule the project\./
const BALANCE_SENTENCE = 'The remaining balance is due upon completion.'

/**
 * Cancellation Policy's stock sentence, and what it says on a contract that
 * asks no deposit (Jonathan, Oct 29 2026: "No deposit contracts: replace the
 * sentence with 'Once materials are ordered, their cost is non-refundable.'").
 */
export const DEPOSIT_CANCEL_SENTENCE = 'The deposit is non-refundable once materials are ordered.'
export const NO_DEPOSIT_CANCEL_SENTENCE = 'Once materials are ordered, their cost is non-refundable.'

/**
 * The terms as a proposal not yet signed shows them, and as its contract is
 * signed (Oct 29 2026):
 *   - Payment Terms says the proposal's own deposit: "A 30% deposit is
 *     required ..." for 30%; for none (0 or blank, D2) "No deposit is
 *     required to schedule the project." and "The full price is due upon
 *     completion." Only those stock sentences change; words typed in their
 *     place stay as typed.
 *   - Permits: the stock sentence that had the customer get the permit reads
 *     PERMIT_SENTENCE (#32).
 *   - Cancellation Policy, for none: the stock "The deposit is non-refundable
 *     once materials are ordered." reads NO_DEPOSIT_CANCEL_SENTENCE. With a
 *     deposit it stays; words typed in its place stay as typed.
 *     `cancellation: false` leaves it as it is: a contract signed before that
 *     rule (Oct 29 2026, late; portal lib/customerDollars.ts).
 * The same terms again give the same words (safe to run twice).
 */
export function termsAsAsked<T extends ContractTerm>(terms: T[], depositPct: unknown, opts: { cancellation?: boolean } = {}): T[] {
  const pct = askedDepositPct(depositPct)
  return terms.map(t => {
    if (t.key === 'cancellation' && pct === null && opts.cancellation !== false && t.text.includes(DEPOSIT_CANCEL_SENTENCE)) {
      return { ...t, text: t.text.split(DEPOSIT_CANCEL_SENTENCE).join(NO_DEPOSIT_CANCEL_SENTENCE) }
    }
    if (t.key === 'payment_terms' && DEPOSIT_SENTENCE.test(t.text)) {
      const text = pct === null
        ? t.text.replace(DEPOSIT_SENTENCE, 'No deposit is required to schedule the project.').split(BALANCE_SENTENCE).join('The full price is due upon completion.')
        : t.text.replace(DEPOSIT_SENTENCE, `A ${pct}% deposit is required to schedule the project.`)
      return { ...t, text }
    }
    if (t.key === 'permits' && t.text.includes(OLD_PERMIT_SENTENCE)) return { ...t, text: t.text.split(OLD_PERMIT_SENTENCE).join(PERMIT_SENTENCE) }
    return t
  })
}

/**
 * The deposit a quote's Payment Terms say, as the server works it out
 * (portal lib/contractBilling.ts termsDepositOf, sent by
 * GET /api/saved-quotes/:id/deposit-terms and with the customer's copy):
 *   asSigned    signed before the Oct 29 2026 rules: its terms stay as signed;
 *   depositPct  the proposal's own percent; null when it asks none (0% or
 *               blank, D2); 50 for a quote with no proposal at all (the
 *               contract's standard terms, as its payment schedule).
 *   cancellationAsSigned  signed before the no deposit Cancellation Policy
 *               sentence (Oct 29 2026, late): that sentence stays as signed.
 */
export interface DepositTerms { asSigned: boolean; depositPct: number | null; cancellationAsSigned?: boolean }

/** The standard deposit of a quote with no proposal (portal lib/paymentMath.ts DEFAULT_DEPOSIT_PCT). */
export const NO_PROPOSAL_DEPOSIT_PCT = 50

/**
 * The same, until the server's answer is in (no signal in a driveway): a
 * quote not yet signed reads exactly as the server reads it.
 */
export function depositTermsOf(quote: unknown): DepositTerms {
  const p = quote && typeof quote === 'object' ? (quote as { proposal?: unknown }).proposal : undefined
  const options = p && typeof p === 'object' ? (p as { options?: unknown }).options : undefined
  if (!Array.isArray(options) || options.length === 0) return { asSigned: false, depositPct: NO_PROPOSAL_DEPOSIT_PCT }
  return { asSigned: false, depositPct: askedDepositPct((p as { depositPct?: unknown }).depositPct) }
}

/**
 * Settings' contract sections (as the printable quote templates and the quote
 * window's Preview show them) with the deposit the customer's link says
 * (termsAsAsked): "A 30% deposit is required ..." for 30%, "No deposit is
 * required ... The full price is due upon completion." for none, and its
 * Cancellation Policy NO_DEPOSIT_CANCEL_SENTENCE. A contract signed before the
 * Oct 29 2026 rules: as it was.
 */
export function sectionsAsAsked<S extends { key: string; title: string; body: string }>(sections: S[], d: DepositTerms): S[] {
  if (d.asSigned) return sections
  return sections.map(s => {
    const [t] = termsAsAsked([{ key: s.key, title: s.title, text: String(s.body ?? '') }], d.depositPct, { cancellation: d.cancellationAsSigned !== true })
    return t.text === s.body ? s : { ...s, body: t.text }
  })
}

/** "123 Main St, Ocala, FL 34470" from Settings → Company; '' when the street, city and ZIP are all empty. */
export function companyAddressOf(company: unknown): string {
  const c = (company && typeof company === 'object' ? company : {}) as Record<string, unknown>
  const s = (k: string) => String(c[k] ?? '').trim()
  const street = s('address'), city = s('city'), state = s('state'), zip = s('zip')
  if (!street && !city && !zip) return ''
  const tail = [state, zip].filter(Boolean).join(' ')
  return [street, city, tail].filter(Boolean).join(', ')
}
