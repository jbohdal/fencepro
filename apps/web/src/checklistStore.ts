/**
 * Job Checklist items. A job's list is kept on the server
 * (BusinessState.jobChecklists, made when the job is made: lib/seeds.ts
 * ensureJobChecklist) and read one job at a time (/api/saved-jobs/:id/milestones);
 * the default milestone labels are a company setting (business state).
 */

import { getBusinessField, setBusinessField } from './businessStateStore'
import { fetchMilestones, tickMilestone } from './jobTruthApi'

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

const labelKey = (label: string) => label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/** A milestone's fixed id on one job. Same formula as the server (portal lib/seeds.ts milestoneId). */
export const milestoneId = (jobId: string, label: string) => `m:${jobId}:${labelKey(label)}`

/**
 * A job's checklist as the server works it out (jobTruthApi.ts,
 * /api/saved-jobs/:id/milestones). The phone no longer holds every job's
 * list (BusinessState.jobChecklists, 2.7 MB on each page load: audit #17).
 */
export async function getChecklistForJob(jobId: string): Promise<ChecklistItem[]> {
  const r = await fetchMilestones(jobId)
  if (!r.ok) return []
  return r.data.milestones.map((m, i) => ({
    id: milestoneId(jobId, m.label), jobId, label: m.label, isComplete: m.done,
    ...(m.tickedBy ? { completedBy: m.tickedBy } : {}), ...(m.tickedAt ? { completedAt: m.tickedAt } : {}),
    sortOrder: i, createdAt: m.tickedAt ?? '', updatedAt: m.tickedAt ?? '',
  }))
}

/** Tick (or untick) one item by hand, saved on the server. Null when it is not on the job or could not be saved. */
export async function toggleChecklistItem(jobId: string, itemId: string): Promise<ChecklistItem | null> {
  const item = (await getChecklistForJob(jobId)).find(i => i.id === itemId)
  if (!item) return null
  const r = await tickMilestone(jobId, item.label, !item.isComplete)
  if (!r.ok) return null
  try { window.dispatchEvent(new CustomEvent(EVT)) } catch {}
  return (await getChecklistForJob(jobId)).find(i => i.id === itemId) ?? null
}

export interface ChecklistProgress { total: number; complete: number }

export async function getChecklistProgress(jobId: string): Promise<ChecklistProgress> {
  const items = await getChecklistForJob(jobId)
  return { total: items.length, complete: items.filter(i => i.isComplete).length }
}

export const CHECKLIST_UPDATED_EVENT = EVT
