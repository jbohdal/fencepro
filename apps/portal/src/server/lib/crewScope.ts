/**
 * The Installer gets only what his installs need (review, Oct 25, 2026: the
 * crew phone was sent every customer's phone, email and address, every
 * appointment and the customers' portal messages).
 *
 * His installs: jobs with a crew day today or later on the Schedule, jobs
 * booked to start today or later and not finished, and jobs he tapped Start
 * or Finish on. Logins are not tied to a crew in the app, so every crew's
 * installs count. From those: their customers, their quotes (the crew packet
 * is made from the quote), and the appointments with those customers or
 * booked with him.
 *
 * crewScoped(kind) is mounted in index.ts before each of those routes: for
 * the Installer it filters the list answers and answers 404 for one record
 * outside his installs. Every other login passes untouched.
 */

import prisma from './prisma.js'
import { staffRoleOf, hidesPrices } from './costRedact.js'
import { verifyStaffBearer } from './secrets.js'
import { floridaYmd } from './crewInstall.js'

export interface CrewScope { jobIds: Set<string>; contactIds: Set<string>; quoteIds: Set<string>; userId: string }

/** Is this login scoped to its own installs (the Installer, or any role that sees no prices)? */
export const isScopedCrew = (role: string | null | undefined) => hidesPrices(role)

export async function crewScope(userId: string, today = floridaYmd(new Date())): Promise<CrewScope | null> {
  const me = await prisma.crmUser.findUnique({ where: { id: userId }, select: { crmAccountId: true, firstName: true, lastName: true, email: true } })
  if (!me?.crmAccountId) return null
  const accountId = me.crmAccountId
  const name = `${me.firstName ?? ''} ${me.lastName ?? ''}`.trim()
  const days = await prisma.scheduledGridJob.findMany({ where: { accountId, deletedAt: null, date: { gte: today }, stagingJobId: { not: null } }, select: { stagingJobId: true } })
  const booked = await prisma.savedJob.findMany({ where: { accountId, deletedAt: null, archivedAt: null, scheduledDate: { gte: today }, completedDate: null }, select: { id: true } })
  const tapped = await prisma.activityLog.findMany({ where: { entityType: 'job', body: { in: ['Install started', 'Install finished'] }, actor: { in: [name, me.email].filter(Boolean) } }, select: { entityId: true } })
  const ids = new Set<string>([...days.map(d => d.stagingJobId!), ...booked.map(j => j.id), ...tapped.map(t => t.entityId)])
  const jobs = await prisma.savedJob.findMany({ where: { accountId, id: { in: [...ids] }, deletedAt: null }, select: { id: true, crmContactId: true, quoteId: true } })
  return {
    userId,
    jobIds: new Set(jobs.map(j => j.id)),
    contactIds: new Set(jobs.map(j => j.crmContactId).filter((x): x is string => !!x)),
    quoteIds: new Set(jobs.map(j => j.quoteId).filter((x): x is string => !!x)),
  }
}

export type ScopedKind = 'contacts' | 'jobs' | 'quotes' | 'appointments' | 'pipeline'

/** Is this record within the Installer's installs? */
export function inScope(kind: ScopedKind, s: CrewScope, item: any): boolean {
  if (!item || typeof item !== 'object') return false
  switch (kind) {
    case 'contacts': return s.contactIds.has(item.id)
    case 'jobs': return s.jobIds.has(item.id)
    case 'quotes': return s.quoteIds.has(item.id) || (!!item.crmContactId && s.contactIds.has(item.crmContactId) && item.status === 'SOLD')
    case 'appointments': return (!!item.crmContactId && s.contactIds.has(item.crmContactId)) || item.assignedToUserId === s.userId
    case 'pipeline': return !!item.customerId && s.contactIds.has(item.customerId)
  }
}

/** Words in a path that are routes, not record ids. */
const NOT_IDS = new Set(['sync', 'notes', 'geo', 'team', 'share', 'cards', 'board', 'column', 'search', 'pages', 'words', 'archived', 'milestones'])

/**
 * Middleware for one record kind. For the Installer: a list answer keeps only
 * his installs' records; a request for one record outside them is a 404.
 */
export function crewScoped(kind: ScopedKind) {
  return async (req: any, res: any, next: any) => {
    const role = staffRoleOf(req)
    if (!isScopedCrew(role)) { next(); return }
    const who = verifyStaffBearer(req)
    const scope = who?.sub ? await crewScope(String(who.sub)).catch(() => null) : null
    if (!scope) { res.status(403).json({ success: false, code: 'NOT_ALLOWED', error: 'Your login is not linked to a company.' }); return }
    const first = String(req.path || '/').split('/').filter(Boolean)[0]
    // One record by id (and what hangs off it: notes, consent, history).
    if (first && !NOT_IDS.has(first) && kind !== 'pipeline') {
      const ok = kind === 'contacts' ? scope.contactIds.has(first) : kind === 'jobs' ? scope.jobIds.has(first) : kind === 'quotes' ? scope.quoteIds.has(first) : true
      if (!ok) { res.status(404).json({ success: false, error: 'Not found' }); return }
    }
    // The pipeline's pages and search are the office's: the Installer's board is the plain list, filtered.
    if (kind === 'pipeline' && first && req.method === 'GET') { res.status(403).json({ success: false, code: 'NOT_ALLOWED', error: 'Your role does not use the Sales Pipeline.' }); return }
    const json = res.json.bind(res)
    res.json = (body: any) => {
      if (body && Array.isArray(body.data)) return json({ ...body, data: body.data.filter((x: any) => inScope(kind, scope, x)) })
      if (kind === 'pipeline' && body?.data && Array.isArray(body.data.leads)) return json({ ...body, data: { ...body.data, leads: body.data.leads.filter((x: any) => inScope('pipeline', scope, x)), archivedLeads: [] } })
      if (kind === 'appointments' && body?.data && typeof body.data === 'object' && 'startAt' in body.data && !inScope('appointments', scope, body.data)) return res.status(404) && json({ success: false, error: 'Not found' })
      return json(body)
    }
    next()
  }
}

/** Middleware: not the Installer's at all (the customers' portal messages). */
export function refuseScopedCrew(req: any, res: any, next: any): void {
  if (isScopedCrew(staffRoleOf(req))) { res.status(403).json({ success: false, code: 'NOT_ALLOWED', error: 'Customer messages are the office\'s.' }); return }
  next()
}

/** Middleware: refuse the Installer with this sentence. */
export function refuseCrewWith(error: string) {
  return (req: any, res: any, next: any): void => {
    if (isScopedCrew(staffRoleOf(req))) { res.status(403).json({ success: false, code: 'NOT_ALLOWED', error }); return }
    next()
  }
}
