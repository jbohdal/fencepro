/**
 * The installer's list (InstallerHome.tsx): every crew day from today on,
 * from the install schedule (Schedule install makes one Schedule entry per
 * crew day, linked to the job: lib/installScheduling.ts). No browser, no
 * store: tested on its own (portal tests/crewInstall.test.ts).
 */

import type { Job } from './jobStore'

/** YYYY-MM-DD in Florida. */
export const ymd = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
/** How far ahead "Coming up" looks: 60 days (a repair 23 days out did not show at 21; review, Oct 27 2026). Server: crewVisits.ts VISIT_AHEAD_DAYS. */
export const AHEAD_DAYS = 60

export interface CrewDay { job: Job; day: string; crew: string; dayNo: number; days: number }

/**
 * Every crew day from today on (AHEAD_DAYS ahead), one per job and day: from
 * the Schedule's entries for the job, else (a job booked before the install
 * schedule) its start day.
 */
export function crewDays(jobs: Job[], entries: Array<{ stagingJobId?: string; date: string; crewId: string; status?: string }>, crews: Array<{ id: string; name: string }>, today: string, ahead = AHEAD_DAYS): CrewDay[] {
  const until = ymd(new Date(new Date(`${today}T12:00:00`).getTime() + ahead * 86_400_000))
  const crewName = (id: string) => crews.find(c => c.id === id)?.name ?? id
  const out: CrewDay[] = []
  for (const job of jobs) {
    // Finished jobs are not on the list, except today's card of a job finished today: the crew sees "Job finished
    // and closed out" after the tap that closed it, instead of the card vanishing (round 2b, Oct 26 2026).
    const finished = !!job.completedDate || job.status === 'completed' || job.status === 'invoiced' || job.status === 'paid'
    if (finished && job.completedDate !== today) continue
    const mine = entries.filter(e => e.stagingJobId === job.id && /^\d{4}-\d{2}-\d{2}$/.test(e.date) && (!finished || e.date === today))
    const days = [...new Set(mine.map(e => e.date))].sort()
    if (days.length) {
      days.forEach((day, i) => {
        if (day < today || day > until) return
        const e = mine.find(x => x.date === day)!
        out.push({ job, day, crew: crewName(e.crewId) || job.crewAssigned, dayNo: i + 1, days: days.length })
      })
    } else if (job.scheduledDate && job.scheduledDate >= today && job.scheduledDate <= until && (!finished || job.scheduledDate === today)) {
      out.push({ job, day: job.scheduledDate, crew: crewName(job.crewAssigned) || job.crewAssigned, dayNo: 1, days: Math.max(1, job.estimatedDays || 1) })
    }
  }
  return out.sort((a, b) => a.day.localeCompare(b.day) || a.job.customerName.localeCompare(b.job.customerName))
}

