/**
 * Deletions Jonathan agreed to, on the date he chose (ScheduledDeletion).
 *
 * On or after deleteOn (Ocala time) the records are deleted, but only:
 *   - after a successful backup in the last 26 hours (the nightly one), else
 *     it waits for the next hour and tries again;
 *   - records still archived (one brought back is left alone);
 *   - records nothing points at any more (an appointment, a quote or a job
 *     added since keeps that record, and the reminder says so).
 * The dashboard shows the reminder from remindOn; "Keep them" cancels.
 */

import prisma from './prisma.js'

export const ocalaDay = (d = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)

const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

/** Run every deletion that is due. Returns what happened, for the log and tests. */
export async function runDueDeletions(now = new Date()): Promise<string[]> {
  const today = ocalaDay(now)
  const due = await prisma.scheduledDeletion.findMany({ where: { status: 'scheduled', deleteOn: { lte: today } } })
  if (!due.length) return []
  const backup = await prisma.backupLog.findFirst({
    where: { status: 'success', completedAt: { gte: new Date(now.getTime() - 26 * 3_600_000) } },
    orderBy: { completedAt: 'desc' },
  })
  if (!backup) return due.map(d => `${d.id}: waiting for a backup from the last 26 hours`)

  const out: string[] = []
  for (const d of due) {
    if (d.model !== 'CrmContact') { out.push(`${d.id}: unknown record type ${d.model}`); continue }
    const wanted = ids(d.recordIds)
    // Still archived or deleted (one brought back or restored is left alone).
    const archived = await prisma.crmContact.findMany({ where: { id: { in: wanted }, accountId: d.accountId, OR: [{ archivedAt: { not: null } }, { deletedAt: { not: null } }] }, select: { id: true } })
    const kept: string[] = []
    const deletable: string[] = []
    for (const { id } of archived) {
      // all rows: anything still pointing at the customer, deleted or not, keeps it (the rows refer to it).
      const [appts, quotes, jobs] = await Promise.all([
        prisma.appointment.count({ where: { crmContactId: id } }),
        prisma.savedQuote.count({ where: { crmContactId: id } }),
        prisma.savedJob.count({ where: { crmContactId: id } }),
      ])
      if (appts + quotes + jobs > 0) kept.push(id); else deletable.push(id)
    }
    const notArchived = wanted.filter(id => !archived.some(a => a.id === id))
    const deleted = deletable.length ? (await prisma.crmContact.deleteMany({ where: { id: { in: deletable }, OR: [{ archivedAt: { not: null } }, { deletedAt: { not: null } }] } })).count : 0
    const result = [
      `Deleted ${deleted} of ${wanted.length} on ${today} (backup ${backup.completedAt.toISOString()}).`,
      notArchived.length ? `Left alone, no longer archived: ${notArchived.length}.` : '',
      kept.length ? `Left alone, something new points at them: ${kept.length}.` : '',
    ].filter(Boolean).join(' ')
    await prisma.scheduledDeletion.update({ where: { id: d.id }, data: { status: 'done', doneAt: now, result } })
    console.log(`[scheduled-deletion] ${d.what}: ${result}`)
    out.push(`${d.id}: ${result}`)
  }
  return out
}

/** Check once an hour (a missed day is caught up on the next check). */
export function startScheduledDeletions(): void {
  if (process.env.DISABLE_CRON === '1') return
  const tick = () => { runDueDeletions().catch(err => console.error('[scheduled-deletion] failed:', err)) }
  setTimeout(tick, 60_000).unref()
  setInterval(tick, 3_600_000).unref()
}
