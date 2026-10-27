/**
 * The installer's day (walkthrough round 1, Oct 25, 2026): Start and Finish
 * on an install, and what the customer told us, for the crew.
 *
 * Start and Finish are kept in ActivityLog (entityType 'job', the job's id),
 * one row per tap with who and when; the job page and the installer's home
 * read them back. Nothing about money is here.
 *
 * The customer's notes ("have 2 dogs") come from the customer record's notes
 * and the "Customer notes:" line of a website quote's note. A dollar amount in
 * a line is shown as "$ (left out)" (lib/costRedact.ts): the crew never sees a
 * price, and never loses the rest of the line ("Have 2 dogs ... Budget about
 * $4000." kept the dogs; review, Oct 25, 2026).
 */

import prisma from './prisma.js'
import { forCrew } from './costRedact.js'

export type InstallTimeKind = 'start' | 'finish'
/**
 * A tap. `jobDone`: the crew said the whole job is finished ("Finished the
 * job", or Finish on the job's last crew day), not only "Finish for today" on
 * a day of a longer job (round 2, Oct 26 2026).
 */
export interface InstallTime { kind: InstallTimeKind; at: string; by: string; day: string; jobDone?: boolean }

const KIND: Record<InstallTimeKind, string> = { start: 'install.start', finish: 'install.finish' }
const SAID: Record<InstallTimeKind, string> = { start: 'Install started', finish: 'Install finished' }
/** Finish that ends the whole job (the last crew day, or "Finished the job" on an earlier one). */
const SAID_DONE = 'Install finished: job done'

/** YYYY-MM-DD in Florida. */
export const floridaYmd = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' })


/**
 * What the customer told us, for the crew packet and the installer: the
 * customer record's notes (line by line) and each "Customer notes: ..." line
 * of the notes on file (a website quote writes one). Repeats once.
 */
export function customerNotesFrom(contactNotes: string | null | undefined, noteBodies: Array<string | null | undefined>): string[] {
  const out: string[] = []
  const add = (s: string) => { const t = forCrew(s.trim().replace(/\s+/g, ' ')); if (t && !out.some(x => x.toLowerCase() === t.toLowerCase())) out.push(t) }
  for (const line of String(contactNotes ?? '').split('\n')) add(line)
  for (const body of noteBodies) {
    for (const line of String(body ?? '').split('\n')) {
      const m = line.match(/^\s*customer notes?\s*:\s*(.+)$/i)
      if (m) add(m[1])
    }
  }
  return out
}

/** The customer's notes for a job's customer (none when the job has no customer). */
export async function customerNotesForJob(accountId: string, crmContactId: string | null | undefined): Promise<string[]> {
  if (!crmContactId) return []
  const c = await prisma.crmContact.findFirst({ where: { id: crmContactId, accountId }, select: { notes: true } })
  if (!c) return []
  const notes = await prisma.crmContactNote.findMany({ where: { crmContactId, deletedAt: null }, select: { body: true }, orderBy: { createdAt: 'asc' } })
  return customerNotesFrom(c.notes, notes.map(n => n.body))
}

/** Start and Finish taps on a job, oldest first. */
export async function installTimes(jobId: string): Promise<InstallTime[]> {
  const rows = await prisma.activityLog.findMany({ where: { entityType: 'job', entityId: jobId, body: { in: [...Object.values(SAID), SAID_DONE] } }, orderBy: { createdAt: 'asc' } })
  return rows.map(r => {
    const kind: InstallTimeKind = r.body === SAID.start ? 'start' : 'finish'
    return { kind, at: r.createdAt.toISOString(), by: r.actor, day: floridaYmd(r.createdAt), ...(r.body === SAID_DONE ? { jobDone: true } : {}) }
  })
}

/** Record a Start or Finish tap; a Finish that ends the whole job with `jobDone`. */
export async function recordInstallTime(jobId: string, kind: InstallTimeKind, by: string, at = new Date(), jobDone = false): Promise<InstallTime> {
  const done = kind === 'finish' && jobDone
  const r = await prisma.activityLog.create({ data: { entityType: 'job', entityId: jobId, actor: by || 'Crew', body: done ? SAID_DONE : SAID[kind], metadata: { kind: KIND[kind], ...(done ? { jobDone: true } : {}) }, createdAt: at } })
  return { kind, at: r.createdAt.toISOString(), by: r.actor, day: floridaYmd(r.createdAt), ...(done ? { jobDone: true } : {}) }
}

/**
 * Did the crew finish the whole job? A Finish marked job done, or a Finish on
 * or after the job's last crew day (a one day job: any Finish). "Finish for
 * today" on day 1 of 2 is not the install finished.
 */
export function crewFinishedJob(times: InstallTime[], lastCrewDay: string | null): boolean {
  return times.some(t => t.kind === 'finish' && (t.jobDone || !lastCrewDay || t.day >= lastCrewDay))
}

/** The day the crew finished the whole job (the first Finish that did, crewFinishedJob); null while not finished. */
export function jobFinishedDay(times: InstallTime[], lastCrewDay: string | null): string | null {
  return times.find(t => t.kind === 'finish' && (t.jobDone || !lastCrewDay || t.day >= lastCrewDay))?.day ?? null
}

/** Where a job is today, from its taps: not started, working (started, not finished), or finished today. */
export function todayState(times: InstallTime[], today: string): 'not-started' | 'working' | 'finished' {
  const t = times.filter(x => x.day === today)
  if (!t.length) return 'not-started'
  return t[t.length - 1].kind === 'start' ? 'working' : 'finished'
}
