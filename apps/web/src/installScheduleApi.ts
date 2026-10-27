/**
 * Scheduling installs, through the server (portal lib/installScheduling.ts):
 * the Ready to schedule list, booking (or moving) an install on crew days,
 * taking it off, and the rain day. After each change the jobs and the
 * Schedule board are read again, so every screen (Schedule, Dispatch, the job
 * page, Operations) shows it at once.
 *
 * Needs signal: a booking moves the job's stage, fills the crew days and
 * prepares the customer's text in one step on the server.
 */

import { sendJson } from './syncHttp'
import { newId } from './recordSync'
import { CHANGED_EVENT as FOLLOW_UPS_CHANGED } from './followUpStore'
import { refreshJobs } from './jobStore'
import { reloadSchedule } from './scheduleStore'
import { plainError } from './plainError'
import { notifyStageBlocked } from './stageBlocked'
import type { ReadyFacts, Ymd } from '../../portal/src/server/lib/installDays'

export interface ReadyJob extends ReadyFacts {
  id: string
  customerName: string
  address: string
  phone: string
  crmContactId: string | null
  quoteId: string | null
  fenceStyle: string
  footage: number
  sections: number
  crewDays: number
  crewDaysFrom: 'quote' | 'estimate'
  stage: string
  stageName: string
  scheduledDate: string
  scheduledEndDate: string | null
  crewAssigned: string
  bookedDays: Ymd[]
  depositCents: number
  depositPaidCents: number
  allowWeekend: boolean
}

export interface PreparedText {
  jobId: string
  customerName: string
  phone: string
  body: string
  allowed: boolean
  reason: string | null
  callFrom: 'rep' | 'company'
}

export interface ScheduleResult {
  job: { id: string; opsStage: string; scheduledDate: string; scheduledEndDate: string | null; crewAssigned: string }
  days: Ymd[]
  crew: { id: string; name: string }
  movedFrom: Ymd | null
  rescheduled: boolean
  previousStart: Ymd | null
  text: PreparedText
  calendar: string
}

export interface RainMove {
  jobId: string | null
  customerName: string
  startFrom: Ymd
  startTo: Ymd
  days: Array<{ id: string; from: Ymd; to: Ymd }>
  text: PreparedText | null
  clashes?: string[]
}

export type Answer<T> = { ok: true; data: T } | { ok: false; error: string }

async function call<T>(method: string, path: string, body?: unknown): Promise<Answer<T>> {
  const r = await sendJson(method, `/api/schedule${path}`, body)
  if (r.result.ok) return { ok: true, data: r.json?.data as T }
  if (r.status === 409 && r.json?.code === 'STAGE_BLOCKED' && Array.isArray(r.json?.blocked)) notifyStageBlocked(r.json.blocked)
  return { ok: false, error: r.status === 0 ? 'No signal. Scheduling needs signal: try again when the phone has it.' : plainError(r.status, r.json?.error).message }
}

/** Everything else on screen follows the change. */
async function readAgain() { await Promise.allSettled([refreshJobs(), reloadSchedule()]) }

export const fetchReadyJobs = () => call<ReadyJob[]>('GET', '/ready')
export const fetchJobFacts = (jobId: string) => call<ReadyJob>('GET', `/ready/${encodeURIComponent(jobId)}`)

export async function scheduleInstall(req: { jobId: string; start: Ymd; crew?: string | null; days?: number | null; allowWeekend?: boolean }): Promise<Answer<ScheduleResult>> {
  const r = await call<ScheduleResult>('POST', '/install', req)
  if (r.ok) await readAgain()
  return r
}

export async function unscheduleInstall(jobId: string): Promise<Answer<{ job: { id: string; opsStage: string }; text: PreparedText; stageName: string }>> {
  const r = await call<{ job: { id: string; opsStage: string }; text: PreparedText; stageName: string }>('POST', `/install/${encodeURIComponent(jobId)}/off`, {})
  if (r.ok) await readAgain()
  return r
}

/** Jobs booked "The crew works weekends on this job". */
export const fetchWeekendJobs = () => call<string[]>('GET', '/weekend-jobs')

export const previewRainDay = (date: Ymd, shift = 1) => call<RainMove[]>('POST', '/rain-day/preview', { date, shift })

export async function applyRainDay(date: Ymd, shift: number, reason: string): Promise<Answer<RainMove[]>> {
  const r = await call<RainMove[]>('POST', '/rain-day', { date, shift, reason })
  if (r.ok) await readAgain()
  return r
}

/** What an install text is about: booked, moved, taken off the schedule, or moved by a rain day. */
export type InstallTextKind = 'scheduled' | 'moved' | 'off' | 'rain'

/**
 * "Did you send the text?" Yes: the install text goes in the customer's History
 * (and the card's), like a card text. Nothing is sent by the app. The id makes
 * a second tap one row; histories on screen read again.
 */
export async function noteInstallTexted(jobId: string, what: InstallTextKind, to: string, id: string = newId()): Promise<Answer<unknown>> {
  const r = await call<unknown>('POST', `/install/${encodeURIComponent(jobId)}/texted`, { id, what, to, at: new Date().toISOString() })
  if (r.ok) { try { window.dispatchEvent(new CustomEvent(FOLLOW_UPS_CHANGED)) } catch { /* no window */ } }
  return r
}
