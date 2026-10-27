/**
 * A job's permit status, the one place every reader takes it from: the job's
 * Permit record when it has one, else what the job starts as. A repair (its
 * quote's work) starts Not needed (Jonathan, Oct 26 2026: "Repairs: permit
 * defaults to Not needed (office can change it), no reminders unless set to
 * Needed"); anything else has no status until the office sets one (null, shown
 * as "Not set").
 *
 * Round 6 review, Oct 27 2026: the job's Permit panel showed a repair as Not
 * needed (the default) while Advance, the Schedule window and the milestones
 * read only the record, found none, and treated the permit as not set: Advance
 * went to Permit Pending and Schedule said "Permit: Not set".
 *
 * Plain prisma only (no PDF or pricing imports), so the board, Schedule, the
 * tasks and the customer's portal can all use it.
 */

import prisma from './prisma.js'

/** The permit status a job starts with: Not needed for a repair, else Needed. A fence move is a new fence line, so Needed. */
export function defaultPermitStatus(work: unknown): 'not_needed' | 'needed' {
  return work && typeof work === 'object' && (work as { type?: unknown }).type === 'repair' ? 'not_needed' : 'needed'
}

/**
 * Each job's permit status: its record's, else Not needed for a repair, else
 * null (no record; a new fence's permit has not been set). `accountId` scopes
 * the reads when given (the cross-account task sweep passes null).
 */
export async function permitStatusesOf(accountId: string | null, jobs: Array<{ id: string; quoteId?: string | null }>): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>()
  if (!jobs.length) return out
  const scope = accountId ? { accountId } : {}
  const records = await prisma.permit.findMany({ where: { ...scope, jobId: { in: jobs.map(j => j.id) } }, select: { jobId: true, status: true } })
  const byJob = new Map(records.map(p => [p.jobId, p.status]))
  const needQuote = [...new Set(jobs.filter(j => !byJob.has(j.id) && j.quoteId).map(j => j.quoteId as string))]
  // all rows: a job's quote says what the job is (a repair) even if the quote was deleted later
  const quotes = needQuote.length ? await prisma.savedQuote.findMany({ where: { ...scope, id: { in: needQuote } }, select: { id: true, work: true } }) : []
  const workOf = new Map(quotes.map(q => [q.id, q.work]))
  for (const j of jobs) {
    const rec = byJob.get(j.id)
    out.set(j.id, rec ?? (j.quoteId && defaultPermitStatus(workOf.get(j.quoteId)) === 'not_needed' ? 'not_needed' : null))
  }
  return out
}

/** One job's permit status (permitStatusesOf). */
export async function permitStatusOf(accountId: string | null, job: { id: string; quoteId?: string | null }): Promise<string | null> {
  return (await permitStatusesOf(accountId, [job])).get(job.id) ?? null
}
