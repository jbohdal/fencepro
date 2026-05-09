/**
 * Contract Templates — 7 editable sections appearing on every quote.
 * Backed by /api/business-state.contractSections via businessStateStore.
 */

import { getBusinessField, setBusinessField } from './businessStateStore'

const EVT = 'fencepro:contract:updated'

export interface ContractSection {
  key: string
  title: string
  body: string      // HTML or plain text — rendered via dangerouslySetInnerHTML in the template
  visible: boolean
}

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

export function getContractSections(): ContractSection[] {
  const saved = getBusinessField('contractSections') as ContractSection[]
  if (!saved || saved.length === 0) return DEFAULT_CONTRACT_SECTIONS
  // Ensure every default key exists (in case new sections were added over time).
  const byKey = new Map(saved.map(s => [s.key, s]))
  return DEFAULT_CONTRACT_SECTIONS.map(d => byKey.get(d.key) || d)
}

export function saveContractSections(sections: ContractSection[]): void {
  setBusinessField('contractSections', sections)
  try { window.dispatchEvent(new CustomEvent(EVT)) } catch {}
}

export function resetContractSection(key: string): ContractSection | null {
  const all = getContractSections()
  const def = DEFAULT_CONTRACT_SECTIONS.find(d => d.key === key)
  if (!def) return null
  const next = all.map(s => s.key === key ? { ...def } : s)
  saveContractSections(next)
  return def
}

export const CONTRACT_UPDATED_EVENT = EVT
