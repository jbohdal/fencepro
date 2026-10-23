/**
 * Database-backed schedule persistence (settings + grid jobs + rain day log).
 * Mirrors savedQuotesApi.ts pattern. Account scoped on the server.
 */

import { isSignedIn, fetchWithAuth } from './crmAuth'
import { toast } from './toast'
import { LOCAL_API_ORIGIN } from './apiOrigin'
import { plainError, plainThrown } from './plainError'

const AUTH_API = (window.location.hostname === 'localhost' ? LOCAL_API_ORIGIN : '')

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
  const token = isSignedIn()
  if (!token) return { ok: false, error: 'Not authenticated' }
  try {
    const res = await fetchWithAuth(`${AUTH_API}/api/schedule${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (res.status === 401) return { ok: false, error: plainError(401).message }
    const json = await res.json().catch(() => ({}))
    if (!res.ok || json?.success === false) return { ok: false, error: plainError(res.status, json?.error).message }
    return { ok: true, data: json.data as T }
  } catch (err) {
    return { ok: false, error: plainThrown(err).message }
  }
}

// Settings
export async function fetchScheduleSettings(): Promise<ScheduleSettingsRecord | null> {
  const r = await call<ScheduleSettingsRecord>('GET', '/settings')
  return r.ok ? (r.data || null) : null
}
export async function saveScheduleSettings(payload: {
  workDays: number[]; crews: CrewRecord[]; lat?: number | null; lng?: number | null
}, baseVersion: number): Promise<ScheduleSettingsRecord | null> {
  const r = await call<ScheduleSettingsRecord>('PUT', '/settings', { ...payload, baseVersion })
  if (!r.ok) toast.error('Schedule settings not saved', r.error || plainError(0).message)
  return r.ok ? (r.data || null) : null
}

// Grid jobs
export async function fetchScheduledJobs(): Promise<ScheduledGridJobRecord[] | null> {
  const r = await call<ScheduledGridJobRecord[]>('GET', '/jobs')
  if (!r.ok) toast.error('Could not load schedule', r.error || plainError(0).message)
  return r.ok ? (r.data || []) : null
}
export async function createScheduledJob(payload: Omit<ScheduledGridJobRecord, 'id' | 'accountId'>): Promise<ScheduledGridJobRecord | null> {
  const r = await call<ScheduledGridJobRecord>('POST', '/jobs', payload)
  if (!r.ok) toast.error('Schedule entry not saved', r.error || plainError(0).message)
  return r.ok ? (r.data || null) : null
}
export async function updateScheduledJob(id: string, payload: Partial<ScheduledGridJobRecord>): Promise<ScheduledGridJobRecord | null> {
  const r = await call<ScheduledGridJobRecord>('PATCH', `/jobs/${id}`, payload)
  if (!r.ok) toast.error('Schedule entry not updated', r.error || plainError(0).message)
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
/** `id`: chosen by the screen, so the same rain day sent twice is logged once. */
export async function appendRainDay(payload: Omit<RainDayRecord, 'id' | 'accountId'> & { id?: string }): Promise<RainDayRecord | null> {
  const r = await call<RainDayRecord>('POST', '/rain-log', payload)
  if (!r.ok) toast.error('Rain day not logged', r.error || plainError(0).message)
  return r.ok ? (r.data || null) : null
}
export async function syncRainLog(entries: any[]): Promise<{ created: number; total: number } | null> {
  const r = await call<{ created: number; total: number }>('POST', '/rain-log/sync', { entries })
  return r.ok ? (r.data || null) : null
}
