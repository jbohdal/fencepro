/**
 * Job Checklist items: per-job milestone list saved in business state
 * (BusinessState.jobChecklists on the server).
 *
 * A job's list is made on the server when the job is made (lib/seeds.ts
 * ensureJobChecklist). This browser never makes one: a job with no saved list
 * shows the default milestones with the same fixed ids the server uses
 * (`m:<jobId>:<label>`), and the list is saved only when an item is ticked.
 * Two phones doing that at once save the same ids, so the lists merge into one.
 */

import { getBusinessField, setBusinessField } from './businessStateStore'

const EVT = 'fencepro:checklist:updated'

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
  const saved = getBusinessField('defaultMilestones') as string[]
  return Array.isArray(saved) && saved.length > 0 ? saved : DEFAULT_MILESTONES
}

export function setDefaultMilestones(labels: string[]): void {
  setBusinessField('defaultMilestones', labels)
  try { window.dispatchEvent(new CustomEvent(EVT)) } catch {}
}

function loadAll(): ChecklistItem[] {
  // The cache stores checklists as a Record<jobId, ChecklistItem[]>; flatten
  // to a single array to match the legacy on-the-wire shape used below.
  const map = (getBusinessField('jobChecklists') as Record<string, ChecklistItem[]>) || {}
  const items: ChecklistItem[] = []
  for (const jobId of Object.keys(map)) {
    if (Array.isArray(map[jobId])) items.push(...map[jobId])
  }
  return items
}
function saveAll(items: ChecklistItem[]) {
  const grouped: Record<string, ChecklistItem[]> = {}
  for (const it of items) {
    if (!grouped[it.jobId]) grouped[it.jobId] = []
    grouped[it.jobId].push(it)
  }
  setBusinessField('jobChecklists', grouped)
  try { window.dispatchEvent(new CustomEvent(EVT)) } catch {}
}

const labelKey = (label: string) => label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/** A milestone's fixed id on one job. Same formula as the server (portal lib/seeds.ts milestoneId). */
export const milestoneId = (jobId: string, label: string) => `m:${jobId}:${labelKey(label)}`

/** The default milestones for a job, with fixed ids. Not saved. */
function defaultsFor(jobId: string): ChecklistItem[] {
  const at = '1970-01-01T00:00:00.000Z'
  const seen = new Set<string>()
  const out: ChecklistItem[] = []
  for (const label of getDefaultMilestones()) {
    const id = milestoneId(jobId, label)
    if (seen.has(id)) continue
    seen.add(id)
    out.push({ id, jobId, label, isComplete: false, sortOrder: out.length, createdAt: at, updatedAt: at })
  }
  return out
}

export function getChecklistForJob(jobId: string): ChecklistItem[] {
  const all = loadAll().filter(i => i.jobId === jobId)
  if (all.length === 0) return defaultsFor(jobId)
  return all.sort((a, b) => a.sortOrder - b.sortOrder)
}

export function toggleChecklistItem(jobId: string, itemId: string, user?: string): ChecklistItem | null {
  const saved = loadAll()
  // A job whose list is not saved yet: its defaults (fixed ids) are saved with this tick.
  const all = saved.some(i => i.jobId === jobId) ? saved : [...saved, ...defaultsFor(jobId)]
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
