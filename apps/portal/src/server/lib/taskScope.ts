/**
 * Whose tasks the Today screen lists (GET /api/automations/tasks).
 *
 *   Owner, admin, manager, office: tasks named for them, and the company's
 *     tasks that name nobody (permits, materials, ...): the office runs those.
 *   Salesman, Installer: only tasks named for them, or for their role
 *     (assignedRole). Christa's Today listed every company task (walkthrough,
 *     Oct 24, 2026).
 */

import type { Prisma } from '@prisma/client'
import { isFullRole } from './permissions.js'
import { removedIdsAmong } from './deletion.js'

/** Roles whose Today also lists the company's tasks that name nobody. */
export const seesCompanyTasks = (role: string | null | undefined): boolean => isFullRole(role) || role === 'office_staff'

/** The where clause for "my tasks". `names`: the login's email, full name and first name. */
export function myTasksWhere(role: string | null | undefined, names: string[]): Prisma.TaskWhereInput {
  const named: Prisma.TaskWhereInput[] = names.filter(n => n && n.trim()).map(n => ({ assignedTo: { equals: n.trim(), mode: 'insensitive' as const } }))
  if (seesCompanyTasks(role)) return { OR: [{ assignedTo: null }, { assignedTo: '' }, ...named] }
  const nobody: Prisma.TaskWhereInput = { OR: [{ assignedTo: null }, { assignedTo: '' }] }
  return { OR: [...named, ...(role ? [{ AND: [nobody, { assignedRole: role }] }] : [])] }
}

/**
 * Open tasks whose customer is gone (review Oct 28 2026: Today listed two follow ups for "jj jj", a deleted
 * customer). A task names its job, or the pipeline card it was made for (Task.jobId); it is left off the open
 * list when:
 *   - its job is deleted, or the job's customer is deleted or archived;
 *   - its card's customer is deleted or archived;
 *   - its card or job was taken off by a deletion nothing restored (DeletionLog ids).
 * The task itself is not changed: restoring the customer brings it back. A task naming nothing, or something
 * not found, stays.
 */
export interface TaskLinkFacts {
  /** Jobs by id: deleted, and their customer's id. */
  jobs: Map<string, { deleted: boolean; contactId: string | null }>
  /** Cards on the board (on it or archived) by id: their customer's id. */
  cards: Map<string, string | null>
  /** Customers deleted or archived. */
  goneContacts: Set<string>
  /** Ids a deletion took and nothing restored. */
  removed: Set<string>
}

/** Is this task's customer (or job) gone? Pure; the tests call it. */
export function taskSubjectGone(jobId: string | null | undefined, f: TaskLinkFacts): boolean {
  if (!jobId) return false
  if (f.removed.has(jobId)) return true
  const job = f.jobs.get(jobId)
  if (job) return job.deleted || (!!job.contactId && f.goneContacts.has(job.contactId))
  const card = f.cards.get(jobId)
  return !!card && f.goneContacts.has(card)
}

/** The facts for these tasks, read from the account's records. */
export async function taskLinkFacts(db: any, accountId: string, jobIds: string[]): Promise<TaskLinkFacts> {
  const ids = [...new Set(jobIds.filter(Boolean))]
  const empty: TaskLinkFacts = { jobs: new Map(), cards: new Map(), goneContacts: new Set(), removed: new Set() }
  if (!ids.length) return empty
  const [jobs, cards, removed] = await Promise.all([
    db.savedJob.findMany({ where: { accountId, id: { in: ids } }, select: { id: true, deletedAt: true, crmContactId: true } }),
    db.$queryRaw`
      SELECT l->>'id' AS "id", l->>'customerId' AS "customerId"
      FROM "PipelineState" p, jsonb_array_elements(COALESCE(p.leads::jsonb, '[]'::jsonb) || COALESCE(p."archivedLeads"::jsonb, '[]'::jsonb)) l
      WHERE p."accountId" = ${accountId} AND jsonb_typeof(l) = 'object' AND l->>'id' = ANY(${ids})` as Promise<Array<{ id: string; customerId: string | null }>>,
    removedIdsAmong(db, accountId, ids),
  ])
  const contactIds = [...new Set([...jobs.map((j: any) => j.crmContactId), ...cards.map(c => c.customerId)].filter((x): x is string => !!x))]
  const gone = contactIds.length
    ? await db.crmContact.findMany({ where: { accountId, id: { in: contactIds }, OR: [{ deletedAt: { not: null } }, { archivedAt: { not: null } }] }, select: { id: true } })
    : []
  return {
    jobs: new Map(jobs.map((j: any) => [j.id, { deleted: !!j.deletedAt, contactId: j.crmContactId ?? null }])),
    cards: new Map(cards.map(c => [c.id, c.customerId ?? null])),
    goneContacts: new Set(gone.map((c: any) => c.id)),
    removed,
  }
}
