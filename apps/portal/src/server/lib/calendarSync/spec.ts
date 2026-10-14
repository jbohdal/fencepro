/**
 * What goes on the calendar: turns CRM records that carry a date into the
 * events that should exist. Pure, no database and no Google here.
 *
 * Sources (the `source` half of an event's key):
 *   job          a job with a scheduled date (Operations, Dispatch, Smart Schedule)
 *   grid         an entry on the Schedule board; rain day reschedules move it
 *   lead         a pipeline card with a date: an estimate before the sale, an
 *                install after it when no job carries the date
 *   contact      a customer's First Appointment Date
 *   appointment  an appointment on a customer (Appointments page, website chat, phone agent)
 *
 * The same visit must not appear twice, so: a job that is on the Schedule
 * board is shown from the board; an install typed on a pipeline card is
 * skipped when the customer's job already has a date; a customer's first
 * appointment is skipped when their pipeline card shows an estimate that day.
 */

import { createHash } from 'crypto'

export type EventSource = 'job' | 'grid' | 'lead' | 'contact' | 'appointment'

export interface CalendarEventSpec {
  source: EventSource
  recordId: string
  summary: string
  location: string
  description: string
  /** All day events: first and last day, both included (YYYY-MM-DD). */
  startDate?: string
  endDate?: string
  /** Timed events: ISO instants. */
  startAt?: string
  endAt?: string
  /** A phone reminder this many minutes before (timed events). */
  reminderMinutes?: number
}

export interface JobRow {
  id: string; crmContactId: string | null; status: string
  customerName: string; customerPhone: string; customerAddress: string
  fenceStyle: string; sections: number; totalFeet: number; walkGates: number; dblGates: number
  contractValue: number; quotePrice: number
  scheduledDate: string; scheduledEndDate: string | null; estimatedDays: number
  crewAssigned: string; notes: string
}
export interface GridRow {
  id: string; stagingJobId: string | null; clientName: string; area: string; sections: number
  fenceType: string; jobPrice: number; tearout: boolean; crewId: string; date: string; notes: string; status: string
}
export interface LeadRow {
  id: string; customerId?: string; firstName: string; lastName: string; phone?: string; email?: string
  address?: string; fenceType?: string; sections?: number; quotePrice?: number; notes?: string
  stage: string; scheduledDate?: string
}
export interface ContactRow {
  id: string; firstName: string; lastName: string; phone: string | null; email: string | null
  serviceAddress: string | null; firstApptDate: string | null; notes: string | null
}
export interface AppointmentRow {
  id: string; crmContactId: string; type: string; status: string
  startAt: Date | null; endAt: Date | null; allDay: boolean
  address: string; assignedTo: string; notes: string; source: string; jobId: string | null
  contact: { firstName: string; lastName: string; phone: string | null; email: string | null; serviceAddress: string | null }
}

export interface SpecInputs {
  /** Where the CRM is opened, no trailing slash. Links in descriptions point here. */
  baseUrl: string
  /** Working weekdays, 0 = Sunday. Used to span a multi day job. */
  workDays: number[]
  crews: Array<{ id: string; name: string }>
  jobs: JobRow[]
  gridJobs: GridRow[]
  leads: LeadRow[]
  contacts: ContactRow[]
  appointments: AppointmentRow[]
  /** The usual person on appointments; others get their name in the title. */
  defaultPerson?: string
}

// Same stage groups as the web app's pipelineValue.ts.
const PRE_SALE = new Set(['First Contact', 'Appointment', 'Estimating', 'Pending Signature'])
const PRODUCTION = new Set(['Signed Contract', 'Job Prep', 'Pending Start', 'Jobs In Progress'])

const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'))
const money = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fullName = (first?: string | null, last?: string | null) => `${first || ''} ${last && last !== '-' ? last : ''}`.replace(/\s+/g, ' ').trim()

export function addDays(date: string, days: number): string {
  const d = new Date(date + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
const weekday = (date: string) => new Date(date + 'T00:00:00Z').getUTCDay()

/** The next working day after `date`. With no working days set, simply the next day. */
export function nextWorkday(date: string, workDays: number[]): string {
  if (workDays.length === 0) return addDays(date, 1)
  let d = addDays(date, 1)
  for (let i = 0; i < 7 && !workDays.includes(weekday(d)); i++) d = addDays(d, 1)
  return d
}

/** The last day of a job that starts on `start` and takes `days` working days. */
export function lastWorkday(start: string, days: number, workDays: number[]): string {
  let d = start
  for (let i = 1; i < Math.max(1, Math.round(days)); i++) d = nextWorkday(d, workDays)
  return d
}

function installTitle(name: string, style: string, sections: number): string {
  const bits = [style?.trim(), sections > 0 ? `${sections} section${sections === 1 ? '' : 's'}` : ''].filter(Boolean)
  return `Install: ${name || 'Unknown'}` + (bits.length ? ` (${bits.join(', ')})` : '')
}

function describe(lines: Array<[string, string | number | null | undefined | false]>, notes: string | null | undefined, link: string | null): string {
  const out = lines.filter(([, v]) => v !== null && v !== undefined && v !== false && String(v).trim() !== '').map(([k, v]) => `${k}: ${v}`)
  if (notes && notes.trim()) out.push('', `Notes: ${notes.trim()}`)
  if (link) out.push('', `Open in EZ Biz: ${link}`)
  return out.join('\n')
}

const gates = (walk: number, dbl: number) => {
  const bits = [walk > 0 ? `${walk} walk` : '', dbl > 0 ? `${dbl} double` : ''].filter(Boolean)
  return bits.length ? bits.join(', ') : null
}

export function buildDesiredEvents(inp: SpecInputs): CalendarEventSpec[] {
  const out: CalendarEventSpec[] = []
  const link = (customerId?: string | null) => (customerId ? `${inp.baseUrl}/?customer=${encodeURIComponent(customerId)}` : null)
  const crewName = (id: string) => inp.crews.find(c => c.id === id)?.name || id
  const jobsById = new Map(inp.jobs.map(j => [j.id, j]))

  // ── Schedule board ──
  // Entries for the same job (or, with no job, the same client) on back to
  // back working days are one visit. The earliest entry names the event.
  const dated = inp.gridJobs.filter(g => isDate(g.date))
  const groups = new Map<string, GridRow[]>()
  for (const g of dated) {
    const k = g.stagingJobId ? `job:${g.stagingJobId}` : `name:${norm(g.clientName)}`
    const list = groups.get(k)
    if (list) list.push(g); else groups.set(k, [g])
  }
  const jobsOnBoard = new Set<string>()
  for (const rows of groups.values()) {
    rows.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
    let run: GridRow[] = []
    const flush = () => {
      if (run.length === 0) return
      const first = run[0], last = run[run.length - 1]
      const job = first.stagingJobId ? jobsById.get(first.stagingJobId) : undefined
      if (job) jobsOnBoard.add(job.id)
      const rain = run.every(r => r.status === 'RainDay' || r.status === 'Rain Day')
      const title = job ? installTitle(job.customerName, job.fenceStyle || first.fenceType, job.sections || first.sections)
                        : installTitle(first.clientName, first.fenceType, first.sections)
      const notes = [...new Set(run.map(r => r.notes?.trim()).filter(Boolean))].join(' / ') || (job?.notes ?? '')
      out.push({
        source: 'grid', recordId: first.id,
        summary: (rain ? 'Rain day: ' : '') + title,
        location: job?.customerAddress || first.area || '',
        description: describe([
          ['Phone', job?.customerPhone],
          ['Fence style', job?.fenceStyle || first.fenceType],
          ['Footage', job && job.totalFeet > 0 ? `${job.totalFeet} ft` : null],
          ['Sections', (job?.sections || first.sections) > 0 ? (job?.sections || first.sections) : null],
          ['Gates', job ? gates(job.walkGates, job.dblGates) : null],
          ['Quote price', (job ? job.contractValue || job.quotePrice : first.jobPrice) > 0 ? money(job ? job.contractValue || job.quotePrice : first.jobPrice) : null],
          ['Tear out', first.tearout ? 'yes' : null],
          ['Area', first.area],
          ['Crew', first.crewId ? crewName(first.crewId) : null],
        ], notes, link(job?.crmContactId)),
        startDate: first.date, endDate: last.date,
      })
      run = []
    }
    for (const r of rows) {
      const prev = run[run.length - 1]
      if (prev && r.date > nextWorkday(prev.date, inp.workDays)) flush()
      run.push(r)
    }
    flush()
  }

  // ── Jobs with a scheduled date ──
  const customersWithInstall = new Set<string>()
  for (const j of inp.jobs) {
    if (jobsOnBoard.has(j.id)) { if (j.crmContactId) customersWithInstall.add(j.crmContactId); continue }
    if (!isDate(j.scheduledDate)) continue
    if (j.crmContactId) customersWithInstall.add(j.crmContactId)
    const end = isDate(j.scheduledEndDate) && j.scheduledEndDate >= j.scheduledDate
      ? j.scheduledEndDate : lastWorkday(j.scheduledDate, j.estimatedDays || 1, inp.workDays)
    out.push({
      source: 'job', recordId: j.id,
      summary: installTitle(j.customerName, j.fenceStyle, j.sections),
      location: j.customerAddress || '',
      description: describe([
        ['Phone', j.customerPhone],
        ['Fence style', j.fenceStyle],
        ['Footage', j.totalFeet > 0 ? `${j.totalFeet} ft` : null],
        ['Sections', j.sections > 0 ? j.sections : null],
        ['Gates', gates(j.walkGates, j.dblGates)],
        ['Quote price', (j.contractValue || j.quotePrice) > 0 ? money(j.contractValue || j.quotePrice) : null],
        ['Crew', j.crewAssigned],
      ], j.notes, link(j.crmContactId)),
      startDate: j.scheduledDate, endDate: end,
    })
  }

  // ── Pipeline cards ──
  const estimateByCustomer = new Map<string, Set<string>>()
  for (const l of inp.leads) {
    if (!isDate(l.scheduledDate)) continue
    const name = fullName(l.firstName, l.lastName)
    const common = { location: l.address || '', startDate: l.scheduledDate, endDate: l.scheduledDate }
    const details: Array<[string, string | number | null | undefined | false]> = [
      ['Phone', l.phone], ['Email', l.email], ['Fence style', l.fenceType],
      ['Sections', (l.sections || 0) > 0 ? l.sections : null],
      ['Quote price', (l.quotePrice || 0) > 0 ? money(l.quotePrice as number) : null],
    ]
    if (PRE_SALE.has(l.stage)) {
      out.push({ source: 'lead', recordId: l.id, summary: `Estimate: ${name || 'Unknown'}`, description: describe(details, l.notes, link(l.customerId)), ...common })
      if (l.customerId) (estimateByCustomer.get(l.customerId) ?? estimateByCustomer.set(l.customerId, new Set()).get(l.customerId)!).add(l.scheduledDate)
    } else if (PRODUCTION.has(l.stage) && !(l.customerId && customersWithInstall.has(l.customerId))) {
      out.push({ source: 'lead', recordId: l.id, summary: installTitle(name, l.fenceType || '', l.sections || 0), description: describe(details, l.notes, link(l.customerId)), ...common })
    }
  }

  // ── Customers' first appointment ──
  for (const c of inp.contacts) {
    if (!isDate(c.firstApptDate)) continue
    if (estimateByCustomer.get(c.id)?.has(c.firstApptDate)) continue
    out.push({
      source: 'contact', recordId: c.id,
      summary: `Estimate: ${fullName(c.firstName, c.lastName) || 'Unknown'}`,
      location: c.serviceAddress || '',
      description: describe([['Phone', c.phone], ['Email', c.email]], null, link(c.id)),
      startDate: c.firstApptDate, endDate: c.firstApptDate,
    })
  }

  // ── Appointments ──
  // Imported history never goes to the calendar, nor does anything cancelled
  // or missed. An install linked to a job is already there as the job.
  const LABEL: Record<string, string> = {
    estimate: 'Estimate', follow_up: 'Follow up', contract_signing: 'Contract signing', install: 'Install',
    service: 'Service', warranty: 'Warranty', call_back: 'Call back', other: 'Appointment',
  }
  for (const a of inp.appointments) {
    if (a.source === 'import' || !a.startAt || ['cancelled', 'no_show'].includes(a.status)) continue
    if (a.type === 'install' && a.jobId) continue
    const name = fullName(a.contact.firstName, a.contact.lastName) || 'Unknown'
    const who = a.assignedTo && inp.defaultPerson && a.assignedTo !== inp.defaultPerson ? ` (${a.assignedTo})` : ''
    const done = a.status === 'completed' ? '✓ ' : ''
    const common = {
      source: 'appointment' as const, recordId: a.id,
      summary: `${done}${LABEL[a.type] || 'Appointment'}: ${name}${who}`,
      location: a.address || a.contact.serviceAddress || '',
      description: describe([['Phone', a.contact.phone], ['Email', a.contact.email], ['With', a.assignedTo || null]], a.notes, link(a.crmContactId)),
    }
    if (a.allDay) {
      const first = florida(a.startAt)
      out.push({ ...common, startDate: first, endDate: a.endAt ? florida(new Date(a.endAt.getTime() - 1)) : first })
    } else {
      const end = a.endAt && a.endAt > a.startAt ? a.endAt : new Date(a.startAt.getTime() + 60 * 60_000)
      out.push({ ...common, startAt: a.startAt.toISOString(), endAt: end.toISOString(), reminderMinutes: 30 })
    }
  }
  return out
}

function norm(s: string): string { return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() }

function florida(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

export const eventKey = (e: { source: string; recordId: string }) => `${e.source}:${e.recordId}`

/** Changes whenever anything Google would show changes. */
export function specHash(e: CalendarEventSpec): string {
  return createHash('sha1').update(JSON.stringify([e.summary, e.location, e.description, e.startDate, e.endDate, e.startAt, e.endAt, e.reminderMinutes ?? null])).digest('hex')
}

/** The day an event ends, in Florida. Used to decide what counts as upcoming. */
export function lastDayOf(e: CalendarEventSpec): string {
  if (e.endDate) return e.endDate
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(e.endAt as string))
}

/**
 * A Google event id for a CRM record. Always the same for the same record, so
 * sending it twice can never make two events. (Google ids allow 0-9 and a-v.)
 */
export function googleEventId(accountId: string, e: { source: string; recordId: string }): string {
  return 'gdf' + createHash('sha1').update(`${accountId}|${e.source}|${e.recordId}`).digest('hex')
}
