/**
 * Contract Templates — 7 editable sections appearing on every quote.
 * Backed by /api/business-state.contractSections via businessStateStore.
 */

import { getBusinessField, setBusinessField } from './businessStateStore'
import { DEFAULT_CONTRACT_SECTIONS, contractSectionsOf, type ContractSection } from './contractTerms'

const EVT = 'fencepro:contract:updated'

export type { ContractSection }
export { DEFAULT_CONTRACT_SECTIONS }

export function getContractSections(): ContractSection[] {
  // Every default key there (in case new sections were added over time); the same rule the server freezes terms with (contractTerms.ts).
  return contractSectionsOf(getBusinessField('contractSections'))
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
