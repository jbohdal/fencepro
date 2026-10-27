/**
 * What the Schedule month shows: the board's entries (one per crew day,
 * Schedule install) plus jobs that have install dates and no entries
 * (scheduled the old way). One list, so the month and Schedule install's
 * "crew already has ..." warning never disagree (round 2b, Oct 26 2026: Manuel
 * Cotrich showed on Crew 1, Mon 10/26, and the warning missed him).
 */

import { installDays as crewDaysFrom, crewDaysOfWeek } from '../../portal/src/server/lib/installDays'
import { getJob, type Job } from './jobStore'
import { getQuoteById } from './quoteStore'
import { workSummary } from './moveRepair'
import { soldStyleLabel } from './fenceCatalog'
import type { ScheduledJob, ScheduleSettings } from './SchedulePage'

/** The id prefix of a month card made from a job's dates (no board entry yet). */
export const FROM_DATES = 'job-dates:'

/**
 * Jobs with an install date and no board entry: one card per crew day, from
 * the start (and end, else the crew days estimated) on the crew days, on the
 * job's crew (by id or by name). A finished or archived job is left out once
 * its dates are past; Ready to schedule never lists a job with a date.
 */
export function datedJobsWithoutEntries(all: Job[], entries: ScheduledJob[], settings: ScheduleSettings): ScheduledJob[] {
  const booked = new Set(entries.map(e => e.stagingJobId).filter(Boolean))
  const week = crewDaysOfWeek(settings.workDays)
  const out: ScheduledJob[] = []
  for (const j of all) {
    // Done (installed, invoiced, paid): its install date is history, never shown as days ahead (Maria, installed 10/24, dated 10/29).
    if (booked.has(j.id) || !/^\d{4}-\d{2}-\d{2}$/.test(j.scheduledDate || '') || j.status === 'on_hold' || ['completed', 'invoiced', 'paid'].includes(j.status)) continue
    const end = /^\d{4}-\d{2}-\d{2}$/.test(j.scheduledEndDate || '') && j.scheduledEndDate! >= j.scheduledDate ? j.scheduledEndDate! : null
    let days = crewDaysFrom(j.scheduledDate, end ? 60 : Math.max(1, j.estimatedDays || 1), week)
    if (end) days = days.filter(d => d <= end)
    if (!days.length) days = [j.scheduledDate]
    const key = (j.crewAssigned || '').trim().toLowerCase()
    const crew = settings.crews.find(c => c.id.toLowerCase() === key) ?? settings.crews.find(c => c.name.trim().toLowerCase() === key)
    for (const d of days) out.push({
      id: `${FROM_DATES}${j.id}:${d}`, stagingJobId: j.id, clientName: j.customerName, area: j.customerAddress, sections: j.sections, fenceType: j.fenceStyle,
      jobPrice: j.contractValue, tearout: j.tearOutSections > 0, crewId: crew?.id ?? '', date: d, notes: '',
      status: j.status === 'completed' || j.status === 'invoiced' || j.status === 'paid' ? 'Complete' : 'Scheduled',
    })
  }
  return out
}

/** Everything on the month: the entries and the dated jobs without entries. */
export function monthEntries(all: Job[], entries: ScheduledJob[], settings: ScheduleSettings): ScheduledJob[] {
  return [...entries, ...datedJobsWithoutEntries(all, entries, settings)]
}

/** A repair's or a move's work in a line (moveRepair.ts workSummary), else null: a new fence. */
export function repairWorkOf(quoteId: string | null | undefined): string | null {
  return quoteId ? workSummary((getQuoteById(quoteId) as { work?: Parameters<typeof workSummary>[0] } | null)?.work) : null
}

/**
 * What the job is, in a line: a repair or a move says its work ("Repair: 1 ×
 * Rehang a gate with new hardware"), a new fence its style, feet and sections
 * (round 2b, Oct 26 2026: a repair read "White Vinyl Privacy · 2 sections" on
 * Ready to schedule, Schedule install and the month). A best price fence says the
 * panels its runs used ("8 ft panels"), not "(best price)": the job is sold (Oct 27 2026).
 */
export function jobScopeWords(j: { quoteId?: string | null; fenceStyle?: string; footage?: number; sections?: number }): string {
  return repairWorkOf(j.quoteId) ?? [soldStyleLabel(j.fenceStyle || '', j.quoteId ? getQuoteById(j.quoteId) as any : null) || 'No style', j.footage ? `${j.footage} ft` : '', j.sections ? `${j.sections} sections` : ''].filter(Boolean).join(' · ')
}

/** A month or day card's job: its repair work (null for a new fence) from the job's quote. */
export function entryWork(e: { stagingJobId?: string }): string | null {
  const job = e.stagingJobId ? getJob(e.stagingJobId) : null
  return job ? repairWorkOf(job.quoteId) : null
}
