/**
 * Operations Stages — user-configurable kanban columns for the Ops board.
 *
 * Saved on the server through cloudStorage (/api/kv, key fencepro_ops_stages).
 */
import { cloudStorage } from './cloudStorage'

const KEY = 'fencepro_ops_stages'
const EVT = 'fencepro:ops_stages:updated'

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

/**
 * The default stages, each with a fixed id (`ops-<name>`). Shown when nothing
 * is saved; nothing is written until the stages are edited and saved, so two
 * screens opening at once cannot each save their own copy of the defaults.
 */
function defaultStages(): OpsStage[] {
  const at = '1970-01-01T00:00:00.000Z'
  return DEFAULT_OPS_STAGES.map(s => ({ ...s, id: `ops-${s.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, createdAt: at, updatedAt: at }))
}

export function getOpsStages(): OpsStage[] {
  try {
    const r = cloudStorage.getItem(KEY)
    if (!r) return defaultStages()
    const parsed: OpsStage[] = JSON.parse(r)
    if (!Array.isArray(parsed) || parsed.length === 0) return defaultStages()
    return parsed.slice().sort((a, b) => a.sortOrder - b.sortOrder)
  } catch {
    return defaultStages()
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
  cloudStorage.setItem(KEY, JSON.stringify(cleaned))
  try { window.dispatchEvent(new CustomEvent(EVT)) } catch {}
}

export function resetOpsStages(): OpsStage[] {
  const fresh = defaultStages()
  cloudStorage.setItem(KEY, JSON.stringify(fresh))
  try { window.dispatchEvent(new CustomEvent(EVT)) } catch {}
  return fresh
}

export const OPS_STAGES_UPDATED_EVENT = EVT
