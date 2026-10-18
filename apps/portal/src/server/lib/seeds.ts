/**
 * Defaults the server fills in by itself, each with a fixed key so doing it
 * twice (or twice at the same moment) leaves one copy.
 *
 *   - A job's milestone checklist (BusinessState.jobChecklists[jobId]): made
 *     here when the job is made, item ids are `m:<jobId>:<label>`; the web app
 *     shows the same items with the same ids until the job's list is saved,
 *     and never writes a list of its own.
 *   - Material kit sets (InventoryState.kits): at most one set in use per
 *     style; any extra is archived (kept, not lost).
 *   - Lists held in BusinessState (invoices, payments, purchase orders...):
 *     one entry per id.
 */

import prisma from './prisma.js'
import { findOrCreate, oneById } from './once.js'

/** The milestones a new job starts with, unless Settings has its own list. Same list as web checklistStore.ts. */
export const DEFAULT_MILESTONES = [
  'Locate Complete',
  'Permit Approved',
  'Materials Confirmed',
  'Crew Assigned',
  'Job Started',
  'Final Walkthrough',
  'Photos Uploaded',
  'Invoice Sent',
]

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

const labelKey = (label: string) => label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/** A milestone's fixed id on one job. Same formula as web checklistStore.ts. */
export const milestoneId = (jobId: string, label: string) => `m:${jobId}:${labelKey(label)}`

/** The labels new jobs start with. */
export function milestoneLabels(saved: unknown): string[] {
  return Array.isArray(saved) && saved.length > 0 && saved.every(x => typeof x === 'string') ? saved as string[] : DEFAULT_MILESTONES
}

/** A job's starting checklist (same ids every time). */
export function defaultChecklist(jobId: string, labels: string[], now = new Date().toISOString()): ChecklistItem[] {
  const seen = new Set<string>()
  const out: ChecklistItem[] = []
  for (const label of labels) {
    const id = milestoneId(jobId, label)
    if (seen.has(id)) continue
    seen.add(id)
    out.push({ id, jobId, label, isComplete: false, sortOrder: out.length, createdAt: now, updatedAt: now })
  }
  return out
}

/**
 * One item per milestone on each job: the same id twice, or the same label
 * twice (two phones each made the list with their own ids before this rule),
 * collapse into the first, done if either was done.
 */
export function oneChecklistPerJob(map: unknown): unknown {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return map
  const out: Record<string, unknown> = {}
  for (const [jobId, list] of Object.entries(map as Record<string, unknown>)) {
    if (!Array.isArray(list)) { out[jobId] = list; continue }
    const kept: any[] = []
    const byKey = new Map<string, any>()
    for (const item of list) {
      if (!item || typeof item !== 'object') { kept.push(item); continue }
      const keys = [typeof item.id === 'string' ? `id:${item.id}` : null, typeof item.label === 'string' ? `label:${labelKey(item.label)}` : null].filter(Boolean) as string[]
      const first = keys.map(k => byKey.get(k)).find(Boolean)
      if (!first) {
        const copy = { ...item }
        kept.push(copy)
        for (const k of keys) byKey.set(k, copy)
        continue
      }
      if (item.isComplete && !first.isComplete) Object.assign(first, { isComplete: true, completedBy: item.completedBy, completedAt: item.completedAt, updatedAt: item.updatedAt ?? first.updatedAt })
      for (const k of keys) if (!byKey.has(k)) byKey.set(k, first)
    }
    out[jobId] = kept
  }
  return out
}

/**
 * Kit sets with at most one in use per style. A later set for a style that
 * already has one in use is archived, not dropped.
 */
export function oneActiveKitPerStyle<T>(kits: T[]): T[] {
  const list = oneById(kits)
  const inUse = new Set<string>()
  let changed = list !== kits
  const out = list.map(k => {
    const s = k as { styleName?: unknown; archived?: unknown }
    if (!s || typeof s.styleName !== 'string' || !s.styleName || s.archived) return k
    if (!inUse.has(s.styleName)) { inUse.add(s.styleName); return k }
    changed = true
    return { ...k, archived: true }
  })
  return changed ? out : kits
}

/** What a BusinessState field is saved as: lists one entry per id, checklists one item per milestone. */
export function normalizeBusinessField(field: string, value: unknown): unknown {
  if (field === 'jobChecklists') return oneChecklistPerJob(value)
  if (Array.isArray(value)) return oneById(value)
  return value
}

/**
 * The job's milestone checklist, made with the default milestones if the job
 * has none yet. Applied only onto the version it read, so two at once make
 * one list (the second finds the first's and stops).
 */
export async function ensureJobChecklist(accountId: string, jobId: string): Promise<ChecklistItem[]> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const s = await findOrCreate(
      () => prisma.businessState.findUnique({ where: { accountId } }),
      () => prisma.businessState.create({ data: { accountId } }),
    )
    const map = (s.jobChecklists && typeof s.jobChecklists === 'object' && !Array.isArray(s.jobChecklists) ? s.jobChecklists : {}) as unknown as Record<string, ChecklistItem[]>
    if (Array.isArray(map[jobId]) && map[jobId].length > 0) return map[jobId]
    const items = defaultChecklist(jobId, milestoneLabels(s.defaultMilestones))
    const done = await prisma.businessState.updateMany({
      where: { accountId, version: s.version },
      data: { jobChecklists: { ...map, [jobId]: items } as any, version: { increment: 1 } },
    })
    if (done.count === 1) return items
  }
  throw new Error('Could not save the job checklist (the settings record kept changing).')
}
