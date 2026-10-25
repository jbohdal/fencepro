/**
 * The installer's list (InstallerHome.tsx): every crew day from today on,
 * from the install schedule (Schedule install makes one Schedule entry per
 * crew day, linked to the job: lib/installScheduling.ts). No browser, no
 * store: tested on its own (portal tests/crewInstall.test.ts).
 */

import type { Job } from './jobStore'

/** YYYY-MM-DD in Florida. */
export const ymd = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
/** How far ahead "Coming up" looks. */
export const AHEAD_DAYS = 21

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
    // Finished jobs are not on the list.
    if (job.completedDate || job.status === 'completed' || job.status === 'invoiced' || job.status === 'paid') continue
    const mine = entries.filter(e => e.stagingJobId === job.id && /^\d{4}-\d{2}-\d{2}$/.test(e.date))
    const days = [...new Set(mine.map(e => e.date))].sort()
    if (days.length) {
      days.forEach((day, i) => {
        if (day < today || day > until) return
        const e = mine.find(x => x.date === day)!
        out.push({ job, day, crew: crewName(e.crewId) || job.crewAssigned, dayNo: i + 1, days: days.length })
      })
    } else if (job.scheduledDate && job.scheduledDate >= today && job.scheduledDate <= until) {
      out.push({ job, day: job.scheduledDate, crew: job.crewAssigned, dayNo: 1, days: Math.max(1, job.estimatedDays || 1) })
    }
  }
  return out.sort((a, b) => a.day.localeCompare(b.day) || a.job.customerName.localeCompare(b.job.customerName))
}

