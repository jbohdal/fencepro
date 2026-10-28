/**
 * Keep what is on screen current. The server changes some things on its own
 * (a customer accepts a proposal online: the quote is sold, the card moves,
 * the job appears in Operations; the website adds a lead), so the lists are
 * read again when the app comes back on screen, when signal returns, and
 * every minute while it is open. Changes still waiting on this phone stay on
 * top of what the server sends.
 */

import { refreshOptionLists } from './optionListsStore'
import { refreshQuotes } from './quoteStore'
import { refreshJobs } from './jobStore'
import { refreshPipeline } from './pipelineStore'
import { refreshCustomers } from './customerStore'
import { refreshAppointments } from './appointmentsStore'
import { refreshOpsStages } from './opsStagesStore'
import { refreshPipelineStages } from './pipelineStagesStore'
import { refreshBookingTeam } from './bookingTeamStore'
import { refreshSchedule } from './scheduleStore'

let started = false
let last = 0

async function readAgain(force = false) {
  if (!force && typeof document !== 'undefined' && document.visibilityState !== 'visible') return
  if (!force && Date.now() - last < 15_000) return
  last = Date.now()
  // Small checks: quotes, jobs, customers and appointments ask only for what changed since the last read
  // (?since=), the pipeline only whether its version moved (audit #17).
  await Promise.allSettled([refreshQuotes(), refreshJobs(), refreshPipeline(), refreshCustomers(), refreshOpsStages(), refreshPipelineStages(), refreshOptionLists(), refreshBookingTeam(), refreshSchedule(), refreshAppointments()])
  // What an open screen reads for itself (a job's change orders: ChangeOrders.tsx useChangeOrdersLive) reads again too.
  try { window.dispatchEvent(new CustomEvent(LIVE_REFRESH_EVENT)) } catch { /* no window */ }
}

/** Sent after each live refresh, for what a screen reads for itself. */
export const LIVE_REFRESH_EVENT = 'ezbiz:live-refresh'

export function startLiveRefresh() {
  if (started) return
  started = true
  document.addEventListener('visibilitychange', () => { void readAgain() })
  window.addEventListener('focus', () => { void readAgain() })
  window.addEventListener('online', () => { void readAgain(true) })
  setInterval(() => { void readAgain() }, 60_000)
}

/** A screen that needs the newest copy now (Operations, the Sales Pipeline when opened). */
export const refreshNow = () => readAgain(true)
