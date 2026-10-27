/**
 * Tasks an automation made that close by themselves once the thing they ask
 * for is done (recheck Oct 27 2026, gap 1: the "Signed Contract" rule's
 * "File the fence permit for …", "Schedule the install for …" and "Order
 * materials for …" stayed open after the permit was Approved, the job was
 * scheduled, and even after the job was Paid & Closed, so the office's Today
 * listed 100 of them).
 *
 * Which tasks: open (pending or in progress) tasks made by an automation
 * (createdBy "automation:…") for a job, or for its card when the task was made
 * before the job was saved. What a task asks for is read from its title (the
 * rule's own wording, the customer's name left out):
 *
 *   permit     "permit"         the permit is Approved (issued, inspection
 *                               scheduled, passed) or Not needed
 *   schedule   "schedule"       the job has a start date (Schedule install)
 *   materials  "material"       the job's materials are marked Ordered,
 *                               Received or Loaded, its Sales Order is marked
 *                               Ordered or Received, or a vendor invoice for
 *                               the job is in
 *
 * A title that names more than one (a rule wrote "Order materials and file
 * the permit") closes only when each is done. Every one of them closes when
 * the job is Complete, Invoiced or Paid: the work is behind it. A task that
 * names none of them (a follow up call, a review request) is left alone.
 *
 * A closed task is marked completed, and its description ends with
 * "Closed by itself on <date>: <why>." so the office can see it was not a
 * person who ticked it.
 *
 * Run soon after a job, a permit or the Sales Orders are saved (closeTasksSoon,
 * a moment after the save is committed), and every 5 minutes by the
 * automation worker's sweep, which also catches a vendor invoice or any other
 * way a job changes. scripts/task-close-backfill.ts runs the same check once
 * over the tasks already open, as a dry run unless --apply.
 */

import prisma from './prisma.js'
import { floridaDay, jobForCard } from './automations/context.js'
import { permitStatusesOf } from './permitStatus.js'

export type TaskNeed = 'permit' | 'schedule' | 'materials'

const OPEN = ['pending', 'in_progress'] as const
const DONE_STATUS = new Set(['completed', 'invoiced', 'paid'])
const PERMIT_OK = new Set(['approved', 'inspection_scheduled', 'passed', 'not_needed'])
const PERMIT_WORDS: Record<string, string> = { approved: 'Approved', inspection_scheduled: 'Approved (inspection scheduled)', passed: 'Approved and passed inspection', not_needed: 'marked Not needed' }
const STATUS_WORDS: Record<string, string> = { completed: 'Complete', invoiced: 'Complete and invoiced', paid: 'Paid' }
const MATERIAL_WORDS: Record<string, string> = { ordered: 'Ordered', received: 'Received', loaded: 'Loaded on the truck' }
const mdy = (d: string) => (/^\d{4}-\d{2}-\d{2}/.test(d) ? `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}` : d)
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** What an automation's task asks for, from its title (the customer's name left out, so a "Permit Smith" is not a permit). */
export function needsOfTask(title: string, jobName?: string | null): TaskNeed[] {
  let t = ` ${title} `
  if (jobName && jobName.trim()) t = t.replace(new RegExp(escape(jobName.trim()), 'gi'), ' ')
  const out: TaskNeed[] = []
  if (/\bpermit/i.test(t)) out.push('permit')
  if (/\bschedul/i.test(t)) out.push('schedule')
  if (/\bmaterial/i.test(t)) out.push('materials')
  return out
}

/** What the job's records say, for the check. */
export interface TaskJobFacts {
  status: string
  scheduledDate: string
  materialsStatus: string
  permitStatus: string | null
  /** Sales Orders for the job (BusinessState.pendingOrders) marked ordered or received. */
  salesOrdersOrdered: number
  /** Vendor invoices (job lot orders) for the job. */
  vendorInvoices: number
}

/** Why the task can close now, in words, or null while it is still to do. Pure. */
export function closeReason(needs: TaskNeed[], f: TaskJobFacts): string | null {
  if (!needs.length) return null
  const phase = f.status
  if (DONE_STATUS.has(phase)) return `the job is ${STATUS_WORDS[phase]}`
  const why: string[] = []
  for (const n of needs) {
    if (n === 'permit') {
      if (!f.permitStatus || !PERMIT_OK.has(f.permitStatus)) return null
      why.push(`the permit is ${PERMIT_WORDS[f.permitStatus]}`)
    } else if (n === 'schedule') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(f.scheduledDate || '')) return null
      why.push(`the job is scheduled to start ${mdy(f.scheduledDate)}`)
    } else {
      if (MATERIAL_WORDS[f.materialsStatus]) why.push(`materials are marked ${MATERIAL_WORDS[f.materialsStatus]} on the job`)
      else if (f.salesOrdersOrdered > 0) why.push('its Sales Order is marked Ordered')
      else if (f.vendorInvoices > 0) why.push('a vendor invoice for the job is in')
      else return null
    }
  }
  return why.join(' and ')
}

export interface ClosedTask { taskId: string; title: string; jobId: string; customer: string; reason: string }
export interface SweepResult { open: number; checked: number; closed: ClosedTask[]; stillOpen: number; noJob: number }

/**
 * Close every open automation task whose job says it is done (dryRun: only
 * say which). `jobIds` limits it to tasks for those jobs (and their cards).
 */
export async function closeFinishedTasks(opts: { dryRun?: boolean; jobIds?: string[]; now?: Date } = {}): Promise<SweepResult> {
  const now = opts.now ?? new Date()
  const tasks = await prisma.task.findMany({
    where: { status: { in: [...OPEN] }, createdBy: { startsWith: 'automation:' }, jobId: { not: null } },
    select: { id: true, title: true, description: true, jobId: true, jobName: true },
    orderBy: { createdAt: 'asc' },
  })
  const out: SweepResult = { open: tasks.length, checked: 0, closed: [], stillOpen: 0, noJob: 0 }
  const asked = tasks.map(t => ({ t, needs: needsOfTask(t.title, t.jobName) })).filter(x => x.needs.length)
  out.checked = asked.length
  if (!asked.length) return out

  // The task's job: its own id, else the card it was made on (the task came before the job was saved).
  const ids = [...new Set(asked.map(x => x.t.jobId!))]
  const direct = await prisma.savedJob.findMany({ where: { id: { in: ids }, deletedAt: null } })
  const jobOf = new Map<string, any>(direct.map(j => [j.id, j]))
  const cardIds = ids.filter(id => !jobOf.has(id))
  // Only for some jobs (a save): only the cards that can lead to them are looked up.
  const only = opts.jobIds ? await prisma.savedJob.findMany({ where: { id: { in: opts.jobIds }, deletedAt: null }, select: { id: true, quoteId: true, crmContactId: true } }) : null
  const mayLead = (l: any) => !only || only.some(j => l.jobId === j.id || (j.quoteId && l.quoteId === j.quoteId) || (j.crmContactId && l.customerId === j.crmContactId))
  if (cardIds.length) {
    const boards = await prisma.pipelineState.findMany({ select: { accountId: true, leads: true } })
    for (const b of boards) {
      for (const l of (Array.isArray(b.leads) ? b.leads : []) as any[]) {
        if (!l?.id || !cardIds.includes(l.id) || jobOf.has(l.id) || !mayLead(l)) continue
        const j = await jobForCard(b.accountId, l)
        if (j) jobOf.set(l.id, j)
      }
    }
  }
  const wanted = opts.jobIds ? new Set(opts.jobIds) : null
  const items = asked.filter(x => {
    const j = jobOf.get(x.t.jobId!)
    if (!j) { out.noJob++; return false }
    return !wanted || wanted.has(j.id)
  })
  if (!items.length) return out

  const jobs = [...new Map(items.map(x => [jobOf.get(x.t.jobId!).id, jobOf.get(x.t.jobId!)])).values()]
  const jobIds = jobs.map(j => j.id)
  const accounts = [...new Set(jobs.map(j => j.accountId))]
  const [permits, vendor, states] = await Promise.all([
    permitStatusesOf(null, jobs),
    prisma.vendorInvoice.groupBy({ by: ['jobId'], where: { jobId: { in: jobIds }, docType: 'invoice', status: { notIn: ['refused', 'undone', 'failed', 'replaced'] } }, _count: { _all: true } }),
    prisma.businessState.findMany({ where: { accountId: { in: accounts } }, select: { accountId: true, pendingOrders: true } }),
  ])
  const orders = states.flatMap(s => ((Array.isArray(s.pendingOrders) ? s.pendingOrders : []) as any[]).map(o => ({ ...o, accountId: s.accountId })))
  const factsOf = (j: any): TaskJobFacts => ({
    status: j.status === 'on_hold' ? (j.previousStatus || 'staging') : j.status,
    scheduledDate: j.scheduledDate || '',
    materialsStatus: j.materialsStatus || 'not_ordered',
    permitStatus: permits.get(j.id) ?? null,
    salesOrdersOrdered: orders.filter(o => o.accountId === j.accountId && (o.jobId === j.id || (j.quoteId && o.quoteId === j.quoteId)) && (o.status === 'ordered' || o.status === 'received')).length,
    vendorInvoices: vendor.find(v => v.jobId === j.id)?._count._all ?? 0,
  })

  const day = mdy(floridaDay(now))
  for (const { t, needs } of items) {
    const j = jobOf.get(t.jobId!)
    const reason = closeReason(needs, factsOf(j))
    if (!reason) { out.stillOpen++; continue }
    if (!opts.dryRun) {
      const note = `Closed by itself on ${day}: ${reason}.`
      const description = [t.description?.trim(), note].filter(Boolean).join('\n\n').slice(0, 4000)
      // Only while it is still open: a person who ticked it a moment ago keeps their tick.
      const done = await prisma.task.updateMany({ where: { id: t.id, status: { in: [...OPEN] } }, data: { status: 'completed', completedAt: now, description } })
      if (!done.count) continue
    }
    out.closed.push({ taskId: t.id, title: t.title, jobId: j.id, customer: j.customerName || t.jobName || '', reason })
  }
  return out
}

let soon: ReturnType<typeof setTimeout> | null = null
const soonJobs = new Set<string>()
/** A job, its permit or its Sales Order was just saved: check its tasks a moment later, once the save is committed. */
export function closeTasksSoon(jobId?: string | null): void {
  if (process.env.TASK_AUTO_CLOSE === '0') return
  if (jobId) soonJobs.add(jobId)
  else soonJobs.add('*')
  if (soon) return
  soon = setTimeout(() => {
    soon = null
    const all = soonJobs.has('*')
    const jobIds = [...soonJobs].filter(id => id !== '*')
    soonJobs.clear()
    closeFinishedTasks(all ? {} : { jobIds }).catch(err => console.error('[tasks] closing finished tasks:', err))
  }, 1500)
  soon.unref?.()
}
