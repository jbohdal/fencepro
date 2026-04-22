/**
 * Operations Stages — user-configurable kanban columns for the Ops board.
 *
 * localStorage-backed for the CRM web app. Mirrors the Prisma OperationsStage
 * model so a future server migration can lift-and-shift.
 */

const KEY = 'fencepro_ops_stages'
const EVT = 'fencepro:ops_stages:updated'

const uid = () => Math.random().toString(36).slice(2, 10)

export interface OpsStage {
  id: string
  name: string
  color: string         // badge hex
  sortOrder: number
  isFirstStage: boolean // where Signed Contract jobs land
  isCompletionStage: boolean
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export const DEFAULT_OPS_STAGES: Omit<OpsStage, 'id' | 'createdAt' | 'updatedAt'>[] = [
  { name: 'Awaiting Locates',  color: '#3b82f6', sortOrder: 0, isFirstStage: true,  isCompletionStage: false, isActive: true },
  { name: 'Permit Pending',    color: '#f59e0b', sortOrder: 1, isFirstStage: false, isCompletionStage: false, isActive: true },
  { name: 'Materials Ordered', color: '#f97316', sortOrder: 2, isFirstStage: false, isCompletionStage: false, isActive: true },
  { name: 'Scheduled',         color: '#10b981', sortOrder: 3, isFirstStage: false, isCompletionStage: false, isActive: true },
  { name: 'In Progress',       color: '#06b6d4', sortOrder: 4, isFirstStage: false, isCompletionStage: false, isActive: true },
  { name: 'Punch List',        color: '#8b5cf6', sortOrder: 5, isFirstStage: false, isCompletionStage: false, isActive: true },
  { name: 'Complete',          color: '#16a34a', sortOrder: 6, isFirstStage: false, isCompletionStage: true,  isActive: true },
  { name: 'On Hold',           color: '#6b7280', sortOrder: 7, isFirstStage: false, isCompletionStage: false, isActive: true },
]

function seedIfEmpty(): OpsStage[] {
  const now = new Date().toISOString()
  return DEFAULT_OPS_STAGES.map(s => ({ ...s, id: uid(), createdAt: now, updatedAt: now }))
}

export function getOpsStages(): OpsStage[] {
  try {
    const r = localStorage.getItem(KEY)
    if (!r) {
      const seed = seedIfEmpty()
      localStorage.setItem(KEY, JSON.stringify(seed))
      return seed
    }
    const parsed: OpsStage[] = JSON.parse(r)
    return parsed.slice().sort((a, b) => a.sortOrder - b.sortOrder)
  } catch {
    return seedIfEmpty()
  }
}

export function getFirstOpsStage(): OpsStage {
  const all = getOpsStages()
  return all.find(s => s.isFirstStage && s.isActive) || all.filter(s => s.isActive)[0] || all[0]
}

export function saveOpsStages(stages: OpsStage[]): void {
  const now = new Date().toISOString()
  // Enforce exactly one isFirstStage
  const firstIdx = stages.findIndex(s => s.isFirstStage)
  const cleaned = stages.map((s, i) => ({ ...s, isFirstStage: i === firstIdx, sortOrder: i, updatedAt: now }))
  localStorage.setItem(KEY, JSON.stringify(cleaned))
  try { window.dispatchEvent(new CustomEvent(EVT)) } catch {}
}

export function resetOpsStages(): OpsStage[] {
  const fresh = seedIfEmpty()
  localStorage.setItem(KEY, JSON.stringify(fresh))
  try { window.dispatchEvent(new CustomEvent(EVT)) } catch {}
  return fresh
}

export const OPS_STAGES_UPDATED_EVENT = EVT
