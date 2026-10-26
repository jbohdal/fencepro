/**
 * A job's milestones, worked out on the server from the job's records
 * (portal lib/jobReadiness.ts, lib/jobTruth.ts): the Milestone Checklist on
 * the job page and the count on each Operations card. A hand tick is saved on
 * the server and comes back labeled "ticked by hand".
 */

import { useEffect, useState } from 'react'
import { sendJson } from './syncHttp'
import type { Milestone } from '../../portal/src/server/lib/jobReadiness'

export type { Milestone }
export interface JobMilestones { milestones: Milestone[]; complete: number; total: number; closeOut?: 'mark_installed' | null }

/** Fired after anything that can change a job's milestones (a locate, a permit, a tick). */
export const MILESTONES_EVENT = 'ezbiz:milestones:changed'
export function milestonesChanged(): void { try { window.dispatchEvent(new CustomEvent(MILESTONES_EVENT)) } catch { /* no window */ } }

export async function fetchMilestones(jobId: string): Promise<{ ok: true; data: JobMilestones } | { ok: false; error: string }> {
  const r = await sendJson('GET', `/api/saved-jobs/${encodeURIComponent(jobId)}/milestones`)
  return r.result.ok && r.json?.data ? { ok: true, data: r.json.data as JobMilestones } : { ok: false, error: r.json?.error || 'The milestones need signal to load.' }
}

export async function tickMilestone(jobId: string, label: string, ticked: boolean): Promise<{ ok: true; data: JobMilestones } | { ok: false; error: string }> {
  const r = await sendJson('POST', `/api/saved-jobs/${encodeURIComponent(jobId)}/milestones`, { label, ticked })
  if (r.result.ok && r.json?.data) { milestonesChanged(); return { ok: true, data: r.json.data as JobMilestones } }
  return { ok: false, error: r.json?.error || (r.status === 0 ? 'No signal. Try again when the phone has signal.' : 'Could not save the tick.') }
}

/** One job's milestones, reloaded when the job or anything behind it changes. */
export function useJobMilestones(jobId: string, version: unknown): { data: JobMilestones | null; error: string; setData: (d: JobMilestones) => void } {
  const [data, setData] = useState<JobMilestones | null>(null)
  const [error, setError] = useState('')
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const on = () => setTick(t => t + 1)
    window.addEventListener(MILESTONES_EVENT, on)
    window.addEventListener('fencepro:jobs:updated', on)
    return () => { window.removeEventListener(MILESTONES_EVENT, on); window.removeEventListener('fencepro:jobs:updated', on) }
  }, [])
  useEffect(() => {
    let live = true
    fetchMilestones(jobId).then(r => { if (!live) return; if (r.ok) { setData(r.data); setError('') } else setError(r.error) })
    return () => { live = false }
  }, [jobId, version, tick])
  return { data, error, setData }
}

let summary: Record<string, { complete: number; total: number; permitOk?: boolean }> = {}
let loading: Promise<void> | null = null
const SUMMARY_EVENT = 'ezbiz:milestones:summary'
async function loadSummary(): Promise<void> {
  if (loading) return loading
  loading = (async () => {
    const r = await sendJson('GET', '/api/saved-jobs/milestones/summary')
    if (r.result.ok && r.json?.data) { summary = r.json.data; try { window.dispatchEvent(new CustomEvent(SUMMARY_EVENT)) } catch { /* no window */ } }
  })().finally(() => { loading = null })
  return loading
}

/** The job's permit is not needed or issued (the server's milestones summary): Advance passes over Permit Pending. */
export const permitOkOf = (jobId: string): boolean => summary[jobId]?.permitOk === true

/** Every job's milestone count, for the Operations cards (one request for the board). */
export function useMilestoneSummary(): Record<string, { complete: number; total: number; permitOk?: boolean }> {
  const [, setN] = useState(0)
  useEffect(() => {
    const on = () => setN(n => n + 1)
    // Jobs change often (every refresh): one reload a second at most.
    let timer: ReturnType<typeof setTimeout> | null = null
    const reload = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => { timer = null; void loadSummary() }, 1000) }
    window.addEventListener(SUMMARY_EVENT, on)
    window.addEventListener(MILESTONES_EVENT, reload)
    window.addEventListener('fencepro:jobs:updated', reload)
    void loadSummary()
    return () => { window.removeEventListener(SUMMARY_EVENT, on); window.removeEventListener(MILESTONES_EVENT, reload); window.removeEventListener('fencepro:jobs:updated', reload) }
  }, [])
  return summary
}
