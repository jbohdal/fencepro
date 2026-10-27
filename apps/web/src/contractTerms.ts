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
    body: `Unless noted otherwise, the customer is responsible for obtaining any required permits. If a permit is denied after materials are ordered, any non-refundable costs will be billed.`,
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
  return DEFAULT_CONTRACT_SECTIONS.map(d => byKey.get(d.key) || d)
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
  out.terms = proposalTerms(savedSections)
  return out
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
