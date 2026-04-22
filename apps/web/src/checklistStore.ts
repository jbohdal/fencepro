/**
 * Job Checklist items — per-job milestone list backed by localStorage
 * (mirrors a server-side `JobChecklistItem` table for future migration).
 *
 * The checklist is seeded from the default milestones on first access for
 * each job. The default milestones are configurable via `setDefaultMilestones`
 * and can be overridden from the Operations Stages settings page.
 */

const KEY = 'fencepro_job_checklists'
const DEFAULTS_KEY = 'fencepro_default_milestones'
const EVT = 'fencepro:checklist:updated'

const uid = () => Math.random().toString(36).slice(2, 10)

export interface ChecklistItem {
  id: string
  jobId: string
  label: string
  isComplete: boolean
  completedBy?: string
  completedAt?: string
  sortOrder: number
  createdAt: string
  updatedAt: string
}

const DEFAULT_MILESTONES = [
  'Locate Complete',
  'Permit Approved',
  'Materials Confirmed',
  'Crew Assigned',
  'Job Started',
  'Final Walkthrough',
  'Photos Uploaded',
  'Invoice Sent',
]

export function getDefaultMilestones(): string[] {
  try {
    const r = localStorage.getItem(DEFAULTS_KEY)
    if (!r) return DEFAULT_MILESTONES
    const parsed = JSON.parse(r)
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_MILESTONES
  } catch { return DEFAULT_MILESTONES }
}

export function setDefaultMilestones(labels: string[]): void {
  localStorage.setItem(DEFAULTS_KEY, JSON.stringify(labels))
  try { window.dispatchEvent(new CustomEvent(EVT)) } catch {}
}

function loadAll(): ChecklistItem[] {
  try { const r = localStorage.getItem(KEY); return r ? JSON.parse(r) : [] } catch { return [] }
}
function saveAll(items: ChecklistItem[]) {
  localStorage.setItem(KEY, JSON.stringify(items))
  try { window.dispatchEvent(new CustomEvent(EVT)) } catch {}
}

/** Seed a job with default milestones if it has none. Idempotent. */
export function ensureChecklistForJob(jobId: string): ChecklistItem[] {
  const all = loadAll()
  const existing = all.filter(i => i.jobId === jobId)
  if (existing.length > 0) return existing.sort((a, b) => a.sortOrder - b.sortOrder)

  const now = new Date().toISOString()
  const fresh: ChecklistItem[] = getDefaultMilestones().map((label, idx) => ({
    id: uid(), jobId, label,
    isComplete: false, sortOrder: idx,
    createdAt: now, updatedAt: now,
  }))
  saveAll([...all, ...fresh])
  return fresh
}

export function getChecklistForJob(jobId: string): ChecklistItem[] {
  const all = loadAll().filter(i => i.jobId === jobId)
  if (all.length === 0) return ensureChecklistForJob(jobId)
  return all.sort((a, b) => a.sortOrder - b.sortOrder)
}

export function toggleChecklistItem(jobId: string, itemId: string, user?: string): ChecklistItem | null {
  const all = loadAll()
  const idx = all.findIndex(i => i.id === itemId && i.jobId === jobId)
  if (idx < 0) return null
  const now = new Date().toISOString()
  const flipped = !all[idx].isComplete
  all[idx] = {
    ...all[idx],
    isComplete: flipped,
    completedBy: flipped ? (user || 'user') : undefined,
    completedAt: flipped ? now : undefined,
    updatedAt: now,
  }
  saveAll(all)
  return all[idx]
}

export interface ChecklistProgress { total: number; complete: number }

export function getChecklistProgress(jobId: string): ChecklistProgress {
  const items = getChecklistForJob(jobId)
  return { total: items.length, complete: items.filter(i => i.isComplete).length }
}

export const CHECKLIST_UPDATED_EVENT = EVT
