/**
 * Database-backed schedule persistence (settings + grid jobs + rain day log).
 * Mirrors savedQuotesApi.ts pattern. Account scoped on the server.
 */

import { getAccessToken, fetchWithAuth } from './crmAuth'
import { toast } from './toast'

const AUTH_API = (window.location.hostname === 'localhost' ? 'http://localhost:4000' : '')

export interface CrewRecord { id: string; name: string; color: string }
export interface ScheduleSettingsRecord {
  id: string
  accountId: string
  workDays: number[]
  crews: CrewRecord[]
  lat: number | null
  lng: number | null
  updatedAt: string
}
export type ScheduledGridJobStatus = 'Scheduled' | 'InProgress' | 'Complete' | 'RainDay' | 'RolledOver'
export interface ScheduledGridJobRecord {
  id: string
  accountId: string
  stagingJobId: string | null
  clientName: string
  area: string
  sections: number
  fenceType: string
  jobPrice: number
  tearout: boolean
  crewId: string
  date: string
  notes: string
  status: ScheduledGridJobStatus
}
export interface RainDayRecord {
  id: string
  accountId: string
  jobId: string
  clientName: string
  originalDate: string
  rescheduleDate: string
  reason: string
  flaggedAt: string
}

async function call<T>(method: string, path: string, body?: unknown): Promise<{ ok: boolean; data?: T; error?: string }> {
  const token = getAccessToken()
  if (!token) return { ok: false, error: 'Not authenticated' }
  try {
    const res = await fetchWithAuth(`${AUTH_API}/api/schedule${path}`, {
      method,
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (res.status === 401) return { ok: false, error: 'Session expired' }
    const json = await res.json().catch(() => ({}))
    if (!res.ok || json?.success === false) return { ok: false, error: json?.error || `HTTP ${res.status}` }
    return { ok: true, data: json.data as T }
  } catch (err) {
    return { ok: false, error: (err as Error).message || 'Network error' }
  }
}

// Settings
export async function fetchScheduleSettings(): Promise<ScheduleSettingsRecord | null> {
  const r = await call<ScheduleSettingsRecord>('GET', '/settings')
  return r.ok ? (r.data || null) : null
}
export async function saveScheduleSettings(payload: {
  workDays: number[]; crews: CrewRecord[]; lat?: number | null; lng?: number | null
}): Promise<ScheduleSettingsRecord | null> {
  const r = await call<ScheduleSettingsRecord>('PUT', '/settings', payload)
  if (!r.ok) toast.error('Schedule settings not saved', `${r.error || 'Network error'}`)
  return r.ok ? (r.data || null) : null
}

// Grid jobs
export async function fetchScheduledJobs(): Promise<ScheduledGridJobRecord[] | null> {
  const r = await call<ScheduledGridJobRecord[]>('GET', '/jobs')
  if (!r.ok) toast.error('Could not load schedule', `${r.error || 'Network error'}`)
  return r.ok ? (r.data || []) : null
}
export async function createScheduledJob(payload: Omit<ScheduledGridJobRecord, 'id' | 'accountId'>): Promise<ScheduledGridJobRecord | null> {
  const r = await call<ScheduledGridJobRecord>('POST', '/jobs', payload)
  if (!r.ok) toast.error('Schedule entry not saved', `${r.error || 'Network error'}`)
  return r.ok ? (r.data || null) : null
}
export async function updateScheduledJob(id: string, payload: Partial<ScheduledGridJobRecord>): Promise<ScheduledGridJobRecord | null> {
  const r = await call<ScheduledGridJobRecord>('PATCH', `/jobs/${id}`, payload)
  if (!r.ok) toast.error('Schedule entry not updated', `${r.error || 'Network error'}`)
  return r.ok ? (r.data || null) : null
}
export async function deleteScheduledJob(id: string): Promise<boolean> {
  const r = await call('DELETE', `/jobs/${id}`)
  return r.ok
}
/**
 * Upsert scheduled jobs. With `replace: true` the list is the whole board and
 * the server removes anything not in it; only pass that after the schedule
 * has been loaded from the server.
 */
export async function syncScheduledJobs(jobs: any[], opts: { replace?: boolean } = {}): Promise<{ created: number; updated: number; total: number } | null> {
  const r = await call<{ created: number; updated: number; total: number }>('POST', '/jobs/sync', { jobs, replace: !!opts.replace })
  return r.ok ? (r.data || null) : null
}

// Rain day log
export async function fetchRainLog(): Promise<RainDayRecord[] | null> {
  const r = await call<RainDayRecord[]>('GET', '/rain-log')
  return r.ok ? (r.data || []) : null
}
export async function appendRainDay(payload: Omit<RainDayRecord, 'id' | 'accountId'>): Promise<RainDayRecord | null> {
  const r = await call<RainDayRecord>('POST', '/rain-log', payload)
  if (!r.ok) toast.error('Rain day not logged', `${r.error || 'Network error'}`)
  return r.ok ? (r.data || null) : null
}
export async function syncRainLog(entries: any[]): Promise<{ created: number; total: number } | null> {
  const r = await call<{ created: number; total: number }>('POST', '/rain-log/sync', { entries })
  return r.ok ? (r.data || null) : null
}

const SCHEDULE_MIGRATION_FLAG = 'fencepro_schedule_db_migrated_v1'

export async function migrateLocalScheduleOnce(): Promise<void> {
  if (localStorage.getItem(SCHEDULE_MIGRATION_FLAG) === '1') return
  const token = getAccessToken()
  if (!token) return
  try {
    // Settings
    try {
      const raw = localStorage.getItem('fencepro_schedule')
      const blob = raw ? JSON.parse(raw) : null
      if (blob?.settings) {
        await saveScheduleSettings({
          workDays: Array.isArray(blob.settings.workDays) ? blob.settings.workDays : [1, 2, 3, 4],
          crews: Array.isArray(blob.settings.crews) ? blob.settings.crews : [],
        })
      }
      if (Array.isArray(blob?.jobs) && blob.jobs.length > 0) {
        await syncScheduledJobs(blob.jobs.map((j: any) => ({
          id: j.id,
          stagingJobId: j.stagingJobId || undefined,
          clientName: j.clientName || '',
          area: j.area || '',
          sections: j.sections || 0,
          fenceType: j.fenceType || '',
          jobPrice: j.jobPrice || 0,
          tearout: !!j.tearout,
          crewId: j.crewId || '',
          date: j.date || '',
          notes: j.notes || '',
          status: ['Scheduled', 'In Progress', 'Complete', 'Rain Day', 'Rolled Over'].includes(j.status)
            ? (j.status === 'In Progress' ? 'InProgress' : j.status === 'Rain Day' ? 'RainDay' : j.status === 'Rolled Over' ? 'RolledOver' : j.status)
            : 'Scheduled',
        })))
      }
    } catch {}
    // Rain log
    try {
      const raw = localStorage.getItem('fencepro_rainlog')
      const log = raw ? JSON.parse(raw) : []
      if (Array.isArray(log) && log.length > 0) {
        await syncRainLog(log.map((e: any) => ({
          jobId: e.jobId || '',
          clientName: e.clientName || '',
          originalDate: e.originalDate || '',
          rescheduleDate: e.rescheduleDate || '',
          reason: e.reason || '',
          flaggedAt: e.flaggedAt || new Date().toISOString(),
        })))
      }
    } catch {}
    localStorage.setItem(SCHEDULE_MIGRATION_FLAG, '1')
    try { localStorage.removeItem('fencepro_schedule') } catch {}
    try { localStorage.removeItem('fencepro_rainlog') } catch {}
  } catch {}
}
