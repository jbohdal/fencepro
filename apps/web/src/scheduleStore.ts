/**
 * Schedule store — in memory cache backed by /api/schedule/*.
 *
 * Replaces the prior `localStorage.fencepro_schedule` and `fencepro_rainlog`
 * blobs. Preserves the existing call shape used by SchedulePage and
 * DispatchPage (loadSchedule + saveSchedule + loadRainLog + saveRainLog) so
 * the rain day cascade, work day config, crews with colors, and Twilio SMS
 * preview UX in those files keeps working.
 *
 * Writes are eager: every saveSchedule fires PUT /settings + POST /jobs/sync
 * in the background. Rain log appends are individual POSTs.
 */

import {
  fetchScheduleSettings,
  fetchScheduledJobs,
  fetchRainLog,
  appendRainDay,
  migrateLocalScheduleOnce,
  type CrewRecord,
} from './scheduleApi'
import type { ScheduledJob, ScheduleSettings, RainDayEntry } from './SchedulePage'
import { createVersionedFlusher, versionedSave, legacyMigrationEnabled } from './syncGuard'

const AUTH_API = (window.location.hostname === 'localhost' ? 'http://localhost:4000' : '')

const SETTINGS_EVT = 'fencepro:schedule:updated'
const RAIN_EVT = 'fencepro:rainlog:updated'

const DEFAULT_SETTINGS: ScheduleSettings = {
  workDays: [1, 2, 3, 4],
  crews: [{ id: 'crew1', name: 'Crew 1', color: 'bg-blue-500' }],
}

let cacheJobs: ScheduledJob[] = []
let cacheSettings: ScheduleSettings = DEFAULT_SETTINGS
let cacheRain: RainDayEntry[] = []
let initPromise: Promise<void> | null = null
let hydrated = false

function statusFromApi(s: string): ScheduledJob['status'] {
  if (s === 'InProgress') return 'In Progress'
  if (s === 'RainDay') return 'Rain Day'
  if (s === 'RolledOver') return 'Rolled Over'
  return s as ScheduledJob['status']
}
function statusToApi(s: ScheduledJob['status']): 'Scheduled' | 'InProgress' | 'Complete' | 'RainDay' | 'RolledOver' {
  if (s === 'In Progress') return 'InProgress'
  if (s === 'Rain Day') return 'RainDay'
  if (s === 'Rolled Over') return 'RolledOver'
  return s
}

function emit(name: string) {
  try { window.dispatchEvent(new CustomEvent(name)) } catch {}
}

export function initSchedule(): Promise<void> {
  if (hydrated) return Promise.resolve()
  if (initPromise) return initPromise
  initPromise = (async () => {
    if (legacyMigrationEnabled()) { try { await migrateLocalScheduleOnce() } catch {} }
    const [settings, jobs, rain] = await Promise.all([
      fetchScheduleSettings(),
      fetchScheduledJobs(),
      fetchRainLog(),
    ])
    // The board is saved as a whole, so it only counts as loaded when both
    // the settings and the job list actually came back.
    if (!settings || !jobs) return
    if (settings) {
      cacheSettings = {
        workDays: Array.isArray(settings.workDays) ? settings.workDays : [1, 2, 3, 4],
        crews: Array.isArray(settings.crews) ? (settings.crews as CrewRecord[]) : DEFAULT_SETTINGS.crews,
      }
    }
    if (jobs) cacheJobs = jobs.map(jobFromApi)
    flusher.loaded(boardNow(), typeof (settings as { version?: number }).version === 'number' ? (settings as unknown as { version: number }).version : 0)
    if (rain) {
      cacheRain = rain.map(r => ({
        id: r.id,
        jobId: r.jobId,
        clientName: r.clientName,
        originalDate: r.originalDate,
        rescheduleDate: r.rescheduleDate,
        reason: r.reason,
        flaggedAt: r.flaggedAt,
      }))
    }
    hydrated = true
    emit(SETTINGS_EVT)
    emit(RAIN_EVT)
  })().finally(() => { if (!hydrated) initPromise = null })
  return initPromise
}

/** True once the schedule has loaded from the server. */
export function isScheduleHydrated(): boolean { return hydrated }

function jobFromApi(j: any): ScheduledJob {
  return {
    id: j.id,
    clientName: j.clientName,
    area: j.area,
    sections: j.sections,
    fenceType: j.fenceType,
    jobPrice: j.jobPrice,
    tearout: j.tearout,
    crewId: j.crewId,
    date: j.date,
    notes: j.notes,
    stagingJobId: j.stagingJobId || undefined,
    status: statusFromApi(j.status),
  }
}
function jobToApi(j: ScheduledJob) {
  return {
    id: j.id,
    stagingJobId: j.stagingJobId || undefined,
    clientName: j.clientName,
    area: j.area,
    sections: j.sections,
    fenceType: j.fenceType,
    jobPrice: j.jobPrice,
    tearout: j.tearout,
    crewId: j.crewId,
    date: j.date,
    notes: j.notes,
    status: statusToApi(j.status),
  }
}

// The whole board (settings and every job) is saved at once, and the save
// replaces the server's list. It only runs after the board has loaded, and it
// is version checked: if another tab or device saved first, this tab's change
// is put on top of the newest board and saved again (see syncGuard).
type BoardDoc = { settings: { workDays: number[]; crews: CrewRecord[] }; jobs: ScheduledJob[] }
const boardNow = (): BoardDoc => ({ settings: { workDays: cacheSettings.workDays, crews: cacheSettings.crews as CrewRecord[] }, jobs: cacheJobs })
const pickBoard = (d: any): BoardDoc => ({
  settings: {
    workDays: Array.isArray(d?.settings?.workDays) ? d.settings.workDays : [1, 2, 3, 4],
    crews: Array.isArray(d?.settings?.crews) ? d.settings.crews : (DEFAULT_SETTINGS.crews as CrewRecord[]),
  },
  jobs: Array.isArray(d?.jobs) ? d.jobs.map(jobFromApi) : [],
})
const flusher = createVersionedFlusher<BoardDoc>({
  name: 'Schedule',
  isHydrated: () => hydrated,
  debounceMs: 150,
  get: boardNow,
  apply: next => {
    cacheSettings = { ...cacheSettings, workDays: next.settings.workDays, crews: next.settings.crews }
    cacheJobs = next.jobs
    emit(SETTINGS_EVT)
  },
  save: (state, version) => versionedSave(`${AUTH_API}/api/schedule/board`, 'PUT', { settings: state.settings, jobs: state.jobs.map(jobToApi) }, version, pickBoard),
})

export function loadSchedule(): { jobs: ScheduledJob[]; settings: ScheduleSettings } {
  return { jobs: cacheJobs, settings: cacheSettings }
}

export function saveSchedule(jobs: ScheduledJob[], settings: ScheduleSettings): void {
  cacheJobs = jobs
  cacheSettings = settings
  emit(SETTINGS_EVT)
  flusher.schedule()
}

export function loadRainLog(): RainDayEntry[] {
  return cacheRain
}

export function saveRainLog(log: RainDayEntry[]): void {
  // The existing UX appends entries via SchedulePage; we detect any new
  // entries (in `log` but not in cache) and POST them individually.
  const existingIds = new Set(cacheRain.map(e => e.id))
  const newOnes = log.filter(e => !existingIds.has(e.id))
  cacheRain = log
  emit(RAIN_EVT)
  for (const e of newOnes) {
    appendRainDay({
      jobId: e.jobId,
      clientName: e.clientName,
      originalDate: e.originalDate,
      rescheduleDate: e.rescheduleDate,
      reason: e.reason,
      flaggedAt: e.flaggedAt,
    }).catch(() => {})
  }
}

export const SCHEDULE_UPDATED_EVENT = SETTINGS_EVT
export const RAIN_LOG_UPDATED_EVENT = RAIN_EVT
